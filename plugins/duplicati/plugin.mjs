// Plugin de Duplicati (2.1 o posterior): estado de tus trabajos de copia de seguridad.
//
// Inicia sesión con la contraseña de la interfaz de Duplicati (la API de la 2.1 usa un token
// que se guarda en memoria y se renueva solo). No declara `permissions.network`.

import { createHash } from "node:crypto";
import { ago, bytes, remember } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Duplicati", type: "url", required: true, placeholder: "http://192.168.1.10:8200" },
  { key: "password", label: "Contraseña de la interfaz", type: "secret", required: true },
];

const tokens = new Map();
const STALE_HOURS = 72;

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "duplicati",
  name: "Duplicati",
  version: "0.1.0",
  description: "Estado de tus copias de seguridad en Duplicati: cuándo se hizo la última, si hay avisos o errores y cuándo toca la siguiente.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const backups = await get(ctx, "/api/v1/backups");
    return `Conectado: ${Array.isArray(backups) ? backups.length : 0} trabajos de copia`;
  },

  widgets: [
    {
      type: "jobs",
      name: "Copias de seguridad",
      description: "Cada trabajo con la fecha de su última copia, avisos y errores, y si hay una en curso.",
      icon: "🛟",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      config: [],

      async load(ctx) {
        const [backups, state, notes, progress] = await Promise.all([
          get(ctx, "/api/v1/backups"),
          get(ctx, "/api/v1/serverstate").catch(() => ({})),
          get(ctx, "/api/v1/notifications").catch(() => []),
          get(ctx, "/api/v1/progressstate", { allow404: true }).catch(() => null),
        ]);
        const jobs = Array.isArray(backups) ? backups : [];
        const notifications = (Array.isArray(notes) ? notes : []).filter((n) => n.BackupID);
        const byJob = (id, type) => notifications.filter((n) => String(n.BackupID) === String(id) && n.Type === type).length;
        const running = state?.ActiveTask && progress?.BackupID ? String(progress.BackupID) : null;

        const rows = jobs.map((j) => {
          const b = j.Backup ?? {};
          const meta = b.Metadata ?? {};
          const last = parseDate(meta.LastBackupFinished);
          const errors = byJob(b.ID, "Error");
          const warnings = byJob(b.ID, "Warning");
          const hours = last ? (Date.now() - last) / 3600_000 : Infinity;
          const next = j.Schedule?.Time ? Date.parse(j.Schedule.Time) : NaN;
          let right = last ? ago(last) : "Nunca";
          let tone = "good";
          if (running === String(b.ID)) [right, tone] = ["En curso", "good"];
          else if (errors > 0) [right, tone] = ["Con errores", "bad"];
          else if (warnings > 0) [right, tone] = ["Con avisos", "warn"];
          else if (!last) tone = "warn";
          else if (hours > STALE_HOURS) tone = "warn";
          return {
            title: String(b.Name ?? "Trabajo"),
            subtitle: [last ? `última copia ${ago(last)}` : "sin copias todavía", Number.isFinite(next) ? `siguiente ${new Date(next).toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "", Number(meta.TargetFilesSize) > 0 ? bytes(meta.TargetFilesSize) : ""]
              .filter(Boolean)
              .join(" · "),
            right,
            tone,
          };
        });
        const rank = { bad: 0, warn: 1, good: 2 };
        rows.sort((a, b) => rank[a.tone] - rank[b.tone] || a.title.localeCompare(b.title, "es"));

        const errors = notifications.filter((n) => n.Type === "Error").length;
        const warnings = notifications.filter((n) => n.Type === "Warning").length;
        const stored = jobs.reduce((n, j) => n + (Number(j.Backup?.Metadata?.TargetFilesSize) || 0), 0);
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Trabajos", value: String(jobs.length), hint: stored > 0 ? bytes(stored) : undefined },
                  { label: "Errores", value: String(errors), tone: errors > 0 ? "bad" : "good" },
                  { label: "Avisos", value: String(warnings), tone: warnings > 0 ? "warn" : "neutral" },
                  { label: "En curso", value: running ? "Sí" : "No", tone: running ? "good" : "neutral" },
                ],
              },
            },
            { view: { kind: "list", empty: "Duplicati no tiene trabajos de copia.", items: rows } },
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

/** Duplicati da las fechas como «20241012T020000Z». */
function parseDate(v) {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(String(v ?? ""));
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
}

async function login(ctx, fresh = false) {
  const key = keyOf(ctx);
  const hit = tokens.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.token;
  const res = await ctx.http(`${base(ctx)}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Password: String(ctx.config.password ?? ""), RememberMe: true }),
  });
  if (res.status === 404) ctx.fail("No se encontró la API de Duplicati. ¿Es la versión 2.1 o posterior y la URL es correcta?");
  let token;
  try {
    token = res.json()?.AccessToken;
  } catch {
    token = undefined;
  }
  if (!res.ok || typeof token !== "string") ctx.fail("Duplicati rechazó la contraseña.");
  remember(tokens, key, { token, expires: Date.now() + 25 * 60_000 });
  return token;
}

async function get(ctx, path, { allow404 = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login(ctx, attempt > 0);
    const res = await ctx.http(base(ctx) + path, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      tokens.delete(keyOf(ctx));
      continue;
    }
    // `progressstate` responde 404 hasta que se ha ejecutado alguna copia.
    if (res.status === 404 && allow404) return null;
    if (res.status === 401 || res.status === 403) ctx.fail("Duplicati rechazó la sesión.");
    if (!res.ok) ctx.fail(`Duplicati respondió con error ${res.status}`);
    try {
      return res.json();
    } catch {
      return ctx.fail("La URL responde, pero no parece Duplicati.");
    }
  }
  return ctx.fail("Duplicati rechazó la sesión.");
}
