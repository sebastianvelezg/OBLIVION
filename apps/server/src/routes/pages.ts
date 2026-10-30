import { Hono } from "hono";
import { z } from "zod";
import type { PageDTO, WidgetDTO, WidgetStyle } from "@oblivion/sdk";
import { GRID_COLUMNS } from "@oblivion/sdk";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin, requireUser, type AppEnv } from "../auth.js";
import { audit, tx } from "../db.js";
import { buildStoredConfig, ConfigError, maskConfig, normalizeUrl } from "../plugins/config.js";
import { backgroundSchema, collectBackgroundGarbage } from "./appearance.js";
import { BACKGROUND_ID_PATTERN } from "@oblivion/sdk";
import { IMAGE_KEY } from "../plugins/schema.js";
import { emptyState, isStateful, validateState } from "../plugins/state.js";
import type { RegisteredWidget } from "../plugins/registry.js";
import type { AppDeps } from "../app.js";

export interface WidgetRow {
  id: string;
  page_id: string;
  type: string;
  title: string;
  config: string;
  state: string;
  connection_id: string | null;
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const title = z.string().trim().min(1).max(60);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const styleSchema = z
  .object({
    titleMode: z.enum(["auto", "show", "hide"]).optional(),
    accent: hexColor.nullable().optional(),
    opacity: z.number().int().min(10).max(100).nullable().optional(),
    link: z.string().trim().max(500).nullable().optional(),
    bare: z.boolean().nullable().optional(),
    image: z.string().regex(BACKGROUND_ID_PATTERN).nullable().optional(),
    imageDim: z.number().int().min(0).max(85).nullable().optional(),
    imageBlur: z.number().int().min(0).max(24).nullable().optional(),
  })
  .strict();

/** Valida el estilo que llega del navegador y lo deja sin vacíos (lo que se guarda). */
export function buildStyle(input: unknown): WidgetStyle {
  const parsed = styleSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ConfigError("Estilo inválido");
  const { titleMode, accent, opacity, link, bare, image, imageDim, imageBlur } = parsed.data;
  const out: WidgetStyle = {};
  if (titleMode && titleMode !== "auto") out.titleMode = titleMode;
  if (accent) out.accent = accent.toLowerCase();
  if (opacity != null) out.opacity = opacity;
  if (link) out.link = normalizeUrl(link, "Enlace");
  if (bare) out.bare = true;
  if (image) {
    out.image = image;
    if (imageDim != null) out.imageDim = imageDim;
    if (imageBlur != null) out.imageBlur = imageBlur;
  }
  return out;
}

export function readStyle(json: string): WidgetStyle {
  try {
    return buildStyle(JSON.parse(json));
  } catch {
    return {};
  }
}
const cell = z.number().int().min(0).max(1000);

export function pageRoutes(deps: AppDeps) {
  const { db, registry, runtime, box, config: appConfig } = deps;
  const app = new Hono<AppEnv>();

  /** URL de cada conexión (para que el título del widget abra el servicio). */
  function connectionUrls(): Map<string, string> {
    const out = new Map<string, string>();
    const rows = db.prepare("SELECT id, config FROM connections").all() as { id: string; config: string }[];
    for (const r of rows) {
      const url = safeParse(r.config).url;
      if (typeof url !== "string") continue;
      // Los usuarios de solo lectura también ven este enlace: se quita lo que pudiera llevar un
      // secreto (?apikey=…, #token) y solo se conserva el origen y la ruta.
      try {
        const u = new URL(url);
        u.search = "";
        u.hash = "";
        out.set(r.id, u.toString());
      } catch {
        /* URL no válida: sin enlace */
      }
    }
    return out;
  }

  /** Error de validación del fondo de una página (o `null` si está bien). */
  function backgroundProblem(bg: { type: string; imageId: string | null } | null | undefined): string | null {
    if (!bg) return null;
    if (bg.imageId && !fs.existsSync(path.join(appConfig.uploadsDir, bg.imageId))) return "La imagen de fondo no existe";
    if (bg.type === "image" && !bg.imageId) return "Sube una imagen para usar el fondo «Foto»";
    return null;
  }

  const imageMissing = (style: WidgetStyle) =>
    !!style.image && !fs.existsSync(path.join(appConfig.uploadsDir, style.image));

  function toWidgetDTO(row: WidgetRow, urls: Map<string, string> = connectionUrls()): WidgetDTO {
    const reg = registry.get(row.type);
    const style = readStyle(row.style);
    const viaConnection = reg && reg.def.openLink !== false && row.connection_id ? urls.get(row.connection_id) : undefined;
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
      connectionId: row.connection_id,
      style,
      link: style.link ?? viaConnection ?? null,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
    };
  }

