// Plugin de What's Up Docker (WUD): qué contenedores tienen una versión nueva disponible.
//
// WUD vigila tus contenedores y avisa de actualizaciones sin tocarlos. Si activaste
// autenticación básica, pon usuario y contraseña en la conexión.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de What's Up Docker", type: "url", required: true, placeholder: "http://192.168.1.10:3000" },
  { key: "username", label: "Usuario", type: "string", help: "Solo si WUD tiene autenticación básica." },
  { key: "password", label: "Contraseña", type: "secret" },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "wud",
  name: "What's Up Docker",
  version: "0.1.0",
  description: "Qué contenedores de Docker tienen una actualización disponible, según What's Up Docker.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const list = await containers(ctx);
    return `Conectado: ${list.filter((c) => c.updateAvailable).length} actualizaciones de ${list.length} contenedores`;
  },

  widgets: [
    {
      type: "updates",
      name: "Actualizaciones",
      description: "Contenedores vigilados y los que tienen una versión nueva, con su salto (mayor, menor, parche).",
      icon: "🔄",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [
        {
          key: "show",
          label: "Qué listar",
          type: "select",
          default: "updates",
          options: [
            { value: "updates", label: "Solo los que tienen actualización" },
            { value: "all", label: "Todos los contenedores" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 15, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 15));
        const all = await containers(ctx);
        const withUpdate = all.filter((c) => c.updateAvailable);
        const rows = ctx.config.show === "all" ? all : withUpdate;
        const rank = (c) => (c.updateAvailable ? (c.updateKind?.semverDiff === "major" ? 0 : 1) : 2);
        const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Vigilados", value: String(all.length) },
                  { label: "Con actualización", value: String(withUpdate.length), tone: withUpdate.length > 0 ? "warn" : "good" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: ctx.config.show === "all" ? "WUD no vigila ningún contenedor." : "Todo está al día.",
                items: sorted.slice(0, limit).map((c) => {
                  const k = c.updateKind ?? {};
                  const diff = { major: "Mayor", minor: "Menor", patch: "Parche" }[k.semverDiff];
                  const tag = c.image?.tag?.value;
                  return {
                    title: String(c.name ?? "contenedor"),
                    subtitle: c.updateAvailable
                      ? `${c.image?.name ?? ""}${tag ? `:${tag}` : ""}${k.remoteValue ? ` → ${String(k.remoteValue).slice(0, 40)}` : ""}`
                      : `${c.image?.name ?? ""}${tag ? `:${tag}` : ""}`,
                    right: c.updateAvailable ? (diff ?? (k.kind === "digest" ? "Imagen nueva" : "Disponible")) : "Al día",
                    tone: c.updateAvailable ? (k.semverDiff === "major" ? "bad" : "warn") : "good",
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

async function containers(ctx) {
  const headers = { Accept: "application/json" };
  const user = String(ctx.config.username ?? "");
  if (user) headers.Authorization = "Basic " + Buffer.from(`${user}:${ctx.config.password ?? ""}`).toString("base64");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + "/api/containers", { headers });
  if (res.status === 401 || res.status === 403) ctx.fail("What's Up Docker rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail("No se encontró la API de What's Up Docker. ¿La URL es la de su interfaz web?");
  if (!res.ok) ctx.fail(`What's Up Docker respondió con error ${res.status}`);
  try {
    const list = res.json();
    if (!Array.isArray(list)) throw new Error("no es lista");
    return list;
  } catch {
    return ctx.fail("La URL responde, pero no parece What's Up Docker.");
  }
}
