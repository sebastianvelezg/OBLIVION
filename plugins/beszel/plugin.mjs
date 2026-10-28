// Plugin de Beszel (https://beszel.dev): CPU, memoria y disco de cada servidor que monitorizas.
//
// Beszel está hecho sobre PocketBase. Usa el correo y la contraseña de un usuario de Beszel
// (basta con uno que solo vea los sistemas). El token se guarda en memoria y se renueva solo.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { createHash } from "node:crypto";
import { remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Beszel", type: "url", required: true, placeholder: "http://192.168.1.10:8090" },
  { key: "identity", label: "Correo del usuario", type: "string", required: true },
  { key: "password", label: "Contraseña", type: "secret", required: true },
];

const tokens = new Map();
// Colecciones de usuarios de PocketBase donde se intenta iniciar sesión (cambian entre versiones de Beszel).
const AUTH_PATHS = ["/api/collections/users/auth-with-password", "/api/collections/_superusers/auth-with-password", "/api/admins/auth-with-password"];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "beszel",
  name: "Beszel",
  version: "0.1.0",
  description: "Estado, CPU, memoria y disco de cada servidor monitorizado por Beszel.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const systems = await listSystems(ctx);
    return `Conectado: ${systems.filter((s) => s.status === "up").length} de ${systems.length} sistemas en línea`;
  },

  widgets: [
    {
      type: "systems",
      name: "Sistemas",
      description: "Cada sistema con su estado y su uso de CPU, memoria y disco.",
      icon: "🖥️",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [],

      async load(ctx) {
        const systems = await listSystems(ctx);
        const up = systems.filter((s) => s.status === "up").length;
        const down = systems.filter((s) => s.status === "down").length;
        const rank = (s) => (s.status === "down" ? 0 : s.status === "up" ? 2 : 1);
        const sorted = [...systems].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "En línea", value: String(up), tone: "good" },
                  { label: "Caídos", value: String(down), tone: down > 0 ? "bad" : "neutral" },
                  { label: "Total", value: String(systems.length) },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "Beszel no tiene sistemas.",
                items: sorted.map((s) => {
                  const i = s.info ?? {};
                  const pct = (v) => (Number.isFinite(Number(v)) ? `${Math.round(Number(v))}%` : "—");
                  const hot = [i.cpu, i.mp, i.dp].some((v) => Number(v) >= 90);
                  const ok = s.status === "up";
                  return {
                    title: String(s.name ?? "sistema"),
                    subtitle: ok ? `CPU ${pct(i.cpu)} · RAM ${pct(i.mp)} · Disco ${pct(i.dp)}` : "",
                    right: s.status === "up" ? "En línea" : s.status === "down" ? "Caído" : s.status === "paused" ? "Pausado" : String(s.status ?? "—"),
                    progress: ok && Number.isFinite(Number(i.cpu)) ? Math.min(1, Math.max(0, Number(i.cpu) / 100)) : undefined,
                    tone: s.status === "down" ? "bad" : hot ? "warn" : ok ? "good" : "neutral",
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
const keyOf = (ctx) =>
  `${base(ctx)}|${String(ctx.config.identity ?? "")}|${createHash("sha256").update(String(ctx.config.password ?? "")).digest("hex").slice(0, 16)}`;

async function login(ctx, fresh = false) {
  const key = keyOf(ctx);
  const hit = tokens.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.token;

  for (const path of AUTH_PATHS) {
    const res = await ctx.http(base(ctx) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identity: String(ctx.config.identity ?? ""), password: String(ctx.config.password ?? "") }),
    });
    // 404: esa colección no existe en esta versión; 400: no es un usuario de esa colección. Se prueba la siguiente.
    if (res.status === 404 || res.status === 400) continue;
    if (!res.ok) ctx.fail(`Beszel respondió con error ${res.status}`);
    try {
      const token = res.json()?.token;
      if (typeof token === "string" && token) {
        remember(tokens, key, { token, expires: Date.now() + 25 * 60_000 });
        return token;
      }
    } catch {
      /* siguiente */
    }
  }
  return ctx.fail("Beszel rechazó el correo o la contraseña (o la URL no es la de Beszel).");
}

async function listSystems(ctx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login(ctx, attempt > 0);
    const res = await ctx.http(`${base(ctx)}/api/collections/systems/records?page=1&perPage=100&sort=%2Bcreated`, {
      // PocketBase espera el token tal cual en Authorization.
      headers: { Accept: "application/json", Authorization: token },
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      tokens.delete(keyOf(ctx));
      continue;
    }
    if (res.status === 401 || res.status === 403) ctx.fail("Beszel no deja ver los sistemas a ese usuario.");
    if (!res.ok) ctx.fail(`Beszel respondió con error ${res.status}`);
    try {
      const body = res.json();
      if (!Array.isArray(body?.items)) throw new Error("sin items");
      return body.items;
    } catch {
      return ctx.fail("La URL responde, pero no parece Beszel.");
    }
  }
  return ctx.fail("Beszel rechazó la sesión.");
}
