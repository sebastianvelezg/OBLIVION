// Plugin de Navidrome (API Subsonic): lo que suena ahora y los últimos álbumes.
//
// Usa tu usuario y contraseña. La API Subsonic nunca envía la contraseña: cada petición lleva
// un «token» (md5 de contraseña + sal aleatoria), igual que hacen las apps de Navidrome.
// Conviene crear un usuario solo para Oblivion. No declara `permissions.network`.

import { createHash, randomBytes } from "node:crypto";

const connection = [
  { key: "url", label: "URL de Navidrome", type: "url", required: true, placeholder: "http://192.168.1.10:4533" },
  { key: "username", label: "Usuario", type: "string", required: true },
  { key: "password", label: "Contraseña", type: "secret", required: true },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "navidrome",
  name: "Navidrome",
  version: "0.1.0",
  description: "Qué se está escuchando ahora en tu Navidrome, el tamaño de la biblioteca y los últimos álbumes.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    await api(ctx, "ping");
    return "Conectado a Navidrome";
  },

  widgets: [
    {
      type: "now-playing",
      name: "Reproduciendo ahora",
      description: "Quién está escuchando qué en este momento.",
      icon: "🎵",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 15,
      config: [],

      async load(ctx) {
        const r = await api(ctx, "getNowPlaying");
        const entries = asList(r.nowPlaying?.entry);
        return {
          kind: "list",
          empty: "Nadie está escuchando nada ahora mismo.",
          items: entries.slice(0, 20).map((e) => ({
            title: String(e.title ?? "Sin título"),
            subtitle: [e.artist, e.username, e.playerName].filter(Boolean).join(" · "),
            right: Number(e.minutesAgo) > 0 ? `hace ${e.minutesAgo} min` : "ahora",
            tone: "good",
          })),
        };
      },
    },

    {
      type: "recent",
      name: "Últimos álbumes",
      description: "Los álbumes añadidos más recientemente, y el tamaño de la biblioteca.",
      icon: "💿",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Cantidad", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const r = await api(ctx, "getAlbumList2", { type: "newest", size: String(limit) });
        const albums = asList(r.albumList2?.album);
        const sections = [];
        // El recuento es un dato extra: si no está, no se muestra.
        try {
          const scan = (await api(ctx, "getScanStatus")).scanStatus;
          if (scan && Number.isFinite(Number(scan.count))) {
            sections.push({ view: { kind: "stats", items: [{ label: "Canciones", value: Number(scan.count).toLocaleString("es"), hint: scan.scanning ? "escaneando…" : undefined }] } });
          }
        } catch {
          /* sin recuento */
        }
        sections.push({
          view: {
            kind: "list",
            empty: "Todavía no hay álbumes.",
            items: albums.map((a) => ({
              title: String(a.name ?? a.title ?? "Álbum"),
              subtitle: String(a.artist ?? ""),
              right: a.year ? String(a.year) : undefined,
            })),
          },
        });
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

/** Subsonic omite el campo cuando no hay nada y devuelve un objeto (no lista) cuando hay uno. */
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

async function api(ctx, endpoint, extra = {}) {
  const user = String(ctx.config.username ?? "");
  const password = String(ctx.config.password ?? "");
  if (!user || !password) ctx.fail("Faltan el usuario o la contraseña en la conexión.");
  const salt = randomBytes(8).toString("hex");
  const token = createHash("md5").update(password + salt).digest("hex");
  const q = new URLSearchParams({ u: user, t: token, s: salt, v: "1.16.1", c: "oblivion", f: "json", ...extra });
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/rest/${endpoint}?${q}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) ctx.fail("No se encontró la API de Navidrome. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Navidrome respondió con error ${res.status}`);
  let body;
  try {
    body = res.json()["subsonic-response"];
  } catch {
    return ctx.fail("La URL responde, pero no parece Navidrome.");
  }
  if (!body) ctx.fail("La URL responde, pero no parece Navidrome.");
  if (body.status !== "ok") {
    const code = Number(body.error?.code);
    if (code === 40 || code === 41) ctx.fail("Navidrome rechazó el usuario o la contraseña.");
    ctx.fail(`Navidrome respondió: ${String(body.error?.message ?? "error").slice(0, 80)}`);
  }
  return body;
}
