import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadMasterKey, SecretBox } from "./crypto.js";
import { housekeeping, openDb } from "./db.js";
import { PluginRegistry } from "./plugins/registry.js";
import { WidgetRuntime } from "./plugins/runtime.js";

const config = loadConfig();
const db = openDb(config.dataDir);
const box = new SecretBox(loadMasterKey(config.dataDir));
const registry = await PluginRegistry.load(config.pluginDirs);
const runtime = new WidgetRuntime(box);

const app = createApp({ config, db, box, registry, runtime });

housekeeping(db);
setInterval(() => housekeeping(db), 3600_000).unref();

const hasUsers = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n > 0;
if (!hasUsers) {
  console.warn(
    config.setupToken
      ? "⚠  Sin usuarios: el asistente de primer arranque pedirá OBLIVION_SETUP_TOKEN."
      : "⚠  Sin usuarios: quien abra la web primero crea la cuenta de administrador. " +
          "Define OBLIVION_SETUP_TOKEN si el servidor es accesible desde fuera.",
  );
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`dashboard escuchando en http://${info.address}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
