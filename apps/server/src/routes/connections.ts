import { Hono } from "hono";
import { z } from "zod";
import type { ConnectionDTO } from "@oblivion/sdk";
import { requireAdmin, type AppEnv } from "../auth.js";
import { audit } from "../db.js";
import { buildStoredConfig, ConfigError, maskConfig } from "../plugins/config.js";
import type { AppDeps } from "../app.js";

interface ConnectionRow {
  id: string;
  plugin_id: string;
  name: string;
  config: string;
}

const MAX_CONNECTIONS = 50;
const name = z.string().trim().min(1).max(60);

/**
 * Conexiones: la URL y las credenciales de un servicio (Jellyfin, Speedtest Tracker...)
 * se escriben una sola vez y todos los widgets del plugin las comparten. Solo las
 * gestiona el administrador y los secretos nunca salen del servidor.
 */
export function connectionRoutes(deps: AppDeps) {
  const { db, registry, runtime, box } = deps;
  const app = new Hono<AppEnv>();

  function toDTO(row: ConnectionRow): ConnectionDTO {
    const plugin = registry.plugin(row.plugin_id);
    // Si el plugin ya no está instalado no mostramos nada de la config (puede tener secretos).
    const { config, secretsSet } = plugin
      ? maskConfig(plugin.connection ?? [], safeParse(row.config))
      : { config: {}, secretsSet: [] };
    const used = db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE connection_id = ?").get(row.id) as { n: number };
    return { id: row.id, pluginId: row.plugin_id, name: row.name, config, secretsSet, widgets: used.n };
  }

  const find = (id: string) =>
    db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as unknown as ConnectionRow | undefined;

  app.get("/connections", requireAdmin, (c) => {
    const rows = db.prepare("SELECT * FROM connections ORDER BY plugin_id, name").all() as unknown as ConnectionRow[];
    return c.json({ connections: rows.map(toDTO) });
  });

  // «Probar conexión»: con los valores del formulario (los secretos en blanco usan los guardados).
  app.post("/connections/test", requireAdmin, async (c) => {
    const parsed = z
      .object({ pluginId: z.string().max(80), config: z.unknown(), id: z.string().max(64).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);

    const plugin = registry.plugin(parsed.data.pluginId);
    if (!plugin?.connection?.length) return c.json({ error: "Este plugin no usa conexiones" }, 400);
    if (!plugin.test) return c.json({ error: "Este plugin no puede probar la conexión" }, 400);

    let existing: Record<string, unknown> = {};
    if (parsed.data.id) {
      const row = find(parsed.data.id);
      if (!row || row.plugin_id !== plugin.id) return c.json({ error: "No existe" }, 404);
      existing = safeParse(row.config);
    }
    let stored;
    try {
      stored = buildStoredConfig(plugin.connection, parsed.data.config ?? {}, existing, box);
    } catch (err) {
      if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
      throw err;
    }
    return c.json(await runtime.testConnection(plugin, stored));
  });

  app.post("/connections", requireAdmin, async (c) => {
    const parsed = z
      .object({ pluginId: z.string().max(80), name, config: z.unknown() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);

    const plugin = registry.plugin(parsed.data.pluginId);
    if (!plugin?.connection?.length) return c.json({ error: "Este plugin no usa conexiones" }, 400);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM connections").get() as { n: number }).n;
    if (count >= MAX_CONNECTIONS) return c.json({ error: `Máximo ${MAX_CONNECTIONS} conexiones` }, 400);

    let stored;
    try {
      stored = buildStoredConfig(plugin.connection, parsed.data.config ?? {}, {}, box);
    } catch (err) {
      if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
      throw err;
    }

    const id = crypto.randomUUID();
    db.prepare("INSERT INTO connections (id, plugin_id, name, config, created_at) VALUES (?,?,?,?,?)").run(
      id,
      plugin.id,
      parsed.data.name,
      JSON.stringify(stored),
      Date.now(),
    );
    audit(db, "connection_created", { username: c.get("user")!.username, detail: `${plugin.id}: ${parsed.data.name}` });
    return c.json({ connection: toDTO(find(id)!) }, 201);
  });

  app.patch("/connections/:id", requireAdmin, async (c) => {
    const parsed = z
      .object({ name: name.optional(), config: z.unknown().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);

    const row = find(c.req.param("id"));
    if (!row) return c.json({ error: "No existe" }, 404);
    const plugin = registry.plugin(row.plugin_id);

    let configJson = row.config;
    if (parsed.data.config !== undefined) {
      if (!plugin?.connection?.length) return c.json({ error: "El plugin de esta conexión no está instalado" }, 400);
      try {
        configJson = JSON.stringify(buildStoredConfig(plugin.connection, parsed.data.config, safeParse(row.config), box));
      } catch (err) {
        if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
        throw err;
      }
    }
    db.prepare("UPDATE connections SET name = ?, config = ? WHERE id = ?").run(
      parsed.data.name ?? row.name,
      configJson,
      row.id,
    );

    // Los widgets que la usan deben volver a pedir sus datos con las credenciales nuevas.
    const users = db.prepare("SELECT id FROM widgets WHERE connection_id = ?").all(row.id) as { id: string }[];
    users.forEach((w) => runtime.invalidate(w.id));
    audit(db, "connection_updated", { username: c.get("user")!.username, detail: `${row.plugin_id}: ${row.name}` });
    return c.json({ connection: toDTO(find(row.id)!) });
  });

  app.delete("/connections/:id", requireAdmin, (c) => {
    const row = find(c.req.param("id"));
    if (!row) return c.json({ error: "No existe" }, 404);
    const used = (db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE connection_id = ?").get(row.id) as { n: number }).n;
    if (used > 0) {
      return c.json(
        { error: `La usan ${used} widget${used === 1 ? "" : "s"}. Elimínalos o cámbialos a otra conexión primero.` },
        409,
      );
    }
    db.prepare("DELETE FROM connections WHERE id = ?").run(row.id);
    audit(db, "connection_deleted", { username: c.get("user")!.username, detail: `${row.plugin_id}: ${row.name}` });
    return c.json({ ok: true });
  });

  return app;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
