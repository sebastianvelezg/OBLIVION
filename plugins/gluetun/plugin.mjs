// Plugin de Gluetun (https://github.com/qdm12/gluetun): estado de tu VPN.
//
// Gluetun tiene un servidor de control HTTP (puerto 8000 por defecto). Si lo protegiste con
// una clave de API en su `config.toml`, ponla en la conexión; si dejaste esas rutas con
// `auth = "none"`, no hace falta. Las rutas necesarias son:
//   GET /v1/publicip/ip   ·   GET /v1/vpn/status   ·   GET /v1/portforward (opcional)
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL del control de Gluetun", type: "url", required: true, placeholder: "http://192.168.1.10:8000" },
  { key: "apiKey", label: "API key (opcional)", type: "secret", help: "Solo si configuraste autenticación por clave en Gluetun." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "gluetun",
  name: "Gluetun (VPN)",
  version: "0.1.0",
  description: "Estado de tu VPN con Gluetun: si está activa, tu IP pública y el puerto reenviado.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const ip = await get(ctx, "/v1/publicip/ip");
    return `Conectado: IP pública ${String(ip.public_ip ?? "desconocida")}`;
  },

  widgets: [
    {
      type: "status",
      name: "Estado de la VPN",
      description: "Si la VPN está activa, la IP pública, el país y el puerto reenviado.",
      icon: "🛡️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [],

      async load(ctx) {
        const ip = await get(ctx, "/v1/publicip/ip");
        // Datos extra (según la versión de Gluetun): si fallan, simplemente no se muestran.
        const vpn = await first(ctx, ["/v1/vpn/status", "/v1/openvpn/status"]);
        const port = await first(ctx, ["/v1/portforward", "/v1/openvpn/portforwarded"]);

        const status = String(vpn?.status ?? "").toLowerCase();
        const where = [ip.city, ip.region, ip.country].filter((x) => typeof x === "string" && x).join(", ");
        const items = [];
        if (status) {
          items.push({
            label: "VPN",
            value: status === "running" ? "Activa" : status === "stopped" ? "Detenida" : status,
            tone: status === "running" ? "good" : "bad",
          });
        }
        items.push({ label: "IP pública", value: String(ip.public_ip ?? "—") });
        if (where) items.push({ label: "Ubicación", value: where });
        if (Number(port?.port) > 0) items.push({ label: "Puerto reenviado", value: String(port.port) });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const headers = { Accept: "application/json" };
  const key = String(ctx.config.apiKey ?? "");
  if (key) {
    if (!/^[A-Za-z0-9_+/=.-]{4,200}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
    headers["X-API-Key"] = key;
  }
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { headers });
  if (res.status === 401 || res.status === 403) {
    ctx.fail("Gluetun rechazó la petición: revisa la API key y que la ruta esté permitida en su config.toml.");
  }
  if (res.status === 404) ctx.fail("No se encontró esa ruta en Gluetun. ¿La URL es la del servidor de control (puerto 8000)?");
  if (!res.ok) ctx.fail(`Gluetun respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece el servidor de control de Gluetun.");
  }
}

/** Primera ruta que responda bien (cambian entre versiones de Gluetun); `null` si ninguna. */
async function first(ctx, paths) {
  for (const p of paths) {
    try {
      return await get(ctx, p);
    } catch {
      /* probar la siguiente */
    }
  }
  return null;
}
