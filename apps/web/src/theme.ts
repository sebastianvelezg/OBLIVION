import { useEffect } from "react";
import { DEFAULT_APPEARANCE, type Appearance, type PaletteId } from "@oblivion/sdk";

// ───────────────────────────── Paletas ─────────────────────────────

interface Tokens {
  bg: string;
  solid: string;
  surface2: string;
  fg: string;
  muted: string;
}

export const PALETTES: Record<PaletteId, { name: string; dark: Tokens; light: Tokens }> = {
  midnight: {
    name: "Medianoche",
    dark: { bg: "#0b0d13", solid: "#151823", surface2: "#1d2130", fg: "#e8eaf2", muted: "#8b90a3" },
    light: { bg: "#eef0f6", solid: "#ffffff", surface2: "#eceef6", fg: "#151826", muted: "#6a7088" },
  },
  graphite: {
    name: "Grafito",
    dark: { bg: "#0e0e10", solid: "#1a1a1d", surface2: "#242428", fg: "#ececee", muted: "#8e8e96" },
    light: { bg: "#efefef", solid: "#ffffff", surface2: "#ececec", fg: "#18181b", muted: "#71717a" },
  },
  ocean: {
    name: "Océano",
    dark: { bg: "#08121a", solid: "#0f1f2b", surface2: "#162b3a", fg: "#e4f1f7", muted: "#7f9bab" },
    light: { bg: "#e8f1f6", solid: "#ffffff", surface2: "#e3eef4", fg: "#0f2230", muted: "#5f7d8e" },
  },
  forest: {
    name: "Bosque",
    dark: { bg: "#0a120e", solid: "#121f18", surface2: "#1a2c22", fg: "#e6f2ea", muted: "#85a090" },
    light: { bg: "#e9f2ec", solid: "#ffffff", surface2: "#e3eee7", fg: "#112218", muted: "#5f806c" },
  },
  plum: {
    name: "Ciruela",
    dark: { bg: "#120b16", solid: "#1e1426", surface2: "#2a1c35", fg: "#f1e8f6", muted: "#a48bb3" },
    light: { bg: "#f3ecf7", solid: "#ffffff", surface2: "#eee4f4", fg: "#26102f", muted: "#86699a" },
  },
  ember: {
    name: "Brasa",
    dark: { bg: "#140c0a", solid: "#211410", surface2: "#2d1d17", fg: "#f6ece6", muted: "#b09585" },
    light: { bg: "#f8eee8", solid: "#ffffff", surface2: "#f3e6de", fg: "#2a140c", muted: "#957060" },
  },
  sand: {
    name: "Arena",
    dark: { bg: "#13110e", solid: "#1d1a16", surface2: "#292520", fg: "#efe9df", muted: "#9b9285" },
    light: { bg: "#f0ebe1", solid: "#fbf8f2", surface2: "#e9e3d6", fg: "#1f1b16", muted: "#7a7164" },
  },
  ink: {
    name: "Tinta",
    dark: { bg: "#0b0f15", solid: "#121822", surface2: "#1a2230", fg: "#e6ebf2", muted: "#8794a8" },
    light: { bg: "#e8ecf2", solid: "#fdfdfe", surface2: "#e0e6ee", fg: "#0f1722", muted: "#64728a" },
  },
};

export const ACCENTS = [
  { name: "Terracota", value: "#e0793f" },
  { name: "Índigo", value: "#7c8cff" },
  { name: "Violeta", value: "#a78bfa" },
  { name: "Rosa", value: "#f472b6" },
  { name: "Coral", value: "#fb7185" },
  { name: "Ámbar", value: "#fbbf24" },
  { name: "Lima", value: "#a3e635" },
  { name: "Menta", value: "#34d399" },
  { name: "Cian", value: "#22d3ee" },
  { name: "Salvia", value: "#9db08b" },
];

/** `stack` para el texto; `display` para cifras y títulos grandes (reloj, saludo, métricas). */
export const FONTS: Record<Appearance["font"], { name: string; stack: string; display: string; weight: number }> = {
  sans: {
    name: "Moderna",
    stack: '"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    display: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
    weight: 560,
  },
  humanist: {
    name: "Humanista",
    stack: '"Instrument Sans Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    display: '"Instrument Serif", ui-serif, Georgia, serif',
    weight: 400,
  },
  mono: {
    name: "Terminal",
    stack: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    display: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    weight: 500,
  },
  serif: {
    name: "Editorial",
    stack: '"Newsreader Variable", ui-serif, Georgia, "Times New Roman", serif',
    display: '"Newsreader Variable", ui-serif, Georgia, serif',
    weight: 500,
  },
};

export const DENSITIES: Record<Appearance["density"], { name: string; gap: number; row: number; pad: number }> = {
  compact: { name: "Compacta", gap: 8, row: 38, pad: 12 },
  comfortable: { name: "Cómoda", gap: 14, row: 44, pad: 16 },
  spacious: { name: "Amplia", gap: 22, row: 50, pad: 22 },
};

// ───────────────────────────── Estilos predefinidos ─────────────────────────────

