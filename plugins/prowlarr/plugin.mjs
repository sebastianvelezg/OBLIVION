// Plugin de Prowlarr (API v1): estado de tus indexadores.
//
// API key: Prowlarr → Ajustes → General → Seguridad → Clave API.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { arrConnection, arrGet } from "../_shared/arr.mjs";

const APP = "Prowlarr";
const api = (ctx, path) => arrGet(ctx, APP, `/api/v1${path}`);

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "prowlarr",
  name: "Prowlarr",
  version: "0.1.0",
  description: "Cuántos indexadores tienes, cuáles fallan y cuáles están desactivados.",
  author: "Oblivion",
  connection: arrConnection("http://192.168.1.10:9696"),

  async test(ctx) {
    const s = await api(ctx, "/system/status");
    return `Conectado a ${s.appName ?? APP} ${s.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "indexers",
      name: "Indexadores",
      description: "Estado de cada indexador: activo, con fallos temporales o desactivado.",
      icon: "🔎",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 }],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const [indexers, status] = await Promise.all([api(ctx, "/indexer"), api(ctx, "/indexerstatus").catch(() => [])]);
        const failing = new Map((Array.isArray(status) ? status : []).map((s) => [s.indexerId, s]));

        const rows = (Array.isArray(indexers) ? indexers : []).map((i) => {
          const f = failing.get(i.id);
          const until = f ? Date.parse(f.disabledTill) : NaN;
          const blocked = f && (!Number.isFinite(until) || until > Date.now());
          const state = !i.enable ? "off" : blocked ? "bad" : "ok";
          return {
            state,
            title: String(i.name ?? "Indexador"),
            subtitle: [i.protocol === "usenet" ? "Usenet" : i.protocol === "torrent" ? "Torrent" : "", blocked && Number.isFinite(until) ? `reintenta ${new Date(until).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : ""]
              .filter(Boolean)
              .join(" · "),
            right: state === "off" ? "Desactivado" : state === "bad" ? "Con fallos" : "Activo",
            tone: state === "off" ? "neutral" : state === "bad" ? "bad" : "good",
          };
        });
        const rank = { bad: 0, ok: 1, off: 2 };
        rows.sort((a, b) => rank[a.state] - rank[b.state] || a.title.localeCompare(b.title, "es"));

        const bad = rows.filter((r) => r.state === "bad").length;
        const ok = rows.filter((r) => r.state === "ok").length;
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Activos", value: String(ok), tone: "good" },
                  { label: "Con fallos", value: String(bad), tone: bad > 0 ? "bad" : "neutral" },
                  { label: "Total", value: String(rows.length) },
                ],
              },
            },
            { view: { kind: "list", empty: "Prowlarr no tiene indexadores.", items: rows.slice(0, limit).map(({ state, ...row }) => row) } },
          ],
        };
      },
    },
  ],
};

export default plugin;
