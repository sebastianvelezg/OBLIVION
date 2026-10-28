// Plugin de Jellyseerr / Overseerr: solicitudes de películas y series.
//
// API key: Jellyseerr → Ajustes → General → «Clave de API». Es de solo lectura para este
// widget. No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Jellyseerr", type: "url", required: true, placeholder: "http://192.168.1.10:5055" },
  { key: "apiKey", label: "API key", type: "secret", required: true, help: "Ajustes → General → Clave de API." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "jellyseerr",
  name: "Jellyseerr",
  version: "0.1.0",
  description: "Solicitudes pendientes y recientes de Jellyseerr (también funciona con Overseerr).",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const me = await get(ctx, "/api/v1/auth/me");
    return `Conectado como ${me.displayName || me.email || me.username || "usuario"}`;
  },

  widgets: [
    {
      type: "requests",
      name: "Solicitudes",
      description: "Cuántas solicitudes hay pendientes, aprobadas y disponibles, y las últimas que llegaron.",
      icon: "🎟️",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [{ key: "limit", label: "Cantidad de solicitudes recientes", type: "number", default: 5, min: 1, max: 10 }],

      async load(ctx) {
        const limit = Math.min(10, Math.max(1, Number(ctx.config.limit) || 5));
        const [count, recent] = await Promise.all([
          get(ctx, "/api/v1/request/count"),
          get(ctx, `/api/v1/request?take=${limit}&skip=0&sort=added`),
        ]);

        const results = Array.isArray(recent.results) ? recent.results.slice(0, limit) : [];
        // La solicitud solo trae el id de TMDB: los títulos se piden aparte (si alguno falla, se muestra sin título).
        const titles = await Promise.all(results.map((r) => details(ctx, r)));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Pendientes", value: String(count.pending ?? 0), tone: Number(count.pending) > 0 ? "warn" : "neutral" },
                  { label: "Procesando", value: String(count.processing ?? 0) },
                  { label: "Disponibles", value: String(count.available ?? 0), tone: "good" },
                  { label: "Total", value: String(count.total ?? 0) },
                ],
              },
            },
            {
              title: "Recientes",
              view: {
                kind: "list",
                empty: "Todavía no hay solicitudes.",
                items: results.map((r, i) => {
                  const st = status(r);
                  const who = r.requestedBy?.displayName || r.requestedBy?.username || r.requestedBy?.email;
                  return {
                    title: titles[i] || (r.type === "tv" ? "Serie" : "Película"),
                    subtitle: [r.type === "tv" ? "Serie" : "Película", who, ago(r.createdAt)].filter(Boolean).join(" · "),
                    right: st.text,
                    tone: st.tone,
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

function headers(ctx) {
  if (!/^[A-Za-z0-9+/=_-]{8,200}$/.test(String(ctx.config.apiKey ?? ""))) ctx.fail("La API key no tiene un formato válido.");
  return { Accept: "application/json", "X-Api-Key": ctx.config.apiKey };
}

async function get(ctx, path) {
  const res = await ctx.http(base(ctx) + path, { headers: headers(ctx) });
  if (res.status === 401 || res.status === 403) ctx.fail("Jellyseerr rechazó la API key.");
  if (res.status === 404) ctx.fail("No se encontró la API de Jellyseerr. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Jellyseerr respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Jellyseerr.");
  }
}

/** Título (y año) de una solicitud, o `undefined` si no se pudo obtener. */
async function details(ctx, r) {
  const id = Number(r.media?.tmdbId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  try {
    const d = await get(ctx, `/api/v1/${r.type === "tv" ? "tv" : "movie"}/${id}`);
    const name = d.title || d.name;
    const year = String(d.releaseDate || d.firstAirDate || "").slice(0, 4);
    return name ? (year ? `${name} (${year})` : String(name)) : undefined;
  } catch {
    return undefined;
  }
}

/** Estados de Overseerr: solicitud 1 pendiente, 2 aprobada, 3 rechazada; media 3 procesando, 4 parcial, 5 disponible. */
function status(r) {
  if (r.status === 3) return { text: "Rechazada", tone: "bad" };
  if (r.status === 1) return { text: "Pendiente", tone: "warn" };
  const m = r.media?.status;
  if (m === 5) return { text: "Disponible", tone: "good" };
  if (m === 4) return { text: "Parcial", tone: "good" };
  if (m === 3) return { text: "Procesando", tone: "neutral" };
  return { text: "Aprobada", tone: "neutral" };
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
