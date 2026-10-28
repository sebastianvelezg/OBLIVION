// Plugin de Jellyfin: reproducción en vivo, conteos de biblioteca y últimos añadidos.
//
// Necesita una API key: Jellyfin → Panel de control → Claves de API → «+».
// La key se guarda cifrada y el navegador nunca la ve: todas las llamadas (y las
// carátulas) pasan por el servidor del dashboard.
//
// No declara `permissions.network`: solo puede llamar a la URL que escribas en la
// conexión (campo «URL de Jellyfin»). La conexión se crea una vez y la comparten todos
// los widgets de Jellyfin.

/** Conexión compartida por todos los widgets de Jellyfin. */
const connection = [
  {
    key: "url",
    label: "URL de Jellyfin",
    type: "url",
    required: true,
    placeholder: "http://192.168.1.10:8096",
    help: "Dirección con la que tú entras a Jellyfin (puede incluir /jellyfin si usas subruta).",
  },
  {
    key: "apiKey",
    label: "API key",
    type: "secret",
    required: true,
    help: "Jellyfin → Panel de control → Claves de API.",
  },
];

/** Opciones de «Últimos añadidos» (las usa el widget suelto y el panel combinado). */
const latestOptions = [
  {
    key: "kind",
    label: "Últimos añadidos: qué mostrar",
    type: "select",
    default: "Movie,Series",
    options: [
      { value: "Movie,Series", label: "Películas y series" },
      { value: "Movie", label: "Solo películas" },
      { value: "Series", label: "Solo series" },
      { value: "Episode", label: "Episodios" },
    ],
  },
  { key: "limit", label: "Últimos añadidos: cantidad", type: "number", default: 8, min: 1, max: 24 },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "jellyfin",
  name: "Jellyfin",
  version: "0.2.0",
  description: "Estado de tu servidor Jellyfin: quién está viendo qué, tamaño de la biblioteca y lo último añadido.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const info = await get(ctx, "/System/Info/Public");
    // La info pública no exige key: pedimos algo que sí la necesite para validarla.
    await get(ctx, "/Items/Counts");
    return `Conectado a ${info.ServerName ?? "Jellyfin"}${info.Version ? ` (v${info.Version})` : ""}`;
  },

  widgets: [
    {
      type: "now-playing",
      name: "Reproduciendo ahora",
      description: "Quién está viendo qué en este momento, con progreso y tipo de reproducción.",
      icon: "▶️",
      defaultSize: { w: 4, h: 5 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 10,
      config: [],
      load: nowPlaying,
    },

    {
      type: "library",
      name: "Biblioteca",
      description: "Cuántas películas, series y episodios tienes, y la versión del servidor.",
      icon: "🎞️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 300,
      config: [],
      load: library,
    },

    {
      type: "latest",
      name: "Últimos añadidos",
      description: "Carátulas de lo último que llegó a tu biblioteca.",
      icon: "🆕",
      defaultSize: { w: 6, h: 6 },
      minSize: { w: 3, h: 4 },
      refreshSeconds: 300,
      config: latestOptions,
      load: latest,
      image,
    },

    {
      type: "overview",
      name: "Panel de Jellyfin",
      description: "Todo en un solo widget: elige si mostrar lo que se reproduce, la biblioteca y los últimos añadidos.",
      icon: "🎬",
      defaultSize: { w: 6, h: 9 },
      minSize: { w: 4, h: 4 },
      refreshSeconds: 30,
      config: [
        { key: "showNowPlaying", label: "Mostrar «Reproduciendo ahora»", type: "boolean", default: true },
        { key: "showLibrary", label: "Mostrar «Biblioteca»", type: "boolean", default: true },
        { key: "showLatest", label: "Mostrar «Últimos añadidos»", type: "boolean", default: true },
        ...latestOptions,
      ],

      async load(ctx) {
        const parts = [];
        if (ctx.config.showNowPlaying) parts.push(["Reproduciendo ahora", nowPlaying]);
        if (ctx.config.showLibrary) parts.push(["Biblioteca", library]);
        if (ctx.config.showLatest) parts.push(["Últimos añadidos", latest]);
        if (parts.length === 0) {
          return { kind: "message", text: "Activa al menos una sección en la configuración del widget." };
        }

        const results = await Promise.allSettled(parts.map(([, fn]) => fn(ctx)));
        // Si todo falla (key mala, servidor caído...) se muestra ese error; si solo falla una sección, se avisa en ella.
        if (results.every((r) => r.status === "rejected")) throw results[0].reason;
        return {
          kind: "sections",
          sections: results.map((r, i) => ({
            title: parts[i][0],
            view:
              r.status === "fulfilled"
                ? r.value
                : { kind: "message", tone: "bad", text: "No se pudo cargar esta sección." },
          })),
        };
      },

      image,
    },
  ],
};

export default plugin;

// ───────────────────────── vistas (compartidas por los widgets sueltos y el panel) ─────────────────────────