  function loadPages(): PageDTO[] {
    const pages = db.prepare("SELECT id, title, position, background FROM pages ORDER BY position, created_at").all() as {
      id: string;
      title: string;
      position: number;
      background: string | null;
    }[];
    const widgets = db.prepare("SELECT * FROM widgets ORDER BY y, x").all() as unknown as WidgetRow[];
    const urls = connectionUrls();
    return pages.map((p) => ({
      id: p.id,
      title: p.title,
      position: p.position,
      background: parseBackground(p.background),
      widgets: widgets.filter((w) => w.page_id === p.id).map((w) => toWidgetDTO(w, urls)),
    }));
  }

  /** Config guardada del widget + la de su conexión (sin descifrar; lo hace el runtime). */
  function effectiveConfig(row: WidgetRow): Record<string, unknown> {
    const own = safeParse(row.config);
    if (!row.connection_id) return own;
    const conn = db.prepare("SELECT config FROM connections WHERE id = ?").get(row.connection_id) as
      | { config: string }
      | undefined;
    return { ...(conn ? safeParse(conn.config) : {}), ...own };
  }

  /** Comprueba que la conexión elegida existe y es del plugin del widget. */
  function checkConnection(reg: RegisteredWidget, connectionId: string | null | undefined): string | { error: string } | null {
    if (reg.connection.length === 0) return connectionId ? { error: "Este widget no usa conexiones" } : null;
    if (!connectionId) return { error: "Elige una conexión (o crea una) para este widget" };
    const conn = db.prepare("SELECT plugin_id FROM connections WHERE id = ?").get(connectionId) as
      | { plugin_id: string }
      | undefined;
    if (!conn || conn.plugin_id !== reg.plugin.id) return { error: "La conexión elegida no es válida para este widget" };
    return connectionId;
  }

  app.get("/catalog", requireUser, (c) => c.json({ widgets: registry.catalog() }));
  app.get("/pages", requireUser, (c) => c.json({ pages: loadPages() }));

  // ───────── páginas ─────────

