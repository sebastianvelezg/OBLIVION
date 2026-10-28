// Plugin de Komga: bibliotecas, series, libros y lo último añadido.
//
// Autenticación: una API key de Komga (Ajustes de la cuenta → Claves de API) o tu usuario y
// contraseña. No declara `permissions.network`: solo llama a la URL de la conexión.

import { ago } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Komga", type: "url", required: true, placeholder: "http://192.168.1.10:25600" },
  { key: "username", label: "Usuario (solo si no usas API key)", type: "string" },
  {
    key: "secret",
    label: "API key (o contraseña si pones usuario)",
    type: "secret",
    required: true,
    help: "Ajustes de la cuenta → Claves de API.",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "komga",
  name: "Komga",
  version: "0.1.0",
  description: "Cuántas bibliotecas, series y libros tienes en Komga, y las series añadidas más recientemente.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const libs = await get(ctx, "/api/v1/libraries");
    return `Conectado: ${Array.isArray(libs) ? libs.length : 0} bibliotecas`;
  },

  widgets: [
    {
      type: "library",
      name: "Biblioteca",
      description: "Bibliotecas, series y libros de Komga, y lo último añadido.",
      icon: "📖",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "limit", label: "Últimas series a mostrar (0 = ninguna)", type: "number", default: 5, min: 0, max: 20 }],

      async load(ctx) {
        const limit = Math.min(20, Math.max(0, Number(ctx.config.limit) || 0));
        const [libs, series, books] = await Promise.all([get(ctx, "/api/v1/libraries"), total(ctx, "series"), total(ctx, "books")]);
        const n = (v) => Number(v ?? 0).toLocaleString("es");
        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Bibliotecas", value: n(Array.isArray(libs) ? libs.length : 0) },
                { label: "Series", value: n(series) },
                { label: "Libros", value: n(books) },
              ],
            },
          },
        ];
        if (limit > 0) {
          try {
            const r = await get(ctx, `/api/v1/series/latest?size=${limit}`);
            const list = Array.isArray(r.content) ? r.content : [];
            if (list.length > 0) {
              sections.push({
                title: "Añadido recientemente",
                view: {
                  kind: "list",
                  items: list.slice(0, limit).map((s) => ({
                    title: String(s.metadata?.title ?? s.name ?? "Serie"),
                    subtitle: s.booksCount !== undefined ? `${s.booksCount} libro${s.booksCount === 1 ? "" : "s"}` : undefined,
                    right: ago(s.lastModified ?? s.created) || undefined,
                  })),
                },
              });
            }
          } catch {
            /* sin lista */
          }
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function request(ctx, method, path, body) {
  const secret = String(ctx.config.secret ?? "");
  if (!secret) ctx.fail("Falta la API key (o la contraseña) en la conexión.");
  const user = String(ctx.config.username ?? "").trim();
  const headers = { Accept: "application/json" };
  if (user) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
  } else {
    if (!/^[A-Za-z0-9._-]{8,200}$/.test(secret)) ctx.fail("La API key no tiene un formato válido.");
    headers["X-API-Key"] = secret;
  }
  if (body) headers["Content-Type"] = "application/json";
  return ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

function check(ctx, res) {
  if (res.status === 401 || res.status === 403) ctx.fail("Komga rechazó la API key (o el usuario y la contraseña).");
  if (res.status === 404) ctx.fail("No se encontró la API de Komga. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`Komga respondió con error ${res.status}`);
}

async function get(ctx, path) {
  const res = await request(ctx, "GET", path);
  check(ctx, res);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Komga.");
  }
}

/** `totalElements` de /series o /books; las versiones nuevas de Komga lo piden con POST …/list. */
async function total(ctx, what) {
  let res = await request(ctx, "GET", `/api/v1/${what}?size=1`);
  if (res.status === 404 || res.status === 405) res = await request(ctx, "POST", `/api/v1/${what}/list?size=1`, {});
  check(ctx, res);
  try {
    return res.json().totalElements;
  } catch {
    return ctx.fail("La URL responde, pero no parece Komga.");
  }
}
