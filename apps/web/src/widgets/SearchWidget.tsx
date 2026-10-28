import { Search } from "lucide-react";
import { useState } from "react";
import { safeHref } from "./LinksWidget";

/** Buscadores incluidos: `{q}` se sustituye por lo escrito (ya codificado para una URL). */
export const ENGINES: Record<string, { name: string; url: string }> = {
  google: { name: "Google", url: "https://www.google.com/search?q={q}" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={q}" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q={q}" },
  brave: { name: "Brave", url: "https://search.brave.com/search?q={q}" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q={q}" },
  youtube: { name: "YouTube", url: "https://www.youtube.com/results?search_query={q}" },
  github: { name: "GitHub", url: "https://github.com/search?q={q}" },
  wikipedia: { name: "Wikipedia", url: "https://es.wikipedia.org/w/index.php?search={q}" },
};

/** Barra de búsqueda: abre el buscador elegido (o uno propio con `%s`) en otra pestaña. */
export function SearchWidget({ config }: { config: Record<string, any> }) {
  const [q, setQ] = useState("");
  const custom = typeof config.custom === "string" && config.custom.includes("%s") ? config.custom : null;
  const engine = ENGINES[config.engine as string] ?? ENGINES.google!;
  const template = config.engine === "custom" && custom ? custom.replace("%s", "{q}") : engine.url;
  let name = engine.name;
  if (config.engine === "custom" && custom) {
    try {
      name = new URL(custom).host || "tu buscador";
    } catch {
      name = "tu buscador";
    }
  }
  const newTab = config.newTab !== false;

  function go(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    const href = safeHref(template.replace("{q}", encodeURIComponent(text)));
    if (!href) return;
    // `window.open` (y no un formulario) porque la CSP solo permite enviar formularios al propio sitio.
    if (newTab) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.assign(href);
    setQ("");
  }

  return (
    <form onSubmit={go} className="flex h-full items-center" role="search">
      <label className="relative block w-full">
        <span className="sr-only">Buscar con {name}</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          className="input pl-9"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar con ${name}…`}
          maxLength={300}
          autoComplete="off"
        />
      </label>
    </form>
  );
}
