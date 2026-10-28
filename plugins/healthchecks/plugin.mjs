// Plugin de Healthchecks (healthchecks.io o tu propia instancia): estado de tus tareas programadas.
//
// Ideal para vigilar copias de seguridad y scripts: cada tarea avisa con un «ping» y Healthchecks
// marca las que dejan de hacerlo. Usa una API key de **solo lectura** (Proyecto → Ajustes → API
// keys → «Read-only»). No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  {
    key: "url",
    label: "URL de Healthchecks",
    type: "url",
    required: true,
    default: "https://healthchecks.io",
    placeholder: "https://healthchecks.io",
    help: "healthchecks.io o la de tu instancia propia.",
  },
  { key: "apiKey", label: "API key (solo lectura)", type: "secret", required: true },
];

const STATUS = {
  up: ["Al día", "good"],
  started: ["En ejecución", "good"],
  grace: ["En gracia", "warn"],
  down: ["Caído", "bad"],
  paused: ["Pausado", "neutral"],
  new: ["Nuevo", "neutral"],
};

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "healthchecks",
  name: "Healthchecks",
  version: "0.1.0",
  description: "Estado de tus tareas programadas y copias de seguridad: cuáles están al día y cuáles dejaron de avisar.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const checks = await list(ctx);
    return `Conectado: ${checks.length} tarea${checks.length === 1 ? "" : "s"}`;
  },

  widgets: [
    {
      type: "checks",
      name: "Tareas",
      description: "Estado de cada tarea; las caídas salen primero, con cuándo fue su último aviso.",
      icon: "💓",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [
        { key: "tag", label: "Solo la etiqueta (opcional)", type: "string", placeholder: "backup" },
        {
          key: "show",
          label: "Qué mostrar",
          type: "select",
          default: "all",
          options: [
            { value: "all", label: "Todas las tareas" },
            { value: "problems", label: "Solo las que fallan" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const all = await list(ctx, ctx.config.tag);
        const count = (s) => all.filter((c) => c.status === s).length;

        const rank = { down: 0, grace: 1, new: 2, started: 3, up: 3, paused: 4 };
        let rows = all;
        if (ctx.config.show === "problems") rows = all.filter((c) => c.status === "down" || c.status === "grace");
        rows = [...rows].sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || String(a.name).localeCompare(String(b.name), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Al día", value: String(count("up") + count("started")), tone: "good" },
                  { label: "Caídas", value: String(count("down")), tone: count("down") > 0 ? "bad" : "neutral" },
                  { label: "En gracia", value: String(count("grace")), tone: count("grace") > 0 ? "warn" : "neutral" },
                  { label: "Pausadas", value: String(count("paused")) },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: ctx.config.show === "problems" ? "Todas las tareas están bien." : "No hay tareas.",
                items: rows.slice(0, limit).map((c) => {
                  const [text, tone] = STATUS[c.status] ?? [String(c.status ?? "—"), "neutral"];
                  return {
                    title: String(c.name || c.slug || "Tarea"),
                    subtitle: c.last_ping ? `último aviso ${ago(c.last_ping)}` : "sin avisos todavía",
                    right: text,
                    tone,
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

async function list(ctx, tag) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const t = String(tag ?? "").trim();
  if (t && !/^[A-Za-z0-9_.-]{1,50}$/.test(t)) ctx.fail("La etiqueta solo puede llevar letras, números, punto, guion y guion bajo.");
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/api/v3/checks/${t ? `?tag=${encodeURIComponent(t)}` : ""}`, {
    headers: { Accept: "application/json", "X-Api-Key": key },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Healthchecks rechazó la API key.");
  if (res.status === 404) ctx.fail("No se encontró la API de Healthchecks. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Healthchecks respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (!Array.isArray(body?.checks)) throw new Error("sin checks");
    return body.checks;
  } catch {
    return ctx.fail("La URL responde, pero no parece Healthchecks.");
  }
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
