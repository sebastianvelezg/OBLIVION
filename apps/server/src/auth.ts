import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionUser } from "@oblivion/sdk";
import type { Config } from "./config.js";
import { randomToken, sha256 } from "./crypto.js";
import type { DB } from "./db.js";

export const SESSION_COOKIE = "oblivion_sid";
const IDLE_MS = 7 * 24 * 3600 * 1000;
const ABSOLUTE_MS = 30 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type AppEnv = {
  Variables: { user: SessionUser | null; ip: string; sessionHash: string | null };
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } };
};

export function clientIp(c: Context<AppEnv>, config: Config): string {
  if (config.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      // Con un proxy de confianza, la última entrada es la que él añadió.
      const last = xff.split(",").pop()?.trim();
      if (last) return last;
    }
  }
  return c.env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export function isSecureRequest(c: Context<AppEnv>, config: Config): boolean {
  if (config.cookieSecure === "always") return true;
  if (config.cookieSecure === "never") return false;
  if (new URL(c.req.url).protocol === "https:") return true;
  return config.trustProxy && c.req.header("x-forwarded-proto") === "https";
}

export function createSession(db: DB, userId: string, ip: string, ua: string | undefined) {
  const token = randomToken(32);
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen, ip, user_agent) VALUES (?,?,?,?,?,?)",
  ).run(sha256(token), userId, now, now, ip, ua?.slice(0, 200) ?? null);
  return token;
}

export function setSessionCookie(c: Context<AppEnv>, config: Config, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: isSecureRequest(c, config),
    path: "/",
    maxAge: Math.floor(ABSOLUTE_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppEnv>, config: Config) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureRequest(c, config) });
}

/** Lee la cookie, valida la sesión (inactividad y vida máxima) y puebla `c.var.user`. */
export function authenticate(db: DB, config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("ip", clientIp(c, config));
    c.set("user", null);
    c.set("sessionHash", null);

    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const hash = sha256(token);
      const row = db
        .prepare(
          `SELECT s.created_at, s.last_seen, u.id, u.username, u.role, u.must_change_password
             FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
        )
        .get(hash) as
        | {
            created_at: number;
            last_seen: number;
            id: string;
            username: string;
            role: "admin" | "viewer";
            must_change_password: number;
          }
        | undefined;
      const now = Date.now();
      if (row) {
        if (now - row.last_seen > IDLE_MS || now - row.created_at > ABSOLUTE_MS) {
          db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
        } else {
          if (now - row.last_seen > TOUCH_EVERY_MS) {
            db.prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(now, hash);
          }
          c.set("user", {
            id: row.id,
            username: row.username,
            role: row.role,
            mustChangePassword: row.must_change_password === 1,
          });
          c.set("sessionHash", hash);
        }
      }
    }
    await next();
  };
}

/** Con contraseña temporal solo se puede ver el estado, cambiarla o cerrar sesión. */
const ALLOWED_WHEN_TEMP_PASSWORD = new Set(["/api/auth/status", "/api/auth/password", "/api/auth/logout", "/api/health"]);

export const mustChangePasswordGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.mustChangePassword && !ALLOWED_WHEN_TEMP_PASSWORD.has(c.req.path)) {
    return c.json({ error: "Debes cambiar tu contraseña temporal", code: "password_change_required" }, 403);
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "No autenticado" }, 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "No autenticado" }, 401);
  if (user.role !== "admin") return c.json({ error: "Requiere permisos de administrador" }, 403);
  await next();
};

/**
 * Defensa CSRF para la API: la cookie ya es SameSite=Strict; además exigimos una
 * cabecera personalizada (un formulario de otro sitio no puede enviarla) y, si
 * el navegador manda Origin, que coincida con el host al que se llamó.
 */
export const csrfGuard =
  (config: Config): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

    if (c.req.header("x-requested-with") !== "oblivion") {
      return c.json({ error: "Petición rechazada (CSRF)" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin) {
      const host =
        (config.trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host");
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) return c.json({ error: "Origen no permitido" }, 403);
    }
    await next();
  };
