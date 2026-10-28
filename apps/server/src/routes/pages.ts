import { Hono } from "hono";
import { z } from "zod";
import type { PageDTO, WidgetDTO } from "@oblivion/sdk";
import { GRID_COLUMNS } from "@oblivion/sdk";
import { requireAdmin, requireUser, type AppEnv } from "../auth.js";
import { audit, tx } from "../db.js";
import { buildStoredConfig, ConfigError, maskConfig } from "../plugins/config.js";
import { IMAGE_KEY } from "../plugins/schema.js";
import { emptyState, isStateful, validateState } from "../plugins/state.js";
import type { AppDeps } from "../app.js";

interface WidgetRow {
  id: string;
  page_id: string;
  type: string;
  title: string;
  config: string;
  state: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const title = z.string().trim().min(1).max(60);
const cell = z.number().int().min(0).max(1000);

export function pageRoutes(deps: AppDeps) {
  const { db, registry, runtime, box } = deps;
  const app = new Hono<AppEnv>();

  function toWidgetDTO(row: WidgetRow): WidgetDTO {
    const reg = registry.get(row.type);
    const stored = safeParse(row.config);
    // Si el plugin ya no existe, no mostramos nada de la config (puede tener secretos).
    const { config, secretsSet } = reg ? maskConfig(reg.def.config, stored) : { config: {}, secretsSet: [] };
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      config,
      state: safeParse(row.state),
      secretsSet,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
    };
  }

  function loadPages(): PageDTO[] {
    const pages = db.prepare("SELECT id, title, position FROM pages ORDER BY position, created_at").all() as {
      id: string;
      title: string;
      position: number;
    }[];
    const widgets = db.prepare("SELECT * FROM widgets ORDER BY y, x").all() as unknown as WidgetRow[];
    return pages.map((p) => ({
      ...p,
      widgets: widgets.filter((w) => w.page_id === p.id).map(toWidgetDTO),
    }));
  }

  app.get("/catalog", requireUser, (c) => c.json({ widgets: registry.catalog() }));
  app.get("/pages", requireUser, (c) => c.json({ pages: loadPages() }));

  // ───────── páginas ─────────

  app.post("/pages", requireAdmin, async (c) => {
    const parsed = z.object({ title }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Título inválido" }, 400);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n;
    if (count >= 20) return c.json({ error: "Máximo 20 páginas" }, 400);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pages (id, title, position, created_at) VALUES (?,?,?,?)").run(
      id,
      parsed.data.title,
      count,
      Date.now(),
    );
    return c.json({ page: { id, title: parsed.data.title, position: count, widgets: [] } }, 201);
  });

  app.patch("/pages/:id", requireAdmin, async (c) => {
    const parsed = z
      .object({ title: title.optional(), position: z.number().int().min(0).max(100).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    const id = c.req.param("id");
    if (!db.prepare("SELECT 1 FROM pages WHERE id = ?").get(id)) return c.json({ error: "No existe" }, 404);
    if (parsed.data.title) db.prepare("UPDATE pages SET title = ? WHERE id = ?").run(parsed.data.title, id);
    if (parsed.data.position !== undefined) {
      db.prepare("UPDATE pages SET position = ? WHERE id = ?").run(parsed.data.position, id);
    }
    return c.json({ ok: true });
  });

  app.delete("/pages/:id", requireAdmin, (c) => {
    const id = c.req.param("id");
    const count = (db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n;
    if (count <= 1) return c.json({ error: "Debe quedar al menos una página" }, 400);
    const ids = db.prepare("SELECT id FROM widgets WHERE page_id = ?").all(id) as { id: string }[];
    const res = db.prepare("DELETE FROM pages WHERE id = ?").run(id);
    if (res.changes === 0) return c.json({ error: "No existe" }, 404);
    ids.forEach((w) => runtime.invalidate(w.id));
    audit(db, "page_deleted", { username: c.get("user")!.username, detail: id });
    return c.json({ ok: true });
  });

  // ───────── layout ─────────

  app.put("/pages/:id/layout", requireAdmin, async (c) => {
    const parsed = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().max(64),
              x: cell,
              y: cell,
              w: z.number().int().min(1).max(GRID_COLUMNS),
              h: z.number().int().min(1).max(60),
            }),
          )
          .max(200),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Layout inválido" }, 400);
    const pageId = c.req.param("id");
    const stmt = db.prepare("UPDATE widgets SET x=?, y=?, w=?, h=? WHERE id=? AND page_id=?");
    tx(db, () => {
      for (const it of parsed.data.items) {
        if (it.x + it.w > GRID_COLUMNS) continue;
        stmt.run(it.x, it.y, it.w, it.h, it.id, pageId);
      }
    });
    return c.json({ ok: true });
  });

