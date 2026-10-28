// Plugin de Karakeep (antes Hoarder): marcadores guardados y los últimos añadidos.
//
// Clave de API: Karakeep → Ajustes → «Claves de API» → nueva. Solo lee datos.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { ago } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Karakeep", type: "url", required: true, placeholder: "http://192.168.1.10:3000" },
  { key: "apiKey", label: "Clave de API", type: "secret", required: true, help: "Ajustes → Claves de API." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "karakeep",
  name: "Karakeep",
  version: "0.1.0",
  description: "Cuántos marcadores, favoritos y etiquetas tienes en Karakeep, y los últimos guardados con su enlace.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await get(ctx, "/api/v1/users/me/stats");
    return `Conectado: ${Number(s.numBookmarks ?? 0).toLocaleString("es")} marcadores`;
  },

  widgets: [
    {
      type: "stats",
      name: "Marcadores",
      description: "Marcadores, favoritos, archivados, etiquetas y listas.",
      icon: "🔖",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [],

      async load(ctx) {
        const s = await get(ctx, "/api/v1/users/me/stats");
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        return {
          kind: "stats",
          items: [
            { label: "Marcadores", value: n(s.numBookmarks) },
            { label: "Favoritos", value: n(s.numFavorites) },
            { label: "Archivados", value: n(s.numArchived) },
            { label: "Etiquetas", value: n(s.numTags) },
            { label: "Listas", value: n(s.numLists) },
          ],
        };
      },
    },

    {
      type: "latest",
      name: "Últimos marcadores",
      description: "Lo último que guardaste, con enlace a cada página.",
      icon: "🆕",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [{ key: "limit", label: "Cantidad", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const r = await get(ctx, `/api/v1/bookmarks?limit=${limit}&includeContent=false`);
        const list = Array.isArray(r.bookmarks) ? r.bookmarks : [];
        return {
          kind: "list",
          empty: "Todavía no has guardado nada.",
          items: list.slice(0, limit).map((b) => {
            const c = b.content ?? {};
            const url = c.type === "link" && /^https?:\/\//i.test(String(c.url)) ? String(c.url) : undefined;
            let host = "";
            try {
              host = url ? new URL(url).host : "";
            } catch {
              /* sin host */
            }
            const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => t.name).filter(Boolean).slice(0, 3);
            return {
              title: String(b.title || c.title || c.text?.slice(0, 80) || host || "Sin título"),
              subtitle: [host, tags.join(", ")].filter(Boolean).join(" · "),
              right: ago(b.createdAt) || undefined,
              href: url,
            };
          }),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9._-]{8,300}$/.test(key)) ctx.fail("La clave de API no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Karakeep rechazó la clave de API.");
  if (res.status === 404) ctx.fail("No se encontró la API de Karakeep. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Karakeep respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Karakeep.");
  }
}
