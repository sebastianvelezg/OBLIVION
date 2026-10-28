// Plugin de Mealie: estadísticas de tus recetas y el menú de los próximos días.
//
// Token: Mealie → tu perfil → «API Tokens» → crea uno. Solo lee datos (v1 y v2 de Mealie).
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Mealie", type: "url", required: true, placeholder: "http://192.168.1.10:9925" },
  { key: "token", label: "Token de API", type: "secret", required: true, help: "Tu perfil → API Tokens." },
];

const ENTRY = { breakfast: "Desayuno", lunch: "Almuerzo", dinner: "Cena", side: "Guarnición", snack: "Merienda", dessert: "Postre" };
const ORDER = ["breakfast", "lunch", "dinner", "side", "snack", "dessert"];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "mealie",
  name: "Mealie",
  version: "0.1.0",
  description: "Cuántas recetas tienes en Mealie y qué toca comer hoy y los próximos días.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await first(ctx, ["/api/households/statistics", "/api/groups/statistics"]);
    return `Conectado: ${Number(s.totalRecipes ?? 0).toLocaleString("es")} recetas`;
  },

  widgets: [
    {
      type: "stats",
      name: "Recetas",
      description: "Recetas, categorías, etiquetas, herramientas y usuarios de Mealie.",
      icon: "🍳",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [],

      async load(ctx) {
        const s = await first(ctx, ["/api/households/statistics", "/api/groups/statistics"]);
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        return {
          kind: "stats",
          items: [
            { label: "Recetas", value: n(s.totalRecipes) },
            { label: "Categorías", value: n(s.totalCategories) },
            { label: "Etiquetas", value: n(s.totalTags) },
            { label: "Herramientas", value: n(s.totalTools) },
            { label: "Usuarios", value: n(s.totalUsers) },
          ],
        };
      },
    },

    {
      type: "mealplan",
      name: "Menú de la semana",
      description: "Lo que hay en el plan de comidas de hoy y los próximos días.",
      icon: "🗓️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [
        { key: "days", label: "Días por delante", type: "number", default: 7, min: 1, max: 30 },
        { key: "limit", label: "Máximo de filas", type: "number", default: 14, min: 1, max: 50 },
      ],

      async load(ctx) {
        const days = Math.min(30, Math.max(1, Number(ctx.config.days) || 7));
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 14));
        const start = new Date();
        const end = new Date(start.getTime() + (days - 1) * 86400_000);
        const q = `start_date=${ymd(start)}&end_date=${ymd(end)}&perPage=100`;
        const r = await first(ctx, [`/api/households/mealplans?${q}`, `/api/groups/mealplans?${q}`]);
        const items = (Array.isArray(r.items) ? r.items : Array.isArray(r) ? r : [])
          .filter((m) => m.date)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ORDER.indexOf(a.entryType) - ORDER.indexOf(b.entryType));
        const today = ymd(start);
        return {
          kind: "list",
          empty: `No hay nada planificado para los próximos ${days} días.`,
          items: items.slice(0, limit).map((m) => ({
            title: String(m.recipe?.name ?? m.title ?? m.text ?? "Sin nombre").slice(0, 120),
            subtitle: ENTRY[m.entryType] ?? String(m.entryType ?? ""),
            right: dayLabel(String(m.date), today),
            tone: String(m.date) === today ? "good" : "neutral",
          })),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dayLabel(date, today) {
  if (date === today) return "Hoy";
  const d = new Date(`${date}T12:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400_000);
  if (diff === 1) return "Mañana";
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

async function get(ctx, path) {
  const token = String(ctx.config.token ?? "");
  if (!/^[A-Za-z0-9._-]{20,2000}$/.test(token)) ctx.fail("El token de API no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Mealie rechazó el token de API.");
  if (!res.ok) return { __status: res.status };
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Mealie.");
  }
}

/** Mealie v2 usa /households y v1 usa /groups: se prueba la primera ruta que exista. */
async function first(ctx, paths) {
  let last = 0;
  for (const p of paths) {
    const r = await get(ctx, p);
    if (r?.__status === undefined) return r;
    last = r.__status;
  }
  return ctx.fail(last === 404 ? "No se encontró la API de Mealie. ¿La URL es correcta?" : `Mealie respondió con error ${last}`);
}
