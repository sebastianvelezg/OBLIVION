// Plugin de Gatus (https://github.com/TwiN/gatus): el estado de tus endpoints monitorizados.
//
// La API de estado de Gatus es pública por defecto. No declara `permissions.network`.

const connection = [
  { key: "url", label: "URL de Gatus", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "gatus",
  name: "Gatus",
  version: "0.1.0",
  description: "Qué endpoints de Gatus están arriba o caídos, con su latencia y disponibilidad reciente.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const list = await statuses(ctx);
    return `Conectado: ${list.filter(up).length} de ${list.length} endpoints arriba`;
  },

  widgets: [
    {
      type: "endpoints",
      name: "Endpoints",
      description: "Estado de cada endpoint monitorizado; los caídos salen primero.",
      icon: "📈",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [
        {
          key: "show",
          label: "Qué mostrar",
          type: "select",
          default: "all",
          options: [
            { value: "all", label: "Todos los endpoints" },
            { value: "problems", label: "Solo los caídos" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const list = await statuses(ctx);
        const down = list.filter((s) => !up(s)).length;

        // Disponibilidad: resultados correctos / resultados totales de todos los endpoints.
        const results = list.flatMap((s) => s.results ?? []);
        const pct = results.length ? (results.filter((r) => r.success).length / results.length) * 100 : undefined;

        let rows = list;
        if (ctx.config.show === "problems") rows = list.filter((s) => !up(s));
        rows = [...rows].sort((a, b) => Number(up(a)) - Number(up(b)) || String(a.name).localeCompare(String(b.name), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Arriba", value: String(list.length - down), tone: "good" },
                  { label: "Caídos", value: String(down), tone: down > 0 ? "bad" : "neutral" },
                  ...(pct === undefined ? [] : [{ label: "Disponibilidad", value: `${pct.toFixed(pct >= 99.95 ? 0 : 1)}%`, tone: pct < 99 ? "warn" : "neutral" }]),
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: ctx.config.show === "problems" ? "Todos los endpoints están bien." : "Gatus no tiene endpoints.",
                items: rows.slice(0, limit).map((s) => {
                  const last = s.results?.[s.results.length - 1];
                  const ms = Number(last?.duration) / 1e6; // Gatus da nanosegundos
                  const ok = up(s);
                  return {
                    title: String(s.name ?? s.key ?? "endpoint"),
                    subtitle: String(s.group ?? ""),
                    right: ok ? (Number.isFinite(ms) ? `${Math.round(ms)} ms` : "Arriba") : "Caído",
                    tone: ok ? "good" : "bad",
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

/** Arriba = el último resultado fue correcto (sin resultados cuenta como caído, igual que Homepage). */
const up = (s) => s.results?.[s.results.length - 1]?.success === true;

async function statuses(ctx) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/api/v1/endpoints/statuses?page=1&pageSize=100", {
    headers: { Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Gatus pide autenticación: su API de estado debe ser accesible sin ella.");
  if (res.status === 404) ctx.fail("No se encontró la API de Gatus. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Gatus respondió con error ${res.status}`);
  try {
    const list = res.json();
    if (!Array.isArray(list)) throw new Error("no es lista");
    return list;
  } catch {
    return ctx.fail("La URL responde, pero no parece Gatus.");
  }
}
