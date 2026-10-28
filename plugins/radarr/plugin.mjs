// Plugin de Radarr (v3+): cola de descargas, próximos estrenos y películas que faltan.
//
// API key: Radarr → Ajustes → General → Seguridad → Clave API.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { arrConnection, arrGet, queueRow, queueView, range, whenLabel } from "../_shared/arr.mjs";

const APP = "Radarr";
const api = (ctx, path) => arrGet(ctx, APP, `/api/v3${path}`);
const label = (m) => (m?.title ? `${m.title}${m.year ? ` (${m.year})` : ""}` : "Película");

/** Fecha de estreno que importa para el calendario: la primera que cae en el rango. */
function releaseIn(m, startMs, endMs) {
  const kinds = [
    ["digitalRelease", "Digital"],
    ["physicalRelease", "Disco"],
    ["inCinemas", "Cines"],
  ];
  for (const [key, name] of kinds) {
    const t = Date.parse(m[key]);
    if (Number.isFinite(t) && t >= startMs && t < endMs) return { t, name, iso: m[key] };
  }
  return null;
}

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "radarr",
  name: "Radarr",
  version: "0.1.0",
  description: "Cola de descargas, próximos estrenos y películas que faltan en Radarr.",
  author: "Oblivion",
  connection: arrConnection("http://192.168.1.10:7878"),

  async test(ctx) {
    const s = await api(ctx, "/system/status");
    return `Conectado a ${s.appName ?? APP} ${s.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "queue",
      name: "Cola de descargas",
      description: "Las películas que se están descargando, con progreso y tiempo restante.",
      icon: "⬇️",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 20,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 10));
        const q = await api(ctx, `/queue?page=1&pageSize=${limit}&includeMovie=true`);
        const rows = (Array.isArray(q.records) ? q.records : []).map((r) => queueRow(r, label(r.movie) !== "Película" ? label(r.movie) : r.title, ""));
        return queueView(q.totalRecords ?? rows.length, rows, Array.isArray(q.records) ? q.records : []);
      },
    },

    {
      type: "calendar",
      name: "Próximos estrenos",
      description: "Películas que se estrenan (en digital, en disco o en cines) en los próximos días.",
      icon: "📅",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 900,
      config: [
        { key: "days", label: "Días por delante", type: "number", default: 30, min: 1, max: 180 },
        { key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 40 },
      ],
      async load(ctx) {
        const days = Math.min(180, Math.max(1, Number(ctx.config.days) || 30));
        const limit = Math.min(40, Math.max(1, Number(ctx.config.limit) || 10));
        const { start, end } = range(days);
        const list = await api(ctx, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false`);
        const s = Date.parse(start);
        const e = Date.parse(end);
        const movies = (Array.isArray(list) ? list : [])
          .map((m) => ({ m, rel: releaseIn(m, s, e) }))
          .filter((x) => x.rel)
          .sort((a, b) => a.rel.t - b.rel.t);
        return {
          kind: "list",
          empty: `No hay estrenos en los próximos ${days} días.`,
          items: movies.slice(0, limit).map(({ m, rel }) => ({
            title: label(m),
            subtitle: rel.name,
            right: whenLabel(rel.iso, false),
            tone: m.hasFile ? "good" : "neutral",
          })),
        };
      },
    },

    {
      type: "missing",
      name: "Películas que faltan",
      description: "Películas monitorizadas que ya salieron y aún no tienes.",
      icon: "🕳️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const m = await api(ctx, `/wanted/missing?page=1&pageSize=${limit}&monitored=true`);
        const recs = Array.isArray(m.records) ? m.records : [];
        return {
          kind: "sections",
          sections: [
            { view: { kind: "stats", items: [{ label: "Faltan", value: String(m.totalRecords ?? recs.length), tone: Number(m.totalRecords) > 0 ? "warn" : "good" }] } },
            {
              view: {
                kind: "list",
                empty: "No falta ninguna película.",
                items: recs.map((r) => ({
                  title: label(r),
                  subtitle: r.studio ? String(r.studio) : undefined,
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
