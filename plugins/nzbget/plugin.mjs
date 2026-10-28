// Plugin de NZBGet: velocidad y cola de descargas Usenet.
//
// Usa el usuario y la contraseña de NZBGet (Ajustes → Seguridad; por defecto «nzbget» y
// «tegbzn6789»: cámbialos). Habla con su API JSON-RPC. No declara `permissions.network`.

import { basicAuth, bytes, rate } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de NZBGet", type: "url", required: true, placeholder: "http://192.168.1.10:6789" },
  { key: "username", label: "Usuario", type: "string", required: true, default: "nzbget" },
  { key: "password", label: "Contraseña", type: "secret", required: true },
];

const MB = 1024 * 1024;

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "nzbget",
  name: "NZBGet",
  version: "0.1.0",
  description: "Velocidad de descarga, tamaño restante y las descargas de la cola de NZBGet.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await rpc(ctx, "status");
    return `Conectado: ${rate(Number(s.DownloadRate))}${s.DownloadPaused ? " (pausado)" : ""}`;
  },

  widgets: [
    {
      type: "downloads",
      name: "Descargas",
      description: "Velocidad, estado, lo que queda por descargar y las descargas de la cola.",
      icon: "📥",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 10,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const [s, groups] = await Promise.all([rpc(ctx, "status"), rpc(ctx, "listgroups").catch(() => [])]);
        const speed = Number(s.DownloadRate) || 0;
        const paused = !!(s.DownloadPaused || s.ServerPaused);
        const left = (Number(s.RemainingSizeMB) || 0) * MB;
        const eta = speed > 0 && left > 0 ? left / speed : 0;
        const list = Array.isArray(groups) ? groups : [];
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Velocidad", value: rate(speed), tone: speed > 0 ? "good" : "neutral" },
                  { label: "Restante", value: left > 0 ? bytes(left) : "0 B", hint: eta > 0 ? `≈ ${eta >= 3600 ? Math.round(eta / 3600) + " h" : Math.max(1, Math.round(eta / 60)) + " min"}` : undefined },
                  { label: "Descargado", value: bytes((Number(s.DownloadedSizeMB) || 0) * MB) },
                  { label: "Estado", value: paused ? "Pausado" : speed > 0 ? "Descargando" : "En espera", tone: paused ? "warn" : speed > 0 ? "good" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "La cola está vacía.",
                items: list.slice(0, limit).map((g) => {
                  const total = Number(g.FileSizeMB) || 0;
                  const remaining = Number(g.RemainingSizeMB) || 0;
                  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : undefined;
                  return {
                    title: String(g.NZBName ?? "Sin nombre"),
                    subtitle: [g.Category, statusText(g.Status)].filter(Boolean).join(" · "),
                    right: progress === undefined ? undefined : `${Math.round(progress * 100)}%`,
                    progress,
                    tone: /PAUSED/i.test(String(g.Status)) ? "warn" : /FAIL|ERROR/i.test(String(g.Status)) ? "bad" : "neutral",
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

function statusText(s) {
  const v = String(s ?? "");
  if (/DOWNLOADING/i.test(v)) return "Descargando";
  if (/PAUSED/i.test(v)) return "Pausada";
  if (/QUEUED/i.test(v)) return "En cola";
  if (/UNPACKING|POST/i.test(v)) return "Procesando";
  return v.toLowerCase();
}

/** NZBGet acepta el método JSON-RPC en la ruta: GET /jsonrpc/status. */
async function rpc(ctx, method) {
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/jsonrpc/${method}`, {
    headers: { Accept: "application/json", ...basicAuth(String(ctx.config.username ?? ""), ctx.config.password) },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("NZBGet rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de NZBGet. ¿La URL es la de su interfaz web (puerto 6789)?");
  if (!res.ok) ctx.fail(`NZBGet respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (body?.result === undefined) throw new Error("sin result");
    return body.result;
  } catch {
    return ctx.fail("La URL responde, pero no parece NZBGet.");
  }
}
