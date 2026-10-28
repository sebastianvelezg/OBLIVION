// Plugin de Jellystat (https://github.com/CyferShepard/Jellystat): estadísticas de reproducción de Jellyfin.
//
// API key: Jellystat → Ajustes → Clave de API. Funciona con Jellystat 1.1.6 o posterior.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Jellystat", type: "url", required: true, placeholder: "http://192.168.1.10:3000" },
  { key: "apiKey", label: "API key", type: "secret", required: true, help: "Jellystat → Ajustes → Clave de API." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "jellystat",
  name: "Jellystat",
  version: "0.1.0",
  description: "Reproducciones de tu Jellyfin por tipo (películas, series, música) en los últimos días.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    await views(ctx, 7);
    return "Conectado a Jellystat";
  },

  widgets: [
    {
      type: "views",
      name: "Reproducciones",
      description: "Cuántas películas, episodios y canciones se han reproducido en los últimos días.",
      icon: "📊",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [{ key: "days", label: "Últimos días", type: "number", default: 30, min: 1, max: 365 }],

      async load(ctx) {
        const days = Math.min(365, Math.max(1, Math.round(Number(ctx.config.days)) || 30));
        const v = await views(ctx, days);
        const n = (x) => Number(x ?? 0).toLocaleString("es");
        const items = [
          { label: "Películas", value: n(v.Movie) },
          { label: "Episodios", value: n(v.Series) },
          { label: "Canciones", value: n(v.Audio) },
        ];
        if (Number(v.Other) > 0) items.push({ label: "Otros", value: n(v.Other) });
        return {
          kind: "sections",
          sections: [{ title: `Últimos ${days} días`, view: { kind: "stats", items } }],
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function views(ctx, days) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9_.-]{8,300}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const base = String(ctx.config.url).replace(/\/+$/, "");
  const res = await ctx.http(`${base}/stats/getViewsByLibraryType?days=${days}`, {
    headers: { Accept: "application/json", "x-api-token": key },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Jellystat rechazó la API key.");
  if (res.status === 404) ctx.fail("No se encontró la API de Jellystat. ¿La URL es correcta?");
  if (!res.ok) ctx.fail(`Jellystat respondió con error ${res.status}`);
  let body;
  try {
    body = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Jellystat.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) ctx.fail("Jellystat respondió con un formato inesperado.");
  if (typeof body.message === "string") ctx.fail("Jellystat rechazó la petición: revisa la API key.");
  return body;
}
