import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// esbuild/tsup quita el prefijo `node:` de módulos que solo existen con prefijo
// (como node:sqlite) y rompe el import. getBuiltinModule evita el problema.
const sqlite = process.getBuiltinModule("node:sqlite");
if (!sqlite) throw new Error("Este servidor necesita Node.js >= 22.13 (módulo node:sqlite)");

export type DB = DatabaseSync;

type Migration = string | ((db: DB) => void);

const MIGRATIONS: Migration[] = [
  /* 1 */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE widgets (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    w INTEGER NOT NULL,
    h INTEGER NOT NULL
  );
  CREATE INDEX widgets_page ON widgets(page_id);
  CREATE TABLE prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event TEXT NOT NULL,
    username TEXT,
    ip TEXT,
    detail TEXT
  );
  `,
  /* 2: apariencia global del dashboard + estado editable de los widgets (notas, recordatorios) */ `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  ALTER TABLE widgets ADD COLUMN state TEXT NOT NULL DEFAULT '{}';
  DROP TABLE prefs;
  `,
  /* 3: contraseñas temporales que obligan a cambiarlas en el primer acceso */ `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  `,
  /* 4: conexiones compartidas (URL + credenciales de un servicio, escritas una sola vez) */ `
  CREATE TABLE connections (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  ALTER TABLE widgets ADD COLUMN connection_id TEXT REFERENCES connections(id) ON DELETE RESTRICT;
  CREATE INDEX widgets_connection ON widgets(connection_id);
  `,
  /* 5: los widgets que ya llevaban URL/API key pasan a usar una conexión */ moveWidgetCredentialsToConnections,
  /* 6: estilo propio por widget y fondo propio por página */ `
  ALTER TABLE widgets ADD COLUMN style TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE pages ADD COLUMN background TEXT;
  `,
];

/** Campos que antes vivían en cada widget y ahora pertenecen a la conexión del plugin. */
const LEGACY_CONNECTION: Record<string, { label: string; keys: string[]; identity: string[] }> = {
  jellyfin: { label: "Jellyfin", keys: ["url", "apiKey"], identity: ["url"] },
  speedtest: { label: "Speedtest Tracker", keys: ["url", "version", "apiKey"], identity: ["url", "version"] },
};

/**
 * Agrupa los widgets de Jellyfin/Speedtest que apuntaban al mismo servidor en una sola
 * conexión. Los secretos se copian tal cual (ya van cifrados), así que no hace falta la
 * clave maestra; por eso el grupo se decide por la URL y no por el secreto (cada cifrado
 * lleva un nonce distinto, aunque la clave sea la misma). Se conserva la del primer widget.
 */
function moveWidgetCredentialsToConnections(db: DB) {
  const rows = db.prepare("SELECT id, type, config FROM widgets").all() as {
    id: string;
    type: string;
    config: string;
  }[];
  const byGroup = new Map<string, string>(); // huella de la conexión → id
  const insert = db.prepare("INSERT INTO connections (id, plugin_id, name, config, created_at) VALUES (?,?,?,?,?)");
  const update = db.prepare("UPDATE widgets SET config = ?, connection_id = ? WHERE id = ?");

  for (const row of rows) {
    const pluginId = row.type.split(".")[0]!;
    const legacy = LEGACY_CONNECTION[pluginId];
    if (!legacy) continue;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(row.config);
    } catch {
      continue;
    }
    if (typeof config.url !== "string") continue;

    const conn: Record<string, unknown> = {};
    for (const k of legacy.keys) {
      if (config[k] !== undefined) conn[k] = config[k];
      delete config[k];
    }
    const fingerprint = pluginId + "|" + JSON.stringify(legacy.identity.map((k) => conn[k] ?? null));
    let id = byGroup.get(fingerprint);
    if (!id) {
      id = crypto.randomUUID();
      let host = "";
      try {
        host = new URL(String(conn.url)).host;
      } catch {
        /* se queda sin host en el nombre */
      }
      insert.run(id, pluginId, host ? `${legacy.label} (${host})` : legacy.label, JSON.stringify(conn), Date.now());
      byGroup.set(fingerprint, id);
    }
    update.run(JSON.stringify(config), id, row.id);
  }
}

const SESSION_IDLE_MS = 7 * 24 * 3600 * 1000;
const SESSION_ABSOLUTE_MS = 30 * 24 * 3600 * 1000;
const AUDIT_KEEP_MS = 180 * 24 * 3600 * 1000;
const AUDIT_KEEP_ROWS = 20_000;

/** Limpia sesiones caducadas y recorta el registro de auditoría. */
export function housekeeping(db: DB, now = Date.now()) {
  db.prepare("DELETE FROM sessions WHERE last_seen < ? OR created_at < ?").run(
    now - SESSION_IDLE_MS,
    now - SESSION_ABSOLUTE_MS,
  );
  db.prepare(
    `DELETE FROM audit_log WHERE ts < ? OR id <= (SELECT COALESCE(MAX(id), 0) - ? FROM audit_log)`,
  ).run(now - AUDIT_KEEP_MS, AUDIT_KEEP_ROWS);
}

export function openDb(dataDir: string | ":memory:"): DB {
  let file = ":memory:";
  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, "oblivion.db");
  }
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  if (file !== ":memory:") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* en Windows chmod es un no-op */
    }
  }
  return db;
}

/** Aplica las migraciones pendientes (hasta `target`, que solo cambian los tests). */
export function migrate(db: DB, target = MIGRATIONS.length) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < target; v++) {
    db.exec("BEGIN");
    try {
      const step = MIGRATIONS[v]!;
      if (typeof step === "string") db.exec(step);
      else step(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Ejecuta `fn` dentro de una transacción. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function audit(
  db: DB,
  event: string,
  info: { username?: string | null; ip?: string | null; detail?: string | null } = {},
) {
  db.prepare("INSERT INTO audit_log (ts, event, username, ip, detail) VALUES (?,?,?,?,?)").run(
    Date.now(),
    event,
    info.username ?? null,
    info.ip ?? null,
    info.detail ?? null,
  );
  // También a stdout (JSON por línea) para que Docker/Loki/etc. lo recojan.
  if (process.env.NODE_ENV !== "test") {
    console.log(JSON.stringify({ t: new Date().toISOString(), audit: event, ...info }));
  }
}
