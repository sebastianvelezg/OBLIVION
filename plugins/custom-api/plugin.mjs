// Plugin «API personalizada»: conecta cualquier servicio con una API JSON sin escribir un plugin.
//
// Creas una conexión (URL base + autenticación) y, en cada widget, indicas la ruta y qué
// campos del JSON quieres ver. Los campos se eligen con una ruta sencilla como
//   data.users[0].name      ·      stats.disks.length      ·      $.total
//
// Solo hace peticiones GET, solo a la URL de la conexión. La clave se guarda cifrada.
// No ejecuta código: las rutas son solo lectura de propiedades del JSON.

const connection = [
  {
    key: "url",
    label: "URL base de la API",
    type: "url",
    required: true,
    placeholder: "http://192.168.1.10:8080",
    help: "Sin la ruta: la ruta se indica en cada widget.",
  },
  {
    key: "auth",
    label: "Autenticación",
    type: "select",
    default: "none",
    options: [
      { value: "none", label: "Ninguna" },
      { value: "bearer", label: "Token Bearer (Authorization: Bearer …)" },
      { value: "header", label: "Clave en una cabecera (p. ej. X-Api-Key)" },
      { value: "basic", label: "Usuario y contraseña (HTTP básico)" },
    ],
  },
  { key: "headerName", label: "Nombre de la cabecera", type: "string", placeholder: "X-Api-Key", help: "Solo para «Clave en una cabecera»." },
  { key: "username", label: "Usuario", type: "string", help: "Solo para «Usuario y contraseña»." },
  { key: "secret", label: "Token, clave o contraseña", type: "secret" },
];

const FORMATS = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "percent", label: "Porcentaje" },
  { value: "bytes", label: "Tamaño (bytes → GB, TB…)" },
  { value: "duration", label: "Duración (segundos → d h min)" },
  { value: "bool", label: "Sí / No" },
];

