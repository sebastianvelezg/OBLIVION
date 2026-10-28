// Plugin de Uptime Kuma: el estado de tus monitores, desde una «página de estado» pública.
//
// En Uptime Kuma crea una página de estado (Páginas de estado → Nueva), añade los monitores
// que quieras ver y copia su «slug» (la última parte de /status/<slug>). Esa API no necesita
// clave, así que Oblivion solo lee lo que ya publicas en esa página.
//
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de Uptime Kuma", type: "url", required: true, placeholder: "http://192.168.1.10:3001" },
  {
    key: "slug",
    label: "Página de estado (slug)",
    type: "string",
    required: true,
    placeholder: "casa",
    help: "La parte final de la dirección de tu página de estado: /status/<slug>.",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "uptime-kuma",
  name: "Uptime Kuma",
  version: "0.1.0",
  description: "Estado, latencia y disponibilidad de los monitores de una página de estado de Uptime Kuma.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const page = await get(ctx, `/api/status-page/${slug(ctx)}`);
    const monitors = (page.publicGroupList ?? []).reduce((n, g) => n + (g.monitorList?.length ?? 0), 0);
    return `Conectado a «${page.config?.title ?? slug(ctx)}»: ${monitors} monitores`;
  },

  widgets: [
    {
      type: "monitors",
      name: "Monitores",
      description: "Qué servicios están arriba o caídos, con latencia y disponibilidad de 24 h.",
      icon: "📡",
      defaultSize: { w: 4, h: 7 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [
        {
          key: "show",
          label: "Qué mostrar",
          type: "select",
          default: "all",
          options: [
            { value: "all", label: "Todos los monitores" },
            { value: "problems", label: "Solo los que fallan" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 },
      ],

      async load(ctx) {
        const s = slug(ctx);
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const [page, beats] = await Promise.all([get(ctx, `/api/status-page/${s}`), get(ctx, `/api/status-page/heartbeat/${s}`)]);

        const monitors = [];
        for (const g of page.publicGroupList ?? []) {
          for (const m of g.monitorList ?? []) {
            const list = beats.heartbeatList?.[String(m.id)] ?? [];
            const last = list[list.length - 1];
            const up24 = beats.uptimeList?.[`${m.id}_24`];
            monitors.push({ id: m.id, name: String(m.name ?? m.id), group: String(g.name ?? ""), last, up24 });
          }
        }

        const down = monitors.filter((m) => m.last?.status === 0).length;
        const up = monitors.filter((m) => m.last?.status === 1).length;
        const avg = monitors.filter((m) => Number.isFinite(Number(m.up24)));
        const avgPct = avg.length ? (avg.reduce((n, m) => n + Number(m.up24), 0) / avg.length) * 100 : undefined;

        let rows = monitors;
        if (ctx.config.show === "problems") rows = monitors.filter((m) => m.last?.status !== 1 && m.last?.status !== 3);
        const rank = (m) => (m.last?.status === 0 ? 0 : m.last?.status === 2 ? 1 : 2);
        rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "Arriba", value: String(up), tone: "good" },
                  { label: "Caídos", value: String(down), tone: down > 0 ? "bad" : "neutral" },
                  { label: "Disponibilidad 24 h", value: avgPct === undefined ? "—" : `${avgPct.toFixed(avgPct >= 99.95 ? 0 : 1)}%`, tone: avgPct !== undefined && avgPct < 99 ? "warn" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: ctx.config.show === "problems" ? "Todos los monitores están bien." : "La página de estado no tiene monitores.",
                items: rows.slice(0, limit).map((m) => {
                  const st = m.last?.status;
                  const ping = Number(m.last?.ping);
                  return {
                    title: m.name,
                    subtitle: [m.group, Number.isFinite(Number(m.up24)) ? `${(Number(m.up24) * 100).toFixed(1)}% en 24 h` : ""].filter(Boolean).join(" · "),
                    right: st === 0 ? "Caído" : st === 2 ? "Pendiente" : st === 3 ? "Mantenimiento" : Number.isFinite(ping) ? `${Math.round(ping)} ms` : st === 1 ? "Arriba" : "—",
                    tone: st === 0 ? "bad" : st === 2 ? "warn" : st === 1 ? "good" : "neutral",
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

function slug(ctx) {
  const s = String(ctx.config.slug ?? "").trim();
  // Va dentro de una ruta: solo caracteres seguros.
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(s)) ctx.fail("El slug de la página de estado solo puede llevar letras, números, - y _.");
  return s;
}

async function get(ctx, path) {
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, { headers: { Accept: "application/json" } });
  if (res.status === 404) ctx.fail("No se encontró esa página de estado. Revisa el slug y que la página esté publicada.");
  if (!res.ok) ctx.fail(`Uptime Kuma respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Uptime Kuma.");
  }
}
