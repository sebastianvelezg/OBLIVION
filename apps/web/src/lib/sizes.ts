import type { CatalogWidget, SizeId } from "@oblivion/sdk";
import { GRID_COLUMNS } from "@oblivion/sdk";

export interface SizePreset {
  id: SizeId;
  /** Letra para el botón y nombre completo. */
  short: string;
  label: string;
  w: number;
  h: number;
}

const LABELS: Record<SizeId, { short: string; label: string }> = {
  s: { short: "S", label: "Compacto" },
  m: { short: "M", label: "Medio" },
  l: { short: "L", label: "Grande" },
  xl: { short: "XL", label: "Extra grande" },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Tamaños rápidos de un widget. El «medio» es su tamaño por defecto; los que el widget
 * no declara se deducen de él, sin pasarse de la grilla ni bajar de su mínimo.
 */
export function sizePresets(def: Pick<CatalogWidget, "defaultSize" | "minSize" | "sizes">): SizePreset[] {
  const { defaultSize: d, minSize: min } = def;
  const derived: Record<SizeId, { w: number; h: number }> = {
    s: { w: d.w * 0.6, h: d.h * 0.55 },
    m: d,
    l: { w: d.w * 1.5, h: d.h * 1.45 },
    xl: { w: d.w * 2, h: d.h * 1.9 },
  };
  const out: SizePreset[] = [];
  for (const id of ["s", "m", "l", "xl"] as const) {
    const given = def.sizes?.[id];
    const raw = id === "m" ? d : (given ?? derived[id]);
    const w = clamp(raw.w, min.w, GRID_COLUMNS);
    const h = clamp(raw.h, min.h, 60);
    // Sin repetir: si dos tamaños salen iguales, queda el primero.
    if (out.some((p) => p.w === w && p.h === h)) continue;
    out.push({ id, ...LABELS[id], w, h });
  }
  return out;
}

/** El tamaño rápido que coincide exactamente con w×h, si lo hay. */
export function presetFor(presets: SizePreset[], w: number, h: number) {
  return presets.find((p) => p.w === w && p.h === h);
}
