// Plugin de qBittorrent (WebUI API v2): velocidades y torrents activos.
//
// Activa la interfaz web en qBittorrent (Opciones → Interfaz web). Si tienes marcado
// «Omitir autenticación para clientes en localhost / subred», deja usuario y contraseña
// en blanco. No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de qBittorrent", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  { key: "username", label: "Usuario", type: "string", placeholder: "admin" },
  { key: "password", label: "Contraseña", type: "secret" },
];

import { createHash } from "node:crypto";
import { remember } from "../_shared/fmt.mjs";

// qBittorrent cierra la sesión a los ~60 min sin uso; se reutiliza la cookie para no iniciar sesión cada vez.
const sessions = new Map();
const SESSION_MS = 25 * 60_000;

/** Clave de la sesión: servidor + usuario + huella de la contraseña (si la cambian, se vuelve a iniciar sesión). */
const sessionKey = (ctx) =>
  `${base(ctx)}|${String(ctx.config.username ?? "")}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "qbittorrent",
  name: "qBittorrent",
  version: "0.1.0",
  description: "Velocidad de descarga y subida y los torrents activos de qBittorrent.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const version = await get(ctx, "/api/v2/app/version", { text: true });
    return `Conectado a qBittorrent ${String(version).replace(/^v/i, "")}`;
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
            { value: "downloading", label: "Solo descargando" },
            { value: "all", label: "Todos" },
          ],
        },
        { key: "limit", label: "Cantidad", type: "number", default: 6, min: 1, max: 20 },
      ],

      async load(ctx) {
        const filter = ["active", "downloading", "all"].includes(ctx.config.filter) ? ctx.config.filter : "active";
        const limit = Math.min(20, Math.max(1, Number(ctx.config.limit) || 6));

        const [info, torrents] = await Promise.all([
          get(ctx, "/api/v2/transfer/info"),
          get(ctx, `/api/v2/torrents/info?filter=${filter}&sort=dlspeed&reverse=true`),
        ]);
        const list = Array.isArray(torrents) ? torrents : [];
        const downloading = list.filter((t) => DOWN.has(t.state)).length;

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Descarga", value: speed(info.dl_info_speed), tone: Number(info.dl_info_speed) > 0 ? "good" : "neutral" },
                  { label: "Subida", value: speed(info.up_info_speed) },
                  { label: filter === "all" ? "Descargando" : "En la lista", value: String(filter === "all" ? downloading : list.length) },
                  { label: "Conexión", value: info.connection_status === "connected" ? "Conectado" : String(info.connection_status ?? "—"), tone: info.connection_status === "connected" ? "good" : "warn" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay torrents que mostrar.",
                items: list.slice(0, limit).map((t) => {
                  const st = label(t.state);
                  const down = DOWN.has(t.state);
                  return {
                    title: String(t.name ?? "Sin nombre"),
                    subtitle: [st.text, down ? eta(t.eta) : `↑ ${speed(t.upspeed)}`, size(t.size)].filter(Boolean).join(" · "),
                    right: down || Number(t.progress) < 1 ? `${Math.round(Number(t.progress) * 100)}%` : speed(t.upspeed),
                    progress: Number.isFinite(Number(t.progress)) ? Math.min(1, Number(t.progress)) : undefined,
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

const DOWN = new Set(["downloading", "forcedDL", "metaDL", "forcedMetaDL", "stalledDL", "queuedDL", "checkingDL", "allocating"]);

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");

/** Inicia sesión (si hay usuario) y devuelve la cabecera Cookie, reutilizando la sesión viva. */
async function cookie(ctx, fresh = false) {
  const user = String(ctx.config.username ?? "");
  if (!user) return undefined; // sin autenticación (localhost/subred permitida)
  const key = sessionKey(ctx);
  const hit = sessions.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.cookie;

  const res = await ctx.http(`${base(ctx)}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // qBittorrent exige Referer/Origin de su propio host (protección CSRF).
      Referer: base(ctx),
      Origin: new URL(base(ctx)).origin,
    },
    body: new URLSearchParams({ username: user, password: String(ctx.config.password ?? "") }).toString(),
  });
  if (res.status === 403) ctx.fail("qBittorrent bloqueó esta IP por demasiados intentos fallidos. Espera unos minutos.");
  const sid = /SID=([^;,\s]+)/.exec(res.headers["set-cookie"] ?? "")?.[1];
  if (!res.ok || !sid || /fails/i.test(res.text)) ctx.fail("qBittorrent rechazó el usuario o la contraseña.");
  const value = `SID=${sid}`;
  remember(sessions, key, { cookie: value, expires: Date.now() + SESSION_MS });
  return value;
}

async function get(ctx, path, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await cookie(ctx, attempt > 0);
    const res = await ctx.http(base(ctx) + path, {
      headers: { Accept: "application/json", Referer: base(ctx), ...(c ? { Cookie: c } : {}) },
    });
    // La sesión caducó (o no hay credenciales y hace falta iniciar sesión): se reintenta una vez.
    if ((res.status === 403 || res.status === 401) && attempt === 0) {
      sessions.delete(sessionKey(ctx));
      if (!String(ctx.config.username ?? "")) ctx.fail("qBittorrent pide usuario y contraseña: añádelos a la conexión.");
      continue;
    }
    if (res.status === 403 || res.status === 401) ctx.fail("qBittorrent rechazó el usuario o la contraseña.");
    if (res.status === 404) ctx.fail("No se encontró la API de qBittorrent. ¿Es la URL de su interfaz web?");
    if (!res.ok) ctx.fail(`qBittorrent respondió con error ${res.status}`);
    if (opts.text) return res.text;
    try {
      return res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece qBittorrent.");
    }
  }
  return ctx.fail("qBittorrent rechazó la sesión.");
}

function label(state) {
  if (state === "error" || state === "missingFiles") return { text: "Error", tone: "bad" };
  if (/^paused|^stopped/.test(state)) return { text: "Pausado", tone: "neutral" };
  if (state === "stalledDL") return { text: "Sin fuentes", tone: "warn" };
  if (state === "queuedDL" || state === "queuedUP") return { text: "En cola", tone: "neutral" };
  if (/^checking|allocating/.test(state)) return { text: "Comprobando", tone: "neutral" };
  if (DOWN.has(state)) return { text: "Descargando", tone: "neutral" };
  return { text: "Sembrando", tone: "good" };
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

/** qBittorrent usa 8640000 s como «infinito». */
function eta(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0 || s >= 8_640_000) return "";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
