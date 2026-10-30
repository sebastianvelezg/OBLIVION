import fs from "node:fs";
import path from "node:path";
import { Document, LineCounter, isMap, isScalar, parseDocument, visit } from "yaml";
import { z } from "zod";
import {
  CONFIG_DOC_IDS,
  DEFAULT_APPEARANCE,
  GRID_COLUMNS,
  type Appearance,
  type ConfigChange,
  type ConfigDocId,
  type ConfigDocsDTO,
  type ConfigPlanDTO,
  type ConfigProblem,
  type Field,
  type WidgetStyle,
} from "@oblivion/sdk";
import type { AppDeps } from "./app.js";
import { audit, tx, type DB } from "./db.js";
import { ID_PATTERN, slugify, uniqueId } from "./ids.js";
import { buildStoredConfig, ConfigError, maskConfig } from "./plugins/config.js";
import { emptyState, isStateful, validateState } from "./plugins/state.js";
import { appearanceSchema, backgroundSchema, collectBackgroundGarbage, loadAppearance } from "./routes/appearance.js";
import { buildStyle, findFreeSlot, parseBackground, readStyle, safeParse, type WidgetRow } from "./routes/pages.js";

/**
 * Configuración en texto: toda la configuración (conexiones, páginas con sus widgets y su
 * disposición, y la apariencia) se puede ver y editar como tres documentos YAML. La base de datos
 * sigue siendo la fuente de verdad; los documentos se generan a partir de ella y, al aplicarlos,
 * se validan por completo antes de tocar nada (todo o nada).
 */

/** Lo que se escribe en lugar de un secreto: «conserva el que ya hay». */
export const SECRET_MASK = "••••••••";
const VARIABLE = /\{\{\s*(OBLIVION_VAR_[A-Z0-9_]+)\s*\}\}/g;
const HAS_VARIABLE = /\{\{\s*OBLIVION_VAR_/;

type Deps = Pick<AppDeps, "db" | "registry" | "box" | "config">;
type Stored = Record<string, unknown>;

export const DOC_FILES: Record<ConfigDocId, string> = {
  pages: "paginas.yml",
  connections: "conexiones.yml",
  appearance: "apariencia.yml",
};

const HEADERS: Record<ConfigDocId, string> = {
  pages: `Páginas, widgets y su disposición.
Cada widget lleva un id (puedes inventarlo: «reloj-casa»); si lo quitas se crea uno nuevo.
layout: x e y son la columna y la fila de la esquina superior izquierda; w y h el ancho (1-12 columnas)
y el alto en filas. Si omites x/y el widget se coloca en el primer hueco libre.
connection: id de una conexión de conexiones.yml (solo para widgets que la necesitan).
Los secretos aparecen como ${SECRET_MASK}: déjalo así para conservar el valor guardado.`,
  connections: `Conexiones a tus servicios (URL y credenciales, escritas una sola vez).
La clave de cada una es su id; los widgets la usan en «connection».
Para no escribir un secreto aquí, define OBLIVION_VAR_LO_QUE_SEA en el entorno del contenedor
y úsalo como valor: apiKey: "{{OBLIVION_VAR_JELLYFIN_KEY}}".
Los secretos guardados aparecen como ${SECRET_MASK}: déjalo así para conservarlos.`,
  appearance: `Apariencia global: tema, paleta, tipografía, tarjetas y fondo.
Lo que omitas vuelve al valor de fábrica.`,
};

// ───────────────────────── exportar ─────────────────────────

function toYaml(header: string, value: unknown): string {
  const doc = new Document(value);
  // Las cuatro cifras de la posición caben mejor en una sola línea.
  visit(doc, {
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === "layout" && isMap(pair.value)) pair.value.flow = true;
    },
  });
  const comment = header
    .split("\n")
    .map((l) => `# ${l}`.trimEnd())
    .join("\n");
  return `${comment}\n\n${doc.toString({ lineWidth: 0 })}`;
}

function withMasks(fields: Field[], stored: Stored): Stored {
  const { config, secretsSet } = maskConfig(fields, stored);
  for (const key of secretsSet) config[key] = SECRET_MASK;
  return config;
}

interface ConnectionRow {
  id: string;
  plugin_id: string;
  name: string;
  config: string;
}