export interface Preset {
  id: string;
  name: string;
  hint: string;
  apply: (a: Appearance) => Appearance;
}

/** Un estilo cambia la forma (tarjetas, densidad, fondo, letra); no toca tu paleta ni tu acento. */
export const PRESETS: Preset[] = [
  {
    id: "workshop",
    name: "Taller",
    hint: "Cálido y sobrio: tarjetas sólidas, letra humanista",
    apply: (a) => ({
      ...a,
      font: "humanist",
      density: "comfortable",
      card: { style: "solid", opacity: 100, blur: 0, radius: 14, shadow: "soft" },
      background: { ...a.background, type: a.background.imageId ? "image" : "plain" },
    }),
  },
  {
    id: "bento",
    name: "Bento",
    hint: "Mosaico apretado de bloques planos y redondeados",
    apply: (a) => ({
      ...a,
      font: "humanist",
      density: "compact",
      card: { style: "flat", opacity: 100, blur: 0, radius: 24, shadow: "none" },
      background: { ...a.background, type: a.background.imageId ? "image" : "plain" },
    }),
  },
  {
    id: "paper",
    name: "Papel",
    hint: "Claro y editorial, como una libreta (cambia a modo claro)",
    apply: (a) => ({
      ...a,
      mode: "light",
      palette: "sand",
      font: "serif",
      density: "spacious",
      card: { style: "solid", opacity: 100, blur: 0, radius: 6, shadow: "soft" },
      background: { ...a.background, type: "plain" },
    }),
  },
  {
    id: "photo",
    name: "Fotografía",
    hint: "Tu foto de fondo con tarjetas de cristal ligero",
    apply: (a) => ({
      ...a,
      font: "humanist",
      density: "comfortable",
      card: { style: "glass", opacity: 38, blur: 16, radius: 18, shadow: "soft" },
      background: { ...a.background, type: a.background.imageId ? "image" : "aurora", dim: Math.max(a.background.dim, 30) },
    }),
  },
  {
    id: "glass",
    name: "Cristal",
    hint: "Tarjetas translúcidas con desenfoque",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "comfortable",
      card: { style: "glass", opacity: 55, blur: 22, radius: 22, shadow: "soft" },
      background: { ...a.background, type: a.background.imageId ? "image" : "aurora" },
    }),
  },
  {
    id: "solid",
    name: "Sólido",
    hint: "Tarjetas opacas, limpio y clásico",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "comfortable",
      card: { style: "solid", opacity: 100, blur: 0, radius: 14, shadow: "soft" },
      background: { ...a.background, type: "plain" },
    }),
  },
  {
    id: "minimal",
    name: "Minimalista",
    hint: "Plano, sin sombras, compacto",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "compact",
      card: { style: "flat", opacity: 70, blur: 0, radius: 8, shadow: "none" },
      background: { ...a.background, type: "plain" },
    }),
  },
  {
    id: "outline",
    name: "Contorno",
    hint: "Solo líneas sobre el fondo",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "comfortable",
      card: { style: "outline", opacity: 30, blur: 6, radius: 16, shadow: "none" },
      background: { ...a.background, type: a.background.imageId ? "image" : "aurora" },
    }),
  },
  {
    id: "neon",
    name: "Neón",
    hint: "Bordes y resplandor del color de acento",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "comfortable",
      card: { style: "neon", opacity: 45, blur: 16, radius: 18, shadow: "soft" },
      background: { ...a.background, type: a.background.imageId ? "image" : "aurora" },
    }),
  },
  {
    id: "brutal",
    name: "Brutalista",
    hint: "Bordes gruesos y sombra dura, letra mono",
    apply: (a) => ({
      ...a,
      font: "mono",
      density: "comfortable",
      card: { style: "brutal", opacity: 100, blur: 0, radius: 0, shadow: "soft" },
      background: { ...a.background, type: "plain" },
    }),
  },
  {
    id: "editorial",
    name: "Editorial",
    hint: "Letra con serifa, amplio y sobrio",
    apply: (a) => ({
      ...a,
      font: "serif",
      density: "spacious",
      card: { style: "flat", opacity: 60, blur: 0, radius: 4, shadow: "none" },
      background: { ...a.background, type: "plain" },
    }),
  },
  {
    id: "bubble",
    name: "Burbuja",
    hint: "Muy redondeado, cristal y sombra marcada",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "spacious",
      card: { style: "glass", opacity: 50, blur: 30, radius: 32, shadow: "strong" },
      background: { ...a.background, type: a.background.imageId ? "image" : "aurora" },
    }),
  },
  {
    id: "deep",
    name: "Profundo",
    hint: "Cristal casi opaco con degradado de fondo",
    apply: (a) => ({
      ...a,
      font: "sans",
      density: "comfortable",
      card: { style: "glass", opacity: 82, blur: 10, radius: 12, shadow: "strong" },
      background: { ...a.background, type: "gradient" },
    }),
  },
  {
    id: "terminal",
    name: "Terminal",
    hint: "Letra monoespaciada y esquinas rectas",
    apply: (a) => ({
      ...a,
      font: "mono",
      density: "compact",
      card: { style: "outline", opacity: 20, blur: 0, radius: 2, shadow: "none" },
      background: { ...a.background, type: "plain" },
    }),
  },
];

