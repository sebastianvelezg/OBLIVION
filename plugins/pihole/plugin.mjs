// Plugin de Pi-hole: consultas y bloqueos del DNS.
//
//   · Pi-hole v6: usa la contraseña de la interfaz (o una «contraseña de aplicación»).
//   · Pi-hole v5: usa el token de API (Ajustes → API → «Mostrar token de API»).
//
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Pi-hole", type: "url", required: true, placeholder: "http://192.168.1.2" },
  {
    key: "version",
    label: "Versión de Pi-hole",
    type: "select",
    default: "6",
    options: [
      { value: "6", label: "Pi-hole 6 (actual)" },
      { value: "5", label: "Pi-hole 5" },
    ],
  },
  {
    key: "password",
    label: "Contraseña (v6) o token de API (v5)",
    type: "secret",
    help: "En la v6 déjala vacía si tu Pi-hole no tiene contraseña.",
  },
];

import { createHash } from "node:crypto";
import { remember } from "../_shared/fmt.mjs";

// Pi-hole 6 devuelve un id de sesión (válido ~30 min) que se reutiliza.
const sessions = new Map();
const SESSION_MS = 20 * 60_000;

/** Servidor + huella de la contraseña: si la cambian, se vuelve a iniciar sesión. */
const sessionKey = (ctx) =>
  `${base(ctx)}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "pihole",
  name: "Pi-hole",
  version: "0.1.0",
  description: "Consultas DNS, porcentaje bloqueado y dominios en listas de tu Pi-hole.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await summary(ctx);
    return `Conectado: ${s.queries.toLocaleString("es")} consultas`;
  },

  widgets: [
    {
      type: "summary",
      name: "Pi-hole",
      description: "Porcentaje de consultas bloqueadas, consultas totales y dominios bloqueados.",
      icon: "🛡️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [],

      async load(ctx) {
        const s = await summary(ctx);
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        return {
          kind: "metric",
          icon: "🛡️",
          value: s.percent.toFixed(1),
          unit: "% bloqueado",
          caption: s.enabled === false ? "Bloqueo desactivado" : "Bloqueo activo",
          rows: [
            { label: "Consultas", value: n(s.queries) },
            { label: "Bloqueadas", value: n(s.blocked) },
            { label: "Dominios", value: n(s.domains) },
          ],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");

/** Resumen normalizado de ambas versiones. */
async function summary(ctx) {
  if (ctx.config.version === "5") return summaryV5(ctx);
  return summaryV6(ctx);
}

async function summaryV5(ctx) {
  const token = String(ctx.config.password ?? "");
  if (token && !/^[A-Fa-f0-9]{16,128}$/.test(token)) ctx.fail("El token de API de Pi-hole 5 no tiene un formato válido (son caracteres hexadecimales).");
  const q = new URLSearchParams({ summaryRaw: "" });
  if (token) q.set("auth", token);
  const res = await ctx.http(`${base(ctx)}/admin/api.php?${q.toString().replace("summaryRaw=", "summaryRaw")}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) ctx.fail("No se encontró la API de Pi-hole 5. ¿Es la versión 6? Cambia la opción de versión.");
  if (!res.ok) ctx.fail(`Pi-hole respondió con error ${res.status}`);
  let d;
  try {
    d = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Pi-hole.");
  }
  if (!d || typeof d !== "object" || Array.isArray(d) || d.dns_queries_today === undefined) {
    ctx.fail(token ? "Pi-hole no devolvió datos: revisa el token de API." : "Pi-hole no devolvió datos: añade el token de API.");
  }
  return {
    queries: Number(d.dns_queries_today),
    blocked: Number(d.ads_blocked_today),
    percent: Number(d.ads_percentage_today) || 0,
    domains: Number(d.domains_being_blocked),
    enabled: d.status ? d.status === "enabled" : undefined,
  };
}

async function sid(ctx, fresh = false) {
  const password = String(ctx.config.password ?? "");
  if (!password) return undefined; // Pi-hole sin contraseña
  const key = sessionKey(ctx);
  const hit = sessions.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.sid;
  const res = await ctx.http(`${base(ctx)}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 429) ctx.fail("Pi-hole limitó los intentos de inicio de sesión. Espera un momento.");
  if (res.status === 404) ctx.fail("No se encontró la API de Pi-hole 6. ¿Es la versión 5? Cambia la opción de versión.");
  let body;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  const id = body?.session?.sid;
  if (!body?.session?.valid || typeof id !== "string") ctx.fail("Pi-hole rechazó la contraseña.");
  remember(sessions, key, { sid: id, expires: Date.now() + SESSION_MS });
  return id;
}

async function summaryV6(ctx) {
  let d;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await sid(ctx, attempt > 0);
    const res = await ctx.http(`${base(ctx)}/api/stats/summary`, {
      headers: { Accept: "application/json", ...(id ? { sid: id } : {}) },
    });
    if (res.status === 401 && attempt === 0) {
      sessions.delete(sessionKey(ctx));
      continue;
    }
    if (res.status === 401) ctx.fail("Pi-hole rechazó la contraseña.");
    if (res.status === 404) ctx.fail("No se encontró la API de Pi-hole 6. ¿Es la versión 5? Cambia la opción de versión.");
    if (!res.ok) ctx.fail(`Pi-hole respondió con error ${res.status}`);
    try {
      d = res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece Pi-hole.");
    }
    break;
  }
  if (!d?.queries) ctx.fail("La URL responde, pero no parece Pi-hole 6.");

  // El estado del bloqueo es un dato extra: si falla, no se muestra.
  let enabled;
  try {
    const id = await sid(ctx);
    const b = await ctx.http(`${base(ctx)}/api/dns/blocking`, { headers: { Accept: "application/json", ...(id ? { sid: id } : {}) } });
    if (b.ok) enabled = b.json()?.blocking === "enabled";
  } catch {
    /* sin estado */
  }
  return {
    queries: Number(d.queries.total),
    blocked: Number(d.queries.blocked),
    percent: Number(d.queries.percent_blocked) || 0,
    domains: Number(d.gravity?.domains_being_blocked),
    enabled,
  };
}
