// Plugin de Kopia (servidor): estado de las copias (snapshots) de cada origen.
//
// Usa el usuario y la contraseña del servidor de Kopia (--server-username / --server-password).
// OJO: el servidor de Kopia usa por defecto HTTPS con un certificado AUTOFIRMADO, que Oblivion
// no acepta. Arranca Kopia con `--insecure` (solo en tu red local) o con un certificado válido.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { ago, basicAuth, bytes } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL del servidor de Kopia", type: "url", required: true, placeholder: "http://192.168.1.10:51515" },
  { key: "username", label: "Usuario", type: "string", help: "Solo si el servidor tiene autenticación." },
  { key: "password", label: "Contraseña", type: "secret" },
];

const STALE_HOURS = 48;

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "kopia",
  name: "Kopia",
  version: "0.1.0",
  description: "Cuándo se hizo la última copia de cada origen en Kopia, su tamaño y si terminó con errores.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const sources = await listSources(ctx);
    return `Conectado: ${sources.length} ${sources.length === 1 ? "origen" : "orígenes"} de copia`;
  },

  widgets: [
    {
      type: "snapshots",
      name: "Copias",
      description: "Cada origen de copia con la fecha de su último snapshot, tamaño y errores.",
      icon: "📸",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 15, min: 1, max: 50 }],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 15));
        const sources = await listSources(ctx);
        const rows = sources.map((s) => {
          const snap = s.lastSnapshot;
          const start = snap?.startTime ? Date.parse(snap.startTime) : NaN;
          const errors = Number(snap?.stats?.errorCount) || 0;
          const hours = Number.isFinite(start) ? (Date.now() - start) / 3600_000 : Infinity;
          const busy = ["UPLOADING", "PENDING", "SNAPSHOTTING"].includes(String(s.status).toUpperCase());
          let right = Number.isFinite(start) ? ago(start) : "Nunca";
          let tone = "good";
          if (busy) [right, tone] = ["En curso", "good"];
          else if (errors > 0) [right, tone] = [`${errors} error${errors === 1 ? "" : "es"}`, "bad"];
          else if (!Number.isFinite(start) || hours > STALE_HOURS) tone = "warn";
          return {
            tone,
            title: String(s.source?.path ?? "origen"),
            subtitle: [s.source?.userName && s.source?.host ? `${s.source.userName}@${s.source.host}` : "", Number(snap?.stats?.totalSize) > 0 ? bytes(snap.stats.totalSize) : ""].filter(Boolean).join(" · "),
            right,
          };
        });
        const rank = { bad: 0, warn: 1, good: 2 };
        rows.sort((a, b) => rank[a.tone] - rank[b.tone] || a.title.localeCompare(b.title, "es"));
        const count = (t) => rows.filter((r) => r.tone === t).length;
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Orígenes", value: String(rows.length) },
                  { label: "Con errores", value: String(count("bad")), tone: count("bad") > 0 ? "bad" : "good" },
                  { label: `Sin copia > ${STALE_HOURS} h`, value: String(count("warn")), tone: count("warn") > 0 ? "warn" : "good" },
                ],
              },
            },
            { view: { kind: "list", empty: "Kopia no tiene orígenes de copia.", items: rows.slice(0, limit) } },
          ],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function listSources(ctx) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/api/v1/sources", {
    headers: { Accept: "application/json", ...basicAuth(String(ctx.config.username ?? ""), ctx.config.password) },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Kopia rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de Kopia. ¿La URL es la del servidor de Kopia?");
  if (!res.ok) ctx.fail(`Kopia respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (!Array.isArray(body?.sources)) throw new Error("sin sources");
    return body.sources;
  } catch {
    return ctx.fail("La URL responde, pero no parece el servidor de Kopia.");
  }
}
