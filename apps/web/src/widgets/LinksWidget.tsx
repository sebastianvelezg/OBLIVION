import { ExternalLink } from "lucide-react";
import { useBox } from "../lib/box";

interface LinkItem {
  label: string;
  url: string;
  icon?: string;
}

/** Defensa en profundidad: el servidor ya valida, pero nunca pintamos un href que no sea http(s). */
export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const GAP = 8;

export function LinksWidget({ config }: { config: Record<string, any> }) {
  const box = useBox();
  const all: LinkItem[] = Array.isArray(config.items) ? config.items : [];
  const items = all.filter((it) => safeHref(it.url));
  const asList = config.layout === "list";
  const newTab = config.newTab !== false;

  if (items.length === 0) {
    return <p className="text-sm text-muted">Aún no hay enlaces. Edita el widget para añadirlos.</p>;
  }

  // Tres formas según el espacio: tiras (muy bajo), lista, o cuadrícula de iconos grandes.
  const strip = !asList && box.h < 92;
  const list = asList && box.h >= 60;
  const inline = strip || list;
  const rowH = inline ? 36 : 78;
  const minCell = strip ? 120 : list ? (box.wide ? 200 : box.w) : 92;
  const cols = Math.max(1, Math.floor((box.w + GAP) / (minCell + GAP)));
  const rows = Math.max(1, Math.floor((box.h + GAP) / (rowH + GAP)));
  const capacity = cols * rows;
  // Si no caben todos, la última celda se reserva para «+N» (salvo que solo quepa una).
  const reserveTile = items.length > capacity && capacity > 1;
  const shown = items.slice(0, reserveTile ? capacity - 1 : capacity);
  const hidden = items.length - shown.length;

  return (
    <ul className="grid content-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}>
      {shown.map((it, i) => {
        const href = safeHref(it.url)!;
        const glyph = it.icon || it.label.slice(0, 1).toUpperCase();
        return (
          <li key={i} className="min-w-0">
            <a
              href={href}
              target={newTab ? "_blank" : undefined}
              rel="noopener noreferrer"
              title={`${it.label} · ${href}`}
              style={{ height: rowH }}
              className={`group flex min-w-0 items-center rounded-xl border border-line transition-colors hover:border-accent hover:bg-accent-soft ${
                inline ? "gap-2.5 px-3" : "flex-col justify-center gap-1 px-2 text-center"
              }`}
            >
              <span
                className={`${inline ? "text-base" : "text-2xl"} grid shrink-0 place-items-center leading-none ${it.icon ? "" : "display text-accent-text"}`}
                aria-hidden
              >
                {glyph}
              </span>
              <span className={`min-w-0 text-sm font-medium ${inline ? "flex-1 truncate" : "w-full truncate"}`}>{it.label}</span>
              {list && <ExternalLink size={13} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />}
            </a>
          </li>
        );
      })}
      {reserveTile && hidden > 0 && (
        <li className="min-w-0">
          <span
            style={{ height: rowH }}
            className="grid place-items-center rounded-xl border border-dashed border-line text-xs text-muted"
            title={`${hidden} enlaces más: agranda el widget`}
          >
            +{hidden}
          </span>
        </li>
      )}
    </ul>
  );
}
