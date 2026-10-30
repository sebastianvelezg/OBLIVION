/**
 * SDK de plugins.
 *
 * Un plugin es una carpeta dentro de `plugins/` con un `plugin.mjs` que exporta
 * por defecto un `PluginDefinition`. No necesita compilarse.
 *
 * Los plugins NO inyectan HTML ni JavaScript en el navegador: devuelven una
 * "vista" declarativa (`View`) que el dashboard sabe dibujar de forma segura.
 */

// ───────────────────────── Campos de configuración ─────────────────────────

export type FieldType =
  | "string"
  | "text"
  | "url"
  | "number"
  | "boolean"
  | "select"
  | "secret"
  | "list";

export interface SelectOption {
  value: string;
  label: string;
}

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  help?: string;
  /** Solo `select`. */
  options?: SelectOption[];
  /** Solo `number`. */
  min?: number;
  max?: number;
  /** Solo `list`: campos de cada elemento. */
  itemFields?: Field[];
  /** Solo `list`: máximo de elementos (por defecto 50). */
  maxItems?: number;
}

// ───────────────────────────── Vistas declarativas ─────────────────────────

export type Tone = "neutral" | "good" | "warn" | "bad";

/** Un valor grande con detalle opcional (clima, temperatura, uptime...). */
export interface MetricView {
  kind: "metric";
  /** Emoji o texto corto. */
  icon?: string;
  value: string;
  unit?: string;
  caption?: string;
  rows?: { label: string; value: string }[];
  strip?: { label: string; value: string; icon?: string }[];
}

/** Cuadrícula de cifras (conteos de librería, espacio libre...). */
export interface StatsView {
  kind: "stats";
  items: { label: string; value: string; hint?: string; tone?: Tone }[];
}

/** Lista de elementos (sesiones activas, descargas, últimos capítulos...). */
export interface ListView {
  kind: "list";
  empty?: string;
  items: {
    title: string;
    subtitle?: string;
    right?: string;
    /** 0..1 */
    progress?: number;
    tone?: Tone;
    /** Enlace `http(s)` que abre el título en otra pestaña (titulares de un feed, etc.). */
    href?: string;
  }[];
  /**
   * La lista puede desplazarse dentro del widget (titulares de un feed, registros...).
   * Sin esto, el widget enseña solo las filas que caben y resume el resto en «+N más».
   */
  scroll?: boolean;
}

export interface MessageView {
  kind: "message";
  tone?: Tone;
  text: string;
}

/** Cuadrícula de carátulas (últimos añadidos, próximos estrenos...). */
export interface MediaView {
  kind: "media";
  empty?: string;
  items: {
    title: string;
    subtitle?: string;
    /**
     * Clave opaca de la imagen (`[A-Za-z0-9._~-]`, máx. 100). El navegador la
     * pide al servidor, que llama a `image(ctx, key)` del widget: así el
     * navegador nunca habla directo con tu servicio ni ve su API key.
     */
    image?: string;
    /** Texto corto sobre la carátula (año, "NUEVO"...). */
    badge?: string;
    /** 0..1 */
    progress?: number;
  }[];
}

/** Gráfica de líneas (historial de velocidad, temperaturas...). */
export interface ChartView {
  kind: "chart";
  /** Unidad de los valores, p. ej. «Mbps». */
  unit?: string;
  /** Etiquetas del eje X (una por punto); solo se muestran la primera y la última. */
  labels?: string[];
  /** De la más antigua a la más reciente. Hasta 4 series de hasta 200 puntos. */
  series: { name: string; points: number[] }[];
  caption?: string;
}

/** Vista simple (todo salvo `sections`). */
export type LeafView = MetricView | StatsView | ListView | MessageView | MediaView | ChartView;

/** Varias vistas apiladas en un solo widget, cada una con su título (panel combinado). */
export interface SectionsView {
  kind: "sections";
  sections: { title?: string; view: LeafView }[];
}

export type View = LeafView | SectionsView;

// ───────────────────────────── Contexto del plugin ─────────────────────────

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
  /** Cuerpo en bruto (para imágenes). */
  bytes: Uint8Array;
  json<T = unknown>(): T;
}

export interface HttpInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /**
   * `follow` (por defecto) sigue hasta 3 redirecciones revalidando cada destino.
   * `manual` devuelve la respuesta 3xx tal cual (útil para comprobar si un servicio responde).
   */
  redirect?: "follow" | "manual";
}

export interface PluginContext {
  /** Configuración del widget. Los campos `secret` llegan descifrados. */
  config: Record<string, any>;
  /**
   * Único canal de red permitido. Solo llega a los hosts declarados en
   * `permissions.network` y a los campos `url` del widget. Tiene timeout,
   * límite de tamaño y revalida redirecciones.
   */
  http(url: string, init?: HttpInit): Promise<HttpResponse>;
  log(message: string): void;
  /**
   * Termina con un error cuyo mensaje SÍ se muestra al usuario
   * (p. ej. «La API key es incorrecta»). Cualquier otro error se oculta tras un
   * mensaje genérico para no filtrar detalles internos.
   */
  fail(message: string): never;
}

