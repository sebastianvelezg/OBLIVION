// Plugin de SABnzbd: velocidad y cola de descargas Usenet.
//
// API key: SABnzbd → Configuración → General → Seguridad → «Clave API». SABnzbd solo acepta la
// clave en la dirección (?apikey=…), así que Oblivion la añade al llamar; nunca llega al navegador.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { bytes, rate } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de SABnzbd", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  { key: "apiKey", label: "API key", type: "secret", required: true, help: "Configuración → General → Seguridad → Clave API." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "sabnzbd",
  name: "SABnzbd",
  version: "0.1.0",
  description: "Velocidad de descarga, cola y tiempo restante en SABnzbd.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const q = await queue(ctx, 1);
    return `Conectado: ${q.noofslots ?? 0} en cola (${String(q.status ?? "—")})`;
  },

  widgets: [
    {
      type: "downloads",
      name: "Descargas",
      description: "Velocidad, estado, tiempo restante y las descargas de la cola.",
      icon: "📥",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 10,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const q = await queue(ctx, limit);
        const slots = Array.isArray(q.slots) ? q.slots : [];
        const paused = String(q.status).toLowerCase() === "paused";
        const speed = Number(q.kbpersec) * 1024;
        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Velocidad", value: rate(speed), tone: speed > 0 ? "good" : "neutral" },
                  { label: "En cola", value: String(q.noofslots ?? slots.length), hint: Number(q.mbleft) > 0 ? bytes(Number(q.mbleft) * 1024 * 1024) + " restantes" : undefined },
                  { label: "Tiempo restante", value: speed > 0 && q.timeleft ? String(q.timeleft) : "—" },
                  { label: "Estado", value: paused ? "Pausado" : speed > 0 ? "Descargando" : "En espera", tone: paused ? "warn" : speed > 0 ? "good" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "La cola está vacía.",
                items: slots.slice(0, limit).map((s) => {
                  const pct = Number(s.percentage);
                  return {
                    title: String(s.filename ?? s.name ?? "Sin nombre"),
                    subtitle: [s.cat && s.cat !== "*" ? s.cat : "", s.status, s.timeleft && s.timeleft !== "0:00:00" ? s.timeleft : ""].filter(Boolean).join(" · "),
                    right: Number.isFinite(pct) ? `${Math.round(pct)}%` : undefined,
                    progress: Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : undefined,
                    tone: /paused/i.test(String(s.status)) ? "warn" : "neutral",
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

async function queue(ctx, limit) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const q = new URLSearchParams({ mode: "queue", output: "json", limit: String(limit), apikey: key });
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/api?${q}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) ctx.fail("No se encontró la API de SABnzbd. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`SABnzbd respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece SABnzbd.");
  }
  if (body?.error) ctx.fail(/api key/i.test(String(body.error)) ? "SABnzbd rechazó la API key." : `SABnzbd respondió: ${String(body.error).slice(0, 80)}`);
  if (!body?.queue || typeof body.queue !== "object") ctx.fail("La URL responde, pero no parece SABnzbd.");
  return body.queue;
}
