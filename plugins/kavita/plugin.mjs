// Plugin de Kavita: series, volúmenes, archivos y lo último añadido.
//
// Kavita no tiene claves de solo lectura para esta API: inicia sesión con un usuario y una
// contraseña (o con la «clave de API / OPDS» de un usuario). Conviene crear un usuario solo
// para Oblivion. El token se guarda en memoria y se renueva solo.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { createHash } from "node:crypto";
import { ago, bytes, remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Kavita", type: "url", required: true, placeholder: "http://192.168.1.10:5000" },
  { key: "username", label: "Usuario", type: "string", help: "Déjalo vacío si usas la clave de API." },
  { key: "password", label: "Contraseña (o clave de API si no hay usuario)", type: "secret", required: true },
];

const tokens = new Map();

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "kavita",
  name: "Kavita",
  version: "0.1.0",
  description: "Cuántas series, volúmenes y archivos tienes en Kavita, y las series añadidas más recientemente.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await get(ctx, "GET", "/api/Stats/server/stats");
    return `Conectado: ${Number(s.seriesCount ?? 0).toLocaleString("es")} series`;
  },

  widgets: [
    {
      type: "library",
      name: "Biblioteca",
      description: "Series, volúmenes, archivos y tamaño de tu biblioteca, y lo último añadido.",
      icon: "📚",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Últimas series a mostrar (0 = ninguna)", type: "number", default: 5, min: 0, max: 20 }],

      async load(ctx) {
        const limit = Math.min(20, Math.max(0, Number(ctx.config.limit) || 0));
        const s = await get(ctx, "GET", "/api/Stats/server/stats");
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        const items = [];
        if (s.seriesCount !== undefined) items.push({ label: "Series", value: n(s.seriesCount) });
        if (s.volumeCount !== undefined) items.push({ label: "Volúmenes", value: n(s.volumeCount) });
        if (s.chapterCount !== undefined) items.push({ label: "Capítulos", value: n(s.chapterCount) });
        if (s.totalFiles !== undefined) items.push({ label: "Archivos", value: n(s.totalFiles) });
        if (s.totalSize !== undefined) items.push({ label: "Tamaño", value: bytes(s.totalSize) });
        const sections = [{ view: { kind: "stats", items } }];

        // Las últimas series son un extra: si el endpoint cambia entre versiones, no se muestran.
        if (limit > 0) {
          try {
            const recent = await get(ctx, "POST", `/api/Series/recently-added-v2?PageNumber=1&PageSize=${limit}`, {});
            const list = Array.isArray(recent) ? recent : [];
            if (list.length > 0) {
              sections.push({
                title: "Añadido recientemente",
                view: { kind: "list", items: list.slice(0, limit).map((x) => ({ title: String(x.name ?? "Serie"), subtitle: String(x.libraryName ?? ""), right: ago(x.created) || undefined })) },
              });
            }
          } catch {
            /* sin lista */
          }
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");
const keyOf = (ctx) =>
  `${base(ctx)}|${String(ctx.config.username ?? "")}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

async function login(ctx, fresh = false) {
  const key = keyOf(ctx);
  const hit = tokens.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.token;
  const user = String(ctx.config.username ?? "");
  const secret = String(ctx.config.password ?? "");
  const res = await ctx.http(`${base(ctx)}/api/Account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(user ? { username: user, password: secret, apiKey: "" } : { username: "", password: "", apiKey: secret }),
  });
  if (res.status === 404) ctx.fail("No se encontró la API de Kavita. ¿La URL es correcta?");
  let token;
  try {
    token = res.json()?.token;
  } catch {
    token = undefined;
  }
  if (!res.ok || typeof token !== "string") ctx.fail("Kavita rechazó el usuario o la contraseña.");
  remember(tokens, key, { token, expires: Date.now() + 50 * 60_000 });
  return token;
}

async function get(ctx, method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login(ctx, attempt > 0);
    const res = await ctx.http(base(ctx) + path, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      tokens.delete(keyOf(ctx));
      continue;
    }
    if (res.status === 401 || res.status === 403) ctx.fail("Kavita no deja leer esto a ese usuario.");
    if (res.status === 404) ctx.fail("Kavita no tiene esa ruta. ¿Es una versión reciente?");
    if (!res.ok) ctx.fail(`Kavita respondió con error ${res.status}`);
    try {
      return res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece Kavita.");
    }
  }
  return ctx.fail("Kavita rechazó la sesión.");
}
