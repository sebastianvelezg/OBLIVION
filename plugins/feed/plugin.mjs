// Plugin de feeds RSS / Atom: titulares de los sitios que quieras (noticias, blogs, releases de GitHub…).
//
// No necesita API ni claves. Solo llama a las direcciones que escribas en la lista. El texto
// de un feed es ajeno al dashboard: se muestra siempre como texto y los enlaces solo pueden
// ser http(s).

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "feed",
  name: "Feeds RSS",
  version: "0.1.0",
  description: "Últimos titulares de tus feeds RSS o Atom, con enlace a cada artículo.",
  author: "Oblivion",
  widgets: [
    {
      type: "latest",
      name: "Titulares RSS",
      description: "Lo último de uno o varios feeds, mezclado y ordenado por fecha.",
      icon: "📰",
      defaultSize: { w: 5, h: 7 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [
        {
          key: "feeds",
          label: "Feeds",
          type: "list",
          maxItems: 10,
          itemFields: [
            { key: "name", label: "Nombre (opcional)", type: "string", placeholder: "Hacker News" },
            { key: "url", label: "URL del feed", type: "url", required: true, placeholder: "https://hnrss.org/frontpage" },
          ],
        },
        { key: "limit", label: "Cantidad de titulares", type: "number", default: 10, min: 1, max: 30 },
      ],

      async load(ctx) {
        const feeds = Array.isArray(ctx.config.feeds) ? ctx.config.feeds : [];
        if (feeds.length === 0) {
          return { kind: "message", text: "Añade al menos un feed en la configuración del widget (botón de ajustes en modo edición)." };
        }
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 10));

        const results = await Promise.allSettled(feeds.map((f) => readFeed(ctx, f)));
        // Si todos fallan se muestra el motivo; si solo falla alguno, se muestran los demás.
        if (results.every((r) => r.status === "rejected")) throw results[0].reason;
        const entries = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        entries.sort((a, b) => (b.time || 0) - (a.time || 0));

        return {
          kind: "list",
          empty: "Los feeds no tienen titulares.",
          items: entries.slice(0, limit).map((e) => ({
            title: e.title,
            subtitle: [e.source, ago(e.time)].filter(Boolean).join(" · "),
            href: e.link,
          })),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function readFeed(ctx, { name, url }) {
  const res = await ctx.http(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } });
  if (!res.ok) ctx.fail(`El feed respondió con error ${res.status}`);
  const entries = parse(res.text);
  if (entries === null) ctx.fail("La URL responde, pero no parece un feed RSS o Atom.");
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();
  const source = String(name || entries.feedTitle || host).slice(0, 60);
  return entries.items.map((e) => ({ ...e, source }));
}

/** Lector mínimo de RSS 2.0 y Atom (sin dependencias). Devuelve `null` si no es un feed. */
function parse(xml) {
  const isAtom = /<feed[\s>]/i.test(xml);
  const isRss = /<rss[\s>]|<rdf:RDF[\s>]|<channel[\s>]/i.test(xml);
  if (!isAtom && !isRss) return null;

  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const head = xml.slice(0, Math.max(0, xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i)) || undefined);
  const items = [];
  for (const b of blocks.slice(0, 40)) {
    const title = text(tag(b, "title"));
    if (!title) continue;
    let link = "";
    if (isAtom) {
      // Atom: <link href="…" rel="alternate"/> (si hay varios, el «alternate»).
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const pick = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l)) ?? links[0];
      link = pick ? (/href=["']([^"']+)["']/i.exec(pick)?.[1] ?? "") : "";
    } else {
      link = text(tag(b, "link")) || text(tag(b, "guid"));
    }
    link = decode(link).trim();
    const when = Date.parse(text(tag(b, isAtom ? "published" : "pubDate")) || text(tag(b, "updated")) || text(tag(b, "dc:date")));
    items.push({
      title: title.slice(0, 200),
      link: /^https?:\/\//i.test(link) ? link.slice(0, 500) : undefined,
      time: Number.isFinite(when) ? when : 0,
    });
  }
  return { items, feedTitle: text(tag(head, "title")) };
}

function tag(s, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(s);
  return m ? m[1] : "";
}

/** Quita CDATA y etiquetas, decodifica entidades y colapsa espacios. */
function text(s) {
  return decode(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const safeChar = (c) => (Number.isInteger(c) && c > 31 && c < 0x110000 && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : "");

function ago(t) {
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 30 * 86400) return `hace ${Math.round(s / 86400)} d`;
  return new Date(t).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}