/** Los documentos tal como salen de la base de datos (sin comentarios propios del usuario). */
export function canonicalDocs({ db, registry }: Deps): Record<ConfigDocId, string> {
  const connections: Record<string, unknown> = {};
  const rows = db.prepare("SELECT * FROM connections ORDER BY plugin_id, name").all() as unknown as ConnectionRow[];
  for (const row of rows) {
    const plugin = registry.plugin(row.plugin_id);
    if (!plugin?.connection?.length) continue; // plugin ya no instalado: no se toca
    const config = withMasks(plugin.connection, safeParse(row.config));
    connections[row.id] = {
      plugin: row.plugin_id,
      name: row.name,
      ...(Object.keys(config).length ? { config } : {}),
    };
  }

  const pageRows = db
    .prepare("SELECT id, title, background FROM pages ORDER BY position, created_at")
    .all() as { id: string; title: string; background: string | null }[];
  const widgetRows = db.prepare("SELECT * FROM widgets ORDER BY y, x, rowid").all() as unknown as WidgetRow[];
  const pages = pageRows.map((p) => {
    const widgets = widgetRows
      .filter((w) => w.page_id === p.id)
      .flatMap((w) => {
        const reg = registry.get(w.type);
        if (!reg) return []; // plugin ya no instalado: se conserva sin mostrarse
        const config = withMasks(reg.def.config, safeParse(w.config));
        const style = readStyle(w.style);
        const state = safeParse(w.state);
        const hasState =
          isStateful(reg.def.component) && JSON.stringify(state) !== JSON.stringify(emptyState(reg.def.component));
        return [
          {
            id: w.id,
            type: w.type,
            ...(w.title ? { title: w.title } : {}),
            ...(w.connection_id ? { connection: w.connection_id } : {}),
            layout: { x: w.x, y: w.y, w: w.w, h: w.h },
            ...(Object.keys(config).length ? { config } : {}),
            ...(Object.keys(style).length ? { style } : {}),
            ...(hasState ? { state } : {}),
          },
        ];
      });
    const background = parseBackground(p.background);
    return { id: p.id, title: p.title, ...(background ? { background } : {}), widgets };
  });

  return {
    pages: toYaml(HEADERS.pages, { pages }),
    connections: toYaml(HEADERS.connections, { connections }),
    appearance: toYaml(HEADERS.appearance, loadAppearance(db)),
  };
}

/**
 * Los documentos que se enseñan al usuario: si desde la última vez que se aplicaron no ha cambiado
 * nada, el texto guardado (con sus comentarios y su formato); si no, el generado de nuevo.
 */
export function currentDocs(deps: Deps): ConfigDocsDTO {
  const canonical = canonicalDocs(deps);
  const documents = CONFIG_DOC_IDS.map((id) => {
    const saved = readSaved(deps.db, id);
    const text = saved && saved.canonical === canonical[id] ? saved.text : canonical[id];
    return { id, filename: DOC_FILES[id], text };
  });
  const variables = Object.keys(process.env)
    .filter((k) => /^OBLIVION_VAR_[A-Z0-9_]+$/.test(k))
    .sort();
  return { documents, variables };
}

function readSaved(db: DB, id: ConfigDocId): { text: string; canonical: string } | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`configdoc.${id}`) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v?.text === "string" && typeof v?.canonical === "string" ? v : null;
  } catch {
    return null;
  }
}

// ───────────────────────── leer y validar ─────────────────────────

interface Parsed {
  doc: Document.Parsed;
  lines: LineCounter;
  value: unknown;
  text: string;
}

type Path = (string | number)[];

const formatPath = (path: readonly PropertyKey[]) =>
  path.reduce<string>((acc, p) => (typeof p === "number" ? `${acc}[${p}]` : acc ? `${acc}.${String(p)}` : String(p)), "");

/** Acumula problemas y avisos con la línea del documento a la que se refieren. */
class Report {
  readonly problems: ConfigProblem[] = [];
  readonly warnings: ConfigProblem[] = [];
  /** Secretos escritos en claro en el texto: se tapan antes de guardar el documento. */
  readonly literalSecrets: { doc: ConfigDocId; path: Path }[] = [];
  readonly parsed: Partial<Record<ConfigDocId, Parsed>> = {};

  private locate(doc: ConfigDocId, path: Path): number | undefined {
    const p = this.parsed[doc];
    if (!p) return undefined;
    for (let n = path.length; n >= 0; n--) {
      const node = p.doc.getIn(path.slice(0, n), true) as { range?: [number, number, number] } | null | undefined;
      if (node?.range) return p.lines.linePos(node.range[0]).line;
    }
    return undefined;
  }

  private entry(doc: ConfigDocId, path: Path, message: string): ConfigProblem {
    const line = this.locate(doc, path);
    return { doc, message, ...(line ? { line } : {}), ...(path.length ? { path: formatPath(path) } : {}) };
  }

  error(doc: ConfigDocId, path: Path, message: string) {
    this.problems.push(this.entry(doc, path, message));
  }

