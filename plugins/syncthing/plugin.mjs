// Plugin de Syncthing: carpetas sincronizadas, dispositivos conectados y errores.
//
// API key: Syncthing → Acciones → Configuración → «Clave API de la interfaz gráfica».
// Solo lee datos. No declara `permissions.network`: solo llama a la URL de la conexión.

import { ago, bytes } from "../_shared/fmt.mjs";

const connection = [
  { key: "url", label: "URL de Syncthing", type: "url", required: true, placeholder: "http://192.168.1.10:8384" },
  { key: "apiKey", label: "API key", type: "secret", required: true, help: "Acciones → Configuración → Clave API de la interfaz gráfica." },
];

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "syncthing",
  name: "Syncthing",
  version: "0.1.0",
  description: "Estado de tus carpetas sincronizadas, qué dispositivos están conectados y si hay errores.",
  author: "Oblivion",
  connection,

  async test(ctx) {
    const s = await get(ctx, "/rest/system/status");
    return `Conectado: ${String(s.myID ?? "").slice(0, 7) || "Syncthing"}, encendido ${s.uptime ? Math.round(Number(s.uptime) / 3600) + " h" : "—"}`;
  },

  widgets: [
    {
      type: "status",
      name: "Sincronización",
      description: "Carpetas (sincronizadas, sincronizando o con error) y dispositivos conectados.",
      icon: "🔁",
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [{ key: "showDevices", label: "Mostrar la lista de dispositivos", type: "boolean", default: true }],

      async load(ctx) {
        const [config, status, conns, errors] = await Promise.all([
          get(ctx, "/rest/system/config"),
          get(ctx, "/rest/system/status").catch(() => ({})),
          get(ctx, "/rest/system/connections").catch(() => ({ connections: {} })),
          get(ctx, "/rest/system/error").catch(() => ({ errors: [] })),
        ]);
        const folders = (Array.isArray(config.folders) ? config.folders : []).slice(0, 25);
        const devices = Array.isArray(config.devices) ? config.devices : [];
        const myId = status.myID;
        const live = conns.connections ?? {};

        const statuses = await Promise.all(
          folders.map((f) =>
            f.paused
              ? { paused: true }
              : get(ctx, `/rest/db/status?folder=${encodeURIComponent(f.id)}`).catch(() => ({ unknown: true })),
          ),
        );

        const rows = folders.map((f, i) => {
          const s = statuses[i];
          const need = Number(s.needBytes) || 0;
          const global = Number(s.globalBytes) || 0;
          const pct = global > 0 ? Math.min(100, Math.floor(((global - need) / global) * 100)) : 100;
          const bad = Number(s.errors) > 0 || Number(s.pullErrors) > 0;
          let right = "Sincronizada";
          let tone = "good";
          if (f.paused) [right, tone] = ["Pausada", "neutral"];
          else if (s.unknown) [right, tone] = ["Sin datos", "warn"];
          else if (bad) [right, tone] = ["Con errores", "bad"];
          else if (s.state === "scanning" || s.state === "scan-waiting") [right, tone] = ["Escaneando", "warn"];
          else if (s.state === "syncing" || need > 0) [right, tone] = [`${pct}%`, "warn"];
          else if (s.state === "error") [right, tone] = ["Error", "bad"];
          return {
            title: String(f.label || f.id),
            subtitle: s.globalBytes !== undefined ? `${bytes(global)} · ${Number(s.globalFiles ?? 0).toLocaleString("es")} archivos` : "",
            right,
            tone,
            progress: tone === "warn" && right.endsWith("%") ? pct / 100 : undefined,
          };
        });

        const others = devices.filter((d) => d.deviceID !== myId);
        const connected = others.filter((d) => live[d.deviceID]?.connected).length;
        const synced = rows.filter((r) => r.tone === "good").length;
        const errorCount = Array.isArray(errors.errors) ? errors.errors.length : 0;

        const sections = [
          {
            view: {
              kind: "stats",
              items: [
                { label: "Carpetas", value: String(rows.length), hint: `${synced} al día`, tone: synced === rows.length ? "good" : "neutral" },
                { label: "Dispositivos", value: `${connected} / ${others.length}`, tone: others.length > 0 && connected === 0 ? "warn" : "neutral" },
                { label: "Errores", value: String(errorCount), tone: errorCount > 0 ? "bad" : "good" },
              ],
            },
          },
          { title: "Carpetas", view: { kind: "list", empty: "Syncthing no tiene carpetas.", items: rows } },
        ];
        if (ctx.config.showDevices && others.length > 0) {
          sections.push({
            title: "Dispositivos",
            view: {
              kind: "list",
              items: others.slice(0, 25).map((d) => {
                const c = live[d.deviceID] ?? {};
                const on = !!c.connected;
                return {
                  title: String(d.name || String(d.deviceID).slice(0, 7)),
                  subtitle: d.paused ? "pausado" : on ? "" : c.lastSeen ? `visto ${ago(c.lastSeen)}` : "",
                  right: d.paused ? "Pausado" : on ? "Conectado" : "Desconectado",
                  tone: d.paused ? "neutral" : on ? "good" : "warn",
                };
              }),
            },
          });
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
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", "X-API-Key": key },
  });
  if (res.status === 401 || res.status === 403) ctx.fail("Syncthing rechazó la API key.");
  if (res.status === 404) ctx.fail("No se encontró la API de Syncthing. ¿La URL es la de su interfaz web (puerto 8384)?");
  if (!res.ok) ctx.fail(`Syncthing respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail("La URL responde, pero no parece Syncthing.");
  }
}
