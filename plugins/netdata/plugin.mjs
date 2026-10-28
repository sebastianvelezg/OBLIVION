// Plugin de Netdata: alarmas y gráfica de CPU y memoria del último rato.
//
// Netdata expone su API en el puerto 19999 sin autenticación por defecto. En Unraid está en la
// tienda de aplicaciones. No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Netdata", type: "url", required: true, placeholder: "http://192.168.1.10:19999" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "netdata",
  name: "Netdata",
  version: "0.1.0",
  description: "Alarmas activas y gráfica de uso de CPU y memoria del último rato, medidas por Netdata.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const info = await get(ctx, "/api/v1/info");
    return `Conectado a Netdata ${info.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "overview",
      name: "Resumen del sistema",
      description: "Alarmas de Netdata y gráfica de CPU y memoria de los últimos minutos.",
      icon: "📊",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [
        {
          key: "minutes",
          label: "Minutos de la gráfica",
          type: "number",
          default: 10,
          min: 2,
          max: 120,
        },
      ],

      async load(ctx) {
        const minutes = Math.min(120, Math.max(2, Math.round(Number(ctx.config.minutes)) || 10));
        const info = await get(ctx, "/api/v1/info");
        const a = info.alarms ?? {};
        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Normales", value: String(a.normal ?? 0), tone: "good" },
                { label: "Avisos", value: String(a.warning ?? 0), tone: Number(a.warning) > 0 ? "warn" : "neutral" },
                { label: "Críticas", value: String(a.critical ?? 0), tone: Number(a.critical) > 0 ? "bad" : "neutral" },
              ],
            },
          },
        ];

        // La gráfica es un extra: si falla (permisos, versión), se muestran solo las alarmas.
        try {
          const [cpu, ram] = await Promise.all([series(ctx, "system.cpu", minutes), series(ctx, "system.ram", minutes)]);
          const cpuPts = cpu.rows.map((r) => Math.min(100, r.values.reduce((x, y) => x + y, 0)));
          const ramPts = ram.rows.map((r) => {
            const used = r.values[ram.index("used")] ?? 0;
            const total = r.values.reduce((x, y) => x + y, 0) || 1;
            return (used / total) * 100;
          });
          const fmt = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
          sections.push({
            title: `Últimos ${minutes} min`,
            view: {
              kind: "chart",
              unit: "%",
              labels: cpu.rows.map((r) => fmt.format(new Date(r.t * 1000))),
              series: [
                { name: "CPU", points: cpuPts.map(r1) },
                { name: "Memoria", points: ramPts.map(r1) },
              ],
            },
          });
        } catch {
          /* sin gráfica */
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const r1 = (n) => Math.round(n * 10) / 10;

async function get(ctx, path) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { headers: { Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) ctx.fail("Netdata pide autenticación: su API local debe ser accesible sin ella.");
  if (res.status === 404) ctx.fail("No se encontró la API de Netdata. ¿La URL es la de su interfaz (puerto 19999)?");
  if (!res.ok) ctx.fail(`Netdata respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Netdata.");
  }
}

/** Serie de un gráfico de Netdata, de más antigua a más reciente (Netdata la da al revés). */
async function series(ctx, chart, minutes) {
  const points = 30;
  const d = await get(ctx, `/api/v1/data?chart=${encodeURIComponent(chart)}&after=-${minutes * 60}&points=${points}&group=average&format=json`);
  const labels = Array.isArray(d.labels) ? d.labels : [];
  const data = Array.isArray(d.data) ? d.data : [];
  if (labels.length < 2 || data.length < 2) throw new Error("sin datos");
  // `labels[0]` es «time»; el resto, las dimensiones. Para la CPU se ignoran las que ya están contadas en otras.
  const skip = new Set(chart === "system.cpu" ? ["guest", "guest_nice"] : []);
  const idx = labels.map((l, i) => (i > 0 && !skip.has(l) ? i : -1)).filter((i) => i > 0);
  const rows = [...data]
    .reverse()
    .map((row) => ({ t: Number(row[0]), values: idx.map((i) => Math.max(0, Number(row[i]) || 0)) }));
  const names = idx.map((i) => labels[i]);
  return { rows, index: (name) => names.indexOf(name) };
}
