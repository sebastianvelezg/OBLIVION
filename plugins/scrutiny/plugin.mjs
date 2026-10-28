// Plugin de Scrutiny (https://github.com/AnalogJ/scrutiny): salud SMART de tus discos.
//
// Scrutiny recoge los datos SMART de cada disco y los marca como sanos o con fallos. En
// Unraid está en la tienda de aplicaciones («Scrutiny»). Su API no usa autenticación.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Scrutiny", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "scrutiny",
  name: "Scrutiny (discos)",
  version: "0.1.0",
  description: "Salud SMART de cada disco: cuántos están sanos, con avisos o fallando, y su temperatura.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const disks = await listDisks(ctx);
    return `Conectado: ${disks.length} disco${disks.length === 1 ? "" : "s"}`;
  },

  widgets: [
    {
      type: "health",
      name: "Salud de los discos",
      description: "Estado SMART de cada disco con su temperatura y horas de uso.",
      icon: "💽",
      defaultSize: { w: 4, h: 7 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [
        { key: "limit", label: "Máximo de discos", type: "number", default: 24, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 24));
        const disks = await listDisks(ctx);

        const failed = disks.filter((d) => st(d).tone === "bad").length;
        const warn = disks.filter((d) => st(d).tone === "warn").length;
        const ok = disks.length - failed - warn;

        // Primero lo que falla; dentro de cada grupo, por nombre.
        const rank = { bad: 0, warn: 1, good: 2 };
        disks.sort((a, b) => rank[st(a).tone] - rank[st(b).tone] || String(name(a)).localeCompare(String(name(b)), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Sanos", value: String(ok), tone: "good" },
                  { label: "Con aviso", value: String(warn), tone: warn > 0 ? "warn" : "neutral" },
                  { label: "Con fallos", value: String(failed), tone: failed > 0 ? "bad" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "Scrutiny todavía no ha encontrado discos.",
                items: disks.slice(0, limit).map((d) => {
                  const s = st(d);
                  const temp = Number(d.smart?.temp);
                  const hours = Number(d.smart?.power_on_hours);
                  return {
                    title: name(d),
                    subtitle: [
                      d.device.device_name ? `/dev/${String(d.device.device_name).replace(/^\/dev\//, "")}` : "",
                      capacity(d.device.capacity),
                      Number.isFinite(temp) && temp > 0 ? `${temp} °C` : "",
                      Number.isFinite(hours) && hours > 0 ? `${Math.round(hours / 24).toLocaleString("es")} d encendido` : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    right: s.text,
                    tone: s.tone,
                  };
                }),
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

/** Discos activos (los archivados en Scrutiny no cuentan). */
async function listDisks(ctx) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/api/summary", {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) ctx.fail("No se encontró la API de Scrutiny. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Scrutiny respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Scrutiny.");
  }
  const summary = body?.data?.summary;
  if (!summary || typeof summary !== "object") ctx.fail("La URL responde, pero no parece Scrutiny.");
  return Object.values(summary).filter((d) => d && typeof d === "object" && d.device && !d.device.archived);
}

const name = (d) => String(d.device.model_name || d.device.device_name || d.device.wwn || "Disco");

/** `device_status`: 0 sano · 1 falla SMART · 2 falla según Scrutiny (umbrales) · 3 ambas. */
function st(d) {
  const s = Number(d.device.device_status);
  if (s === 0) return { text: "Sano", tone: "good" };
  if (s === 2) return { text: "Aviso", tone: "warn" };
  if (s === 1 || s === 3) return { text: "Falla", tone: "bad" };
  return { text: "Desconocido", tone: "warn" };
}

function capacity(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n >= 1e12 ? `${(n / 1e12).toFixed(n >= 1e13 ? 0 : 1)} TB` : `${Math.round(n / 1e9)} GB`;
}
