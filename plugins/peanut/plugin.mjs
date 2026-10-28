// Plugin de PeaNUT (https://github.com/Brandawg93/PeaNUT): estado de tu SAI/UPS.
//
// PeaNUT es una interfaz web y una API para NUT (Network UPS Tools), que soporta APC, Eaton,
// CyberPower y casi cualquier UPS con USB. En Unraid puedes instalarlo desde la tienda de
// aplicaciones (también existe el plugin «NUT» para que Unraid lea el UPS). Su API no pide clave.
// No declara `permissions.network`: solo llama a la URL de la conexión.

const connection = [
  { key: "url", label: "URL de PeaNUT", type: "url", required: true, placeholder: "http://192.168.1.10:8080" },
  {
    key: "device",
    label: "Nombre del UPS en NUT",
    type: "string",
    default: "ups",
    placeholder: "ups",
    help: "El nombre que tiene en NUT (en upsd/ups.conf, por defecto «ups»).",
  },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "peanut",
  name: "UPS (PeaNUT)",
  version: "0.1.0",
  description: "Estado de tu UPS: si hay corriente o va con batería, la carga de la batería, el consumo y la autonomía.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const u = ups(await device(ctx));
    return `Conectado${u.model ? ` a ${u.model}` : ""}: ${state(u.status).text}`;
  },

  widgets: [
    {
      type: "status",
      name: "Estado del UPS",
      description: "Con corriente o con batería, carga de la batería, consumo y autonomía estimada.",
      icon: "🔋",
      defaultSize: { w: 4, h: 4 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [],

      async load(ctx) {
        const u = ups(await device(ctx));
        const st = state(u.status);
        const items = [{ label: "Estado", value: st.text, tone: st.tone, hint: u.model || undefined }];
        if (Number.isFinite(u.charge)) {
          items.push({ label: "Batería", value: `${Math.round(u.charge)}%`, tone: u.charge < 20 ? "bad" : u.charge < 50 ? "warn" : "good", hint: st.charging ? "cargando" : st.discharging ? "descargando" : undefined });
        }
        if (Number.isFinite(u.load)) {
          items.push({ label: "Carga", value: `${Math.round(u.load)}%`, tone: u.load > 90 ? "bad" : u.load > 75 ? "warn" : "neutral", hint: Number.isFinite(u.watts) ? `${Math.round(u.watts)} W` : undefined });
        }
        if (Number.isFinite(u.runtime)) {
          items.push({ label: "Autonomía", value: duration(u.runtime), tone: u.runtime < 300 ? "bad" : u.runtime < 600 ? "warn" : "neutral" });
        }
        if (Number.isFinite(u.voltage)) items.push({ label: "Entrada", value: `${Math.round(u.voltage)} V` });
        return { kind: "stats", items };
      },
    },
  ],
};

export default plugin;

// ───────────────────────── helpers ─────────────────────────

async function device(ctx) {
  const name = String(ctx.config.device || "ups").trim();
  // Va dentro de la ruta: solo caracteres de un nombre de dispositivo NUT.
  if (!/^[A-Za-z0-9_.@:-]{1,60}$/.test(name)) ctx.fail("El nombre del UPS no es válido.");
  const res = await ctx.http(`${String(ctx.config.url).replace(/\/+$/, "")}/api/v1/devices/${encodeURIComponent(name)}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) ctx.fail(`PeaNUT no conoce un UPS llamado «${name}». Revisa el nombre en NUT.`);
  if (!res.ok) ctx.fail(`PeaNUT respondió con error ${res.status}`);
  try {
    const body = res.json();
    if (!body || typeof body !== "object") throw new Error("vacío");
    return body;
  } catch {
    return ctx.fail("La URL responde, pero no parece PeaNUT.");
  }
}

/** PeaNUT devuelve las variables de NUT planas («battery.charge») o, en versiones antiguas, en `upsData`. */
function ups(d) {
  const flat = d.upsData && typeof d.upsData === "object" ? d.upsData : d;
  const pick = (...keys) => keys.map((k) => flat[k] ?? d[k]).find((v) => v !== undefined && v !== null && v !== "");
  const num = (...keys) => {
    const v = pick(...keys);
    return v === undefined ? NaN : Number(v);
  };
  const load = num("ups.load", "ups_load");
  const nominal = num("ups.realpower.nominal", "ups_realpower_nominal");
  const realpower = num("ups.realpower", "ups_realpower");
  return {
    status: String(pick("ups.status", "ups_status") ?? ""),
    model: String(pick("device.model", "ups.model", "device_model", "ups_model") ?? "").slice(0, 60),
    charge: num("battery.charge", "battery_charge"),
    load,
    runtime: num("battery.runtime", "battery_runtime"),
    voltage: num("input.voltage", "input_voltage"),
    watts: Number.isFinite(realpower) ? realpower : Number.isFinite(load) && Number.isFinite(nominal) ? (load / 100) * nominal : NaN,
  };
}

/** `ups.status` es una lista de códigos NUT separados por espacio: «OL CHRG», «OB DISCHRG», «OB LB»... */
function state(status) {
  const codes = new Set(String(status).toUpperCase().split(/\s+/).filter(Boolean));
  const charging = codes.has("CHRG");
  const discharging = codes.has("DISCHRG");
  if (codes.has("LB")) return { text: "Batería baja", tone: "bad", charging, discharging };
  if (codes.has("OB")) return { text: "Con batería", tone: "warn", charging, discharging };
  if (codes.has("RB")) return { text: "Cambiar batería", tone: "warn", charging, discharging };
  if (codes.has("OVER")) return { text: "Sobrecarga", tone: "bad", charging, discharging };
  if (codes.has("OL")) return { text: "Con corriente", tone: "good", charging, discharging };
  return { text: status ? String(status).slice(0, 30) : "Desconocido", tone: "neutral", charging, discharging };
}

function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