async function nowPlaying(ctx) {
  const sessions = await get(ctx, "/Sessions?ActiveWithinSeconds=300");
  const playing = (Array.isArray(sessions) ? sessions : []).filter((s) => s.NowPlayingItem);

  return {
    kind: "list",
    empty: "Nadie está reproduciendo nada ahora mismo.",
    items: playing.map((s) => {
      const item = s.NowPlayingItem;
      const state = s.PlayState ?? {};
      const total = Number(item.RunTimeTicks) || 0;
      const pos = Number(state.PositionTicks) || 0;
      const method = s.PlayMethod ?? state.PlayMethod;
      const transcoding = method === "Transcode";
      const who = [s.UserName, s.DeviceName || s.Client].filter(Boolean).join(" · ");
      return {
        title: titleOf(item),
        subtitle: [episodeLabel(item), who].filter(Boolean).join(" · "),
        right: state.IsPaused ? "Pausado" : transcoding ? "Transcodifica" : "Directo",
        progress: total > 0 ? Math.min(1, pos / total) : undefined,
        tone: transcoding ? "warn" : "neutral",
      };
    }),
  };
}

async function library(ctx) {
  const [counts, info] = await Promise.all([
    get(ctx, "/Items/Counts"),
    // Información pública: si falla no es grave.
    get(ctx, "/System/Info/Public").catch(() => null),
  ]);

  const n = (v) => Number(v ?? 0).toLocaleString("es");
  const items = [
    { label: "Películas", value: n(counts.MovieCount) },
    { label: "Series", value: n(counts.SeriesCount) },
    { label: "Episodios", value: n(counts.EpisodeCount) },
  ];
  if (counts.SongCount) items.push({ label: "Canciones", value: n(counts.SongCount) });
  if (counts.AlbumCount) items.push({ label: "Álbumes", value: n(counts.AlbumCount) });
  if (counts.BoxSetCount) items.push({ label: "Colecciones", value: n(counts.BoxSetCount) });
  if (info?.ServerName) {
    items.push({ label: "Servidor", value: String(info.ServerName), hint: info.Version ? `v${info.Version}` : undefined, tone: "good" });
  }
  return { kind: "stats", items };
}

async function latest(ctx) {
  const kind = ["Movie,Series", "Movie", "Series", "Episode"].includes(ctx.config.kind) ? ctx.config.kind : "Movie,Series";
  const limit = Math.min(24, Math.max(1, Number(ctx.config.limit) || 8));

  const q = new URLSearchParams({
    SortBy: "DateCreated",
    SortOrder: "Descending",
    Recursive: "true",
    IncludeItemTypes: kind,
    Limit: String(limit),
    Fields: "ProductionYear",
    EnableImageTypes: "Primary",
    ImageTypeLimit: "1",
  });
  const data = await get(ctx, `/Items?${q}`);
  const items = Array.isArray(data.Items) ? data.Items : [];

  return {
    kind: "media",
    empty: "Todavía no hay nada en la biblioteca.",
    items: items.map((it) => {
      // Un episodio no suele tener carátula propia: usamos la de su serie.
      const imageId = it.ImageTags?.Primary ? it.Id : it.SeriesId || it.ParentId || undefined;
      return {
        title: it.SeriesName || it.Name || "Sin título",
        subtitle: it.Type === "Episode" ? [episodeLabel(it), it.Name].filter(Boolean).join(" · ") : undefined,
        badge: it.ProductionYear ? String(it.ProductionYear) : undefined,
        image: validId(imageId) ? imageId : undefined,
      };
    }),
  };
}

// Carátula servida por el dashboard (el navegador nunca llama a Jellyfin).
async function image(ctx, key) {
  if (!validId(key)) ctx.fail("Identificador de imagen no válido");
  const res = await ctx.http(`${base(ctx)}/Items/${key}/Images/Primary?maxHeight=420&quality=85`, {
    headers: authHeaders(ctx),
  });
  if (!res.ok) ctx.fail(`Jellyfin no tiene imagen (${res.status})`);
  return { bytes: res.bytes };
}

// ───────────────────────── helpers ─────────────────────────

const validId = (id) => typeof id === "string" && /^[a-f0-9-]{32,36}$/i.test(id);

function base(ctx) {
  return String(ctx.config.url).replace(/\/+$/, "");
}

function authHeaders(ctx) {
  // La key va dentro de una cabecera con comillas: nada de comillas ni saltos de línea.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(ctx.config.apiKey ?? ""))) ctx.fail("La API key no tiene un formato válido.");
  return {
    Accept: "application/json",
    Authorization: `MediaBrowser Client="Oblivion", Device="Oblivion", DeviceId="oblivion-dashboard", Version="0.2.0", Token="${ctx.config.apiKey}"`,
  };
}

/** GET JSON con mensajes de error que el usuario entiende. */
async function get(ctx, path) {
  const res = await ctx.http(base(ctx) + path, { headers: authHeaders(ctx) });
  if (res.status === 401 || res.status === 403) ctx.fail("Jellyfin rechazó la API key. Revisa que sea correcta.");
  if (res.status === 404) ctx.fail("Jellyfin no encontró esa ruta. ¿La URL incluye la subruta correcta?");
  if (!res.ok) ctx.fail(`Jellyfin respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece un servidor Jellyfin.");
  }
}

function titleOf(item) {
  return item.SeriesName || item.Name || "Sin título";
}

function episodeLabel(item) {
  if (item.Type !== "Episode") return item.ProductionYear ? String(item.ProductionYear) : "";
  const s = item.ParentIndexNumber;
  const e = item.IndexNumber;
  const tag = s != null && e != null ? `T${s}·E${e}` : "";
  return [tag, item.SeriesName ? item.Name : ""].filter(Boolean).join(" ");
}
