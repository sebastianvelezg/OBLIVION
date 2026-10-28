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
  }[];
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

export type View = MetricView | StatsView | ListView | MessageView | MediaView;

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
  config: Field[];
  /** Cada cuántos segundos refrescar el dato (mín. 5). Solo widgets con `load`. */
  refreshSeconds?: number;
  /**
   * Widget dibujado por el propio dashboard (reloj, calculadora...).
   * Reservado para el plugin `core`.
   */
  component?: string;
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
  config: Field[];
  component?: string;
  refreshSeconds: number;
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
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageDTO {
  id: string;
  title: string;
  position: number;
  widgets: WidgetDTO[];
}

// ───────────────────────────── Apariencia ──────────────────────────────────

export const PALETTE_IDS = ["midnight", "graphite", "ocean", "forest", "plum", "ember"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export type CardStyle = "glass" | "solid" | "outline" | "flat";

/** Apariencia de todo el dashboard (la edita el administrador). */
export interface Appearance {
  mode: "dark" | "light" | "system";
  palette: PaletteId;
  /** `#rrggbb` */
  accent: string;
  font: "sans" | "mono" | "serif";
  density: "compact" | "comfortable" | "spacious";
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
  palette: "midnight",
  accent: "#7c8cff",
  font: "sans",
  density: "comfortable",
  card: { style: "glass", opacity: 62, blur: 18, radius: 20, shadow: "soft" },
  background: { type: "aurora", from: "#1b2140", to: "#0b0d13", angle: 160, imageId: null, blur: 0, dim: 35 },
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
