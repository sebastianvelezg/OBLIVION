// Plugin de Caddy: estado de los destinos (upstreams) de tus proxies inversos.
//
// Usa la API de administración de Caddy (`reverse_proxy/upstreams`). Por defecto solo escucha en
// localhost:2019: para llegar a ella desde Oblivion tienes que cambiar su dirección en el
// Caddyfile (`admin 0.0.0.0:2019`) y NO exponerla fuera de tu red: esa API puede cambiar
// la configuración de Caddy. Este plugin solo hace GET.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de la API de administración de Caddy", type: "url", required: true, placeholder: "http://192.168.1.10:2019" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "caddy",
  name: "Caddy",
  version: "0.1.0",
  description: "Destinos de tus proxies inversos en Caddy, con sus peticiones y fallos.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const u = await upstreams(ctx);
    return `Conectado: ${u.length} destino${u.length === 1 ? "" : "s"}`;
  },

  widgets: [
    {
      type: "upstreams",
      name: "Destinos",
      description: "Cada destino de los proxies inversos con sus peticiones y fallos; los que fallan salen primero.",
      icon: "🔐",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 }],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const list = await upstreams(ctx);
        const num = (v) => Number(v) || 0;
        const requests = list.reduce((n, u) => n + num(u.num_requests), 0);
        const fails = list.reduce((n, u) => n + num(u.fails), 0);
        const rows = [...list].sort((a, b) => num(b.fails) - num(a.fails) || String(a.address).localeCompare(String(b.address), "es"));
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Destinos", value: String(list.length) },
                  { label: "Peticiones activas", value: requests.toLocaleString("es") },
                  { label: "Fallos", value: fails.toLocaleString("es"), tone: fails > 0 ? "warn" : "good" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "Caddy no tiene destinos de proxy inverso.",
                items: rows.slice(0, limit).map((u) => ({
                  title: String(u.address ?? "destino"),
                  subtitle: `${num(u.num_requests)} petición${num(u.num_requests) === 1 ? "" : "es"} activa${num(u.num_requests) === 1 ? "" : "s"}`,
                  right: num(u.fails) > 0 ? `${num(u.fails)} fallo${num(u.fails) === 1 ? "" : "s"}` : "Bien",
                  tone: num(u.fails) > 0 ? "warn" : "good",
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

async function upstreams(ctx) {
  // Caddy valida el origen de las peticiones a su API de administración.
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/reverse_proxy/upstreams", { headers: { Accept: "application/json" } });
  if (res.status === 403) ctx.fail("Caddy rechazó la petición: revisa «admin» y «origins» en su configuración.");
  if (res.status === 404) ctx.fail("No se encontró la API de administración de Caddy. ¿La URL es la de su puerto de administración (2019)?");
  if (!res.ok) ctx.fail(`Caddy respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (!Array.isArray(body)) throw new Error("no es lista");
    return body;
  } catch {
    return ctx.fail("La URL responde, pero no parece la API de administración de Caddy.");
  }
}
