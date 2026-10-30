import { Hono } from "hono";
import { z } from "zod";
import {
  clearSessionCookie,
  createSession,
  requireUser,
  setSessionCookie,
  type AppEnv,
} from "../auth.js";
import { burnPasswordCheck, hashPassword, safeEqual, verifyPassword } from "../crypto.js";
import type { SessionDTO } from "@oblivion/sdk";
import { audit, tx, type DB } from "../db.js";
import { RateLimiter } from "../security/ratelimit.js";
import type { AppDeps } from "../app.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "El usuario debe tener al menos 3 caracteres")
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "El usuario solo puede tener letras, números, _ . -");

export const passwordSchema = z
  .string()
  .min(12, "La contraseña debe tener al menos 12 caracteres")
  .max(256);

/** Sesiones de un usuario, de la más reciente a la más antigua. */
export function listSessions(db: DB, userId: string, currentHash: string | null): SessionDTO[] {
  const rows = db
    .prepare(
      "SELECT id_hash, ip, user_agent, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC",
    )
    .all(userId) as { id_hash: string; ip: string | null; user_agent: string | null; created_at: number; last_seen: number }[];
  return rows.map((r) => ({
    id: r.id_hash,
    current: r.id_hash === currentHash,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
  }));
}

export function authRoutes({ db, config }: AppDeps) {
  const app = new Hono<AppEnv>();

  // 5 fallos por usuario y 20 por IP cada 15 minutos.
  const failUser = new RateLimiter(5, 15 * 60_000);
  const failIp = new RateLimiter(20, 15 * 60_000);
  const setupIp = new RateLimiter(10, 15 * 60_000);

  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

  app.get("/status", (c) => {
    return c.json({
      setupRequired: userCount() === 0,
      setupTokenRequired: userCount() === 0 && config.setupToken !== null,
      user: c.get("user"),
    });
  });

  app.post("/setup", async (c) => {
    const ip = c.get("ip");
    if (!setupIp.hit(ip).allowed) return c.json({ error: "Demasiados intentos" }, 429);

    const parsed = z
      .object({ username: usernameSchema, password: passwordSchema, token: z.string().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);
    const { username, password, token } = parsed.data;

    if (config.setupToken && !safeEqual(token ?? "", config.setupToken)) {
      audit(db, "setup_bad_token", { ip });
      return c.json({ error: "Código de configuración incorrecto" }, 403);
    }

    const hash = await hashPassword(password, config.scryptN);
    const id = crypto.randomUUID();
    const created = tx(db, () => {
      if (userCount() > 0) return false; // alguien llegó antes
      const now = Date.now();
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)",
      ).run(id, username, hash, "admin", now);
      db.prepare("INSERT INTO pages (id, title, position, created_at) VALUES (?,?,?,?)").run(
        "inicio",
        "Inicio",
        0,
        now,
      );
      return true;
    });
    if (!created) return c.json({ error: "La instalación ya fue configurada" }, 409);

    audit(db, "setup", { username, ip });
    const sessionToken = createSession(db, id, ip, c.req.header("user-agent"));
    setSessionCookie(c, config, sessionToken);
    return c.json({ user: { id, username, role: "admin", mustChangePassword: false } }, 201);
  });

  app.post("/login", async (c) => {
    const ip = c.get("ip");
    const parsed = z
      .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Datos inválidos" }, 400);
    const { username, password } = parsed.data;
    const userKey = username.toLowerCase();

    const blocked = [failIp.isBlocked(ip), failUser.isBlocked(userKey)].find((b) => b.blocked);
    if (blocked) {
      audit(db, "login_blocked", { username, ip });
      c.header("Retry-After", String(blocked.retryAfter));
      return c.json({ error: "Demasiados intentos. Prueba más tarde." }, 429);
    }

    const row = db
      .prepare("SELECT id, username, password_hash, role, must_change_password FROM users WHERE username = ?")
      .get(username) as
      | { id: string; username: string; password_hash: string; role: "admin" | "viewer"; must_change_password: number }
      | undefined;

    let ok = false;
    if (row) ok = await verifyPassword(password, row.password_hash);
    else await burnPasswordCheck(config.scryptN); // mismo coste exista o no el usuario

    if (!ok || !row) {
      failIp.hit(ip);
      failUser.hit(userKey);
      audit(db, "login_failed", { username, ip });
      return c.json({ error: "Usuario o contraseña incorrectos" }, 401);
    }

    failUser.reset(userKey);
    const token = createSession(db, row.id, ip, c.req.header("user-agent"));
    setSessionCookie(c, config, token);
    audit(db, "login", { username: row.username, ip });
    return c.json({
      user: { id: row.id, username: row.username, role: row.role, mustChangePassword: row.must_change_password === 1 },
    });
  });

  app.post("/logout", (c) => {
    const hash = c.get("sessionHash");
    if (hash) db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
    clearSessionCookie(c, config);
    return c.json({ ok: true });
  });

  app.post("/password", requireUser, async (c) => {
    const user = c.get("user")!;
    const ip = c.get("ip");
    const parsed = z
      .object({ current: z.string().min(1).max(256), next: passwordSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);

    if (failUser.isBlocked(user.username.toLowerCase()).blocked) {
      return c.json({ error: "Demasiados intentos. Prueba más tarde." }, 429);
    }
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as {
      password_hash: string;
    };
    if (!(await verifyPassword(parsed.data.current, row.password_hash))) {
      failUser.hit(user.username.toLowerCase());
      audit(db, "password_change_failed", { username: user.username, ip });
      return c.json({ error: "La contraseña actual no es correcta" }, 403);
    }

    if (parsed.data.next === parsed.data.current) {
      return c.json({ error: "La contraseña nueva debe ser distinta de la actual" }, 400);
    }

    const hash = await hashPassword(parsed.data.next, config.scryptN);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, user.id);
    // Cierra todas las demás sesiones de este usuario.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(user.id, c.get("sessionHash"));
    audit(db, "password_changed", { username: user.username, ip });
    return c.json({ ok: true });
  });

  // ───────── mis sesiones ─────────

  app.get("/sessions", requireUser, (c) => {
    return c.json({ sessions: listSessions(db, c.get("user")!.id, c.get("sessionHash")) });
  });

  app.post("/sessions/revoke-others", requireUser, (c) => {
    const user = c.get("user")!;
    const res = db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?")
      .run(user.id, c.get("sessionHash"));
    audit(db, "sessions_revoked_others", { username: user.username, ip: c.get("ip"), detail: String(res.changes) });
    return c.json({ revoked: Number(res.changes) });
  });

  app.delete("/sessions/:sid", requireUser, (c) => {
    const user = c.get("user")!;
    const sid = c.req.param("sid");
    const res = db.prepare("DELETE FROM sessions WHERE id_hash = ? AND user_id = ?").run(sid, user.id);
    if (res.changes === 0) return c.json({ error: "No existe" }, 404);
    audit(db, "session_revoked", { username: user.username, ip: c.get("ip") });
    // Si era la sesión actual, también se limpia la cookie.
    if (sid === c.get("sessionHash")) clearSessionCookie(c, config);
    return c.json({ ok: true });
  });

  return app;
}
