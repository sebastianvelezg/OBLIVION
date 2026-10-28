// Plugin de AdGuard Home: consultas DNS y bloqueos.
//
// Usa el usuario y la contraseña de su interfaz web (HTTP básico). No declara
// `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de AdGuard Home", type: "url", required: true, placeholder: "http://192.168.1.2:3000" },
  { key: "username", label: "Usuario", type: "string" },
  { key: "password", label: "Contraseña", type: "secret" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "adguard",
  name: "AdGuard Home",
  version: "0.1.0",
  description: "Consultas DNS, porcentaje bloqueado y tiempo de respuesta de AdGuard Home.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const st = await get(ctx, "/control/status");
    return `Conectado a AdGuard Home ${st.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "summary",
      name: "AdGuard Home",
      description: "Porcentaje de consultas bloqueadas, consultas totales y tiempo medio de respuesta.",
      icon: "🛡️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [],

      async load(ctx) {
        const [stats, status] = await Promise.all([get(ctx, "/control/stats"), get(ctx, "/control/status").catch(() => null)]);
        const queries = Number(stats.num_dns_queries) || 0;
        const blocked = Number(stats.num_blocked_filtering) || 0;
        const n = (v) => v.toLocaleString("es");
        const ms = Number(stats.avg_processing_time) * 1000;
        return {
          kind: "metric",
          icon: "🛡️",
          value: (queries > 0 ? (blocked / queries) * 100 : 0).toFixed(1),
          unit: "% bloqueado",
          caption: status && status.protection_enabled === false ? "Protección desactivada" : "Protección activa",
          rows: [
            { label: "Consultas", value: n(queries) },
            { label: "Bloqueadas", value: n(blocked) },
            { label: "Respuesta", value: Number.isFinite(ms) ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : "—" },
          ],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const headers = { Accept: "application/json" };
  const user = String(ctx.config.username ?? "");
  if (user) headers.Authorization = "Basic " + Buffer.from(`${user}:${ctx.config.password ?? ""}`).toString("base64");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { headers });
  if (res.status === 401 || res.status === 403) ctx.fail("AdGuard Home rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de AdGuard Home. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`AdGuard Home respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece AdGuard Home.");
  }
}
