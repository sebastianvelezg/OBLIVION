// Plugin de Linkwarden: colecciones, enlaces y etiquetas.
//
// Token: Linkwarden → Ajustes → «Access Tokens» → nuevo. Solo lee datos.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Linkwarden", type: "url", required: true, placeholder: "http://192.168.1.10:3000" },
  { key: "token", label: "Token de acceso", type: "secret", required: true, help: "Ajustes → Access Tokens." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "linkwarden",
  name: "Linkwarden",
  version: "0.1.0",
  description: "Cuántas colecciones, enlaces y etiquetas tienes en Linkwarden, y cuáles son las colecciones más grandes.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const c = await list(ctx, "/api/v1/collections");
    return `Conectado: ${c.length} colecciones`;
  },

  widgets: [
    {
      type: "overview",
      name: "Resumen",
      description: "Colecciones, enlaces y etiquetas, con las colecciones que más enlaces tienen.",
      icon: "🔗",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Colecciones a listar", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const [collections, tags] = await Promise.all([list(ctx, "/api/v1/collections"), list(ctx, "/api/v1/tags").catch(() => [])]);
        const count = (c) => Number(c._count?.links ?? 0);
        const links = collections.reduce((n, c) => n + count(c), 0);
        const n = (v) => v.toLocaleString("es");
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Colecciones", value: n(collections.length) },
                  { label: "Enlaces", value: n(links) },
                  { label: "Etiquetas", value: n(tags.length) },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay colecciones.",
                items: [...collections]
                  .sort((a, b) => count(b) - count(a))
                  .slice(0, limit)
                  .map((c) => ({
                    title: String(c.name ?? "Colección"),
                    subtitle: c.description ? String(c.description).slice(0, 80) : undefined,
                    right: `${n(count(c))} enlace${count(c) === 1 ? "" : "s"}`,
                  })),
              },
            },
          ],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

/** Linkwarden envuelve las listas en `{ response: [...] }`. */
async function list(ctx, path) {
  const token = String(ctx.config.token ?? "");
  if (!/^[A-Za-z0-9._-]{8,2000}$/.test(token)) ctx.fail("El token de acceso no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Linkwarden rechazó el token de acceso.");
  if (res.status === 404) ctx.fail("No se encontró la API de Linkwarden. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Linkwarden respondió con error ${res.status}`);
  try {
    const body = res.json();
    const out = Array.isArray(body) ? body : body?.response;
    if (!Array.isArray(out)) throw new Error("sin lista");
    return out;
  } catch {
    return ctx.fail("La URL responde, pero no parece Linkwarden.");
  }
}