// ───────────────────────────── Aplicar al documento ─────────────────────────────

/** Negro o blanco según la luminancia, para que el texto sobre el acento siempre se lea. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0b0d13" : "#ffffff";
}

export function resolvedMode(a: Appearance): "dark" | "light" {
  if (a.mode !== "system") return a.mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Variables CSS del color de acento (las usa el tema global y los widgets con acento propio). */
export function accentVars(accent: string, mode: "dark" | "light"): Record<string, string> {
  return {
    "--accent": accent,
    "--accent-fg": readableOn(accent),
    "--accent-soft": `color-mix(in oklab, ${accent} 16%, transparent)`,
    // Acento para usar como COLOR DE TEXTO: se oscurece en modo claro y se aclara en oscuro.
    "--accent-text":
      mode === "light"
        ? `color-mix(in oklab, ${accent} 55%, black)`
        : `color-mix(in oklab, ${accent} 80%, white)`,
  };
}

/** Traduce la apariencia a variables CSS en <html>. Todo pasa por CSSOM (compatible con la CSP). */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const mode = resolvedMode(a);
  const t = PALETTES[a.palette][mode];
  const dens = DENSITIES[a.density];
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  root.dataset.theme = mode;
  root.style.colorScheme = mode;

  set("--bg", t.bg);
  set("--surface-solid", t.solid);
  set("--surface-2", t.surface2);
  set("--fg", t.fg);
  set("--muted", t.muted);
  set("--line", `color-mix(in oklab, ${t.fg} 11%, transparent)`);
  for (const [k, v] of Object.entries(accentVars(a.accent, mode))) set(k, v);
  set("--good", mode === "dark" ? "#4ade80" : "#16a34a");
  set("--warn", mode === "dark" ? "#fbbf24" : "#d97706");
  set("--bad", mode === "dark" ? "#f87171" : "#dc2626");

  // ── tarjeta
  const { style, opacity, blur, radius, shadow } = a.card;
  const opaque = style === "solid" || style === "brutal";
  const pct = opaque ? 100 : style === "outline" ? Math.min(opacity, 40) : opacity;
  set("--card-bg", `color-mix(in oklab, ${t.solid} ${pct}%, transparent)`);
  set("--card-blur", opaque ? "0px" : `${blur}px`);
  // Neón y brutalista se dibujan en styles.css con el acento de CADA tarjeta (para que un acento propio funcione).
  root.dataset.cardStyle = style;
  set("--neon-glow", `${{ none: 0, soft: 45, strong: 75 }[shadow]}%`);
  set("--brutal-offset", `${{ none: 0, soft: 5, strong: 9 }[shadow]}px`);
  const borderPct = style === "outline" ? 26 : style === "flat" ? 0 : style === "glass" ? 14 : 10;
  set("--card-border", `color-mix(in oklab, ${t.fg} ${borderPct}%, transparent)`);
  const glassHighlight = style === "glass" ? `inset 0 1px 0 color-mix(in oklab, ${t.fg} 10%, transparent), ` : "";
  const shadows = {
    none: "none",
    soft: `${glassHighlight}0 10px 30px -14px rgba(0,0,0,${mode === "dark" ? 0.6 : 0.2})`,
    strong: `${glassHighlight}0 22px 50px -12px rgba(0,0,0,${mode === "dark" ? 0.8 : 0.35})`,
  };
  set("--card-shadow", shadows[shadow]);
  set("--card-radius", `${radius}px`);
  set("--r-sm", `${Math.max(3, Math.round(radius * 0.4))}px`);
  set("--r-md", `${Math.max(4, Math.round(radius * 0.6))}px`);
  set("--r-lg", `${Math.max(5, Math.round(radius * 0.8))}px`);

  // ── densidad y tipografía
  set("--card-pad", `${dens.pad}px`);
  set("--app-font", FONTS[a.font].stack);
  set("--display-font", FONTS[a.font].display);
  set("--display-weight", String(FONTS[a.font].weight));
}

// ───────────────────────────── Caché local ─────────────────────────────

const CACHE_KEY = "oblivion.appearance.v2";

/** Copia local para pintar el tema correcto antes de que llegue la respuesta del servidor. */
export function loadCachedAppearance(): Appearance | null {
  try {
    const p = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (p && p.card && p.background && /^#[0-9a-f]{6}$/i.test(p.accent) && p.palette in PALETTES) {
      return { ...DEFAULT_APPEARANCE, ...p, card: { ...DEFAULT_APPEARANCE.card, ...p.card }, background: { ...DEFAULT_APPEARANCE.background, ...p.background } };
    }
  } catch {
    /* sin almacenamiento o JSON roto */
  }
  return null;
}

export function cacheAppearance(a: Appearance) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    /* modo privado */
  }
}

/** Aplica la apariencia y, en modo «sistema», reacciona a cambios del SO. */
export function useAppearanceEffect(a: Appearance) {
  useEffect(() => {
    applyAppearance(a);
    if (a.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(a);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [a]);
}
