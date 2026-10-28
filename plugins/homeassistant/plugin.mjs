// Plugin de Home Assistant: el estado de las entidades que elijas y un resumen de la casa.
//
// Token: Home Assistant → tu perfil → pestaña «Seguridad» → «Tokens de acceso de larga duración».
// Solo lee datos (GET de estados y una plantilla de solo lectura). No declara `permissions.network`.
//
// Para elegir entidades escribe sus IDs (Ajustes → Dispositivos y servicios → Entidades,
// o Herramientas de desarrollador → Estados), por ejemplo: sensor.temperatura_salon.

const connection = [
  { key: "url", label: "URL de Home Assistant", type: "url", required: true, placeholder: "http://192.168.1.10:8123" },
  { key: "token", label: "Token de acceso de larga duración", type: "secret", required: true },
];

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

const TEXT = {
  on: "Encendido", off: "Apagado", home: "En casa", not_home: "Fuera", open: "Abierto", closed: "Cerrado",
  locked: "Con llave", unlocked: "Sin llave", unavailable: "No disponible", unknown: "Desconocido",
  playing: "Reproduciendo", paused: "Pausado", idle: "Inactivo", heat: "Calor", cool: "Frío", auto: "Auto",
  detected: "Detectado", clear: "Libre", running: "En marcha", charging: "Cargando",
};

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "homeassistant",
  name: "Home Assistant",
  version: "0.1.0",
  description: "Estado de las entidades que elijas (sensores, luces, puertas…) y cuántas luces hay encendidas o quién está en casa.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const r = await request(ctx, "GET", "/api/");
    return `Conectado: ${String(r?.message ?? "Home Assistant responde")}`;
  },

  widgets: [
    {
      type: "entities",
      name: "Entidades",
      description: "El estado actual de las entidades que elijas, con su unidad (°C, %, W…).",
      icon: "🏠",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 2 },
      refreshSeconds: 30,
      config: [
        {
          key: "entities",
          label: "Entidades",
          type: "list",
          maxItems: 20,
          itemFields: [
            { key: "id", label: "ID de la entidad", type: "string", required: true, placeholder: "sensor.temperatura_salon" },
            { key: "name", label: "Nombre (opcional)", type: "string", placeholder: "Salón" },
          ],
        },
      ],

      async load(ctx) {
        const list = Array.isArray(ctx.config.entities) ? ctx.config.entities : [];
        if (list.length === 0) {
          return { kind: "message", text: "Añade al menos una entidad en la configuración del widget (botón de ajustes en modo edición)." };
        }
        const results = await Promise.allSettled(list.map((e) => entity(ctx, String(e.id).trim())));
        // Si todas fallan (token malo, servidor caído) se muestra ese error; si falla una, se marca en su fila.
        if (results.every((r) => r.status === "rejected" && !(r.reason instanceof NotFound))) throw results[0].reason;

        return {
          kind: "list",
          items: list.map((e, i) => {
            const r = results[i];
            const title = String(e.name || (r.status === "fulfilled" ? r.value.attributes?.friendly_name : "") || e.id);
            if (r.status === "rejected") return { title, subtitle: String(e.id), right: "No existe", tone: "warn" };
            const s = r.value;
            const text = format(s);
            return { title, subtitle: String(e.id), right: text, tone: /^(unavailable|unknown)$/.test(s.state) ? "warn" : "neutral" };
          }),
        };
      },
    },

    {
      type: "summary",
      name: "Resumen de la casa",
      description: "Luces encendidas, interruptores activos, quién está en casa y entidades no disponibles.",
      icon: "🏡",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 60,
      config: [],

      async load(ctx) {
        // Plantilla de solo lectura: devuelve los recuentos ya hechos en el servidor de Home Assistant.
        const template =
          "{{ {'lights_on': states.light | selectattr('state','eq','on') | list | length," +
          " 'lights': states.light | list | length," +
          " 'switches_on': states.switch | selectattr('state','eq','on') | list | length," +
          " 'people_home': states.person | selectattr('state','eq','home') | list | length," +
          " 'people': states.person | list | length," +
          " 'unavailable': states | selectattr('state','eq','unavailable') | list | length} | tojson }}";
        const text = await request(ctx, "POST", "/api/template", { template }, true);
        let c;
        try {
          c = JSON.parse(String(text).trim());
        } catch {
          return ctx.fail("Home Assistant no pudo calcular el resumen (¿la plantilla no es compatible con tu versión?).");
        }
        const items = [];
        if (c.lights > 0) items.push({ label: "Luces encendidas", value: `${c.lights_on} / ${c.lights}` });
        if (c.switches_on > 0 || c.lights === 0) items.push({ label: "Interruptores activos", value: String(c.switches_on) });
        if (c.people > 0) items.push({ label: "En casa", value: `${c.people_home} / ${c.people}`, tone: c.people_home > 0 ? "good" : "neutral" });
        items.push({ label: "No disponibles", value: String(c.unavailable), tone: c.unavailable > 0 ? "warn" : "good" });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

class NotFound extends Error {}

async function request(ctx, method, path, body, raw = false) {
  const token = String(ctx.config.token ?? "");
  if (!/^[A-Za-z0-9._-]{20,2000}$/.test(token)) ctx.fail("El token de acceso no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Home Assistant rechazó el token (¿lo revocaste?).");
  if (res.status === 404) throw new NotFound("No existe");
  if (!res.ok) ctx.fail(`Home Assistant respondió con error ${res.status}`);
  if (raw) return res.text;
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Home Assistant.");
  }
}

async function entity(ctx, id) {
  if (!ENTITY_ID.test(id)) ctx.fail(`«${id.slice(0, 40)}» no es un ID de entidad válido (algo como sensor.temperatura).`);
  return request(ctx, "GET", `/api/states/${id}`);
}

/** Valor listo para mostrar: números redondeados con su unidad; estados conocidos traducidos. */
function format(s) {
  const unit = s.attributes?.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : "";
  const n = Number(s.state);
  if (s.state !== "" && Number.isFinite(n)) return `${Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10}${unit}`;
  return (TEXT[s.state] ?? String(s.state)).slice(0, 60) + unit;
}