  // ───────── widgets ─────────

  app.post("/pages/:id/widgets", requireAdmin, async (c) => {
    const pageId = c.req.param("id");
    const parsed = z
      .object({ type: z.string().max(80), title: z.string().trim().max(60).optional(), config: z.unknown() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    if (!db.prepare("SELECT 1 FROM pages WHERE id = ?").get(pageId)) return c.json({ error: "No existe la página" }, 404);

    const reg = registry.get(parsed.data.type);
    if (!reg) return c.json({ error: "Tipo de widget desconocido" }, 400);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE page_id = ?").get(pageId) as { n: number }).n;
    if (count >= 100) return c.json({ error: "Máximo 100 widgets por página" }, 400);

    let stored;
    try {
      stored = buildStoredConfig(reg.def.config, parsed.data.config ?? {}, {}, box);
    } catch (err) {
      if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
      throw err;
    }

    const { w, h } = reg.def.defaultSize;
    const taken = db.prepare("SELECT x, y, w, h FROM widgets WHERE page_id = ?").all(pageId) as unknown as Rect[];
    const slot = findFreeSlot(taken, w, h);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO widgets (id, page_id, type, title, config, state, x, y, w, h) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      pageId,
      reg.fullType,
      parsed.data.title ?? "",
      JSON.stringify(stored),
      JSON.stringify(emptyState(reg.def.component)),
      slot.x,
      slot.y,
      w,
      h,
    );

    audit(db, "widget_added", { username: c.get("user")!.username, detail: reg.fullType });
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow;
    return c.json({ widget: toWidgetDTO(row) }, 201);
  });

  app.patch("/widgets/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const parsed = z
      .object({ title: z.string().trim().max(60).optional(), config: z.unknown().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);

    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const reg = registry.get(row.type);

    let configJson = row.config;
    if (parsed.data.config !== undefined) {
      if (!reg) return c.json({ error: "El plugin de este widget no está instalado" }, 400);
      try {
        configJson = JSON.stringify(
          buildStoredConfig(reg.def.config, parsed.data.config, safeParse(row.config), box),
        );
      } catch (err) {
        if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
        throw err;
      }
    }
    db.prepare("UPDATE widgets SET title = ?, config = ? WHERE id = ?").run(
      parsed.data.title ?? row.title,
      configJson,
      id,
    );
    runtime.invalidate(id);
    const updated = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow;
    return c.json({ widget: toWidgetDTO(updated) });
  });

  // Imágenes de las vistas «media»: el navegador pide una clave opaca y el servidor
  // la resuelve con el plugin; así nunca hay contacto directo con el servicio.
  app.get("/widgets/:id/image/:key", requireUser, async (c) => {
    const key = c.req.param("key");
    if (!IMAGE_KEY.test(key)) return c.json({ error: "No encontrado" }, 404);
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(c.req.param("id")) as unknown as
      | WidgetRow
      | undefined;
    const reg = row && registry.get(row.type);
    if (!row || !reg) return c.json({ error: "No encontrado" }, 404);
    const img = await runtime.getImage(row.id, reg, safeParse(row.config), key);
    if (!img) return c.json({ error: "No encontrado" }, 404);
    return new Response(img.bytes as unknown as BodyInit, {
      headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600" },
    });
  });

  // Estado editable desde el propio widget (texto de una nota, lista de recordatorios...).
  app.put("/widgets/:id/state", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const reg = registry.get(row.type);
    if (!reg || !isStateful(reg.def.component)) return c.json({ error: "Este widget no guarda estado" }, 400);

    let state;
    try {
      state = validateState(reg.def.component, await c.req.json().catch(() => null));
    } catch (err) {
      if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
      throw err;
    }
    db.prepare("UPDATE widgets SET state = ? WHERE id = ?").run(JSON.stringify(state), id);
    return c.json({ state });
  });

  app.delete("/widgets/:id", requireAdmin, (c) => {
    const id = c.req.param("id");
    const res = db.prepare("DELETE FROM widgets WHERE id = ?").run(id);
    if (res.changes === 0) return c.json({ error: "No existe" }, 404);
    runtime.invalidate(id);
    return c.json({ ok: true });
  });

  app.get("/widgets/:id/data", requireUser, async (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const reg = registry.get(row.type);
    if (!reg) return c.json({ ok: false, error: "Plugin no instalado" });
    return c.json(await runtime.getData(id, reg, safeParse(row.config)));
  });

  return app;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Primer hueco libre (de arriba abajo, de izquierda a derecha) donde cabe w×h. */
export function findFreeSlot(taken: Rect[], w: number, h: number): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    taken.some((t) => x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y);
  const maxY = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= GRID_COLUMNS; x++) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
