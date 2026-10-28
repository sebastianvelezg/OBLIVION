// Plugin de Immich: fotos, vídeos y espacio usado.
//
// API key: Immich → tu usuario → Ajustes de la cuenta → Claves de API → «Nueva clave».
// Las estadísticas del servidor requieren una clave de una cuenta de **administrador**.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Immich", type: "url", required: true, placeholder: "http://192.168.1.10:2283" },
  {
    key: "apiKey",
    label: "API key",
    type: "secret",
    required: true,
    help: "Cuenta de administrador → Ajustes → Claves de API.",
  },
];

// Immich cambió la ruta de las estadísticas entre versiones: se prueban de la más nueva a la más antigua.
const STATS_PATHS = ["/api/server/statistics", "/api/server-info/statistics", "/api/server-info/stats"];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "immich",
  name: "Immich",
  version: "0.1.0",
  description: "Cuántas fotos y vídeos tienes en Immich y cuánto espacio ocupan, por usuario.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await stats(ctx);
    return `Conectado: ${n(s.photos)} fotos y ${n(s.videos)} vídeos`;
  },

  widgets: [
    {
      type: "stats",
      name: "Biblioteca de fotos",
      description: "Fotos, vídeos y espacio usado en Immich, y lo que ocupa cada usuario.",
      icon: "📷",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "showUsers", label: "Mostrar el espacio por usuario", type: "boolean", default: true }],

      async load(ctx) {
        const s = await stats(ctx);
        const users = Array.isArray(s.usageByUser) ? s.usageByUser : [];
        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Fotos", value: n(s.photos) },
                { label: "Vídeos", value: n(s.videos) },
                { label: "Espacio usado", value: bytes(s.usage) },
                ...(users.length > 0 ? [{ label: "Usuarios", value: String(users.length) }] : []),
              ],
            },
          },
        ];
        if (ctx.config.showUsers && users.length > 0) {
          const sorted = [...users].sort((a, b) => Number(b.usage) - Number(a.usage));
          sections.push({
            title: "Por usuario",
            view: {
              kind: "list",
              items: sorted.slice(0, 20).map((u) => ({
                title: String(u.userName || u.userId || "Usuario"),
                subtitle: `${n(u.photos)} fotos · ${n(u.videos)} vídeos`,
                right: bytes(u.usage),
              })),
            },
          });
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const n = (v) => Number(v ?? 0).toLocaleString("es");

function bytes(v) {
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, x)) / Math.log(1024)));
  const val = x / 1024 ** i;
  return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

async function stats(ctx) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const base = String(ctx.config.url).replace(/\/+$/, "");

  for (const path of STATS_PATHS) {
    const res = await ctx.http(base + path, { headers: { Accept: "application/json", "x-api-key": key } });
    if (res.status === 404) continue; // otra versión de Immich
    if (res.status === 401) ctx.fail("Immich rechazó la API key.");
    if (res.status === 403) ctx.fail("La API key no tiene permiso: usa una clave de una cuenta de administrador.");
    if (!res.ok) ctx.fail(`Immich respondió con error ${res.status}`);
    try {
      const body = res.json();
      if (!body || typeof body !== "object") break;
      return body;
    } catch {
      return ctx.fail("La URL responde, pero no parece Immich.");
    }
  }
  return ctx.fail("No se encontró la API de Immich. ¿La URL es correcta (suele terminar en el puerto 2283)?");
}
