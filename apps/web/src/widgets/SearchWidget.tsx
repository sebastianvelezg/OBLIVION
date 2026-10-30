import { Search } from "lucide-react";
import { useState } from "react";
import { useBox } from "../lib/box";
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
  const box = useBox();
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

  // Versión grande: la barra crece y lleva el nombre del buscador encima.
  const big = box.h >= 96;
  const huge = box.h >= 150;

  return (
    <form onSubmit={go} className="flex size-full flex-col justify-center gap-2" role="search">
      {big && <span className="text-xs font-semibold text-muted">Buscar con {name}</span>}
      <label className="relative block w-full">
        <span className="sr-only">Buscar con {name}</span>
        <Search
          size={huge ? 20 : 16}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${huge ? "left-4" : "left-3"}`}
          aria-hidden
        />
        <input
          className={`input ${huge ? "py-4 pl-12 text-lg" : big ? "py-3 pl-10 text-base" : "pl-9"}`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={box.narrow ? "Buscar…" : `Buscar con ${name}…`}
          maxLength={300}
          autoComplete="off"
        />
      </label>
    </form>
  );
}
