import { createContext, useContext } from "react";
import type { CatalogWidget, ItemSize, WidgetStyle } from "@oblivion/sdk";

/**
 * Lo que el usuario puede retocar del INTERIOR de un widget (además de su tamaño): cuánto
 * crece el contenido, qué tamaño tienen las piezas (carátulas, cifras), cuántas columnas hay y si
 * lo que no cabe se resume o se desplaza. Cada vista lo lee de aquí y lo aplica a su manera.
 */
export interface ViewOptions {
  itemSize?: ItemSize;
  columns?: number;
  scroll: boolean;
}

const Ctx = createContext<ViewOptions>({ scroll: false });
export const ViewOptionsProvider = Ctx.Provider;
export const useViewOptions = () => useContext(Ctx);

export const optionsOf = (style: WidgetStyle | undefined): ViewOptions => ({
  itemSize: style?.itemSize,
  columns: style?.columns,
  scroll: style?.overflow === "scroll",
});

/** Anchura objetivo (px) de una pieza según su tamaño: carátulas, cifras... */
export const ITEM_WIDTH: Record<ItemSize, number> = { xs: 64, s: 88, m: 120, l: 160, xl: 210 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Una página web ajena o una foto ya se adaptan a la tarjeta: no se escalan ni a mano. */
export const NO_SCALE = new Set(["embed", "image"]);
/** Los enlaces reparten su espacio por cantidad: agrandarlos solos haría que no cupieran todos (a mano sí). */
const MANUAL_ONLY = new Set(["links"]);

/**
 * Escala automática: el contenido crece o encoge con la tarjeta respecto a su tamaño normal
 * (el «medio» del widget). Se mide por el lado que menos creció, así lo que cabía sigue cabiendo
 * aunque la tarjeta se estire solo a lo ancho o solo a lo alto.
 */
export function autoScale(def: Pick<CatalogWidget, "defaultSize" | "component"> | undefined, w: number, h: number): number {
  if (!def || (def.component && (NO_SCALE.has(def.component) || MANUAL_ONLY.has(def.component)))) return 1;
  const r = Math.min(w / def.defaultSize.w, h / def.defaultSize.h);
  const s = clamp(1 + (r - 1) * 0.5, 0.9, 1.4);
  // De 5 en 5 %: al estirar el borde no se redibuja con cada píxel.
  return Math.round(s * 20) / 20;
}

/** Escala que se aplica de verdad: la elegida (en %) o la automática. */
export function effectiveScale(style: WidgetStyle | undefined, def: Pick<CatalogWidget, "defaultSize" | "component"> | undefined, w: number, h: number) {
  return style?.scale ? style.scale / 100 : autoScale(def, w, h);
}

export const PAD_PX = { none: 0, tight: 8, roomy: 26 } as const;