  warn(doc: ConfigDocId, path: Path, message: string) {
    this.warnings.push(this.entry(doc, path, message));
  }
}

const YAML_ERRORS: Record<string, string> = {
  DUPLICATE_KEY: "Clave repetida en el mismo bloque",
  BAD_INDENT: "Sangría incorrecta: los elementos de un mismo bloque deben empezar en la misma columna",
  TAB_AS_INDENT: "Usa espacios para sangrar, no tabuladores",
  MISSING_CHAR: "Falta un carácter: comillas, corchete o llave sin cerrar, o «:» después de la clave",
  BLOCK_AS_IMPLICIT_KEY: "Falta «:» tras la clave o el valor está mal sangrado",
  MULTILINE_IMPLICIT_KEY: "Falta «:» tras la clave, o la línea anterior no terminó bien",
  BLOCK_IN_FLOW: "Dentro de { } o [ ] no se puede abrir un bloque con sangría",
  UNEXPECTED_TOKEN: "Carácter inesperado",
};

/** El mensaje de la librería, sin la posición (ya va aparte) y, si se conoce, en español. */
function friendlyYamlError(code: string, message: string): string {
  const detail = message.split("\n")[0]!.replace(/ at line \d+, column \d+:?$/, "");
  return YAML_ERRORS[code] ?? `Sintaxis YAML no válida (${detail})`;
}

function parseText(id: ConfigDocId, text: string, rep: Report): Parsed | null {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  rep.parsed[id] = { doc, lines, value: undefined, text };
  if (doc.errors.length) {
    // Un solo fallo suele provocar varios avisos seguidos: se enseña el primero de cada línea.
    const seen = new Set<number>();
    for (const e of doc.errors) {
      const line = e.linePos?.[0]?.line;
      if (line !== undefined) {
        if (seen.has(line)) continue;
        seen.add(line);
      }
      rep.problems.push({ doc: id, message: friendlyYamlError(e.code, e.message), ...(line ? { line } : {}) });
    }
    return null;
  }
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 0 }) ?? {};
  } catch {
    rep.problems.push({ doc: id, message: "No se admiten alias de YAML (&ancla / *alias)" });
    return null;
  }
  const parsed = { doc, lines, value, text };
  rep.parsed[id] = parsed;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    rep.error(id, [], "El documento debe ser un mapa de claves (clave: valor)");
    return null;
  }
  return parsed;
}

/** Valida con zod y vuelca cada error con su ruta y línea. */
function check<S extends z.ZodType>(id: ConfigDocId, schema: S, value: unknown, rep: Report): z.infer<S> | null {
  const res = schema.safeParse(value);
  if (res.success) return res.data;
  for (const issue of res.error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) rep.error(id, [...path, key], `Clave desconocida «${key}»`);
    } else {
      rep.error(id, path, issue.message);
    }
  }
  return null;
}

function expandVariables(value: unknown, missing: (name: string) => void): unknown {
  if (typeof value === "string") {
    return value.replace(VARIABLE, (_m, name: string) => {
      const found = process.env[name];
      if (found === undefined) missing(name);
      return found ?? "";
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandVariables(v, missing));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandVariables(v, missing)]));
  }
  return value;
}

/** Config de un widget o conexión → lo que se guarda (secretos cifrados). */
function buildConfig(
  rep: Report,
  doc: ConfigDocId,
  at: Path,
  fields: Field[],
  raw: Record<string, unknown> | undefined,
  existing: Stored,
  box: Deps["box"],
): Stored | null {
  const input: Record<string, unknown> = { ...(raw ?? {}) };
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) rep.warn(doc, [...at, key], `«${key}» no es un campo de este elemento y se ignora`);
  }

  let missing = false;
  const expanded = expandVariables(input, (name) => {
    missing = true;
    rep.error(doc, at, `La variable de entorno ${name} no está definida en el servidor`);
  }) as Record<string, unknown>;
  if (missing) return null;

  for (const f of fields) {
    if (f.type !== "secret") continue;
    const value = input[f.key];
    if (value === SECRET_MASK) delete expanded[f.key]; // «conserva el guardado»
    else if (typeof value === "string" && value !== "" && !HAS_VARIABLE.test(value)) {
      rep.literalSecrets.push({ doc, path: [...at, f.key] });
    }
  }

  try {
    return buildStoredConfig(fields, expanded, existing, box);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    rep.error(doc, at, err.message);
    return null;
  }
}

// ───────────────────────── esquemas de los documentos ─────────────────────────

const idSchema = z.string().regex(ID_PATTERN, "Id no válido: minúsculas, números, «-» o «_» (máx. 48)");
const looseObject = z.record(z.string(), z.unknown());

