// Plugin de Sonarr (v3/v4): cola de descargas, próximos episodios y los que faltan.
//
// API key: Sonarr → Ajustes → General → Seguridad → Clave API.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { arrConnection, arrGet, episodeTag, queueRow, queueView, range, whenLabel } from "../_shared/arr.mjs";

const APP = "Sonarr";
const api = (ctx, path) => arrGet(ctx, APP, `/api/v3${path}`);

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "sonarr",
  name: "Sonarr",
  version: "0.1.0",
  description: "Cola de descargas, próximos episodios y episodios que faltan en Sonarr.",
  author: "Oblivion",
  connection: arrConnection("http://192.168.1.10:8989"),

  async test(ctx) {
    const s = await api(ctx, "/system/status");
    return `Conectado a ${s.appName ?? APP} ${s.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "queue",
      name: "Cola de descargas",
      description: "Los episodios que se están descargando, con progreso y tiempo restante.",
      icon: "⬇️",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 20,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 10));
        const q = await api(ctx, `/queue?page=1&pageSize=${limit}&includeSeries=true&includeEpisode=true`);
        const rows = (Array.isArray(q.records) ? q.records : []).map((r) =>
          queueRow(r, r.series?.title, [episodeTag(r.episode), r.episode?.title].filter(Boolean).join(" · ")),
        );
        return queueView(q.totalRecords ?? rows.length, rows, Array.isArray(q.records) ? q.records : []);
      },
    },

    {
      type: "calendar",
      name: "Próximos episodios",
      description: "Los episodios que se emiten en los próximos días.",
      icon: "📅",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 900,
      config: [
        { key: "days", label: "Días por delante", type: "number", default: 7, min: 1, max: 60 },
        { key: "limit", label: "Máximo de filas", type: "number", default: 12, min: 1, max: 40 },
      ],
      async load(ctx) {
        const days = Math.min(60, Math.max(1, Number(ctx.config.days) || 7));
        const limit = Math.min(40, Math.max(1, Number(ctx.config.limit) || 12));
        const { start, end } = range(days);
        const list = await api(ctx, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false&includeSeries=true`);
        const eps = (Array.isArray(list) ? list : []).filter((e) => e.airDateUtc).sort((a, b) => Date.parse(a.airDateUtc) - Date.parse(b.airDateUtc));
        return {
          kind: "list",
          empty: `No hay estrenos en los próximos ${days} días.`,
          items: eps.slice(0, limit).map((e) => ({
            title: String(e.series?.title ?? e.title ?? "Serie"),
            subtitle: [episodeTag(e), e.title].filter(Boolean).join(" · "),
            right: whenLabel(e.airDateUtc),
            tone: e.hasFile ? "good" : "neutral",
          })),
        };
      },
    },

    {
      type: "missing",
      name: "Episodios que faltan",
      description: "Episodios monitorizados que ya salieron y aún no tienes.",
      icon: "🕳️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const m = await api(ctx, `/wanted/missing?page=1&pageSize=${limit}&sortKey=airDateUtc&sortDirection=descending&includeSeries=true&monitored=true`);
        const recs = Array.isArray(m.records) ? m.records : [];
        return {
          kind: "sections",
          sections: [
            { view: { kind: "stats", items: [{ label: "Faltan", value: String(m.totalRecords ?? recs.length), tone: Number(m.totalRecords) > 0 ? "warn" : "good" }] } },
            {
              view: {
                kind: "list",
                empty: "No falta ningún episodio.",
                items: recs.map((e) => ({
                  title: String(e.series?.title ?? e.title ?? "Serie"),
                  subtitle: [episodeTag(e), e.title].filter(Boolean).join(" · "),
                  right: whenLabel(e.airDateUtc, false),
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
