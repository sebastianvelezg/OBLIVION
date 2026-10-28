import { ExternalLink } from "lucide-react";

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

export function LinksWidget({ config }: { config: Record<string, any> }) {
  const items: LinkItem[] = Array.isArray(config.items) ? config.items : [];
  const list = config.layout === "list";
  const newTab = config.newTab !== false;

  if (items.length === 0) {
    return <p className="text-sm text-muted">Aún no hay enlaces. Edita el widget para añadirlos.</p>;
  }

  return (
    <ul className={list ? "space-y-1" : "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2"}>
      {items.map((it, i) => {
        const href = safeHref(it.url);
        if (!href) return null;
        return (
          <li key={i}>
            <a
              href={href}
              target={newTab ? "_blank" : undefined}
              rel="noopener noreferrer"
              className={`group flex items-center gap-2.5 rounded-xl bg-accent-soft px-3 py-2.5 transition-all hover:brightness-125 hover:shadow-md ${
                list ? "" : "flex-col py-4 text-center"
              }`}
            >
              <span className={list ? "text-lg" : "text-2xl"} aria-hidden>
                {it.icon || it.label.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.label}</span>
              {list && <ExternalLink size={14} className="text-muted opacity-0 group-hover:opacity-100" />}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
