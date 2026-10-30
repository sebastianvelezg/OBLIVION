import { CircleAlert, TriangleAlert } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { ListView, MediaView, MetricView, StatsView, Tone, View } from "@oblivion/sdk";
import { Measured, useBox } from "../lib/box";
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

function MediaGrid({ view, widgetId }: { view: MediaView; widgetId: string }) {
  const box = useBox();
  if (view.items.length === 0) return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;
  const gap = 10;
  const textH = box.tier === "sm" ? 18 : 34;
  const grid = posterGrid(box.w, box.h, gap, textH);
  const tiny = "tiny" in grid;
  const items = view.items.slice(0, grid.count);
  const hidden = view.items.length - items.length;
  return (
    <ul
      className="grid content-start"
      style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gap }}
      title={hidden > 0 ? `${hidden} más` : undefined}
    >
      {items.map((it, i) => (
        <li key={i} className="min-w-0">
          <Poster widgetId={widgetId} item={it} />
          {!tiny && (
            <>
              <div className="mt-1.5 truncate text-xs font-medium" title={it.title}>
                {it.title}
              </div>
              {textH > 20 && it.subtitle && <div className="truncate text-[11px] text-muted">{it.subtitle}</div>}
            </>
          )}
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

function Stats({ view }: { view: StatsView }) {
  const box = useBox();
  const n = view.items.length;
  const gapX = 16;
  const gapY = 12;
  // Columnas según el ancho; las filas que quepan según el alto.
  const cols = clamp(Math.floor((box.w + gapX) / (96 + gapX)), 1, Math.min(4, n));
  const needRows = Math.ceil(n / cols);
  const minCell = 44;
  const maxRows = Math.max(1, Math.floor((box.h + gapY) / (minCell + gapY)));
  const rows = Math.min(needRows, maxRows);
  const cellH = (box.h - gapY * (rows - 1)) / rows;
  const visible = Math.min(n, cols * rows);
  const hidden = n - visible;
  const big = cellH >= 62;
  const valueFs = Math.floor(clamp(cellH * 0.46, 18, 40));

  return (
    <div className="grid size-full content-between" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: gapX, rowGap: gapY }}>
      {view.items.slice(0, visible).map((s, i) => (
        <div key={i} className="flex min-w-0 flex-col justify-center" title={s.hint ? `${s.label}: ${s.value} · ${s.hint}` : undefined}>
          {big && <div className="truncate text-xs text-muted">{s.label}</div>}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={`display truncate ${toneClass[s.tone ?? "neutral"]}`}
              style={{ fontSize: s.value.length > 9 ? Math.round(valueFs * 0.62) : valueFs }}
            >
              {s.value}
            </span>
            {!big && <span className="truncate text-xs text-muted">{s.label}</span>}
          </div>
          {big && s.hint && cellH >= 78 && <div className="truncate text-[11px] text-muted/80">{s.hint}</div>}
        </div>
      ))}
      {hidden > 0 && (
        <span className="col-span-full -mt-1 text-[11px] text-muted" aria-label={`${hidden} cifras más`}>
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

function List({ view }: { view: ListView }) {
  const box = useBox();
  if (view.items.length === 0) return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;

  // Titulares y registros: se desplazan. Lo demás enseña las filas que caben, sin barra de scroll.
  if (view.scroll) {
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

function Sections({ view, widgetId }: { view: Extract<View, { kind: "sections" }>; widgetId: string }) {
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      {view.sections.map((s, i) => {
        const basis = sectionBasis(s.view);
        return (
          <section
            key={i}
            className={`flex min-h-0 flex-col ${i > 0 ? "border-t border-line pt-3" : ""}`}
            style={{ flex: basis ? `0 1 ${basis}px` : "1 1 0" } as CSSProperties}
          >
            {s.title && <h3 className="mb-1.5 text-xs font-semibold text-muted">{s.title}</h3>}
            <Measured className="min-h-0 flex-1">{() => <ViewRenderer view={s.view} widgetId={widgetId} />}</Measured>
          </section>
        );
      })}
    </div>
  );
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
      return <List view={view} />;
    case "message":
      return <Message tone={view.tone ?? "neutral"} text={view.text} />;
  }
}

