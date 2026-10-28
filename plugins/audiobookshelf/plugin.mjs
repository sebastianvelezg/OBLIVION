// Plugin de Audiobookshelf: bibliotecas (libros y podcasts) y quién está escuchando.
//
// API key / token: Audiobookshelf → Ajustes → Usuarios → tu usuario → «Token de API»
// (o una clave de API de Ajustes → Claves de API). «Quién escucha» exige un usuario admin.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { bytes, duration } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Audiobookshelf", type: "url", required: true, placeholder: "http://192.168.1.10:13378" },
  { key: "apiKey", label: "Token de API", type: "secret", required: true, help: "Ajustes → Usuarios → tu usuario → Token de API." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "audiobookshelf",
  name: "Audiobookshelf",
  version: "0.1.0",
  description: "Tus bibliotecas de audiolibros y podcasts: elementos, duración, tamaño y quién escucha ahora.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const l = await get(ctx, "/api/libraries");
    const n = Array.isArray(l.libraries) ? l.libraries.length : 0;
    return `Conectado: ${n} biblioteca${n === 1 ? "" : "s"}`;
  },

  widgets: [
    {
      type: "libraries",
      name: "Bibliotecas",
      description: "Cada biblioteca con su número de elementos, duración y tamaño; y quién está escuchando.",
      icon: "🎧",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 120,
      config: [{ key: "showListening", label: "Mostrar quién escucha ahora (solo administradores)", type: "boolean", default: true }],

      async load(ctx) {
        const data = await get(ctx, "/api/libraries");
        const libs = (Array.isArray(data.libraries) ? data.libraries : []).slice(0, 12);
        const stats = await Promise.all(libs.map((l) => get(ctx, `/api/libraries/${encodeURIComponent(l.id)}/stats`).catch(() => null)));

        const items = Number;
        const totalItems = stats.reduce((n, s) => n + (s ? items(s.totalItems) || 0 : 0), 0);
        const totalSecs = stats.reduce((n, s) => n + (s ? items(s.totalDuration) || 0 : 0), 0);
        const totalSize = stats.reduce((n, s) => n + (s ? items(s.totalSize) || 0 : 0), 0);

        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Elementos", value: totalItems.toLocaleString("es") },
                { label: "Duración", value: totalSecs > 0 ? `${Math.round(totalSecs / 3600).toLocaleString("es")} h` : "—" },
                { label: "Tamaño", value: totalSize > 0 ? bytes(totalSize) : "—" },
              ],
            },
          },
          {
            view: {
              kind: "list",
              empty: "No hay bibliotecas.",
              items: libs.map((l, i) => {
                const s = stats[i];
                return {
                  title: String(l.name ?? "Biblioteca"),
                  subtitle: s ? `${items(s.totalItems).toLocaleString("es")} elementos · ${duration(items(s.totalDuration))}` : "",
                  right: s ? bytes(s.totalSize) : "—",
                };
              }),
            },
          },
        ];

        // Quién escucha es un extra de administrador: si falla, no se muestra.
        if (ctx.config.showListening) {
          try {
            const online = await get(ctx, "/api/users/online");
            const users = Array.isArray(online.usersOnline) ? online.usersOnline : [];
            if (users.length > 0) {
              sections.push({
                title: "Escuchando ahora",
                view: {
                  kind: "list",
                  items: users.slice(0, 10).map((u) => ({
                    title: String(u.session?.displayTitle ?? "Escuchando"),
                    subtitle: [u.username, u.session?.displayAuthor].filter(Boolean).join(" · "),
                    right: "En directo",
                    tone: "good",
                  })),
                },
              });
            }
          } catch {
            /* sin permiso de administrador */
          }
        }
        return { kind: "sections", sections };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function get(ctx, path) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9._-]{16,2000}$/.test(key)) ctx.fail("El token de API no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Audiobookshelf rechazó el token de API.");
  if (res.status === 404) ctx.fail("No se encontró la API de Audiobookshelf. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Audiobookshelf respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Audiobookshelf.");
  }
}
