import { useState } from "react";
import type { MediaView, Tone, View } from "@oblivion/sdk";
import { Chart } from "./Chart";
import { safeHref } from "./LinksWidget";

function Poster({ widgetId, item }: { widgetId: string; item: MediaView["items"][number] }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-accent-soft">
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
        <div className="grid size-full place-items-center text-3xl font-semibold text-accent-text/70">
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

const toneClass: Record<Tone, string> = {
  neutral: "text-fg",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
};

/**
 * Dibuja las vistas declarativas que devuelven los plugins. Todo se inserta
 * como texto (React lo escapa): un plugin nunca puede inyectar HTML.
 */
export function ViewRenderer({ view, widgetId }: { view: View; widgetId: string }) {
  switch (view.kind) {
    case "sections":
      return (
        <div className="space-y-5">
          {view.sections.map((s, i) => (
            <section key={i}>
              {s.title && <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{s.title}</h3>}
              <ViewRenderer view={s.view} widgetId={widgetId} />
            </section>
          ))}
        </div>
      );

    case "chart":
      return <Chart view={view} />;

    case "media":
      if (view.items.length === 0) {
        return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;
      }
      return (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
          {view.items.map((it, i) => (
            <li key={i} className="min-w-0">
              <Poster widgetId={widgetId} item={it} />
              <div className="mt-1.5 truncate text-xs font-medium" title={it.title}>
                {it.title}
              </div>
              {it.subtitle && <div className="truncate text-[11px] text-muted">{it.subtitle}</div>}
            </li>
          ))}
        </ul>
      );

    case "metric":
      return (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center gap-3">
            {view.icon && <span className="text-5xl leading-none">{view.icon}</span>}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1">
                <span className="text-5xl font-semibold tracking-tight tabular-nums">{view.value}</span>
                {view.unit && <span className="text-xl text-muted">{view.unit}</span>}
              </div>
              {view.caption && <div className="truncate text-sm text-muted">{view.caption}</div>}
            </div>
          </div>

          {view.rows && view.rows.length > 0 && (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-2 text-center">
              {view.rows.map((r) => (
                <div key={r.label} className="rounded-xl bg-accent-soft px-2 py-1.5">
                  <dt className="text-[11px] uppercase tracking-wide text-muted">{r.label}</dt>
                  <dd className="text-sm font-medium tabular-nums">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {view.strip && view.strip.length > 0 && (
            <ul className="mt-auto flex justify-between gap-1 border-t border-line pt-3">
              {view.strip.map((s) => (
                <li key={s.label} className="min-w-0 flex-1 text-center">
                  <div className="text-[11px] uppercase text-muted">{s.label}</div>
                  {s.icon && <div className="text-xl">{s.icon}</div>}
                  <div className="truncate text-xs tabular-nums">{s.value}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case "stats":
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.6rem,1fr))] gap-2">
          {view.items.map((s, i) => (
            <div key={i} className="rounded-xl bg-accent-soft px-3 py-2.5">
              <div className={`${s.value.length > 9 ? "text-lg" : "text-2xl"} font-semibold tabular-nums [overflow-wrap:anywhere] ${toneClass[s.tone ?? "neutral"]}`}>{s.value}</div>
              <div className="text-xs text-muted">{s.label}</div>
              {s.hint && <div className="text-[11px] text-muted/80">{s.hint}</div>}
            </div>
          ))}
        </div>
      );

    case "list":
      if (view.items.length === 0) {
        return <p className="text-sm text-muted">{view.empty ?? "Nada por aquí."}</p>;
      }
      return (
        <ul className="space-y-1.5">
          {view.items.map((it, i) => (
            <li key={i} className="rounded-xl bg-accent-soft px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                {safeHref(it.href) ? (
                  <a
                    href={safeHref(it.href)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`truncate text-sm font-medium hover:underline ${toneClass[it.tone ?? "neutral"]}`}
                    title={it.title}
                  >
                    {it.title}
                  </a>
                ) : (
                  <span className={`truncate text-sm font-medium ${toneClass[it.tone ?? "neutral"]}`}>{it.title}</span>
                )}
                {it.right && <span className="shrink-0 text-xs tabular-nums text-muted">{it.right}</span>}
              </div>
              {it.subtitle && <div className="truncate text-xs text-muted">{it.subtitle}</div>}
              {it.progress !== undefined && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      );

    case "message":
      return <p className={`text-sm ${toneClass[view.tone ?? "neutral"]}`}>{view.text}</p>;
  }
}
