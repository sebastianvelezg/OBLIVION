// Plugin de Backrest (https://github.com/garethgeorge/backrest): resumen de tus planes de copia.
//
// Usa el usuario y la contraseña de Backrest si activaste autenticación. Backrest habla gRPC
// sobre HTTP/JSON, así que el plugin hace un POST con un JSON vacío al resumen del panel.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { ago, basicAuth, bytes } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Backrest", type: "url", required: true, placeholder: "http://192.168.1.10:9898" },
  { key: "username", label: "Usuario", type: "string", help: "Solo si Backrest tiene autenticación." },
  { key: "password", label: "Contraseña", type: "secret" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "backrest",
  name: "Backrest",
  version: "0.1.0",
  description: "Resumen de tus planes de copia en Backrest: último resultado de cada uno, éxitos y fallos de los últimos 30 días y datos añadidos.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const plans = await summary(ctx);
    return `Conectado: ${plans.length} plan${plans.length === 1 ? "" : "es"} de copia`;
  },

  widgets: [
    {
      type: "plans",
      name: "Planes de copia",
      description: "Cada plan con el resultado de su última copia y el balance de los últimos 30 días.",
      icon: "🗄️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 180,
      config: [],

      async load(ctx) {
        const plans = await summary(ctx);
        const num = (v) => Number(v) || 0; // los int64 de gRPC-JSON llegan como texto
        let okNow = 0;
        let failNow = 0;
        const rows = plans.map((p) => {
          const recent = p.recentBackups ?? {};
          const status = String((recent.status ?? [])[0] ?? "");
          const when = Number((recent.timestampMs ?? [])[0]);
          const ok = status === "STATUS_SUCCESS";
          const bad = status === "STATUS_ERROR";
          if (ok) okNow++;
          if (bad) failNow++;
          const failed30 = num(p.backupsFailed30days);
          const warn = !bad && (status === "STATUS_WARNING" || failed30 > 0);
          return {
            tone: bad ? "bad" : warn ? "warn" : ok ? "good" : "neutral",
            title: String(p.id ?? "plan"),
            subtitle: `30 d: ${num(p.backupsSuccessLast30days)} ok · ${failed30} fallos · ${bytes(num(p.bytesAddedLast30days))} añadidos`,
            right: bad ? "Error" : ok ? (Number.isFinite(when) && when > 0 ? ago(when) : "Correcta") : status ? status.replace("STATUS_", "").toLowerCase() : "Sin copias",
          };
        });
        const rank = { bad: 0, warn: 1, good: 2, neutral: 3 };
        rows.sort((a, b) => rank[a.tone] - rank[b.tone] || a.title.localeCompare(b.title, "es"));

        const sum = (key) => plans.reduce((n, p) => n + num(p[key]), 0);
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Planes", value: String(plans.length) },
                  { label: "Última correcta", value: String(okNow), tone: "good" },
                  { label: "Última con error", value: String(failNow), tone: failNow > 0 ? "bad" : "neutral" },
                  { label: "Fallos (30 d)", value: String(sum("backupsFailed30days")), tone: sum("backupsFailed30days") > 0 ? "warn" : "neutral" },
                  { label: "Añadido (30 d)", value: bytes(sum("bytesAddedLast30days")) },
                ],
              },
            },
            { view: { kind: "list", empty: "Backrest no tiene planes de copia.", items: rows.slice(0, 30) } },
          ],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function summary(ctx) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/v1.Backrest/GetSummaryDashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...basicAuth(String(ctx.config.username ?? ""), ctx.config.password) },
    body: "{}",
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Backrest rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de Backrest. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Backrest respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (!Array.isArray(body?.planSummaries)) throw new Error("sin planes");
    return body.planSummaries;
  } catch {
    return ctx.fail("La URL responde, pero no parece Backrest.");
  }
}
