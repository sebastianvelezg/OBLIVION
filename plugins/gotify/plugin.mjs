// Plugin de Gotify: las últimas notificaciones recibidas.
//
// Token de CLIENTE (no el de una aplicación): Gotify → Clientes → crea uno. Es el que puede
// leer mensajes. Solo lee datos. No declara `permissions.network`.

import { ago } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Gotify", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  { key: "token", label: "Token de cliente", type: "secret", required: true, help: "Gotify → Clientes → crear cliente." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "gotify",
  name: "Gotify",
  version: "0.1.0",
  description: "Las últimas notificaciones de tu servidor Gotify, con su aplicación y prioridad.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const apps = await get(ctx, "/application");
    return `Conectado: ${Array.isArray(apps) ? apps.length : 0} aplicaciones`;
  },

  widgets: [
    {
      type: "messages",
      name: "Notificaciones",
      description: "Los últimos mensajes recibidos; los de prioridad alta se resaltan.",
      icon: "🔔",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [{ key: "limit", label: "Cantidad", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const [msgs, apps] = await Promise.all([get(ctx, `/message?limit=${limit}`), get(ctx, "/application").catch(() => [])]);
        const names = new Map((Array.isArray(apps) ? apps : []).map((a) => [a.id, a.name]));
        const list = Array.isArray(msgs.messages) ? msgs.messages : [];
        return {
          kind: "sections",
          sections: [
            { view: { kind: "stats", items: [{ label: "Aplicaciones", value: String(names.size) }, { label: "Mensajes recientes", value: String(list.length) }] } },
            {
              view: {
                kind: "list",
                empty: "No hay notificaciones.",
                items: list.slice(0, limit).map((m) => {
                  const p = Number(m.priority) || 0;
                  return {
                    title: String(m.title || names.get(m.appid) || "Notificación").slice(0, 120),
                    subtitle: String(m.message ?? "").replace(/\s+/g, " ").slice(0, 160),
                    right: ago(m.date) || undefined,
                    tone: p >= 8 ? "bad" : p >= 5 ? "warn" : "neutral",
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

async function get(ctx, path) {
  const token = String(ctx.config.token ?? "");
  if (!/^[A-Za-z0-9._-]{8,200}$/.test(token)) ctx.fail("El token no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", "X-Gotify-Key": token },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Gotify rechazó el token (usa el de un cliente, no el de una aplicación).");
  if (res.status === 404) ctx.fail("No se encontró la API de Gotify. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Gotify respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Gotify.");
  }
}
