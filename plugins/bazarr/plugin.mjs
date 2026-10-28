// Plugin de Bazarr: películas y episodios a los que aún les faltan subtítulos.
//
// API key: Bazarr → Ajustes → General → Seguridad → Clave API.
// No declara `permissions.network`: solo llama a la URL de la conexión.

import { arrConnection, arrGet } from "../_shared/arr.mjs";

const APP = "Bazarr";
// Bazarr usa `X-API-KEY` y no tiene `/api/v3`: las rutas cuelgan de /api.
const api = (ctx, path) => arrGet(ctx, APP, `/api${path}`, { header: "X-API-KEY" });

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "bazarr",
  name: "Bazarr",
  version: "0.1.0",
  description: "Películas y episodios sin subtítulos pendientes de descargar en Bazarr.",
  author: "Oblivion",
  connection: arrConnection("http://192.168.1.10:6767"),

  async test(ctx) {
    const s = await api(ctx, "/system/status");
    return `Conectado a Bazarr ${s?.data?.bazarr_version ?? s?.bazarr_version ?? ""}`.trim();
  },

  widgets: [
    {
      type: "wanted",
      name: "Subtítulos pendientes",
      description: "Cuántas películas y episodios no tienen aún los subtítulos que quieres.",
      icon: "💬",
      defaultSize: { w: 3, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 600,
      config: [],

      async load(ctx) {
        const [movies, episodes] = await Promise.all([api(ctx, "/movies/wanted?start=0&length=1"), api(ctx, "/episodes/wanted?start=0&length=1")]);
        const m = Number(movies?.total ?? 0);
        const e = Number(episodes?.total ?? 0);
        return {
          kind: "stats",
          items: [
            { label: "Películas", value: m.toLocaleString("es"), tone: m > 0 ? "warn" : "good" },
            { label: "Episodios", value: e.toLocaleString("es"), tone: e > 0 ? "warn" : "good" },
          ],
        };
      },
    },
  ],
};

export default plugin;
