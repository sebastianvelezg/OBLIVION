// Plugin de Traefik: routers, servicios y middlewares, y cuáles tienen problemas.
//
// Usa la API de Traefik (`api: {}` en su configuración; puerto 8080 por defecto). Si la proteges
// con autenticación básica, pon el usuario y la contraseña. No uses `--api.insecure` fuera de tu red.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { basicAuth } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de la API de Traefik", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  { key: "username", label: "Usuario", type: "string", help: "Solo si la API tiene autenticación básica." },
  { key: "password", label: "Contraseña", type: "secret" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "traefik",
  name: "Traefik",
  version: "0.1.0",
  description: "Cuántos routers, servicios y middlewares tiene Traefik, y los routers con errores o avisos.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const o = await get(ctx, "/api/overview");
    return `Conectado: ${Number(o.http?.routers?.total ?? 0)} routers HTTP`;
  },

  widgets: [
    {
      type: "overview",
      name: "Resumen",
      description: "Routers, servicios y middlewares HTTP, y los routers con problemas.",
      icon: "🚦",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [{ key: "limit", label: "Máximo de routers con problemas", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const o = await get(ctx, "/api/overview");
        const http = o.http ?? {};
        const part = (label, p) => {
          const bad = Number(p?.errors) || 0;
          const warn = Number(p?.warnings) || 0;
          return { label, value: String(Number(p?.total) || 0), hint: bad || warn ? `${bad} errores · ${warn} avisos` : undefined, tone: bad > 0 ? "bad" : warn > 0 ? "warn" : "neutral" };
        };
        const sections = [{ view: { kind: "stats", items: [part("Routers", http.routers), part("Servicios", http.services), part("Middlewares", http.middlewares)] } }];

        // Los routers con problemas son un extra: si el listado falla o es enorme, no se muestran.
        if (Number(http.routers?.errors) > 0 || Number(http.routers?.warnings) > 0) {
          try {
            const routers = await get(ctx, "/api/http/routers");
            const bad = (Array.isArray(routers) ? routers : []).filter((r) => r.status && r.status !== "enabled");
            if (bad.length > 0) {
              sections.push({
                title: "Con problemas",
                view: {
                  kind: "list",
                  items: bad.slice(0, limit).map((r) => ({
                    title: String(r.name ?? "router"),
                    subtitle: String(r.rule ?? "").slice(0, 120),
                    right: r.status === "warning" ? "Aviso" : r.status === "disabled" ? "Desactivado" : String(r.status),
                    tone: r.status === "warning" ? "warn" : "bad",
                  })),
                },
              });
            }
          } catch {
            /* sin detalle */
          }
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", ...basicAuth(String(ctx.config.username ?? ""), ctx.config.password) },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Traefik rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de Traefik. ¿Está activada (api: {}) y la URL es la de su puerto?");
  if (!res.ok) ctx.fail(`Traefik respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece la API de Traefik.");
  }
}
