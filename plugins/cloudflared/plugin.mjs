// Plugin de Cloudflare Tunnel: estado de uno de tus túneles.
//
// Token de API: Cloudflare → Mi perfil → Tokens de API → «Crear token personalizado» con el
// permiso «Cuenta · Cloudflare Tunnel · Lectura». El ID de la cuenta y el del túnel están en
// el panel Zero Trust → Redes → Túneles. Solo lee datos.
//
// La API de Cloudflare es un servicio público fijo, así que este plugin declara ese único host en
// `permissions.network` y no llama a ningún otro.

import { ago } from "../_shared/fmt.mjs";

const connection = [
  { key: "token", label: "Token de API de Cloudflare", type: "secret", required: true, help: "Permiso: Cuenta · Cloudflare Tunnel · Lectura." },
  { key: "accountId", label: "ID de la cuenta", type: "string", required: true, placeholder: "a1b2c3d4…" },
  { key: "tunnelId", label: "ID del túnel", type: "string", required: true, placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
];

const API = "https://api.cloudflare.com/client/v4";

const STATUS = {
  healthy: ["Activo", "good"],
  degraded: ["Degradado", "warn"],
  down: ["Caído", "bad"],
  inactive: ["Inactivo", "bad"],
};

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "cloudflared",
  name: "Cloudflare Tunnel",
  version: "0.1.0",
  description: "Estado de un túnel de Cloudflare: si está activo, cuántas conexiones tiene y desde qué centros.",
  author: "Oblivion",
  permissions: { network: ["api.cloudflare.com"] },
  connection,

  async test(ctx) {
    const t = await tunnel(ctx);
    return `Conectado: túnel «${String(t.name ?? "sin nombre")}» (${(STATUS[t.status] ?? [String(t.status)])[0]})`;
  },

  widgets: [
    {
      type: "tunnel",
      name: "Túnel",
      description: "Si el túnel está activo, sus conexiones activas y los centros de datos de Cloudflare a los que llega.",
      icon: "☁️",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      // No hay URL de interfaz web en la conexión; el enlace se puede poner a mano.
      openLink: false,
      config: [],

      async load(ctx) {
        const t = await tunnel(ctx);
        const conns = await get(ctx, `/connections`).catch(() => []);
        const list = (Array.isArray(conns) ? conns : []).flatMap((c) => c.conns ?? []);
        const colos = [...new Set(list.map((c) => c.colo_name).filter(Boolean))];
        const [text, tone] = STATUS[t.status] ?? [String(t.status ?? "Desconocido"), "neutral"];
        const origin = list.find((c) => c.origin_ip)?.origin_ip;
        const items = [
          { label: "Estado", value: text, tone, hint: String(t.name ?? "") || undefined },
          { label: "Conexiones", value: String(list.length), tone: list.length === 0 ? "bad" : "neutral" },
        ];
        if (colos.length > 0) items.push({ label: "Centros", value: colos.slice(0, 4).join(", "), hint: colos.length > 4 ? `+${colos.length - 4}` : undefined });
        if (origin) items.push({ label: "Origen", value: String(origin) });
        if (t.conns_active_at) items.push({ label: "Activo desde", value: ago(t.conns_active_at).replace("hace ", "") || "—" });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const ID = /^[A-Za-z0-9-]{16,64}$/;

async function get(ctx, suffix) {
  const token = String(ctx.config.token ?? "");
  const account = String(ctx.config.accountId ?? "").trim();
  const tunnelId = String(ctx.config.tunnelId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) ctx.fail("El token de API de Cloudflare no tiene un formato válido.");
  // Van dentro de la ruta: solo caracteres de un identificador.
  if (!ID.test(account)) ctx.fail("El ID de la cuenta no es válido.");
  if (!ID.test(tunnelId)) ctx.fail("El ID del túnel no es válido.");
  const res = await ctx.http(`${API}/accounts/${account}/cfd_tunnel/${tunnelId}${suffix}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Cloudflare rechazó el token (¿tiene el permiso de lectura de túneles?).");
  if (res.status === 404) ctx.fail("Cloudflare no encuentra ese túnel. Revisa el ID de la cuenta y el del túnel.");
  if (!res.ok) ctx.fail(`Cloudflare respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("Cloudflare respondió con un formato inesperado.");
  }
  if (body?.success === false) ctx.fail(String(body.errors?.[0]?.message ?? "Cloudflare devolvió un error").slice(0, 100));
  return body?.result;
}

async function tunnel(ctx) {
  const t = await get(ctx, "");
  if (!t || typeof t !== "object") ctx.fail("Cloudflare no devolvió datos del túnel.");
  return t;
}
