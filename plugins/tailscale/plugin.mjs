// Plugin de Tailscale: qué dispositivos de tu red (tailnet) están conectados.
//
// Clave de API: https://login.tailscale.com/admin/settings/keys → «Generate access token…»
// (o una clave de API, que caduca a los 90 días como máximo). Solo se leen datos.
//
// La API de Tailscale es un servicio público fijo, así que este plugin declara ese único
// host en `permissions.network` y no llama a ningún otro.

const connection = [
  {
    key: "apiKey",
    label: "Clave de API de Tailscale",
    type: "secret",
    required: true,
    placeholder: "tskey-api-…",
    help: "login.tailscale.com → Settings → Keys.",
  },
  {
    key: "tailnet",
    label: "Tailnet",
    type: "string",
    default: "-",
    help: "Déjalo en «-» para usar el de tu clave, o escribe el nombre de tu tailnet.",
  },
];

const API = "https://api.tailscale.com/api/v2";

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "tailscale",
  name: "Tailscale",
  version: "0.1.0",
  description: "Dispositivos de tu tailnet: cuáles están en línea, su sistema y su dirección.",
  author: "Oblivion",
  permissions: { network: ["api.tailscale.com"] },
  connection,

  async test(ctx) {
    const devices = await listDevices(ctx);
    const online = devices.filter(isOnline).length;
    return `Conectado: ${online} de ${devices.length} dispositivos en línea`;
  },

  widgets: [
    {
      type: "devices",
      name: "Dispositivos",
      description: "Los dispositivos de tu Tailscale, con su estado en línea.",
      icon: "🔗",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      // Tailscale limita las consultas: no hace falta preguntar a menudo.
      refreshSeconds: 120,
      // No hay URL de interfaz web en la conexión; el enlace se puede poner a mano.
      openLink: false,
      config: [
        {
          key: "show",
          label: "Qué mostrar",
          type: "select",
          default: "all",
          options: [
            { value: "all", label: "Todos los dispositivos" },
            { value: "online", label: "Solo los que están en línea" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const all = await listDevices(ctx);
        const online = all.filter(isOnline).length;
        const updates = all.filter((d) => d.updateAvailable).length;

        let rows = all;
        if (ctx.config.show === "online") rows = all.filter(isOnline);
        // En línea primero, luego por nombre.
        rows = [...rows].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || label(a).localeCompare(label(b), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "En línea", value: String(online), tone: "good" },
                  { label: "Total", value: String(all.length) },
                  { label: "Con actualización", value: String(updates), tone: updates > 0 ? "warn" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: "No hay dispositivos.",
                items: rows.slice(0, limit).map((d) => {
                  const on = isOnline(d);
                  const expired = d.keyExpiryDisabled === false && Date.parse(d.expires) < Date.now();
                  return {
                    title: label(d),
                    subtitle: [d.addresses?.[0], d.os, d.clientVersion ? `v${String(d.clientVersion).split("-")[0]}` : ""].filter(Boolean).join(" · "),
                    right: expired ? "Clave caducada" : on ? "En línea" : ago(d.lastSeen),
                    tone: expired ? "warn" : on ? "good" : "neutral",
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

async function listDevices(ctx) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(key)) ctx.fail("La clave de API de Tailscale no tiene un formato válido.");
  const tailnet = String(ctx.config.tailnet || "-").trim();
  // Va dentro de la ruta: solo caracteres de un nombre de tailnet.
  if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(tailnet)) ctx.fail("El nombre del tailnet no es válido.");

  const res = await ctx.http(`${API}/tailnet/${encodeURIComponent(tailnet)}/devices`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) ctx.fail("Tailscale rechazó la clave de API (¿caducó?).");
  if (res.status === 403) ctx.fail("La clave de API no tiene permiso para ver los dispositivos.");
  if (res.status === 404) ctx.fail("No se encontró ese tailnet. Prueba con «-».");
  if (!res.ok) ctx.fail(`Tailscale respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("Tailscale respondió con un formato inesperado.");
  }
  return Array.isArray(body?.devices) ? body.devices : [];
}

const label = (d) => String(d.hostname || String(d.name ?? "").split(".")[0] || "dispositivo");

/** `connectedToControl` es el dato directo; si no viene, se considera en línea lo visto hace < 5 min. */
function isOnline(d) {
  if (typeof d.connectedToControl === "boolean") return d.connectedToControl;
  const t = Date.parse(d.lastSeen);
  return Number.isFinite(t) && Date.now() - t < 5 * 60_000;
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Sin conexión";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