const connectionsDoc = z
  .object({
    connections: z
      .record(
        idSchema,
        z
          .object({
            plugin: z.string().min(1).max(80),
            name: z.string().trim().min(1).max(60),
            config: looseObject.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const cell = z.number().int().min(0).max(1000);
const backgroundDoc = backgroundSchema.partial().strict();

const pagesDoc = z
  .object({
    pages: z
      .array(
        z
          .object({
            id: idSchema.optional(),
            title: z.string().trim().min(1).max(60),
            background: backgroundDoc.nullable().optional(),
            widgets: z
              .array(
                z
                  .object({
                    id: idSchema.optional(),
                    type: z.string().max(80),
                    title: z.string().trim().max(60).optional(),
                    connection: idSchema.nullable().optional(),
                    layout: z
                      .object({
                        x: cell.optional(),
                        y: cell.optional(),
                        w: z.number().int().min(1).max(GRID_COLUMNS).optional(),
                        h: z.number().int().min(1).max(60).optional(),
                      })
                      .strict()
                      .optional(),
                    config: looseObject.optional(),
                    style: z.unknown().optional(),
                    state: z.unknown().optional(),
                  })
                  .strict(),
              )
              .max(100)
              .optional(),
          })
          .strict(),
      )
      .min(1, "Debe haber al menos una página")
      .max(20, "Máximo 20 páginas"),
  })
  .strict();

const MAX_CONNECTIONS = 50;

// ───────────────────────── el plan ─────────────────────────

interface NormConnection {
  id: string;
  plugin: string;
  name: string;
  config: string;
}
interface NormPage {
  id: string;
  title: string;
  background: string | null;
}
interface NormWidget {
  id: string;
  pageId: string;
  type: string;
  title: string;
  config: string;
  connectionId: string | null;
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `null`: no se ha escrito, se conserva el que hay. */
  state: string | null;
}

export interface Plan {
  connections?: NormConnection[];
  pages?: NormPage[];
  widgets?: NormWidget[];
  appearance?: Appearance;
  changes: ConfigChange[];
  /** Texto de cada documento aplicado (con los secretos en claro tapados). */
  texts: Partial<Record<ConfigDocId, string>>;
}

export type Docs = Partial<Record<ConfigDocId, string>>;

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

export function buildPlan(deps: Deps, docs: Docs): { plan: Plan | null; result: ConfigPlanDTO } {
  const { db, registry, box, config: appConfig } = deps;
  const rep = new Report();
  const plan: Plan = { changes: [], texts: {} };

  const dbConnections = db.prepare("SELECT * FROM connections").all() as unknown as ConnectionRow[];
  const dbWidgets = db.prepare("SELECT * FROM widgets").all() as unknown as WidgetRow[];
  const dbPages = db.prepare("SELECT id, title, position, background FROM pages").all() as {
    id: string;
    title: string;
    position: number;
    background: string | null;
  }[];
  const imageExists = (id: string) => fs.existsSync(path.join(appConfig.uploadsDir, id));

  // Elementos de plugins que ya no están instalados: no salen en los documentos y nunca se borran.
  const orphanConnections = new Set(
    dbConnections.filter((c) => !registry.plugin(c.plugin_id)?.connection?.length).map((c) => c.id),
  );
  const orphanWidgets = new Set(dbWidgets.filter((w) => !registry.get(w.type)).map((w) => w.id));

  // ───── conexiones ─────
  let connectionPlugins = new Map(dbConnections.map((c) => [c.id, c.plugin_id]));
  if (docs.connections !== undefined) {
    const parsed = parseText("connections", docs.connections, rep);
    const data = parsed && check("connections", connectionsDoc, parsed.value, rep);
    if (data) {
      const entries = Object.entries(data.connections ?? {});
      if (entries.length + orphanConnections.size > MAX_CONNECTIONS) {
        rep.error("connections", ["connections"], `Máximo ${MAX_CONNECTIONS} conexiones`);
      }
      const out: NormConnection[] = [];
      connectionPlugins = new Map([...orphanConnections].map((id) => [id, dbConnections.find((c) => c.id === id)!.plugin_id]));
      for (const [id, entry] of entries) {
        const at: Path = ["connections", id];
        const plugin = registry.plugin(entry.plugin);
        if (!plugin?.connection?.length) {
          rep.error("connections", [...at, "plugin"], `«${entry.plugin}» no es un plugin con conexiones`);
          continue;
        }
        const existing = dbConnections.find((c) => c.id === id);
        if (existing && existing.plugin_id !== entry.plugin) {
          rep.error("connections", [...at, "plugin"], `La conexión «${id}» ya existe para «${existing.plugin_id}»; usa otro id`);
          continue;
        }
        connectionPlugins.set(id, entry.plugin);
        const stored = buildConfig(rep, "connections", [...at, "config"], plugin.connection, entry.config, safeParse(existing?.config ?? "{}"), box);
        if (stored) out.push({ id, plugin: entry.plugin, name: entry.name, config: JSON.stringify(stored) });
      }
      plan.connections = out;
    }
  }

  // ───── páginas y widgets ─────
  const wantedConnections = new Map<string, string>(); // conexión → un widget que la usa (para avisar al quitarla)
  if (docs.pages !== undefined) {
    const parsed = parseText("pages", docs.pages, rep);
    const data = parsed && check("pages", pagesDoc, parsed.value, rep);
    if (data) {
      const pageIds = new Set<string>();
      const widgetIds = new Set<string>(orphanWidgets);
      for (const [i, p] of data.pages.entries()) {
        if (p.id) {
          if (pageIds.has(p.id)) rep.error("pages", ["pages", i, "id"], `El id «${p.id}» está repetido`);
          pageIds.add(p.id);
        }
        for (const [j, w] of (p.widgets ?? []).entries()) {
          if (!w.id) continue;
          if (widgetIds.has(w.id)) rep.error("pages", ["pages", i, "widgets", j, "id"], `El id «${w.id}» está repetido`);
          widgetIds.add(w.id);
        }
      }

      const pagesOut: NormPage[] = [];
      const widgetsOut: NormWidget[] = [];
      for (const [i, p] of data.pages.entries()) {
        const at: Path = ["pages", i];
        const pageId = p.id ?? uniqueId(slugify(p.title, "pagina"), pageIds);
        pageIds.add(pageId);

        let background: string | null = null;
        if (p.background) {
          const merged = { ...DEFAULT_APPEARANCE.background, imageId: null, ...p.background };
          const full = backgroundSchema.safeParse(merged);
          if (!full.success) rep.error("pages", [...at, "background"], full.error.issues[0]!.message);
          else if (full.data.imageId && !imageExists(full.data.imageId)) rep.error("pages", [...at, "background", "imageId"], "La imagen de fondo no existe");
          else if (full.data.type === "image" && !full.data.imageId) rep.error("pages", [...at, "background"], "El fondo «image» necesita un imageId");
          else background = JSON.stringify(full.data);
        }
        pagesOut.push({ id: pageId, title: p.title, background });

        const rects: { x: number; y: number; w: number; h: number }[] = [];
        const pending: { norm: NormWidget; autoplace: boolean }[] = [];
        for (const [j, w] of (p.widgets ?? []).entries()) {
          const wat: Path = [...at, "widgets", j];
          const reg = registry.get(w.type);
          if (!reg) {
            rep.error("pages", [...wat, "type"], `Tipo de widget desconocido: «${w.type}»`);
            continue;
          }
          const widgetId = w.id ?? uniqueId(slugify(w.type.replace(/^core\./, ""), "widget"), widgetIds);
          widgetIds.add(widgetId);
          const existing = dbWidgets.find((row) => row.id === widgetId && row.type === w.type);

          // conexión
          let connectionId: string | null = null;
          if (reg.connection.length === 0) {
            if (w.connection) rep.error("pages", [...wat, "connection"], "Este widget no usa conexiones");
          } else if (!w.connection) {
            rep.error("pages", [...wat, "connection"], "Este widget necesita una conexión (connection: id)");
          } else if (connectionPlugins.get(w.connection) !== reg.plugin.id) {
            rep.error(
              "pages",
              [...wat, "connection"],
              connectionPlugins.has(w.connection)
                ? `La conexión «${w.connection}» no es de «${reg.plugin.id}»`
                : `No existe la conexión «${w.connection}»`,
            );
          } else {
            connectionId = w.connection;
            if (!wantedConnections.has(connectionId)) wantedConnections.set(connectionId, widgetId);
          }

          const stored = buildConfig(rep, "pages", [...wat, "config"], reg.def.config, w.config, safeParse(existing?.config ?? "{}"), box);

          let style: WidgetStyle = {};
          try {
            style = buildStyle(w.style ?? {});
            if (style.image && !imageExists(style.image)) throw new ConfigError("La imagen del widget no existe");
          } catch (err) {
            if (!(err instanceof ConfigError)) throw err;
            rep.error("pages", [...wat, "style"], err.message);
          }

          let state: string | null = null;
          if (w.state !== undefined) {
            if (!isStateful(reg.def.component)) rep.error("pages", [...wat, "state"], "Este widget no guarda estado");
            else {
              try {
                state = JSON.stringify(validateState(reg.def.component, w.state));
              } catch (err) {
                if (!(err instanceof ConfigError)) throw err;
                rep.error("pages", [...wat, "state"], err.message);
              }
            }
          }

          const min = reg.def.minSize ?? { w: 1, h: 1 };
          const size = {
            w: Math.max(min.w, w.layout?.w ?? reg.def.defaultSize.w),
            h: Math.max(min.h, w.layout?.h ?? reg.def.defaultSize.h),
          };
          const explicit = w.layout?.x !== undefined && w.layout?.y !== undefined;
          if (explicit && w.layout!.x! + size.w > GRID_COLUMNS) {
            rep.error("pages", [...wat, "layout"], `x + w no puede pasar de ${GRID_COLUMNS} columnas`);
          }
          if (!stored) continue;
          const norm: NormWidget = {
            id: widgetId,
            pageId,
            type: w.type,
            title: w.title ?? "",
            config: JSON.stringify(stored),
            connectionId,
            style: JSON.stringify(style),
            x: w.layout?.x ?? 0,
            y: w.layout?.y ?? 0,
            ...size,
            state,
          };
          if (explicit) {
            for (const other of rects) {
              if (norm.x < other.x + other.w && norm.x + norm.w > other.x && norm.y < other.y + other.h && norm.y + norm.h > other.y) {
                rep.warn("pages", [...wat, "layout"], `«${widgetId}» se solapa con otro widget de la página`);
                break;
              }
            }
            rects.push(norm);
          }
          pending.push({ norm, autoplace: !explicit });
        }
        // Los que no llevan posición van al primer hueco libre, después de los colocados a mano.
        for (const item of pending.filter((it) => it.autoplace)) {
          const slot = findFreeSlot(rects, item.norm.w, item.norm.h);
          item.norm.x = slot.x;
          item.norm.y = slot.y;
          rects.push(item.norm);
        }
        widgetsOut.push(...pending.map((it) => it.norm));
      }
      plan.pages = pagesOut;
      plan.widgets = widgetsOut;
    }
  } else if (plan.connections) {
    // Solo se cambian las conexiones: las que sigan en uso por widgets guardados no se pueden quitar.
    for (const w of dbWidgets) {
      if (w.connection_id && !orphanWidgets.has(w.id) && !connectionPlugins.has(w.connection_id)) {
        rep.error("connections", ["connections"], `La conexión «${w.connection_id}» la usa el widget «${w.id}»: no se puede quitar`);
      }
    }
  }

  // ───── apariencia ─────
  if (docs.appearance !== undefined) {
    const parsed = parseText("appearance", docs.appearance, rep);
    if (parsed) plan.appearance = buildAppearance(parsed.value as Record<string, unknown>, rep, imageExists);
  }

  // ───── cambios ─────
  if (rep.problems.length === 0) diff(deps, plan, { dbConnections, dbPages, dbWidgets, orphanConnections, orphanWidgets, wantedConnections });

  // Texto que se guarda tal cual lo escribió el usuario, salvo los secretos en claro.
  for (const id of CONFIG_DOC_IDS) {
    const p = rep.parsed[id];
    if (p) plan.texts[id] = maskLiterals(p, rep.literalSecrets.filter((s) => s.doc === id));
  }

  const result: ConfigPlanDTO = {
    ok: rep.problems.length === 0,
    problems: rep.problems,
    changes: rep.problems.length === 0 ? plan.changes : [],
    warnings: rep.warnings,
  };
  return { plan: result.ok ? plan : null, result };
}

function maskLiterals(p: Parsed, secrets: { path: Path }[]): string {
  const spans: [number, number][] = [];
  for (const s of secrets) {
    const node = p.doc.getIn(s.path, true) as { range?: [number, number, number] } | null | undefined;
    if (node?.range) spans.push([node.range[0], node.range[1]]);
  }
  let text = p.text;
  for (const [from, to] of spans.sort((a, b) => b[0] - a[0])) text = `${text.slice(0, from)}"${SECRET_MASK}"${text.slice(to)}`;
  return text;
}

function buildAppearance(raw: Record<string, unknown>, rep: Report, imageExists: (id: string) => boolean): Appearance | undefined {
  const D = DEFAULT_APPEARANCE;
  const nested = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : v);
  const spread = (base: object, v: unknown) => (v === undefined ? base : typeof nested(v) === "object" ? { ...base, ...(v as object) } : v);

  const top = Object.keys(appearanceSchema.shape);
  const groups: Record<string, string[]> = {
    layout: ["free"],
    card: Object.keys(appearanceSchema.shape.card.shape),
    background: Object.keys(backgroundSchema.shape),
  };
  let unknown = false;
  for (const key of Object.keys(raw)) {
    if (!top.includes(key)) {
      rep.error("appearance", [key], `Clave desconocida «${key}»`);
      unknown = true;
    }
  }
  for (const [group, keys] of Object.entries(groups)) {
    const v = nested(raw[group]);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const key of Object.keys(v)) {
        if (!keys.includes(key)) {
          rep.error("appearance", [group, key], `Clave desconocida «${key}»`);
          unknown = true;
        }
      }
    }
  }
  if (unknown) return undefined;

  const merged = {
    ...D,
    ...raw,
    layout: spread(D.layout, raw.layout),
    card: spread(D.card, raw.card),
    background: spread(D.background, raw.background),
  };
  const parsed = appearanceSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      rep.error("appearance", issue.path.filter((p): p is string | number => typeof p !== "symbol"), issue.message);
    }
    return undefined;
  }
  const bg = parsed.data.background;
  if (bg.imageId && !imageExists(bg.imageId)) {
    rep.error("appearance", ["background", "imageId"], "La imagen de fondo no existe");
    return undefined;
  }
  if (bg.type === "image" && !bg.imageId) {
    rep.error("appearance", ["background"], "El fondo «image» necesita un imageId");
    return undefined;
  }
  return parsed.data;
}

