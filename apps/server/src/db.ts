import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// esbuild/tsup quita el prefijo `node:` de módulos que solo existen con prefijo
// (como node:sqlite) y rompe el import. getBuiltinModule evita el problema.
const sqlite = process.getBuiltinModule("node:sqlite");
if (!sqlite) throw new Error("Este servidor necesita Node.js >= 22.13 (módulo node:sqlite)");

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
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
];

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

function migrate(db: DB) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
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
