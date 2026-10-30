import { CircleAlert, TriangleAlert } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { ListView, MediaView, MetricView, StatsView, Tone, View } from "@oblivion/sdk";
import { Measured, useBox } from "../lib/box";
import { ITEM_WIDTH, useViewOptions } from "../lib/options";
import { Chart } from "./Chart";
import { safeHref } from "./LinksWidget";

const toneClass: Record<Tone, string> = {
  neutral: "text-fg",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};
const toneDot: Record<Tone, string> = {
  neutral: "bg-muted/50",
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────────────────────────── Carátulas ─────────────────────────────

function Poster({ widgetId, item }: { widgetId: string; item: MediaView["items"][number] }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
      {item.image && !failed ? (
        <img
          src={`/api/widgets/${widgetId}/image/${encodeURIComponent(item.image)}`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        // Sin carátula: la inicial del título sobre el color de acento.
        <div className="display grid size-full place-items-center text-4xl text-accent-text/70">
          {item.title.slice(0, 1).toUpperCase()}
        </div>
      )}
      {item.badge && (
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {item.badge}
        </span>
      )}
      {item.progress !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Elige columnas y filas para que las carátulas llenen el alto disponible sin desplazamiento. */
function posterGrid(w: number, h: number, gap: number, textH: number) {
  let best: { cols: number; rows: number; count: number; cell: number } | null = null;
  for (let cols = 1; cols <= 12; cols++) {
    const cell = (w - gap * (cols - 1)) / cols;
    if (cell < 58 || cell > 170) continue;
    const rows = Math.floor((h + gap) / (cell * 1.5 + textH + gap));
    if (rows < 1) continue;
    const count = cols * rows;
    if (!best || count > best.count || (count === best.count && cell > best.cell)) best = { cols, rows, count, cell };
  }
  if (best) return best;
  // Muy poco alto: una sola fila de carátulas pequeñas, sin texto.
  const cell = clamp((h - 2) / 1.5, 36, 170);
  const cols = Math.max(1, Math.floor((w + gap) / (cell + gap)));
  return { cols, rows: 1, count: cols, cell, tiny: true as const };
}

function Caption({ it, show, sub }: { it: MediaView["items"][number]; show: boolean; sub: boolean }) {
  if (!show) return null;
  return (
    <>
      <div className="mt-1.5 truncate text-xs font-medium" title={it.title}>
        {it.title}
      </div>
      {sub && it.subtitle && <div className="truncate text-[11px] text-muted">{it.subtitle}</div>}
    </>
  );
}

function MediaGrid({ view, widgetId, posterW }: { view: MediaView; widgetId: string; posterW?: number }) {
  const box = useBox();
  const opt = useViewOptions();
  if (view.items.length === 0) return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;
  const gap = 10;
  const textH = box.tier === "sm" ? 18 : 34;

  // Una sola fila que se desplaza hacia los lados (una por biblioteca).
  if (view.layout === "row") {
    const byHeight = clamp((box.h - textH - 10) / 1.5, 48, 240);
    const width = posterW ?? (opt.itemSize ? ITEM_WIDTH[opt.itemSize] : Math.min(byHeight, 150));
    return (
      <ul className="flex size-full gap-2.5 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]">
        {view.items.map((it, i) => (
          <li key={i} className="shrink-0" style={{ width }}>
            <Poster widgetId={widgetId} item={it} />
            <Caption it={it} show={width >= 56} sub={width >= 110} />
          </li>
        ))}
      </ul>
    );
  }

  let cols: number;
  let cell: number;
  let tiny = false;
  let count: number;
  if (opt.columns || opt.itemSize) {
    cols = opt.columns ?? Math.max(1, Math.floor((box.w + gap) / (ITEM_WIDTH[opt.itemSize!] + gap)));
    cols = Math.min(cols, 12);
    cell = (box.w - gap * (cols - 1)) / cols;
    const rows = Math.max(1, Math.floor((box.h + gap) / (cell * 1.5 + textH + gap)));
    count = cols * rows;
  } else {
    const grid = posterGrid(box.w, box.h, gap, textH);
    ({ cols, cell, count } = grid);
    tiny = "tiny" in grid;
  }
  // Con «desplazar» se ven todas; si no, solo las que caben y el resto se resume.
  const items = opt.scroll ? view.items : view.items.slice(0, count);
  const hidden = view.items.length - items.length;
  const showText = !tiny && cell >= 56;
  return (
    <ul
      className={`grid content-start ${opt.scroll ? "size-full overflow-y-auto pr-1 [scrollbar-width:thin]" : ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}
      title={hidden > 0 ? `${hidden} más` : undefined}
    >
      {items.map((it, i) => (
        <li key={i} className="min-w-0">
          <Poster widgetId={widgetId} item={it} />
          <Caption it={it} show={showText} sub={textH > 20 && cell >= 100} />
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── Métrica ─────────────────────────────

function Metric({ view }: { view: MetricView }) {
  const box = useBox();
  const rows = view.rows ?? [];
  const strip = view.strip ?? [];

  // Lo que cabe, por prioridad: el valor grande manda; luego el texto, las cifras y el pronóstico.
  const VALUE_MIN = 52;
  let left = box.h - VALUE_MIN;
  const showCaption = !!view.caption && left >= 22;
  if (showCaption) left -= 22;
  const showRows = rows.length > 0 && left >= 54;
  if (showRows) left -= 54;
  const showStrip = strip.length > 0 && left >= 78;
  if (showStrip) left -= 78;

  const valueH = left + VALUE_MIN;
  const chars = view.value.length + (view.unit ? view.unit.length * 0.45 : 0);
  const byWidth = (box.w - (view.icon ? 56 : 0)) / (chars * 0.5 + 0.2);
  const fs = Math.floor(clamp(Math.min(valueH * 0.78, byWidth), 24, 96));
  const stripCols = box.narrow ? Math.min(strip.length, 3) : strip.length;

  return (
    <div className="flex size-full min-h-0 flex-col justify-between gap-2.5">
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <div className="flex items-center gap-3">
          {view.icon && (
            <span className="shrink-0 leading-none" style={{ fontSize: Math.round(fs * 0.85) }} aria-hidden>
              {view.icon}
            </span>
          )}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="display truncate" style={{ fontSize: fs }}>
              {view.value}
            </span>
            {view.unit && (
              <span className="shrink-0 text-muted" style={{ fontSize: clamp(fs * 0.34, 13, 28) }}>
                {view.unit}
              </span>
            )}
          </div>
        </div>
        {showCaption && <div className="mt-1 truncate text-sm text-muted">{view.caption}</div>}
      </div>

      {showRows && (
        <dl className="grid shrink-0 gap-x-4 gap-y-1" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, box.narrow ? 2 : 4)}, minmax(0, 1fr))` }}>
          {rows.slice(0, box.narrow ? 4 : 8).map((r) => (
            <div key={r.label} className="min-w-0 border-t border-line pt-1.5">
              <dt className="truncate text-[11px] text-muted">{r.label}</dt>
              <dd className="truncate text-sm font-medium tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {showStrip && (
        <ul className="grid shrink-0 gap-1 border-t border-line pt-2.5" style={{ gridTemplateColumns: `repeat(${stripCols}, minmax(0, 1fr))` }}>
          {strip.slice(0, stripCols).map((s) => (
            <li key={s.label} className="min-w-0 text-center">
              <div className="truncate text-[11px] text-muted">{s.label}</div>
              {s.icon && <div className="text-xl leading-7">{s.icon}</div>}
              <div className="truncate text-xs tabular-nums">{s.value}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────── Cifras ─────────────────────────────

const STAT_FONT: Record<string, number> = { xs: 16, s: 22, m: 30, l: 42, xl: 56 };

/** Reparte las cifras: las columnas que dejan el número más grande sin que se pierda ninguna. */
function statsLayout(items: StatsView["items"], w: number, h: number, wantCols: number | undefined, cap: number | undefined) {
  const n = items.length;
  const gapX = 14;
  const gapY = 10;
  // La cifra más larga manda, salvo un nombre excepcionalmente largo (un servidor): ese se encoge él solo.
  const chars = Math.max(3, ...items.map((s) => Math.min(s.value.length, 8)));
  let best: { cols: number; rows: number; visible: number; cellW: number; cellH: number; fs: number; score: number } | null = null;
  for (const cols of wantCols ? [Math.min(wantCols, n)] : Array.from({ length: Math.min(n, 6) }, (_, i) => i + 1)) {
    const cellW = (w - gapX * (cols - 1)) / cols;
    if (cellW < 52 && cols > 1) continue;
    const rowsNeeded = Math.ceil(n / cols);
    const rows = Math.min(rowsNeeded, Math.max(1, Math.floor((h + gapY) / (40 + gapY))));
    const cellH = (h - gapY * (rows - 1)) / rows;
    const visible = Math.min(n, cols * rows);
    const fs = Math.floor(clamp(Math.min(cellH * 0.5, cellW / (chars * 0.58), cap ?? 56), 14, 64));
    const score = visible * 1000 + fs;
    if (!best || score > best.score) best = { cols, rows, visible, cellW, cellH, fs, score };
  }
  return { ...(best ?? { cols: 1, rows: 1, visible: Math.min(n, 1), cellW: w, cellH: h, fs: 20 }), gapX, gapY };
}

function Stats({ view }: { view: StatsView }) {
  const box = useBox();
  const opt = useViewOptions();
  const n = view.items.length;
  const L = statsLayout(view.items, box.w, box.h, opt.columns, opt.itemSize ? STAT_FONT[opt.itemSize] : undefined);
  const hidden = n - L.visible;
  const labelAbove = L.cellH >= L.fs * 1.9;
  const hintFits = L.cellH >= L.fs * 2.7;

  return (
    <div className="grid size-full content-center" style={{ gridTemplateColumns: `repeat(${L.cols}, minmax(0, 1fr))`, columnGap: L.gapX, rowGap: L.gapY }}>
      {view.items.slice(0, L.visible).map((s, i) => {
        // Un valor más largo que la columna (un nombre de servidor) se encoge sin afectar a los demás.
        const fs = Math.max(14, Math.min(L.fs, Math.floor(L.cellW / (s.value.length * 0.58))));
        return (
          <div
            key={i}
            className="flex min-w-0 flex-col justify-center"
            style={{ height: Math.min(L.cellH, L.fs * 3.2) }}
            title={s.hint ? `${s.label}: ${s.value} · ${s.hint}` : undefined}
          >
            {labelAbove && <div className="truncate text-xs text-muted">{s.label}</div>}
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className={`display truncate leading-tight ${toneClass[s.tone ?? "neutral"]}`} style={{ fontSize: fs }}>
                {s.value}
              </span>
              {!labelAbove && <span className="truncate text-xs text-muted">{s.label}</span>}
            </div>
            {labelAbove && hintFits && s.hint && <div className="truncate text-[11px] text-muted/80">{s.hint}</div>}
          </div>
        );
      })}
      {hidden > 0 && (
        <span className="col-span-full text-[11px] text-muted" aria-label={`${hidden} cifras más`}>
          +{hidden} más · agranda el widget para verlas
        </span>
      )}
    </div>
  );
}

// ───────────────────────────── Lista ─────────────────────────────

function itemHeight(it: ListView["items"][number]) {
  return 12 + 20 + (it.subtitle ? 16 : 0) + (it.progress !== undefined ? 8 : 0) + 1;
}

function Row({ it }: { it: ListView["items"][number] }) {
  const tone = it.tone ?? "neutral";
  const href = safeHref(it.href);
  const titleCls = `truncate text-sm font-medium ${toneClass[tone]}`;
  return (
    <li className="min-w-0 border-b border-line py-1.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {tone !== "neutral" && <span className={`size-1.5 shrink-0 rounded-full ${toneDot[tone]}`} aria-hidden />}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={`${titleCls} hover:underline`} title={it.title}>
              {it.title}
            </a>
          ) : (
            <span className={titleCls} title={it.title}>
              {it.title}
            </span>
          )}
        </div>
        {it.right && <span className="shrink-0 text-xs tabular-nums text-muted">{it.right}</span>}
      </div>
      {it.subtitle && <div className="truncate text-xs text-muted">{it.subtitle}</div>}
      {it.progress !== undefined && (
        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(it.progress * 100)}%` }} />
        </div>
      )}
    </li>
  );
}

/** El tamaño de las piezas, en una lista, es el de su texto y filas. */
const LIST_ZOOM = { xs: 0.85, s: 0.92, m: 1, l: 1.15, xl: 1.3 } as const;

function SizedList({ view }: { view: ListView }) {
  const opt = useViewOptions();
  const k = opt.itemSize ? LIST_ZOOM[opt.itemSize] : 1;
  if (k === 1) return <List view={view} />;
  return (
    <Measured className="size-full" scale={k}>
      {() => <List view={view} />}
    </Measured>
  );
}

function List({ view }: { view: ListView }) {
  const box = useBox();
  const opt = useViewOptions();
  if (view.items.length === 0) return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;

  // Titulares y registros: se desplazan. Lo demás enseña las filas que caben, sin barra de scroll
  // (salvo que el usuario pida desplazar).
  if (view.scroll || opt.scroll) {
    return (
      <ul className="size-full overflow-y-auto pr-1 [scrollbar-width:thin]">
        {view.items.map((it, i) => (
          <Row key={i} it={it} />
        ))}
      </ul>
    );
  }

  const fit = (avail: number) => {
    let used = 0;
    let n = 0;
    for (const it of view.items) {
      const next = used + itemHeight(it);
      if (next > avail) break;
      used = next;
      n++;
    }
    return n;
  };
  let n = fit(box.h);
  if (n < view.items.length) n = Math.max(1, fit(box.h - 22));
  const hidden = view.items.length - n;

  return (
    <div className="flex size-full flex-col">
      <ul className="min-h-0">
        {view.items.slice(0, n).map((it, i) => (
          <Row key={i} it={it} />
        ))}
      </ul>
      {hidden > 0 && <p className="mt-auto pt-1 text-[11px] text-muted">+{hidden} más · agranda el widget para verlos</p>}
    </div>
  );
}

// ───────────────────────────── Mensaje ─────────────────────────────

function Message({ tone, text }: { tone: Tone; text: string }) {
  const Icon = tone === "bad" ? CircleAlert : tone === "warn" ? TriangleAlert : null;
  return (
    <div className={`flex size-full items-center gap-2 text-sm ${toneClass[tone]}`}>
      {Icon && <Icon size={18} className="shrink-0" aria-hidden />}
      <p className="min-w-0 [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

// ───────────────────────────── Secciones ─────────────────────────────

/** Alto que pide cada tipo de sección dentro de un panel combinado (px); 0 = reparte lo que sobre. */
function sectionBasis(v: View): number {
  if (v.kind === "stats") return Math.ceil(v.items.length / 3) * 56;
  if (v.kind === "metric") return 110;
  if (v.kind === "message") return 28;
  return 0;
}

const isRow = (v: View) => v.kind === "media" && v.layout === "row";

function Sections({ view, widgetId }: { view: Extract<View, { kind: "sections" }>; widgetId: string }) {
  const box = useBox();
  const opt = useViewOptions();
  // Las filas de carátulas se reparten el alto: cada una, la mayor carátula que deje todas a la vista
  // (o el tamaño elegido; si no caben, el panel se desplaza).
  const rows = view.sections.filter((s) => isRow(s.view)).length;
  const others = view.sections.reduce((n, s) => n + (isRow(s.view) ? 0 : sectionBasis(s.view) || 90), 0);
  const between = 24; // hueco + relleno entre dos secciones
  // Alto del texto bajo la carátula: una línea si es pequeña, dos si es grande (título y subtítulo).
  const room = (text: number) => clamp(((box.h - others - rows * (22 + text + 8) - between * (rows - 1)) / rows) / 1.5, 64, 150);
  const fit = rows ? (room(22) >= 100 ? room(34) : room(22)) : 0;
  const posterW = opt.itemSize ? ITEM_WIDTH[opt.itemSize] : Math.floor(fit);
  const rowH = Math.ceil(posterW * 1.5) + (posterW >= 100 ? 34 : 22) + 8;

  return (
    <div className="flex size-full min-h-0 flex-col gap-3 overflow-y-auto [scrollbar-width:thin]">
      {view.sections.map((s, i) => {
        const row = isRow(s.view);
        const basis = sectionBasis(s.view);
        return (
          <section
            key={i}
            className={`flex min-h-0 shrink-0 flex-col ${i > 0 ? "border-t border-line pt-3" : ""}`}
            style={{ flex: row ? "0 0 auto" : basis ? `0 1 ${basis}px` : "1 1 0", ...(row ? { height: rowH + 22 + (i > 0 ? 12 : 0) } : {}) } as CSSProperties}
          >
            {s.title && <h3 className="mb-1.5 text-xs font-semibold text-muted">{s.title}</h3>}
            {row && s.view.kind === "media" ? (
              <div className="min-h-0 flex-1">
                <MediaRowFixed view={s.view} widgetId={widgetId} width={posterW} />
              </div>
            ) : (
              <Measured className="min-h-0 flex-1">{() => <ViewRenderer view={s.view} widgetId={widgetId} />}</Measured>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Fila de carátulas con una anchura decidida por el panel (todas las filas del panel miden igual). */
function MediaRowFixed({ view, widgetId, width }: { view: MediaView; widgetId: string; width: number }) {
  return <Measured className="size-full">{() => <MediaGrid view={view} widgetId={widgetId} posterW={width} />}</Measured>;
}

/**
 * Dibuja las vistas declarativas que devuelven los plugins. Todo se inserta
 * como texto (React lo escapa): un plugin nunca puede inyectar HTML. El resultado
 * se adapta al tamaño real del widget (ver `lib/box.tsx`).
 */
export function ViewRenderer({ view, widgetId }: { view: View; widgetId: string }) {
  switch (view.kind) {
    case "sections":
      return <Sections view={view} widgetId={widgetId} />;
    case "chart":
      return <Chart view={view} />;
    case "media":
      return <MediaGrid view={view} widgetId={widgetId} />;
    case "metric":
      return <Metric view={view} />;
    case "stats":
      return <Stats view={view} />;
    case "list":
      return <SizedList view={view} />;
    case "message":
      return <Message tone={view.tone ?? "neutral"} text={view.text} />;
  }
}