interface DiffInput {
  dbConnections: ConnectionRow[];
  dbPages: { id: string; title: string; position: number; background: string | null }[];
  dbWidgets: WidgetRow[];
  orphanConnections: Set<string>;
  orphanWidgets: Set<string>;
  wantedConnections: Map<string, string>;
}

/** Compara lo escrito con lo guardado y deja en `plan.changes` qué se añade, cambia o quita. */
function diff({ registry, db }: Deps, plan: Plan, d: DiffInput) {
  const add = (c: ConfigChange) => plan.changes.push(c);

  if (plan.connections) {
    const keep = new Set(plan.connections.map((c) => c.id));
    for (const c of plan.connections) {
      const old = d.dbConnections.find((r) => r.id === c.id);
      if (!old) add({ doc: "connections", action: "add", kind: "connection", id: c.id, label: c.name });
      else if (old.name !== c.name || canon(safeParse(old.config)) !== canon(JSON.parse(c.config))) {
        add({ doc: "connections", action: "update", kind: "connection", id: c.id, label: c.name });
      }
    }
    for (const old of d.dbConnections) {
      if (!keep.has(old.id) && !d.orphanConnections.has(old.id)) {
        add({ doc: "connections", action: "remove", kind: "connection", id: old.id, label: old.name });
      }
    }
  }

  if (plan.pages && plan.widgets) {
    const titles = new Map(plan.pages.map((p) => [p.id, p.title]));
    plan.pages.forEach((p, position) => {
      const old = d.dbPages.find((r) => r.id === p.id);
      if (!old) add({ doc: "pages", action: "add", kind: "page", id: p.id, label: p.title });
      else if (old.title !== p.title || old.position !== position || canon(safeParse(old.background ?? "{}")) !== canon(safeParse(p.background ?? "{}"))) {
        add({ doc: "pages", action: "update", kind: "page", id: p.id, label: p.title });
      }
    });
    const keepWidgets = new Set(plan.widgets.map((w) => w.id));
    for (const w of plan.widgets) {
      const name = registry.get(w.type)?.def.name ?? w.type;
      const label = `${w.title || name} · ${titles.get(w.pageId)}`;
      const old = d.dbWidgets.find((r) => r.id === w.id);
      if (!old) add({ doc: "pages", action: "add", kind: "widget", id: w.id, label });
      else {
        const same =
          old.type === w.type &&
          old.page_id === w.pageId &&
          old.title === w.title &&
          old.connection_id === w.connectionId &&
          old.x === w.x &&
          old.y === w.y &&
          old.w === w.w &&
          old.h === w.h &&
          canon(safeParse(old.config)) === canon(JSON.parse(w.config)) &&
          canon(readStyle(old.style)) === canon(JSON.parse(w.style)) &&
          (w.state === null || canon(safeParse(old.state)) === canon(JSON.parse(w.state)));
        if (!same) add({ doc: "pages", action: "update", kind: "widget", id: w.id, label });
      }
    }
    for (const old of d.dbWidgets) {
      if (keepWidgets.has(old.id) || d.orphanWidgets.has(old.id)) continue;
      const name = registry.get(old.type)?.def.name ?? old.type;
      add({ doc: "pages", action: "remove", kind: "widget", id: old.id, label: old.title || name });
    }
    for (const old of d.dbPages) {
      if (!titles.has(old.id)) add({ doc: "pages", action: "remove", kind: "page", id: old.id, label: old.title });
    }
  }

  if (plan.appearance) {
    if (canon(plan.appearance) !== canon(loadAppearance(db))) {
      add({ doc: "appearance", action: "update", kind: "appearance", id: "appearance", label: "Apariencia" });
    }
  }
}

