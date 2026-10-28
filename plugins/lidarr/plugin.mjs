// Plugin de Lidarr (API v1): cola de descargas, próximos álbumes y los que faltan.
//
// API key: Lidarr → Ajustes → General → Seguridad → Clave API.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { arrConnection, arrGet, queueRow, queueView, range, whenLabel } from "../_shared/arr.mjs";

const APP = "Lidarr";
const api = (ctx, path) => arrGet(ctx, APP, `/api/v1${path}`);

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "lidarr",
  name: "Lidarr",
  version: "0.1.0",
  description: "Cola de descargas, próximos álbumes y álbumes que faltan en Lidarr.",
  author: "Oblivion",
  connection: arrConnection("http://192.168.1.10:8686"),

  async test(ctx) {
    const s = await api(ctx, "/system/status");
    return `Conectado a ${s.appName ?? APP} ${s.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "queue",
      name: "Cola de descargas",
      description: "Los álbumes que se están descargando, con progreso y tiempo restante.",
      icon: "⬇️",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 20,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 10));
        const q = await api(ctx, `/queue?page=1&pageSize=${limit}&includeArtist=true&includeAlbum=true`);
        const rows = (Array.isArray(q.records) ? q.records : []).map((r) => queueRow(r, r.artist?.artistName, r.album?.title));
        return queueView(q.totalRecords ?? rows.length, rows, Array.isArray(q.records) ? q.records : []);
      },
    },

    {
      type: "calendar",
      name: "Próximos álbumes",
      description: "Los álbumes que se publican en los próximos días.",
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
        const list = await api(ctx, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false&includeArtist=true`);
        const albums = (Array.isArray(list) ? list : []).filter((a) => a.releaseDate).sort((a, b) => Date.parse(a.releaseDate) - Date.parse(b.releaseDate));
        return {
          kind: "list",
          empty: `No hay lanzamientos en los próximos ${days} días.`,
          items: albums.slice(0, limit).map((a) => ({
            title: String(a.artist?.artistName ?? "Artista"),
            subtitle: String(a.title ?? ""),
            right: whenLabel(a.releaseDate, false),
          })),
        };
      },
    },

    {
      type: "missing",
      name: "Álbumes que faltan",
      description: "Álbumes monitorizados que ya salieron y aún no tienes.",
      icon: "🕳️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],
      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const m = await api(ctx, `/wanted/missing?page=1&pageSize=${limit}&includeArtist=true&monitored=true`);
        const recs = Array.isArray(m.records) ? m.records : [];
        return {
          kind: "sections",
          sections: [
            { view: { kind: "stats", items: [{ label: "Faltan", value: String(m.totalRecords ?? recs.length), tone: Number(m.totalRecords) > 0 ? "warn" : "good" }] } },
            {
              view: {
                kind: "list",
                empty: "No falta ningún álbum.",
                items: recs.map((a) => ({
                  title: String(a.artist?.artistName ?? "Artista"),
                  subtitle: String(a.title ?? ""),
                  right: whenLabel(a.releaseDate, false),
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
