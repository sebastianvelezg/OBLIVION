// Plugin de Glances (https://nicolargo.github.io/glances/): estado del servidor.
//
// Glances es un monitor de sistema que expone una API REST. En Unraid está en la tienda de
// aplicaciones (Community Applications). Arráncalo con el modo web (`glances -w`, puerto 61208).
//
// Para ver los discos y la temperatura reales del servidor ejecuta Glances en modo host
// (red «host» y acceso de solo lectura a /mnt): desde un contenedor normal solo vería el suyo.
//
// No declara `permissions.network`: solo llama a la URL que escribas en la conexión.

const connection = [
  {
    key: "url",
    label: "URL de Glances",
    type: "url",
    required: true,
    placeholder: "http://192.168.1.10:61208",
  },
  {
    key: "version",
    label: "Versión de la API",
    type: "select",
    default: "4",
    options: [
      { value: "4", label: "Glances 4 (actual)" },
      { value: "3", label: "Glances 3" },
    ],
  },
  { key: "username", label: "Usuario", type: "string", help: "Solo si activaste contraseña en Glances (-w --username)." },
  { key: "password", label: "Contraseña", type: "secret" },
];

const GB = 1024 ** 3;
// Sistemas de archivos que no son discos de verdad (ruido en Docker/Unraid).
const VIRTUAL_FS = new Set(["overlay", "tmpfs", "devtmpfs", "squashfs", "shm", "proc", "sysfs", "cgroup", "cgroup2", "ramfs"]);

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "glances",
  name: "Glances (servidor)",
  version: "0.1.0",
  description: "CPU, memoria, discos y temperaturas de tu servidor, medidos por Glances.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const sys = await api(ctx, "/system");
    return `Conectado a ${[sys.hostname, sys.os_name].filter(Boolean).join(" · ") || "Glances"}`;
  },

  widgets: [
    {
      type: "system",
      name: "Estado del sistema",
      description: "CPU, memoria, carga y tiempo encendido del servidor.",
      icon: "🖥️",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 10,
      config: [],

      async load(ctx) {
        const [cpu, mem, swap, load, uptime, sys] = await Promise.all([
          api(ctx, "/cpu"),
          api(ctx, "/mem"),
          api(ctx, "/memswap").catch(() => null),
          api(ctx, "/load").catch(() => null),
          api(ctx, "/uptime").catch(() => null),
          api(ctx, "/system").catch(() => null),
        ]);

        const cpuPct = Number(cpu.total);
        const memPct = Number(mem.percent);
        const items = [
          { label: "CPU", value: pct(cpuPct), tone: tone(cpuPct, 75, 90) },
          {
            label: "Memoria",
            value: pct(memPct),
            hint: `${gb(mem.used)} de ${gb(mem.total)}`,
            tone: tone(memPct, 80, 92),
          },
        ];
        if (swap && Number(swap.total) > 0) {
          items.push({ label: "Swap", value: pct(Number(swap.percent)), hint: `${gb(swap.used)} de ${gb(swap.total)}`, tone: tone(Number(swap.percent), 40, 80) });
        }
        if (load && Number.isFinite(Number(load.min1))) {
          const cores = Number(load.cpucore) || 1;
          items.push({
            label: "Carga (1 min)",
            value: Number(load.min1).toFixed(2),
            hint: `${cores} núcleos`,
            tone: tone((Number(load.min1) / cores) * 100, 80, 120),
          });
        }
        if (uptime) items.push({ label: "Encendido", value: shortUptime(uptime) });
        if (sys?.hostname) items.push({ label: "Servidor", value: String(sys.hostname), hint: sys.os_name ? String(sys.os_name) : undefined });
        return { kind: "stats", items };
      },
    },

    {
      type: "disks",
      name: "Discos",
      description: "Espacio usado en cada disco o volumen (en Unraid: el array, la caché y los discos).",
      icon: "💽",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [
        {
          key: "prefix",
          label: "Solo montajes que empiecen por",
          type: "string",
          placeholder: "/mnt",
          help: "Déjalo vacío para ver todos. En Unraid, «/mnt» muestra el array (disk1, disk2…), la caché y los pools.",
        },
      ],

      async load(ctx) {
        const prefix = String(ctx.config.prefix ?? "").trim();
        const fs = await api(ctx, "/fs");
        const rows = (Array.isArray(fs) ? fs : [])
          .filter((d) => d && Number(d.size) > 0)
          .filter((d) => (prefix ? String(d.mnt_point).startsWith(prefix) : !VIRTUAL_FS.has(String(d.fs_type))))
          .sort((a, b) => String(a.mnt_point).localeCompare(String(b.mnt_point), "es", { numeric: true }));

        return {
          kind: "list",
          empty: prefix ? `Glances no ve ningún montaje que empiece por ${prefix}.` : "Glances no ve ningún disco.",
          items: rows.slice(0, 50).map((d) => {
            const percent = Number(d.percent);
            return {
              title: String(d.mnt_point),
              subtitle: `${gb(d.used)} de ${gb(d.size)} · ${gb(d.free)} libres`,
              right: pct(percent),
              progress: Math.min(1, Math.max(0, percent / 100)),
              tone: tone(percent, 85, 95),
            };
          }),
        };
      },
    },

    {
      type: "temperatures",
      name: "Temperaturas",
      description: "CPU, placa y discos, según los sensores que vea Glances.",
      icon: "🌡️",
      defaultSize: { w: 3, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [],

      async load(ctx) {
        const sensors = await api(ctx, "/sensors");
        const temps = (Array.isArray(sensors) ? sensors : [])
          .filter((s) => /temperature/i.test(String(s.type ?? "")) && Number.isFinite(Number(s.value)))
          .sort((a, b) => Number(b.value) - Number(a.value));
        return {
          kind: "list",
          empty: "Glances no encuentra sensores de temperatura (en Docker, ejecútalo en modo host).",
          items: temps.slice(0, 30).map((s) => ({
            title: String(s.label),
            right: `${Math.round(Number(s.value))} °C`,
            tone: tone(Number(s.value), 70, 85),
          })),
        };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

const base = (ctx) => String(ctx.config.url).replace(/\/+$/, "");

async function api(ctx, path) {
  const v = ctx.config.version === "3" ? "3" : "4";
  const headers = { Accept: "application/json" };
  const user = String(ctx.config.username ?? "");
  if (user) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${ctx.config.password ?? ""}`).toString("base64");
  }
  const res = await ctx.http(`${base(ctx)}/api/${v}${path}`, { headers });
  if (res.status === 401 || res.status === 403) ctx.fail("Glances rechazó el usuario o la contraseña.");
  if (res.status === 404) ctx.fail(`Glances no tiene ${path} en la API v${v}. ¿Elegiste la versión correcta?`);
  if (!res.ok) ctx.fail(`Glances respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Glances (¿está activo el modo web?).");
  }
}

const gb = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "—";
  return n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : n >= 100 * GB ? `${Math.round(n / GB)} GB` : `${(n / GB).toFixed(1)} GB`;
};
const pct = (n) => (Number.isFinite(n) ? `${n >= 10 ? Math.round(n) : n.toFixed(1)}%` : "—");
const tone = (n, warn, bad) => (n >= bad ? "bad" : n >= warn ? "warn" : "good");

/** «3 days, 4:05:06» → «3 d 4 h». */
function shortUptime(raw) {
  const m = /^(?:(\d+) days?, )?(\d+):(\d+)/.exec(String(raw).trim());
  if (!m) return String(raw).slice(0, 20);
  const days = Number(m[1] ?? 0);
  const h = Number(m[2]);
  return days > 0 ? `${days} d ${h} h` : `${h} h ${Number(m[3])} min`;
}
