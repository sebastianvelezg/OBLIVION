// Plugin de Nextcloud: usuarios activos, archivos, espacio libre y carga del servidor.
//
// Usa la app «Información del servidor» (serverinfo) de Nextcloud, que exige una cuenta de
// **administrador**. Dos formas de autenticar:
//   · Token de serverinfo (Administración → Información del sistema → Token de autenticación).
//   · Usuario y «contraseña de aplicación» (Seguridad → Dispositivos y sesiones). No uses tu
//     contraseña real: crea una contraseña de aplicación solo para Oblivion.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Nextcloud", type: "url", required: true, placeholder: "https://nube.casa" },
  {
    key: "username",
    label: "Usuario (solo si usas contraseña de aplicación)",
    type: "string",
    help: "Déjalo vacío si usas el token de la app «Información del sistema».",
  },
  {
    key: "secret",
    label: "Token (o contraseña de aplicación si pones usuario)",
    type: "secret",
    required: true,
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "nextcloud",
  name: "Nextcloud",
  version: "0.1.0",
  description: "Usuarios activos, archivos, espacio libre y estado del servidor de Nextcloud.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const d = await info(ctx);
    return `Conectado a Nextcloud ${d.nextcloud?.system?.version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "server",
      name: "Servidor",
      description: "Usuarios activos, archivos compartidos, espacio libre, memoria y carga de Nextcloud.",
      icon: "☁️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      config: [],

      async load(ctx) {
        const d = await info(ctx);
        const sys = d.nextcloud?.system ?? {};
        const st = d.nextcloud?.storage ?? {};
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        const items = [];
        if (d.activeUsers?.last24hours !== undefined) {
          items.push({ label: "Activos (24 h)", value: n(d.activeUsers.last24hours), hint: `${n(d.activeUsers.last5minutes)} ahora` });
        }
        if (st.num_users !== undefined) items.push({ label: "Usuarios", value: n(st.num_users) });
        if (st.num_files !== undefined) items.push({ label: "Archivos", value: n(st.num_files) });
        if (d.nextcloud?.shares?.num_shares !== undefined) items.push({ label: "Compartidos", value: n(d.nextcloud.shares.num_shares) });
        if (Number.isFinite(Number(sys.freespace))) items.push({ label: "Espacio libre", value: bytes(Number(sys.freespace)) });
        const total = Number(sys.mem_total);
        const free = Number(sys.mem_free);
        if (total > 0 && Number.isFinite(free)) {
          const used = ((total - free) / total) * 100;
          items.push({ label: "Memoria", value: `${Math.round(used)}%`, tone: used > 90 ? "bad" : used > 80 ? "warn" : "good" });
        }
        const load = Array.isArray(sys.cpuload) ? Number(sys.cpuload[0]) : NaN;
        if (Number.isFinite(load)) items.push({ label: "Carga (1 min)", value: load.toFixed(2) });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function info(ctx) {
  const secret = String(ctx.config.secret ?? "");
  if (!secret) ctx.fail("Falta el token (o la contraseña de aplicación) en la conexión.");
  const user = String(ctx.config.username ?? "").trim();
  const headers = { Accept: "application/json", "OCS-APIRequest": "true" };
  if (user) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
  } else {
    if (!/^[A-Za-z0-9_.-]{8,200}$/.test(secret)) ctx.fail("El token no tiene un formato válido.");
    headers["NC-Token"] = secret;
  }
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json`, { headers });
  if (res.status === 401 || res.status === 403) ctx.fail("Nextcloud rechazó las credenciales (la app «Información del sistema» exige un administrador).");
  if (res.status === 404 || res.status === 997) ctx.fail("No se encontró la API de Información del sistema. ¿Está instalada y activa la app «serverinfo»?");
  if (!res.ok) ctx.fail(`Nextcloud respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Nextcloud.");
  }
  const code = Number(body?.ocs?.meta?.statuscode);
  if (code === 997 || code === 401) ctx.fail("Nextcloud rechazó las credenciales.");
  if (!body?.ocs?.data) ctx.fail("Nextcloud respondió con un formato inesperado.");
  return body.ocs.data;
}

function bytes(x) {
  if (!Number.isFinite(x) || x < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, x)) / Math.log(1024)));
  const v = x / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