// Cabeceras que no se pueden fijar: las gestiona el cliente HTTP.
const BLOCKED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "cookie", "upgrade"]);

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "custom-api",
  name: "API personalizada",
  version: "0.1.0",
  description: "Muestra datos de cualquier API JSON: eliges la ruta y los campos, sin programar.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const res = await request(ctx, "");
    // Cualquier respuesta HTTP significa que el servidor está ahí; 401/403 avisan de la autenticación.
    if (res.status === 401 || res.status === 403) ctx.fail(`El servidor respondió ${res.status}: revisa la autenticación.`);
    return `El servidor responde (HTTP ${res.status})`;
  },

  widgets: [
    {
      type: "values",
      name: "Valores de una API",
      description: "Una cifra por cada campo del JSON que elijas (usuarios, espacio libre, temperatura…).",
      icon: "🧩",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 2 },
      refreshSeconds: 60,
      config: [
        { key: "path", label: "Ruta de la API", type: "string", required: true, placeholder: "/api/stats", help: "Empieza por «/». Se añade a la URL base de la conexión." },
        {
          key: "fields",
          label: "Campos",
          type: "list",
          maxItems: 12,
          itemFields: [
            { key: "label", label: "Etiqueta", type: "string", required: true, placeholder: "Usuarios" },
            { key: "jsonPath", label: "Ruta en el JSON", type: "string", required: true, placeholder: "data.users" },
            { key: "format", label: "Formato", type: "select", default: "text", options: FORMATS },
            { key: "unit", label: "Unidad (opcional)", type: "string", placeholder: "°C" },
          ],
        },
      ],

      async load(ctx) {
        const fields = Array.isArray(ctx.config.fields) ? ctx.config.fields : [];
        if (fields.length === 0) {
          return { kind: "message", text: "Añade al menos un campo en la configuración del widget (botón de ajustes en modo edición)." };
        }
        const json = await getJson(ctx);
        return {
          kind: "stats",
          items: fields.map((f) => ({
            label: String(f.label),
            value: show(pick(json, String(f.jsonPath)), f.format, f.unit),
          })),
        };
      },
    },

    {
      type: "list",
      name: "Lista de una API",
      description: "Filas a partir de una lista del JSON (descargas, dispositivos, tareas…).",
      icon: "📋",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [
        { key: "path", label: "Ruta de la API", type: "string", required: true, placeholder: "/api/items", help: "Empieza por «/». Se añade a la URL base de la conexión." },
        { key: "itemsPath", label: "Ruta de la lista en el JSON", type: "string", placeholder: "data.items", help: "Vacío si la respuesta ya es la lista." },
        { key: "titlePath", label: "Título (ruta dentro de cada elemento)", type: "string", required: true, placeholder: "name" },
        { key: "subtitlePath", label: "Subtítulo (opcional)", type: "string", placeholder: "status" },
        { key: "rightPath", label: "Valor a la derecha (opcional)", type: "string", placeholder: "size" },
        { key: "rightFormat", label: "Formato del valor de la derecha", type: "select", default: "text", options: FORMATS },
        { key: "limit", label: "Máximo de filas", type: "number", default: 10, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 10));
        const json = await getJson(ctx);
        const rootPath = String(ctx.config.itemsPath ?? "").trim();
        const list = rootPath ? pick(json, rootPath) : json;
        if (!Array.isArray(list)) ctx.fail("La ruta de la lista no apunta a una lista en el JSON de la API.");

        const sub = String(ctx.config.subtitlePath ?? "").trim();
        const right = String(ctx.config.rightPath ?? "").trim();
        return {
          kind: "list",
          empty: "La lista está vacía.",
          items: list.slice(0, limit).map((it) => ({
            title: show(pick(it, String(ctx.config.titlePath)), "text"),
            subtitle: sub ? show(pick(it, sub), "text") : undefined,
            right: right ? show(pick(it, right), ctx.config.rightFormat) : undefined,
          })),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── red ─────────────────────────

async function request(ctx, path) {
  const base = String(ctx.config.url).replace(/\/+$/, "");
  const p = String(path ?? "").trim();
  // La ruta se pega a la URL base: debe empezar por «/» o «?» para no poder cambiar de servidor.
  if (p && !/^[/?]/.test(p)) ctx.fail("La ruta de la API debe empezar por «/».");
  if (/[\s\\]/.test(p) || p.startsWith("//")) ctx.fail("La ruta de la API no es válida.");

  const headers = { Accept: "application/json" };
  const secret = String(ctx.config.secret ?? "");
  switch (ctx.config.auth) {
    case "bearer":
      if (!secret) ctx.fail("Falta el token en la conexión.");
      headers.Authorization = `Bearer ${secret}`;
      break;
    case "header": {
      const name = String(ctx.config.headerName ?? "").trim();
      if (!/^[A-Za-z0-9-]{1,60}$/.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) ctx.fail("El nombre de la cabecera no es válido.");
      if (!secret) ctx.fail("Falta la clave en la conexión.");
      headers[name] = secret;
      break;
    }
    case "basic":
      headers.Authorization = "Basic " + Buffer.from(`${ctx.config.username ?? ""}:${secret}`).toString("base64");
      break;
  }
  return ctx.http(base + p, { headers });
}

async function getJson(ctx) {
  const res = await request(ctx, ctx.config.path);
  if (res.status === 401 || res.status === 403) ctx.fail(`La API rechazó la petición (${res.status}): revisa la autenticación de la conexión.`);
  if (res.status === 404) ctx.fail("La API no tiene esa ruta (404). Revisa la ruta del widget.");
  if (!res.ok) ctx.fail(`La API respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La API no respondió con JSON.");
  }
}

// ───────────────────────── rutas JSON ─────────────────────────

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Lee `a.b[0].c` de un valor JSON. `length` funciona en listas y textos. Devuelve `undefined` si no existe. */
function pick(value, path) {
  const tokens = String(path).trim().replace(/^\$\.?/, "").match(/[^.[\]]+/g) ?? [];
  let cur = value;
  for (const t of tokens) {
    if (cur === null || cur === undefined || FORBIDDEN.has(t)) return undefined;
    if (t === "length" && (Array.isArray(cur) || typeof cur === "string")) {
      cur = cur.length;
    } else if (Array.isArray(cur)) {
      if (!/^\d+$/.test(t)) return undefined;
      cur = cur[Number(t)];
    } else if (typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, t)) {
      cur = cur[t];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ───────────────────────── formato ─────────────────────────

function show(v, format = "text", unit = "") {
  if (v === undefined || v === null) return "—";
  const u = unit ? ` ${unit}` : "";
  const num = Number(v);
  switch (format) {
    case "number":
      return Number.isFinite(num) ? `${num.toLocaleString("es", { maximumFractionDigits: 2 })}${u}` : "—";
    case "percent":
      return Number.isFinite(num) ? `${num.toLocaleString("es", { maximumFractionDigits: 1 })}%` : "—";
    case "bytes":
      return Number.isFinite(num) ? bytes(num) : "—";
    case "duration":
      return Number.isFinite(num) ? duration(num) : "—";
    case "bool":
      return v === true || v === "true" || v === 1 ? "Sí" : v === false || v === "false" || v === 0 ? "No" : "—";
    default: {
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return (s.length > 120 ? s.slice(0, 117) + "…" : s) + u;
    }
  }
}

function bytes(x) {
  if (x < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, x)) / Math.log(1024)));
  const v = x / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function duration(s) {
  if (s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(s)} s`;
}
