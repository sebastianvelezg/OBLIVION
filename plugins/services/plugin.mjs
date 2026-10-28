// Plugin «Estado de servicios»: comprueba si tus servicios responden y en cuántos ms.
//
// Sirve para cualquier cosa con interfaz web (Dockge, Portainer, Pi-hole, tu NAS...).
// No usa API ni credenciales: hace una petición GET a cada URL y mira si contesta.
//
//   · Responde con 2xx/3xx/4xx  → arriba (un 401/403 también cuenta: el servicio está vivo).
//   · Responde con 5xx          → con error.
//   · No conecta o tarda > 8 s  → caído.
//
// Solo llama a las URLs que escribas en el widget (no declara `permissions.network`).
// Limitación: los servicios HTTPS con certificado autofirmado se ven como caídos;
// usa su dirección http:// de la red local o un certificado válido.

/** @type {import('@oblivion/sdk').PluginDefinition} */
const plugin = {
  id: "services",
  name: "Servicios",
  version: "0.1.0",
  description: "Comprueba si tus servicios están arriba y cuánto tardan en responder.",
  author: "Oblivion",
  widgets: [
    {
      type: "status",
      name: "Estado de servicios",
      description: "Semáforo de tus servicios (Dockge, Portainer, tu NAS...): arriba o caído, con latencia.",
      icon: "🟢",
      defaultSize: { w: 4, h: 6 },
      minSize: { w: 3, h: 3 },
      refreshSeconds: 30,
      config: [
        {
          key: "items",
          label: "Servicios",
          type: "list",
          maxItems: 30,
          itemFields: [
            { key: "name", label: "Nombre", type: "string", required: true, placeholder: "Dockge" },
            { key: "url", label: "URL", type: "url", required: true, placeholder: "http://192.168.1.10:5001" },
          ],
        },
      ],

      async load(ctx) {
        const items = Array.isArray(ctx.config.items) ? ctx.config.items : [];
        if (items.length === 0) {
          return { kind: "message", text: "Añade servicios en la configuración del widget (botón de ajustes en modo edición)." };
        }

        const checks = await Promise.all(items.map((it) => check(ctx, it)));
        return {
          kind: "list",
          items: checks.map((c) => ({
            title: c.name,
            subtitle: c.detail,
            right: c.right,
            tone: c.tone,
          })),
        };
      },
    },
  ],
};

export default plugin;

async function check(ctx, { name, url }) {
  const host = safeHost(url);
  const started = Date.now();
  try {
    // `manual`: una redirección (p. ej. a una página de login) también significa «está vivo».
    const res = await ctx.http(url, { redirect: "manual" });
    const ms = Date.now() - started;
    if (res.status >= 500) return { name, detail: host, right: `Error ${res.status}`, tone: "bad" };
    return { name, detail: host, right: `${ms} ms`, tone: ms > 1500 ? "warn" : "good" };
  } catch (err) {
    // ctx.http solo lanza mensajes pensados para el usuario («No se pudo conectar con…»).
    return { name, detail: err instanceof Error ? err.message : "No responde", right: "Caído", tone: "bad" };
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
