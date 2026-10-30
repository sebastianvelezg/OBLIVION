import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authenticate, csrfGuard, mustChangePasswordGuard, type AppEnv } from "./auth.js";
import type { Config } from "./config.js";
import { BusyError, type SecretBox } from "./crypto.js";
import type { DB } from "./db.js";
import type { PluginRegistry } from "./plugins/registry.js";
import type { WidgetRuntime } from "./plugins/runtime.js";
import { authRoutes } from "./routes/auth.js";
import { configRoutes } from "./routes/config.js";
import { connectionRoutes } from "./routes/connections.js";
import { pageRoutes } from "./routes/pages.js";
import { appearanceRoutes, MAX_BACKGROUND_BYTES } from "./routes/appearance.js";
import { userRoutes } from "./routes/users.js";
import { RateLimiter } from "./security/ratelimit.js";

export interface AppDeps {
  config: Config;
  db: DB;
  box: SecretBox;
  registry: PluginRegistry;
  runtime: WidgetRuntime;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function createApp(deps: AppDeps) {
  const { config, db } = deps;
  const app = new Hono<AppEnv>();
  const apiLimiter = new RateLimiter(600, 60_000);

  // ───── Lista de hosts permitidos (defensa contra DNS rebinding / Host falsos) ─────
  if (config.allowedHosts.length > 0) {
    app.use("*", async (c, next) => {
      const host = ((config.trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host") || "")
        .toLowerCase();
      if (!config.allowedHosts.includes(host)) return c.text("Host no permitido", 421);
      await next();
    });
  }

  // ───── Cabeceras de seguridad en todas las respuestas ─────
  app.use("*", async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        // Los widgets «Página web» necesitan poder embeber otros sitios.
        "frame-src https: http:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https") {
      h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // ───── API ─────
  const api = new Hono<AppEnv>();
  const tooBig = (c: Context) => c.json({ error: "Cuerpo demasiado grande" }, 413);
  const smallBody = bodyLimit({ maxSize: 256 * 1024, onError: tooBig });
  const imageBody = bodyLimit({ maxSize: MAX_BACKGROUND_BYTES + 1024, onError: tooBig });
  // Los documentos de configuración en texto pueden ser largos (notas, muchos widgets).
  const docsBody = bodyLimit({ maxSize: 1024 * 1024, onError: tooBig });
  api.use("*", (c, next) => {
    if (c.req.path === "/api/appearance/background") return imageBody(c, next);
    return (c.req.path.startsWith("/api/config") ? docsBody : smallBody)(c, next);
  });
  api.use("*", authenticate(db, config));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!apiLimiter.hit(c.get("ip")).allowed) return c.json({ error: "Demasiadas peticiones" }, 429);
    await next();
  });
  api.use("*", csrfGuard(config));
  api.use("*", mustChangePasswordGuard);

  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/auth", authRoutes(deps));
  api.route("/appearance", appearanceRoutes(deps));
  api.route("/users", userRoutes(deps));
  api.route("/", connectionRoutes(deps));
  api.route("/", configRoutes(deps));
  api.route("/", pageRoutes(deps));
  api.notFound((c) => c.json({ error: "No encontrado" }, 404));

  app.route("/api", api);

  // ───── Frontend compilado (SPA) ─────
  const indexFile = path.join(config.webDir, "index.html");
  const hasWeb = fs.existsSync(indexFile);
  if (hasWeb) {
    app.get("*", (c) => {
      const url = new URL(c.req.url);
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname);
      } catch {
        return c.text("Bad request", 400);
      }
      const target = path.resolve(config.webDir, "." + path.posix.normalize("/" + rel));
      // Evita salir de la carpeta del frontend.
      const inside = target === config.webDir || target.startsWith(config.webDir + path.sep);
      const isAsset = inside && fs.existsSync(target) && fs.statSync(target).isFile();
      const file = isAsset ? target : indexFile;
      const ext = path.extname(file).toLowerCase();
      const body = fs.readFileSync(file);
      const immutable = isAsset && url.pathname.startsWith("/assets/");
      return new Response(body, {
        headers: {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    });
  } else {
    app.get("/", (c) =>
      c.text("API en marcha. El frontend no está compilado (npm run build) o usa «npm run dev».", 200),
    );
  }

  app.onError((err, c) => {
    if (err instanceof BusyError) {
      c.header("Retry-After", "5");
      return c.json({ error: "Servidor ocupado, inténtalo en unos segundos" }, 503);
    }
    console.error("error no controlado:", err);
    return c.json({ error: "Error interno" }, 500);
  });

  return app;
}
