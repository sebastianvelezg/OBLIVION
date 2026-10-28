// Plugin de Speedtest Tracker (https://github.com/alexjustesen/speedtest-tracker, antes de
// henrywhitaker3/speedtest-tracker): velocidad de tu conexión y su historial.
//
// Dos versiones de la API:
//   · «Antigua»: henrywhitaker3/speedtest-tracker y alexjustesen < 1.2.1. Sin autenticación.
//   · «Nueva»:   alexjustesen ≥ 1.2.1 (imagen de linuxserver). Requiere un token de API con
//                el permiso «Read Results» (se crea en /admin/api-tokens).
//
// No declara `permissions.network`: solo llama a la URL que escribas en la conexión, que
// se crea una vez y comparten todos los widgets de Speedtest Tracker.

/** Conexión compartida por todos los widgets de Speedtest Tracker. */
const connection = [
  {
    key: "url",
    label: "URL de Speedtest Tracker",
    type: "url",
    required: true,
    placeholder: "http://192.168.1.10:8765",
  },
  {
    key: "version",
    label: "Versión de la API",
    type: "select",
    default: "1",
    options: [
      { value: "1", label: "Antigua (henrywhitaker3 / alexjustesen < 1.2.1)" },
      { value: "2", label: "Nueva (alexjustesen ≥ 1.2.1, requiere token)" },
    ],
  },
  {
    key: "apiKey",
    label: "Token de API",
    type: "secret",
    help: "Solo para la versión nueva: /admin/api-tokens → crea un token con «Read Results».",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "speedtest",
  name: "Speedtest Tracker",
  version: "0.2.0",
  description: "Velocidad de descarga, subida y latencia de tu conexión, medida por Speedtest Tracker.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const r = await fetchLatest(ctx);
    if (!r) return "Conectado, pero todavía no hay ningún test";
    const d = fmtSpeed(r.download);
    return `Conectado: último test ${d.value} ${d.unit} (${ago(r.createdAt)})`;
  },

  widgets: [
    {
      type: "latest",
      name: "Último test de velocidad",
      description: "Descarga, subida y ping del test más reciente.",
      icon: "⚡",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [],

      async load(ctx) {
        const r = await fetchLatest(ctx);
        if (!r) return { kind: "message", text: "Speedtest Tracker todavía no tiene ningún test." };
        if (r.status && r.status !== "completed") {
          return {
            kind: "message",
            tone: r.status === "failed" ? "bad" : "warn",
            text: `El último test está en estado «${r.status}».`,
          };
        }

        const down = fmtSpeed(r.download);
        return {
          kind: "metric",
          icon: "⚡",
          value: down.value,
          unit: `${down.unit} ↓`,
          caption: ["Último test", r.server].filter(Boolean).join(" · "),
          rows: [
            { label: "Subida", value: `${fmtSpeed(r.upload).value} ${fmtSpeed(r.upload).unit}` },
            { label: "Ping", value: `${round(r.ping)} ms` },
            { label: "Hace", value: ago(r.createdAt) },
          ],
        };
      },
    },

    {
      type: "history",
      name: "Historial de velocidad",
      description: "Los últimos tests, para ver si tu conexión se degrada. Solo versión nueva.",
      icon: "📈",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [
        {
          key: "mode",
          label: "Cómo mostrarlo",
          type: "select",
          default: "chart",
          options: [
            { value: "chart", label: "Gráfica de líneas" },
            { value: "list", label: "Lista" },
          ],
        },
        { key: "limit", label: "Cantidad", type: "number", default: 12, min: 3, max: 25 },
      ],

      async load(ctx) {
        if (ctx.config.version !== "2") {
          ctx.fail("El historial necesita la versión nueva de Speedtest Tracker (elige «Nueva» y añade el token).");
        }
        const limit = Math.min(25, Math.max(3, Number(ctx.config.limit) || 8));
        const body = await api(ctx, `/api/v1/results?per_page=${limit}&sort=-created_at`);
        const rows = (Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [])
          .slice(0, limit)
          .map(normalizeV2);

        // Los widgets creados antes de que existiera la gráfica (sin `mode`) pasan a verla.
        if (ctx.config.mode !== "list") {
          const ok = rows.filter((r) => !(r.status && r.status !== "completed")).reverse(); // de antiguo a reciente
          if (ok.length < 2) return { kind: "message", text: "Hacen falta al menos dos tests para dibujar la gráfica." };
          const pings = ok.map((r) => r.ping).filter(Number.isFinite);
          const avgPing = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : undefined;
          const short = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          return {
            kind: "chart",
            unit: "Mbps",
            labels: ok.map((r) => (Number.isFinite(Date.parse(r.createdAt)) ? short.format(new Date(r.createdAt)) : "")),
            series: [
              { name: "Descarga", points: ok.map((r) => round1(r.download)) },
              { name: "Subida", points: ok.map((r) => round1(r.upload)) },
            ],
            caption: [`${ok.length} tests`, avgPing !== undefined ? `ping medio ${avgPing} ms` : ""].filter(Boolean).join(" · "),
          };
        }

        const maxDown = Math.max(1, ...rows.map((r) => r.download || 0));
        return {
          kind: "list",
          empty: "Aún no hay tests.",
          items: rows.map((r) => {
            const failed = r.status && r.status !== "completed";
            const d = fmtSpeed(r.download);
            const u = fmtSpeed(r.upload);
            return {
              title: failed ? `Test ${r.status}` : `↓ ${d.value} ${d.unit}  ·  ↑ ${u.value} ${u.unit}`,
              subtitle: ago(r.createdAt),
              right: failed ? undefined : `${round(r.ping)} ms`,
              progress: failed ? undefined : Math.min(1, (r.download || 0) / maxDown),
              tone: failed ? "bad" : "neutral",
            };
          }),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");

async function api(ctx, path) {
  const v2 = ctx.config.version === "2";
  const key = String(ctx.config.apiKey ?? "");
  if (v2 && !/^[A-Za-z0-9|_-]{8,200}$/.test(key)) {
    ctx.fail("Falta el token de API (o no es válido). Créalo en /admin/api-tokens con el permiso «Read Results».");
  }
  const res = await ctx.http(base(ctx) + path, {
    headers: v2 ? { Accept: "application/json", Authorization: `Bearer ${key}` } : { Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    ctx.fail(v2 ? "Speedtest Tracker rechazó el token (¿tiene el permiso «Read Results»?)." : "Speedtest Tracker pide autenticación: prueba con la versión «Nueva».");
  }
  if (res.status === 404) {
    ctx.fail(v2 ? "No se encontró la API /api/v1. ¿Seguro que es la versión nueva?" : "No se encontró la API antigua. ¿Es la versión nueva? Cambia la opción de versión.");
  }
  if (!res.ok) ctx.fail(`Speedtest Tracker respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Speedtest Tracker.");
  }
}

/** Devuelve el último test normalizado a Mbps, o null si no hay ninguno. */
async function fetchLatest(ctx) {
  if (ctx.config.version === "2") {
    const body = await api(ctx, "/api/v1/results/latest");
    // La API documenta el resultado sin envoltorio; algunas versiones lo envuelven en {data}.
    const raw = hasSpeed(body?.data) ? body.data : body;
    return hasSpeed(raw) ? normalizeV2(raw) : null;
  }
  const body = await api(ctx, "/api/speedtest/latest");
  const r = body?.data;
  if (!r || r.download == null) return null;
  // API antigua: valores ya en Mbps.
  return {
    download: Number(r.download),
    upload: Number(r.upload),
    ping: Number(r.ping),
    createdAt: r.created_at,
    status: undefined,
    server: undefined,
  };
}

const hasSpeed = (o) => !!o && typeof o === "object" && ("download_bits" in o || "download" in o);

/** API nueva: `download_bits` / `upload_bits` son bits por segundo → Mbps. */
function normalizeV2(r) {
  const mbps = (bits, bytes) => (bits != null ? Number(bits) / 1e6 : Number(bytes) * 8 / 1e6);
  return {
    download: mbps(r.download_bits, r.download),
    upload: mbps(r.upload_bits, r.upload),
    ping: Number(r.ping),
    createdAt: r.created_at,
    status: r.status,
    server: r.data?.server?.name,
  };
}

const round = (n) => (Number.isFinite(n) ? Math.round(n) : "—");
const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

function fmtSpeed(mbps) {
  if (!Number.isFinite(mbps)) return { value: "—", unit: "Mbps" };
  if (mbps >= 1000) return { value: (mbps / 1000).toFixed(2), unit: "Gbps" };
  return { value: mbps >= 100 ? String(Math.round(mbps)) : mbps.toFixed(1), unit: "Mbps" };
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "un momento";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