  app.post("/pages", requireAdmin, async (c) => {
    const parsed = z
      .object({ title, background: backgroundSchema.nullable().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Título inválido" }, 400);
    const problem = backgroundProblem(parsed.data.background);
    if (problem) return c.json({ error: problem }, 400);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n;
    if (count >= 20) return c.json({ error: "Máximo 20 páginas" }, 400);
    const id = crypto.randomUUID();
    const background = parsed.data.background ?? null;
    db.prepare("INSERT INTO pages (id, title, position, created_at, background) VALUES (?,?,?,?,?)").run(
      id,
      parsed.data.title,
      count,
      Date.now(),
      background && JSON.stringify(background),
    );
    return c.json({ page: { id, title: parsed.data.title, position: count, background, widgets: [] } }, 201);
  });

  app.patch("/pages/:id", requireAdmin, async (c) => {
    const parsed = z
      .object({
        title: title.optional(),
        position: z.number().int().min(0).max(100).optional(),
        background: backgroundSchema.nullable().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    const id = c.req.param("id");
    if (!db.prepare("SELECT 1 FROM pages WHERE id = ?").get(id)) return c.json({ error: "No existe" }, 404);
    const problem = backgroundProblem(parsed.data.background);
    if (problem) return c.json({ error: problem }, 400);
    if (parsed.data.title) db.prepare("UPDATE pages SET title = ? WHERE id = ?").run(parsed.data.title, id);
    if (parsed.data.position !== undefined) {
      db.prepare("UPDATE pages SET position = ? WHERE id = ?").run(parsed.data.position, id);
    }
    if (parsed.data.background !== undefined) {
      const bg = parsed.data.background;
      db.prepare("UPDATE pages SET background = ? WHERE id = ?").run(bg && JSON.stringify(bg), id);
      collectBackgroundGarbage(db, appConfig.uploadsDir);
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
    collectBackgroundGarbage(db, appConfig.uploadsDir);
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
      .object({
        type: z.string().max(80),
        title: z.string().trim().max(60).optional(),
        config: z.unknown(),
        connectionId: z.string().max(64).nullable().optional(),
        style: z.unknown().optional(),
        // Tamaño inicial elegido (compacto, medio, grande...); sin él, el por defecto del widget.
        size: z.object({ w: z.number().int().min(1).max(GRID_COLUMNS), h: z.number().int().min(1).max(60) }).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    if (!db.prepare("SELECT 1 FROM pages WHERE id = ?").get(pageId)) return c.json({ error: "No existe la página" }, 404);

    const reg = registry.get(parsed.data.type);
    if (!reg) return c.json({ error: "Tipo de widget desconocido" }, 400);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE page_id = ?").get(pageId) as { n: number }).n;
    if (count >= 100) return c.json({ error: "Máximo 100 widgets por página" }, 400);

    const connection = checkConnection(reg, parsed.data.connectionId);
    if (typeof connection === "object" && connection) return c.json(connection, 400);

    let stored;
    let style: WidgetStyle;
    try {
      stored = buildStoredConfig(reg.def.config, parsed.data.config ?? {}, {}, box);
      style = buildStyle(parsed.data.style);
    } catch (err) {
      if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
      throw err;
    }
    if (imageMissing(style)) return c.json({ error: "La imagen del widget no existe" }, 400);

    const min = reg.def.minSize ?? { w: 1, h: 1 };
    const want = parsed.data.size ?? reg.def.defaultSize;
    const w = Math.max(min.w, want.w);
    const h = Math.max(min.h, want.h);
    const taken = db.prepare("SELECT x, y, w, h FROM widgets WHERE page_id = ?").all(pageId) as unknown as Rect[];
    const slot = findFreeSlot(taken, w, h);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO widgets (id, page_id, type, title, config, state, connection_id, style, x, y, w, h) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      pageId,
      reg.fullType,
      parsed.data.title ?? "",
      JSON.stringify(stored),
      JSON.stringify(emptyState(reg.def.component)),
      connection,
      JSON.stringify(style),
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
      .object({
        title: z.string().trim().max(60).optional(),
        config: z.unknown().optional(),
        connectionId: z.string().max(64).nullable().optional(),
        style: z.unknown().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);

    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const reg = registry.get(row.type);

    let connectionId = row.connection_id;
    if (parsed.data.connectionId !== undefined && parsed.data.connectionId !== row.connection_id) {
      if (!reg) return c.json({ error: "El plugin de este widget no está instalado" }, 400);
      const checked = checkConnection(reg, parsed.data.connectionId);
      if (typeof checked === "object" && checked) return c.json(checked, 400);
      connectionId = checked;
    }

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
    let styleJson = row.style;
    if (parsed.data.style !== undefined) {
      try {
        const built = buildStyle(parsed.data.style);
        if (imageMissing(built)) return c.json({ error: "La imagen del widget no existe" }, 400);
        styleJson = JSON.stringify(built);
      } catch (err) {
        if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
        throw err;
      }
    }
    db.prepare("UPDATE widgets SET title = ?, config = ?, connection_id = ?, style = ? WHERE id = ?").run(
      parsed.data.title ?? row.title,
      configJson,
      connectionId,
      styleJson,
      id,
    );
    runtime.invalidate(id);
    if (parsed.data.style !== undefined) collectBackgroundGarbage(db, appConfig.uploadsDir);
    const updated = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow;
    return c.json({ widget: toWidgetDTO(updated) });
  });

  // Duplicar: la copia se hace aquí porque el navegador nunca ve los secretos guardados.
  app.post("/widgets/:id/duplicate", requireAdmin, (c) => {
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(c.req.param("id")) as unknown as
      | WidgetRow
      | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE page_id = ?").get(row.page_id) as { n: number }).n;
    if (count >= 100) return c.json({ error: "Máximo 100 widgets por página" }, 400);
    const taken = db.prepare("SELECT x, y, w, h FROM widgets WHERE page_id = ?").all(row.page_id) as unknown as Rect[];
    const slot = findFreeSlot(taken, row.w, row.h);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO widgets (id, page_id, type, title, config, state, connection_id, style, x, y, w, h) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(id, row.page_id, row.type, row.title, row.config, row.state, row.connection_id, row.style, slot.x, slot.y, row.w, row.h);
    audit(db, "widget_added", { username: c.get("user")!.username, detail: row.type });
    const copy = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow;
    return c.json({ widget: toWidgetDTO(copy) }, 201);
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
    const img = await runtime.getImage(row.id, reg, effectiveConfig(row), key);
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
    collectBackgroundGarbage(db, appConfig.uploadsDir);
    return c.json({ ok: true });
  });

  app.get("/widgets/:id/data", requireUser, async (c) => {
    const id = c.req.param("id");
    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id) as unknown as WidgetRow | undefined;
    if (!row) return c.json({ error: "No existe" }, 404);
    const reg = registry.get(row.type);
    if (!reg) return c.json({ ok: false, error: "Plugin no instalado" });
    if (reg.connection.length > 0 && !row.connection_id) {
      return c.json({ ok: false, error: "Este widget no tiene conexión. Edítalo y elige una." });
    }
    return c.json(await runtime.getData(id, reg, effectiveConfig(row)));
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

export function parseBackground(json: string | null) {
  if (!json) return null;
  try {
    const parsed = backgroundSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
