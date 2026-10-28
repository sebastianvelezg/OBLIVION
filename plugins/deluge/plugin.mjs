// Plugin de Deluge (interfaz web): velocidades y torrents.
//
// Usa la contraseña de la interfaz web de Deluge (por defecto «deluge»: cámbiala). La interfaz
// web tiene que estar conectada a un demonio (Ajustes → Gestor de conexiones).
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { createHash } from "node:crypto";
import { duration, rate, remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de la interfaz web de Deluge", type: "url", required: true, placeholder: "http://192.168.1.10:8112" },
  { key: "password", label: "Contraseña de la interfaz web", type: "secret", required: true },
];

const sessions = new Map();
const FIELDS = ["queue", "name", "total_wanted", "state", "progress", "download_payload_rate", "upload_payload_rate", "total_remaining", "eta"];
const STATE = {
  Downloading: ["Descargando", "neutral"],
  Seeding: ["Sembrando", "good"],
  Paused: ["Pausado", "neutral"],
  Queued: ["En cola", "neutral"],
  Checking: ["Comprobando", "neutral"],
  Error: ["Error", "bad"],
  Allocating: ["Reservando espacio", "neutral"],
  Moving: ["Moviendo", "neutral"],
};

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "deluge",
  name: "Deluge",
  version: "0.1.0",
  description: "Velocidad de descarga y subida y los torrents de Deluge.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const ui = await updateUi(ctx);
    return `Conectado: ${Object.keys(ui.torrents ?? {}).length} torrents`;
  },

  widgets: [
    {
      type: "downloads",
      name: "Descargas",
      description: "Velocidades y torrents (descargando primero), con progreso y tiempo restante.",
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
            { value: "active", label: "Activos (descargando o transfiriendo)" },
            { value: "all", label: "Todos" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 },
      ],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const ui = await updateUi(ctx);
        let torrents = Object.values(ui.torrents ?? {});
        const downloading = torrents.filter((t) => t.state === "Downloading").length;
        const seeding = torrents.filter((t) => t.state === "Seeding").length;
        if (ctx.config.filter !== "all") {
          torrents = torrents.filter((t) => t.state === "Downloading" || Number(t.download_payload_rate) > 0 || Number(t.upload_payload_rate) > 0);
        }
        torrents.sort((a, b) => Number(b.download_payload_rate) - Number(a.download_payload_rate) || Number(b.upload_payload_rate) - Number(a.upload_payload_rate));
        const down = Number(ui.stats?.download_rate) || 0;
        const up = Number(ui.stats?.upload_rate) || 0;

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Descarga", value: rate(down), tone: down > 0 ? "good" : "neutral" },
                  { label: "Subida", value: rate(up) },
                  { label: "Descargando", value: String(downloading) },
                  { label: "Sembrando", value: String(seeding) },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay torrents que mostrar.",
                items: torrents.slice(0, limit).map((t) => {
                  const [text, tone] = STATE[t.state] ?? [String(t.state ?? "—"), "neutral"];
                  const pct = Number(t.progress); // Deluge da 0–100
                  const eta = Number(t.eta);
                  return {
                    title: String(t.name ?? "Sin nombre"),
                    subtitle: [text, t.state === "Downloading" && eta > 0 ? duration(eta) : Number(t.upload_payload_rate) > 0 ? `↑ ${rate(t.upload_payload_rate)}` : ""].filter(Boolean).join(" · "),
                    right: Number.isFinite(pct) ? `${Math.round(pct)}%` : undefined,
                    progress: Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : undefined,
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

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");
const keyOf = (ctx) => `${base(ctx)}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

/** Llamada JSON-RPC de Deluge. Devuelve `{ body, cookie }`. */
async function call(ctx, method, params, cookie) {
  const res = await ctx.http(`${base(ctx)}/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ method, params, id: 1 }),
  });
  if (res.status === 404) ctx.fail("No se encontró la interfaz web de Deluge. ¿La URL es la correcta (puerto 8112)?");
  if (!res.ok) ctx.fail(`Deluge respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece la interfaz web de Deluge.");
  }
  return { body, setCookie: /_session_id=([^;,\s]+)/.exec(res.headers["set-cookie"] ?? "")?.[1] };
}

async function login(ctx) {
  const { body, setCookie } = await call(ctx, "auth.login", [String(ctx.config.password ?? "")]);
  if (body?.result !== true || !setCookie) ctx.fail("Deluge rechazó la contraseña de la interfaz web.");
  const cookie = `_session_id=${setCookie}`;
  remember(sessions, keyOf(ctx), { cookie, expires: Date.now() + 20 * 60_000 });
  return cookie;
}

async function updateUi(ctx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const hit = sessions.get(keyOf(ctx));
    const cookie = attempt === 0 && hit && hit.expires > Date.now() ? hit.cookie : await login(ctx);
    const { body } = await call(ctx, "web.update_ui", [FIELDS, {}], cookie);
    // Código 1 = no autenticado (la sesión caducó): se vuelve a iniciar sesión una vez.
    if (body?.error?.code === 1 && attempt === 0) {
      sessions.delete(keyOf(ctx));
      continue;
    }
    if (body?.error) ctx.fail(`Deluge respondió: ${String(body.error.message ?? "error").slice(0, 80)}`);
    const ui = body?.result;
    if (!ui || typeof ui !== "object") ctx.fail("Deluge respondió con un formato inesperado.");
    if (ui.connected === false) ctx.fail("La interfaz web de Deluge no está conectada a un demonio (Ajustes → Gestor de conexiones).");
    return ui;
  }
  return ctx.fail("Deluge rechazó la sesión.");
}