// ───────────────────────────── Definición ──────────────────────────────────

/** Tamaños rápidos de un widget: compacto, medio, grande y extra. */
export type SizeId = "s" | "m" | "l" | "xl";

export interface WidgetDefinition {
  /** Identificador dentro del plugin: `[a-z0-9-]`. */
  type: string;
  name: string;
  description: string;
  /** Emoji. */
  icon?: string;
  /** Tamaño por defecto en celdas (la grilla tiene 12 columnas). */
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  /**
   * Tamaños rápidos (compacto, medio, grande, extra) en celdas. Los que falten se calculan a
   * partir de `defaultSize`, que es el «medio».
   */
  sizes?: Partial<Record<SizeId, { w: number; h: number }>>;
  config: Field[];
  /** Cada cuántos segundos refrescar el dato (mín. 5). Solo widgets con `load`. */
  refreshSeconds?: number;
  /**
   * Widget dibujado por el propio dashboard (reloj, calculadora...).
   * Reservado para el plugin `core`.
   */
  component?: string;
  /**
   * Si el plugin tiene conexión con un campo `url`, el título del widget abre esa
   * dirección. `false` lo desactiva (p. ej. cuando es una API sin interfaz web).
   */
  openLink?: boolean;
  /** Carga datos en el servidor y devuelve una vista declarativa. */
  load?(ctx: PluginContext): Promise<View> | View;
  /**
   * Devuelve los bytes de la imagen que corresponde a una clave de `MediaView`.
   * El servidor comprueba que sea realmente JPEG/PNG/WebP/AVIF (máx. 3 MB).
   */
  image?(ctx: PluginContext, key: string): Promise<{ bytes: Uint8Array }>;
}

export interface PluginDefinition {
  /** `[a-z0-9-]`, único. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions?: {
    /** Hostnames fijos a los que el plugin puede llamar (p. ej. una API pública). */
    network?: string[];
  };
  /**
   * Datos de conexión compartidos por todos los widgets del plugin (URL, API key...).
   * El usuario los escribe una sola vez como «conexión» y cada widget elige una;
   * `ctx.config` recibe los campos de la conexión junto con los del widget.
   * Las claves no pueden coincidir con las de `config` de ningún widget.
   */
  connection?: Field[];
  /**
   * Comprueba que la conexión funciona (botón «Probar conexión»). Recibe la conexión en
   * `ctx.config`. Devuelve un texto de éxito («Conectado a Jellyfin 10.9») o llama a
   * `ctx.fail()` con el motivo.
   */
  test?(ctx: PluginContext): Promise<string | void> | string | void;
  widgets: WidgetDefinition[];
}

/** Helper para obtener autocompletado. No hace nada en tiempo de ejecución. */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}

// ───────────────────────── Contrato servidor ↔ navegador ───────────────────

/** Lo que el navegador ve de un widget del catálogo (sin funciones). */
export interface CatalogWidget {
  fullType: string;
  pluginId: string;
  pluginName: string;
  type: string;
  name: string;
  description: string;
  icon?: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /** Tamaños rápidos que declara el widget (los demás se deducen de `defaultSize`). */
  sizes?: Partial<Record<SizeId, { w: number; h: number }>>;
  config: Field[];
  /** Campos de la conexión del plugin (vacío si el plugin no usa conexiones). */
  connection: Field[];
  /** El plugin sabe probar su conexión. */
  testable: boolean;
  component?: string;
  refreshSeconds: number;
}

/** Retoques de aspecto de un widget concreto (todo opcional: sin definir, manda el estilo global). */
export interface WidgetStyle {
  /** `auto`: solo si escribes un título; `show`: siempre (con el nombre del widget); `hide`: nunca. */
  titleMode?: "auto" | "show" | "hide";
  /** Color de acento propio (`#rrggbb`), p. ej. rojo para alertas. */
  accent?: string;
  /** Opacidad propia del fondo de la tarjeta, 10–100. */
  opacity?: number;
  /** Dirección que abre el título (por defecto, la de la conexión). */
  link?: string;
  /** Sin tarjeta: el contenido va directamente sobre el fondo (relojes, saludos, buscadores). */
  bare?: boolean;
  /** Imagen de fondo de la tarjeta (`<hash>.<ext>`, subida desde el propio widget). */
  image?: string;
  /** Oscurecimiento de la imagen, 0–85 %. */
  imageDim?: number;
  /** Desenfoque de la imagen, 0–24 px. */
  imageBlur?: number;
}

