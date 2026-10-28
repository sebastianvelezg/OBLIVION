// Plugin de Paperless-ngx: documentos totales, bandeja de entrada y últimos documentos.
//
// Autenticación: un token de API (Paperless → tu usuario → «Mi perfil» → token) o, si
// prefieres, tu usuario y contraseña. No declara `permissions.network`.

const connection = [
  { key: "url", label: "URL de Paperless-ngx", type: "url", required: true, placeholder: "http://192.168.1.10:8000" },
  {
    key: "username",
    label: "Usuario (solo si no usas token)",
    type: "string",
    help: "Déjalo vacío para autenticar con un token de API.",
  },
  {
    key: "secret",
    label: "Token de API (o contraseña si pones usuario)",
    type: "secret",
    required: true,
    help: "Mi perfil → «Token de API».",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "paperless",
  name: "Paperless-ngx",
  version: "0.1.0",
  description: "Cuántos documentos tienes en Paperless-ngx, cuántos hay en la bandeja de entrada y los últimos añadidos.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await get(ctx, "/api/statistics/?format=json");
    return `Conectado: ${Number(s.documents_total ?? 0).toLocaleString("es")} documentos`;
  },

  widgets: [
    {
      type: "stats",
      name: "Documentos",
      description: "Total de documentos, los de la bandeja de entrada y los tipos de archivo.",
      icon: "🗂️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [],

      async load(ctx) {
        const s = await get(ctx, "/api/statistics/?format=json");
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        const inbox = Number(s.documents_inbox ?? 0);
        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Documentos", value: n(s.documents_total) },
                { label: "En la bandeja", value: n(s.documents_inbox), tone: inbox > 0 ? "warn" : "good", hint: s.inbox_tag ? `etiqueta ${s.inbox_tag}` : undefined },
                ...(s.character_count != null ? [{ label: "Caracteres", value: n(s.character_count) }] : []),
              ],
            },
          },
        ];
        const types = Array.isArray(s.document_file_type_counts) ? s.document_file_type_counts : [];
        if (types.length > 0) {
          const total = types.reduce((a, t) => a + Number(t.mime_type_count || 0), 0) || 1;
          sections.push({
            title: "Tipos de archivo",
            view: {
              kind: "list",
              items: [...types]
                .sort((a, b) => Number(b.mime_type_count) - Number(a.mime_type_count))
                .slice(0, 6)
                .map((t) => ({
                  title: String(t.mime_type).replace(/^application\//, "").replace(/^image\//, "imagen ").toUpperCase(),
                  right: n(t.mime_type_count),
                  progress: Number(t.mime_type_count) / total,
                })),
            },
          });
        }
        return { kind: "sections", sections };
      },
    },

    {
      type: "inbox",
      name: "Bandeja de entrada",
      description: "Los documentos que esperan en la bandeja de entrada para clasificarlos.",
      icon: "📥",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [{ key: "limit", label: "Máximo de filas", type: "number", default: 8, min: 1, max: 30 }],

      async load(ctx) {
        const limit = Math.min(30, Math.max(1, Number(ctx.config.limit) || 8));
        const d = await get(ctx, `/api/documents/?is_in_inbox=true&ordering=-created&page_size=${limit}&fields=id,title,created,added`);
        const docs = Array.isArray(d.results) ? d.results : [];
        return {
          kind: "list",
          empty: "La bandeja de entrada está vacía.",
          items: docs.slice(0, limit).map((x) => ({
            title: String(x.title || `Documento ${x.id}`),
            subtitle: x.created ? new Date(x.created).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : undefined,
          })),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const secret = String(ctx.config.secret ?? "");
  if (!secret) ctx.fail("Falta el token (o la contraseña) en la conexión.");
  const user = String(ctx.config.username ?? "").trim();
  const headers = { Accept: "application/json" };
  if (user) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
  } else {
    if (!/^[A-Za-z0-9]{20,100}$/.test(secret)) ctx.fail("El token de API no tiene un formato válido.");
    headers.Authorization = `Token ${secret}`;
  }
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { headers });
  if (res.status === 401 || res.status === 403) ctx.fail("Paperless-ngx rechazó el token (o el usuario y la contraseña).");
  if (res.status === 404) ctx.fail("No se encontró la API de Paperless-ngx. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Paperless-ngx respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Paperless-ngx.");
  }
}
