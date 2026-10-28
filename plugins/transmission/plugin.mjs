// Plugin de Transmission (RPC): velocidades y torrents activos.
//
// Funciona con la interfaz web de Transmission (puerto 9091 por defecto). Si tiene usuario y
// contraseña, ponlos en la conexión. No declara `permissions.network`.

import { remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Transmission", type: "url", required: true, placeholder: "http://192.168.1.10:9091" },
  { key: "username", label: "Usuario", type: "string" },
  { key: "password", label: "Contraseña", type: "secret" },
];

// Transmission pide reenviar el id de sesión que devuelve en un 409.
const sessionIds = new Map();

const STATUS = {
  0: { text: "Pausado", tone: "neutral" },
  1: { text: "En cola", tone: "neutral" },
  2: { text: "Comprobando", tone: "neutral" },
  3: { text: "En cola", tone: "neutral" },
  4: { text: "Descargando", tone: "neutral" },
  5: { text: "En cola", tone: "neutral" },
  6: { text: "Sembrando", tone: "good" },
};

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "transmission",
  name: "Transmission",
  version: "0.1.0",
  description: "Velocidad de descarga y subida y los torrents en curso de Transmission.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await rpc(ctx, "session-get");
    return `Conectado a Transmission ${String(s.version ?? "").split(" ")[0]}`.trim();
  },

  widgets: [
    {
      type: "downloads",
      name: "Descargas",
      description: "Velocidades y torrents en curso (descargando o sembrando).",
      icon: "⬇️",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 10,
      config: [
        {
          key: "filter",
          label: "Qué torrents listar",
          type: "select",
          default: "active",
          options: [
            { value: "active", label: "Activos (transfiriendo ahora)" },
            { value: "all", label: "Todos" },
          ],
        },
        { key: "limit", label: "Cantidad", type: "number", default: 6, min: 1, max: 20 },
      ],

      async load(ctx) {
        const limit = Math.min(20, Math.max(1, Number(ctx.config.limit) || 6));
        const onlyActive = ctx.config.filter !== "all";
        const [stats, got] = await Promise.all([
          rpc(ctx, "session-stats"),
          rpc(ctx, "torrent-get", {
            fields: ["name", "status", "percentDone", "rateDownload", "rateUpload", "eta", "error", "totalSize"],
          }),
        ]);

        let list = Array.isArray(got.torrents) ? got.torrents : [];
        if (onlyActive) list = list.filter((t) => t.status === 4 || Number(t.rateDownload) > 0 || Number(t.rateUpload) > 0);
        list.sort((a, b) => Number(b.rateDownload) - Number(a.rateDownload) || Number(b.rateUpload) - Number(a.rateUpload));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Descarga", value: speed(stats.downloadSpeed), tone: Number(stats.downloadSpeed) > 0 ? "good" : "neutral" },
                  { label: "Subida", value: speed(stats.uploadSpeed) },
                  { label: "Activos", value: String(stats.activeTorrentCount ?? 0) },
                  { label: "Total", value: String(stats.torrentCount ?? 0), hint: `${stats.pausedTorrentCount ?? 0} en pausa` },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay torrents que mostrar.",
                items: list.slice(0, limit).map((t) => {
                  const st = t.error ? { text: "Error", tone: "bad" } : (STATUS[t.status] ?? STATUS[0]);
                  const down = t.status === 4;
                  return {
                    title: String(t.name ?? "Sin nombre"),
                    subtitle: [st.text, down ? eta(t.eta) : `↑ ${speed(t.rateUpload)}`, size(t.totalSize)].filter(Boolean).join(" · "),
                    right: `${Math.round(Number(t.percentDone) * 100)}%`,
                    progress: Number.isFinite(Number(t.percentDone)) ? Math.min(1, Number(t.percentDone)) : undefined,
                    tone: st.tone,
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

/** La URL puede ser la de la interfaz web (…/transmission/web/); el RPC siempre está en /transmission/rpc. */
const endpoint = (ctx) =>
  String(ctx.config.url).replace(/\/+$/, "").replace(/\/transmission(\/web)?$/, "") + "/transmission/rpc";

async function rpc(ctx, method, args = {}) {
  const url = endpoint(ctx);
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const user = String(ctx.config.username ?? "");
  if (user) headers.Authorization = "Basic " + Buffer.from(`${user}:${ctx.config.password ?? ""}`).toString("base64");
  const body = JSON.stringify({ method, arguments: args });

  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = sessionIds.get(url);
    const res = await ctx.http(url, { method: "POST", headers: sid ? { ...headers, "X-Transmission-Session-Id": sid } : headers, body });
    if (res.status === 409) {
      const next = res.headers["x-transmission-session-id"];
      if (next && attempt === 0) {
        remember(sessionIds, url, next);
        continue;
      }
    }
    if (res.status === 401 || res.status === 403) ctx.fail("Transmission rechazó el usuario o la contraseña.");
    if (res.status === 404) ctx.fail("No se encontró el RPC de Transmission. ¿Es la URL de su interfaz web?");
    if (!res.ok) ctx.fail(`Transmission respondió con error ${res.status}`);
    let out;
    try {
      out = res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece Transmission.");
    }
    if (out?.result !== "success") ctx.fail(`Transmission respondió: ${String(out?.result ?? "error").slice(0, 80)}`);
    return out.arguments ?? {};
  }
  return ctx.fail("Transmission rechazó la sesión.");
}

function speed(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n) || n <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function size(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Transmission usa -1 (desconocido) y -2 (infinito). */
function eta(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