export interface WidgetDTO {
  id: string;
  type: string;
  title: string;
  config: Record<string, unknown>;
  /** Estado editable dentro del widget (notas, recordatorios). `{}` si no aplica. */
  state: unknown;
  /** Claves de campos `secret` que ya tienen valor guardado. */
  secretsSet: string[];
  /** Conexión que usa el widget (`null` si su plugin no necesita ninguna). */
  connectionId: string | null;
  style: WidgetStyle;
  /** Dirección que abre el título del widget, si la hay. */
  link: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Conexión a un servicio (Jellyfin, Speedtest Tracker...) tal como la ve el administrador. */
export interface ConnectionDTO {
  id: string;
  pluginId: string;
  name: string;
  /** Campos no secretos. */
  config: Record<string, unknown>;
  /** Claves de campos `secret` que ya tienen valor guardado. */
  secretsSet: string[];
  /** Cuántos widgets la usan. */
  widgets: number;
}

export interface PageDTO {
  id: string;
  title: string;
  position: number;
  /** Fondo propio de la página (`null`: usa el de la apariencia general). */
  background: Appearance["background"] | null;
  widgets: WidgetDTO[];
}

// ───────────────────────────── Apariencia ──────────────────────────────────

export const PALETTE_IDS = ["midnight", "graphite", "ocean", "forest", "plum", "ember", "sand", "ink"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export type CardStyle = "glass" | "solid" | "outline" | "flat" | "neon" | "brutal";

/** Apariencia de todo el dashboard (la edita el administrador). */
export interface Appearance {
  mode: "dark" | "light" | "system";
  palette: PaletteId;
  /** `#rrggbb` */
  accent: string;
  font: "sans" | "mono" | "serif" | "humanist";
  density: "compact" | "comfortable" | "spacious";
  /** Cómo se colocan los widgets al moverlos. */
  layout: {
    /** `false`: se pegan arriba sin dejar huecos. `true`: se quedan donde los sueltes. */
    free: boolean;
  };
  card: {
    style: CardStyle;
    /** Opacidad del fondo de la tarjeta, 20–100. */
    opacity: number;
    /** Desenfoque del cristal en px, 0–40. */
    blur: number;
    /** Radio de las esquinas en px, 0–32. */
    radius: number;
    shadow: "none" | "soft" | "strong";
  };
  background: {
    type: "aurora" | "plain" | "gradient" | "image";
    /** Colores del degradado. */
    from: string;
    to: string;
    /** Ángulo del degradado, 0–360. */
    angle: number;
    /** Imagen subida (`<hash>.<ext>`); se conserva aunque `type` no sea `image`. */
    imageId: string | null;
    /** Desenfoque de la foto en px, 0–30. */
    blur: number;
    /** Oscurecimiento de la foto en %, 0–80. */
    dim: number;
  };
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "dark",
  palette: "sand",
  accent: "#e0793f",
  font: "humanist",
  density: "comfortable",
  layout: { free: false },
  card: { style: "solid", opacity: 100, blur: 0, radius: 14, shadow: "soft" },
  background: { type: "plain", from: "#2a2520", to: "#13110e", angle: 160, imageId: null, blur: 0, dim: 35 },
};

export const BACKGROUND_ID_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp|avif)$/;

export type Role = "admin" | "viewer";

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  /** Contraseña temporal: hasta cambiarla solo se permite cambiarla o cerrar sesión. */
  mustChangePassword: boolean;
}

/** Usuario tal como lo ve el administrador. */
export interface UserDTO {
  id: string;
  username: string;
  role: Role;
  createdAt: number;
  mustChangePassword: boolean;
  /** Sesiones activas. */
  sessions: number;
  /** Última actividad (ms), o null si nunca inició sesión. */
  lastSeen: number | null;
}

export interface SessionDTO {
  /** Identificador de la sesión (hash; no permite suplantarla). */
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeen: number;
}

export type WidgetData =
  | { ok: true; view: View; fetchedAt: number }
  | { ok: false; error: string };

export const GRID_COLUMNS = 12;

// ───────── Configuración en texto ─────────

/** Los documentos en los que se puede editar toda la configuración a mano. */
export const CONFIG_DOC_IDS = ["pages", "connections", "appearance"] as const;
export type ConfigDocId = (typeof CONFIG_DOC_IDS)[number];

export interface ConfigDocDTO {
  id: ConfigDocId;
  /** Nombre de archivo sugerido al descargarlo. */
  filename: string;
  text: string;
}

export interface ConfigDocsDTO {
  documents: ConfigDocDTO[];
  /** Variables `OBLIVION_VAR_*` definidas en el servidor (solo el nombre) que se pueden usar como `{{NOMBRE}}`. */
  variables: string[];
}

export interface ConfigProblem {
  doc: ConfigDocId;
  message: string;
  /** Línea (1 = primera) del documento donde está el problema, si se conoce. */
  line?: number;
  /** Ruta dentro del documento, p. ej. `pages[0].widgets[2].config.url`. */
  path?: string;
}

export interface ConfigChange {
  doc: ConfigDocId;
  action: "add" | "update" | "remove";
  kind: "page" | "widget" | "connection" | "appearance";
  id: string;
  label: string;
}

export interface ConfigPlanDTO {
  ok: boolean;
  problems: ConfigProblem[];
  changes: ConfigChange[];
  warnings: ConfigProblem[];
}