// ───────────────────────── aplicar ─────────────────────────

export function applyPlan(deps: Deps & Pick<AppDeps, "runtime">, plan: Plan, username: string) {
  const { db, runtime, config } = deps;
  const before = (db.prepare("SELECT id FROM widgets").all() as { id: string }[]).map((r) => r.id);

  tx(db, () => {
    const now = Date.now();
    if (plan.connections) {
      const upsert = db.prepare(
        `INSERT INTO connections (id, plugin_id, name, config, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config`,
      );
      for (const c of plan.connections) upsert.run(c.id, c.plugin, c.name, c.config, now);
    }

    if (plan.pages && plan.widgets) {
      const upsertPage = db.prepare(
        `INSERT INTO pages (id, title, position, created_at, background) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, position = excluded.position, background = excluded.background`,
      );
      plan.pages.forEach((p, position) => upsertPage.run(p.id, p.title, position, now, p.background));

      const upsertWidget = db.prepare(
        `INSERT INTO widgets (id, page_id, type, title, config, state, connection_id, style, x, y, w, h)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, type = excluded.type, title = excluded.title,
           config = excluded.config, connection_id = excluded.connection_id, style = excluded.style,
           x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h`,
      );
      const setState = db.prepare("UPDATE widgets SET state = ? WHERE id = ?");
      const oldType = new Map((db.prepare("SELECT id, type FROM widgets").all() as { id: string; type: string }[]).map((r) => [r.id, r.type]));
      for (const w of plan.widgets) {
        const blank = JSON.stringify(emptyState(deps.registry.get(w.type)?.def.component));
        upsertWidget.run(w.id, w.pageId, w.type, w.title, w.config, w.state ?? blank, w.connectionId, w.style, w.x, w.y, w.w, w.h);
        if (w.state !== null) setState.run(w.state, w.id);
        else if (oldType.has(w.id) && oldType.get(w.id) !== w.type) setState.run(blank, w.id);
      }

      // Lo que ya no está en el documento (salvo lo de plugins que no están instalados).
      const keepWidgets = new Set(plan.widgets.map((w) => w.id));
      for (const row of db.prepare("SELECT id, type FROM widgets").all() as { id: string; type: string }[]) {
        if (!keepWidgets.has(row.id) && deps.registry.get(row.type)) db.prepare("DELETE FROM widgets WHERE id = ?").run(row.id);
      }
      const keepPages = new Set(plan.pages.map((p) => p.id));
      for (const row of db.prepare("SELECT id FROM pages").all() as { id: string }[]) {
        if (keepPages.has(row.id)) continue;
        const left = db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE page_id = ?").get(row.id) as { n: number };
        if (left.n === 0) db.prepare("DELETE FROM pages WHERE id = ?").run(row.id); // si quedan widgets de plugins ausentes, se conserva
      }
    }

    if (plan.connections) {
      const keep = new Set(plan.connections.map((c) => c.id));
      for (const row of db.prepare("SELECT id, plugin_id FROM connections").all() as { id: string; plugin_id: string }[]) {
        if (!keep.has(row.id) && deps.registry.plugin(row.plugin_id)?.connection?.length) {
          db.prepare("DELETE FROM connections WHERE id = ?").run(row.id);
        }
      }
    }

    if (plan.appearance) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(JSON.stringify(plan.appearance));
    }
  });

  const after = (db.prepare("SELECT id FROM widgets").all() as { id: string }[]).map((r) => r.id);
  for (const id of new Set([...before, ...after])) runtime.invalidate(id);
  collectBackgroundGarbage(db, config.uploadsDir);

  // Se recuerda el texto con sus comentarios mientras la base de datos no cambie por otro lado.
  const canonical = canonicalDocs(deps);
  const save = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const id of CONFIG_DOC_IDS) {
    const text = plan.texts[id];
    if (text !== undefined) save.run(`configdoc.${id}`, JSON.stringify({ text, canonical: canonical[id] }));
  }

  const count = (a: ConfigChange["action"]) => plan.changes.filter((c) => c.action === a).length;
  audit(db, "config_applied", { username, detail: `+${count("add")} ~${count("update")} -${count("remove")}` });
}
