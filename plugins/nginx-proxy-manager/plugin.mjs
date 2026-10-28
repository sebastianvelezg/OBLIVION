// Plugin de Nginx Proxy Manager: tus hosts proxy y cuándo caducan los certificados.
//
// Usa el usuario (el correo) y la contraseña de NPM: inicia sesión por la API, guarda el token
// solo en memoria hasta que caduca y lo renueva solo. Conviene crear en NPM un usuario
// de solo lectura para Oblivion («Ver» en hosts y certificados).
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { createHash } from "node:crypto";
import { remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Nginx Proxy Manager", type: "url", required: true, placeholder: "http://192.168.1.10:81" },
  { key: "identity", label: "Correo del usuario", type: "string", required: true, placeholder: "oblivion@casa.lan" },
  { key: "password", label: "Contraseña", type: "secret", required: true },
];

const tokens = new Map();

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "nginx-proxy-manager",
  name: "Nginx Proxy Manager",
  version: "0.1.0",
  description: "Cuántos hosts proxy tienes, cuáles están desactivados o con error y qué certificados caducan pronto.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const hosts = await get(ctx, "/api/nginx/proxy-hosts");
    return `Conectado: ${Array.isArray(hosts) ? hosts.length : 0} hosts proxy`;
  },

  widgets: [
    {
      type: "hosts",
      name: "Hosts proxy",
      description: "Tus dominios proxy: activos, desactivados o con error de configuración.",
      icon: "🔀",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 }],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const hosts = await get(ctx, "/api/nginx/proxy-hosts");
        const rows = (Array.isArray(hosts) ? hosts : []).map((h) => {
          const enabled = h.enabled === 1 || h.enabled === true;
          const error = enabled && h.meta?.nginx_online === false;
          const names = Array.isArray(h.domain_names) ? h.domain_names : [];
          return {
            state: !enabled ? "off" : error ? "bad" : "ok",
            title: String(names[0] ?? "sin dominio") + (names.length > 1 ? ` +${names.length - 1}` : ""),
            subtitle: `${h.forward_scheme ?? "http"}://${h.forward_host ?? "?"}:${h.forward_port ?? "?"}${h.certificate_id ? " · HTTPS" : ""}`,
            right: !enabled ? "Desactivado" : error ? "Error" : "Activo",
            tone: !enabled ? "neutral" : error ? "bad" : "good",
          };
        });
        const rank = { bad: 0, ok: 1, off: 2 };
        rows.sort((a, b) => rank[a.state] - rank[b.state] || a.title.localeCompare(b.title, "es"));
        const count = (s) => rows.filter((r) => r.state === s).length;
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Activos", value: String(count("ok")), tone: "good" },
                  { label: "Desactivados", value: String(count("off")) },
                  { label: "Con error", value: String(count("bad")), tone: count("bad") > 0 ? "bad" : "neutral" },
                ],
              },
            },
            { view: { kind: "list", empty: "No hay hosts proxy.", items: rows.slice(0, limit).map(({ state, ...r }) => r) } },
          ],
        };
      },
    },

    {
      type: "certificates",
      name: "Certificados",
      description: "Tus certificados SSL por fecha de caducidad: los que caducan antes, primero.",
      icon: "🔒",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 3600,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 40 }],

      async load(ctx) {
        const limit = Math.min(40, Math.max(1, Number(ctx.config.limit) || 10));
        const certs = await get(ctx, "/api/nginx/certificates");
        const rows = (Array.isArray(certs) ? certs : [])
          .map((c) => ({ c, t: expires(c.expires_on) }))
          .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
        const days = (t) => (t === null ? null : Math.floor((t - Date.now()) / 86400_000));
        const soon = rows.filter((r) => days(r.t) !== null && days(r.t) < 30).length;
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Certificados", value: String(rows.length) },
                  { label: "Caducan en < 30 d", value: String(soon), tone: soon > 0 ? "warn" : "good" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay certificados.",
                items: rows.slice(0, limit).map(({ c, t }) => {
                  const d = days(t);
                  const names = Array.isArray(c.domain_names) ? c.domain_names : [];
                  return {
                    title: String(c.nice_name || names[0] || "Certificado"),
                    subtitle: [names[0] && names[0] !== c.nice_name ? names[0] : "", c.provider === "letsencrypt" ? "Let's Encrypt" : String(c.provider ?? "")].filter(Boolean).join(" · "),
                    right: d === null ? "—" : d < 0 ? "Caducado" : d === 0 ? "Caduca hoy" : `en ${d} d`,
                    tone: d === null ? "neutral" : d < 7 ? "bad" : d < 21 ? "warn" : "good",
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

/** NPM da la fecha como «2026-12-01 12:00:00» (UTC, sin zona) o ISO. */
function expires(v) {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : null;
}

const keyOf = (ctx) =>
  `${base(ctx)}|${String(ctx.config.identity ?? "")}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

async function login(ctx) {
  const key = keyOf(ctx);
  const hit = tokens.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const res = await ctx.http(`${base(ctx)}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identity: String(ctx.config.identity ?? ""), secret: String(ctx.config.password ?? "") }),
  });
  if (res.status === 404) ctx.fail("No se encontró la API de Nginx Proxy Manager. ¿La URL es la de su interfaz web (puerto 81)?");
  let body;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  if (!res.ok || typeof body?.token !== "string") ctx.fail("Nginx Proxy Manager rechazó el usuario o la contraseña.");
  // Se renueva 5 minutos antes de que caduque.
  const exp = Date.parse(body.expires);
  remember(tokens, key, { token: body.token, expires: (Number.isFinite(exp) ? exp : Date.now() + 3600_000) - 5 * 60_000 });
  return body.token;
}

async function get(ctx, path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login(ctx);
    const res = await ctx.http(base(ctx) + path, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      tokens.delete(keyOf(ctx));
      continue;
    }
    if (res.status === 401 || res.status === 403) ctx.fail("Nginx Proxy Manager no deja leer esto a ese usuario (¿le falta permiso de «Ver»?).");
    if (!res.ok) ctx.fail(`Nginx Proxy Manager respondió con error ${res.status}`);
    try {
      return res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece Nginx Proxy Manager.");
    }
  }
  return ctx.fail("Nginx Proxy Manager rechazó la sesión.");
}
