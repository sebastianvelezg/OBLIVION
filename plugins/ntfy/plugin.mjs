// Plugin de ntfy (ntfy.sh o tu propio servidor): los últimos mensajes de uno o varios temas.
//
// Un «tema» (topic) es como un canal. Si el tema es público, no hace falta nada más. Si tu
// servidor exige acceso, pon un token (Ajustes → Cuenta → Tokens de acceso). Solo lee datos
// (consulta única, no se queda escuchando). No declara `permissions.network`: solo llama a la URL
// de la conexión.

import { ago } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de ntfy", type: "url", required: true, default: "https://ntfy.sh", placeholder: "https://ntfy.sh" },
  { key: "token", label: "Token de acceso (opcional)", type: "secret", help: "Solo si el servidor o el tema requieren login." },
];

const PRIORITY = { 1: "Mínima", 2: "Baja", 3: "Normal", 4: "Alta", 5: "Urgente" };

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "ntfy",
  name: "ntfy",
  version: "0.1.0",
  description: "Los últimos mensajes de tus temas de ntfy, con su prioridad.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/v1/health", { headers: { Accept: "application/json", ...auth(ctx) } });
    if (res.status === 401 || res.status === 403) ctx.fail("ntfy rechazó el token.");
    if (!res.ok) ctx.fail(`ntfy respondió con error ${res.status}`);
    return "Conectado a ntfy";
  },

  widgets: [
    {
      type: "messages",
      name: "Mensajes",
      description: "Los últimos mensajes de uno o varios temas.",
      icon: "📣",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [
        {
          key: "topics",
          label: "Temas",
          type: "list",
          maxItems: 10,
          itemFields: [{ key: "topic", label: "Tema", type: "string", required: true, placeholder: "alertas-casa" }],
        },
        {
          key: "since",
          label: "Desde hace",
          type: "select",
          default: "1d",
          options: [
            { value: "1h", label: "1 hora" },
            { value: "12h", label: "12 horas" },
            { value: "1d", label: "1 día" },
            { value: "3d", label: "3 días" },
            { value: "all", label: "Todo lo que guarde el servidor" },
          ],
        },
        { key: "limit", label: "Cantidad", type: "number", default: 8, min: 1, max: 30 },
      ],

      async load(ctx) {
        const topics = (Array.isArray(ctx.config.topics) ? ctx.config.topics : []).map((t) => String(t.topic ?? "").trim()).filter(Boolean);
        if (topics.length === 0) {
          return { kind: "message", text: "Añade al menos un tema en la configuración del widget (botón de ajustes en modo edición)." };
        }
        for (const t of topics) {
          // Van dentro de la ruta: solo caracteres de un nombre de tema.
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(t)) ctx.fail(`El tema «${t.slice(0, 30)}» no es válido (letras, números, - y _).`);
        }
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const since = ["1h", "12h", "1d", "3d", "all"].includes(ctx.config.since) ? ctx.config.since : "1d";

        const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/${topics.join(",")}/json?poll=1&since=${since}`, {
          headers: { Accept: "application/x-ndjson", ...auth(ctx) },
        });
        if (res.status === 401 || res.status === 403) ctx.fail("ntfy rechazó el acceso: revisa el token y los permisos del tema.");
        if (res.status === 404) ctx.fail("No se encontró ese tema o la URL no es la de ntfy.");
        if (!res.ok) ctx.fail(`ntfy respondió con error ${res.status}`);

        // La respuesta son líneas JSON (una por evento); solo interesan los mensajes.
        const messages = res.text
          .split("\n")
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter((m) => m && m.event === "message")
          .sort((a, b) => Number(b.time) - Number(a.time));

        return {
          kind: "list",
          empty: "No hay mensajes en ese periodo.",
          items: messages.slice(0, limit).map((m) => {
            const p = Number(m.priority) || 3;
            const tags = Array.isArray(m.tags) ? m.tags.slice(0, 3).join(", ") : "";
            return {
              title: String(m.title || m.message || "Mensaje").slice(0, 120),
              subtitle: [topics.length > 1 ? m.topic : "", m.title ? String(m.message ?? "").replace(/\s+/g, " ").slice(0, 140) : "", tags, p !== 3 ? PRIORITY[p] : ""].filter(Boolean).join(" · "),
              right: ago(m.time, { sec: true }) || undefined,
              tone: p >= 5 ? "bad" : p === 4 ? "warn" : "neutral",
            };
          }),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

function auth(ctx) {
  const token = String(ctx.config.token ?? "");
  if (!token) return {};
  if (!/^[A-Za-z0-9._-]{8,200}$/.test(token)) ctx.fail("El token no tiene un formato válido.");
  return { Authorization: `Bearer ${token}` };
}
