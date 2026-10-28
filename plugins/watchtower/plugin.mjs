// Plugin de Watchtower: resultado de su último análisis (revisados, actualizados, fallidos).
//
// Arranca Watchtower con la API HTTP y las métricas activadas:
//   --http-api-metrics  y  WATCHTOWER_HTTP_API_TOKEN=<una-clave-larga>
// Las métricas son del *último* análisis y de los totales desde que arrancó.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Watchtower", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  { key: "token", label: "Token de la API HTTP", type: "secret", required: true, help: "El valor de WATCHTOWER_HTTP_API_TOKEN." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "watchtower",
  name: "Watchtower",
  version: "0.1.0",
  description: "Resultado del último análisis de Watchtower: contenedores revisados, actualizados y con fallos.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const m = await metrics(ctx);
    return `Conectado: ${m.scanned ?? 0} contenedores revisados en el último análisis`;
  },

  widgets: [
    {
      type: "scan",
      name: "Último análisis",
      description: "Contenedores revisados, actualizados y fallidos en el último análisis de Watchtower.",
      icon: "🗼",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [],

      async load(ctx) {
        const m = await metrics(ctx);
        const n = (v) => (v === undefined ? "—" : Number(v).toLocaleString("es"));
        const items = [
          { label: "Revisados", value: n(m.scanned) },
          { label: "Actualizados", value: n(m.updated), tone: Number(m.updated) > 0 ? "good" : "neutral" },
          { label: "Fallidos", value: n(m.failed), tone: Number(m.failed) > 0 ? "bad" : "neutral" },
        ];
        if (m.scans !== undefined) items.push({ label: "Análisis totales", value: n(m.scans), hint: m.skipped ? `${n(m.skipped)} omitidos` : undefined });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

/** `/v1/metrics` responde en formato Prometheus: «watchtower_containers_scanned 12». */
async function metrics(ctx) {
  const token = String(ctx.config.token ?? "");
  if (!/^[A-Za-z0-9_.~+/=-]{4,300}$/.test(token)) ctx.fail("El token no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/v1/metrics", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Watchtower rechazó el token.");
  if (res.status === 404) ctx.fail("Watchtower no expone las métricas: arráncalo con --http-api-metrics.");
  if (!res.ok) ctx.fail(`Watchtower respondió con error ${res.status}`);
  const read = (name) => {
    const m = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)\\s*$`, "m").exec(res.text);
    return m ? Number(m[1]) : undefined;
  };
  const out = {
    scanned: read("watchtower_containers_scanned"),
    updated: read("watchtower_containers_updated"),
    failed: read("watchtower_containers_failed"),
    scans: read("watchtower_scans_total"),
    skipped: read("watchtower_scans_skipped"),
  };
  if (out.scanned === undefined && out.updated === undefined) ctx.fail("La URL responde, pero no parece Watchtower.");
  return out;
}
