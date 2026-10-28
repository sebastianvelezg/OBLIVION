// Plugin de Docker (solo lectura): qué contenedores corren y cuáles no.
//
// Dockge no tiene API, pero Docker sí. IMPORTANTE (seguridad): NO montes /var/run/docker.sock
// en Oblivion ni expongas el puerto 2375 del demonio: quien lo alcance controla todo el servidor.
// Usa un proxy que solo deje pasar la lectura de contenedores, por ejemplo
// tecnativa/docker-socket-proxy con CONTAINERS=1 y todo lo demás (POST, IMAGES, EXEC...) a 0.
// Mira docs/integrations.md para el compose listo.
//
// Este plugin solo hace `GET /containers/json`. No declara `permissions.network`.

const connection = [
  {
    key: "url",
    label: "URL del proxy de Docker",
    type: "url",
    required: true,
    placeholder: "http://192.168.1.10:2375",
    help: "La del docker-socket-proxy (solo lectura), nunca la del socket completo.",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "docker",
  name: "Docker",
  version: "0.1.0",
  description: "Estado de tus contenedores de Docker (en marcha, detenidos, con problemas), en solo lectura.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const list = await containers(ctx);
    const running = list.filter((c) => c.State === "running").length;
    return `Conectado: ${running} de ${list.length} contenedores en marcha`;
  },

  widgets: [
    {
      type: "containers",
      name: "Contenedores",
      description: "Qué contenedores corren y cuáles están detenidos o con problemas.",
      icon: "🐳",
      defaultSize: { w: 4, h: 7 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 20,
      // La URL es la de un API sin interfaz web: el título no la abre.
      openLink: false,
      config: [
        {
          key: "show",
          label: "Qué mostrar",
          type: "select",
          default: "all",
          options: [
            { value: "all", label: "Todos los contenedores" },
            { value: "problems", label: "Solo los que tienen problemas" },
          ],
        },
        { key: "limit", label: "Máximo de filas", type: "number", default: 20, min: 1, max: 50 },
      ],

      async load(ctx) {
        const limit = Math.min(50, Math.max(1, Number(ctx.config.limit) || 20));
        const all = (await containers(ctx)).map(describe);
        const running = all.filter((c) => c.state === "running").length;
        const problems = all.filter((c) => c.tone === "bad").length;
        const stopped = all.length - running;

        let rows = all;
        if (ctx.config.show === "problems") rows = all.filter((c) => c.tone === "bad" || c.tone === "warn");
        // Primero lo que falla, luego por nombre.
        const rank = { bad: 0, warn: 1, neutral: 2, good: 3 };
        rows.sort((a, b) => rank[a.tone] - rank[b.tone] || a.name.localeCompare(b.name, "es"));

        return {
          kind: "sections",
          sections: [
            {
              view: {
                kind: "stats",
                items: [
                  { label: "En marcha", value: String(running), tone: "good" },
                  { label: "Detenidos", value: String(stopped), tone: stopped > 0 ? "warn" : "neutral" },
                  { label: "Con problemas", value: String(problems), tone: problems > 0 ? "bad" : "neutral" },
                ],
              },
            },
            {
              view: {
                kind: "list",
                empty: ctx.config.show === "problems" ? "Ningún contenedor con problemas." : "No hay contenedores.",
                items: rows.slice(0, limit).map((c) => ({
                  title: c.name,
                  subtitle: [c.stack, c.status].filter(Boolean).join(" · "),
                  right: c.label,
                  tone: c.tone,
                })),
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

/** Lista de contenedores. Es la ÚNICA llamada que hace el plugin (lectura). */
async function containers(ctx) {
  const base = String(ctx.config.url).replace(/\/+$/, "");
  const res = await ctx.http(`${base}/containers/json?all=true`, { headers: { Accept: "application/json" } });
  if (res.status === 403) {
    ctx.fail("El proxy no deja listar contenedores: activa CONTAINERS=1 en docker-socket-proxy.");
  }
  if (res.status === 404) ctx.fail("No se encontró la API de Docker. ¿La URL es la del proxy?");
  if (!res.ok) ctx.fail(`Docker respondió con error ${res.status}`);
  let list;
  try {
    list = res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece la API de Docker.");
  }
  if (!Array.isArray(list)) ctx.fail("La URL responde, pero no parece la API de Docker.");
  return list;
}

function describe(c) {
  const name = String(c.Names?.[0] ?? c.Id ?? "").replace(/^\//, "") || "sin nombre";
  const state = String(c.State ?? "");
  const status = String(c.Status ?? "");
  const stack = c.Labels?.["com.docker.compose.project"];
  const exit = /Exited \((-?\d+)\)/.exec(status);

  let tone = "neutral";
  let label = state || "—";
  if (state === "running") {
    if (/unhealthy/i.test(status)) ((tone = "bad"), (label = "Con fallos"));
    else if (/starting/i.test(status)) ((tone = "warn"), (label = "Iniciando"));
    else ((tone = "good"), (label = "En marcha"));
  } else if (state === "restarting") {
    tone = "bad";
    label = "Reiniciando";
  } else if (state === "paused") {
    tone = "warn";
    label = "Pausado";
  } else if (state === "exited") {
    tone = exit && exit[1] !== "0" ? "bad" : "neutral";
    label = exit && exit[1] !== "0" ? `Salió (${exit[1]})` : "Detenido";
  } else if (state === "dead") {
    tone = "bad";
    label = "Muerto";
  } else if (state === "created") {
    label = "Creado";
  }
  return { name, state, status, stack: stack ? String(stack) : "", tone, label };
}
