import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Cada widget se dibuja según el espacio REAL que tiene (no según una opción suelta):
 * al agrandar o encoger la tarjeta, el contenido pasa solo de la versión compacta a la
 * mediana o a la grande. `Measured` mide un recuadro y se lo da a quien esté dentro.
 */
export type Tier = "xs" | "sm" | "md" | "lg" | "xl";

export interface Box {
  /** Píxeles útiles (sin el relleno de la tarjeta). */
  w: number;
  h: number;
  /** Versión del contenido según el alto: xs (una franja) → xl (muy alto). */
  tier: Tier;
  /** Menos de ~220 px de ancho: hay que apilar y abreviar. */
  narrow: boolean;
  /** Más de ~420 px de ancho: caben varias columnas. */
  wide: boolean;
}

export function tierOf(h: number): Tier {
  if (h < 84) return "xs";
  if (h < 170) return "sm";
  if (h < 290) return "md";
  if (h < 420) return "lg";
  return "xl";
}

export function makeBox(w: number, h: number): Box {
  return { w, h, tier: tierOf(h), narrow: w < 220, wide: w >= 420 };
}

const TIER_ORDER: Tier[] = ["xs", "sm", "md", "lg", "xl"];
/** `atLeast(box, "md")`: la versión mediana o mayor. */
export const atLeast = (b: Box, t: Tier) => TIER_ORDER.indexOf(b.tier) >= TIER_ORDER.indexOf(t);

const BoxContext = createContext<Box>(makeBox(320, 240));
export const useBox = () => useContext(BoxContext);

/** El navegador sabe escalar un bloque entero con `zoom` (todos los actuales; Firefox desde la 126). */
const ZOOM_OK = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1.2");

/**
 * Recuadro que mide su propio tamaño y lo reparte entre sus hijos. Con `scale` ≠ 1 el contenido
 * se dibuja en un espacio `scale` veces menor y se amplía después: así todo (texto, carátulas,
 * márgenes) crece a la vez y las vistas siguen calculando con el hueco que de verdad tienen.
 */
export function Measured({
  children,
  className,
  style,
  scale = 1,
}: {
  children: (box: Box) => ReactNode;
  className?: string;
  style?: CSSProperties;
  scale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const k = ZOOM_OK && scale > 0 ? scale : 1;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = Math.round(size.w / k);
  const h = Math.round(size.h / k);
  const box = useMemo(() => makeBox(w, h), [w, h]);

  return (
    <div ref={ref} className={className} style={style}>
      <BoxContext.Provider value={box}>
        {w > 0 && h > 0 ? (
          k === 1 ? (
            children(box)
          ) : (
            <div style={{ zoom: k, width: w, height: h }}>{children(box)}</div>
          )
        ) : null}
      </BoxContext.Provider>
    </div>
  );
}
