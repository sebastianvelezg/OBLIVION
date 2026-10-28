import { Hono } from "hono";
import { z } from "zod";
import type { UserDTO } from "@oblivion/sdk";
import { requireAdmin, type AppEnv } from "../auth.js";
import { hashPassword } from "../crypto.js";
import { audit, tx } from "../db.js";
import type { AppDeps } from "../app.js";
import { listSessions, passwordSchema, usernameSchema } from "./auth.js";

const MAX_USERS = 50;
const roleSchema = z.enum(["admin", "viewer"]);

interface UserRow {
  id: string;
  username: string;
  role: "admin" | "viewer";
  created_at: number;
  must_change_password: number;
  sessions: number;
  last_seen: number | null;
}

/** Gestión de usuarios: solo administradores. */
export function userRoutes({ db, config }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireAdmin);

  const adminCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
  const find = (id: string) =>
    db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id) as
      | { id: string; username: string; role: "admin" | "viewer" }
      | undefined;

  function list(): UserDTO[] {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at, u.must_change_password,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
                (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen
           FROM users u ORDER BY u.created_at`,
      )
      .all() as unknown as UserRow[];
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      createdAt: r.created_at,
      mustChangePassword: r.must_change_password === 1,
      sessions: Number(r.sessions),
      lastSeen: r.last_seen === null ? null : Number(r.last_seen),
    }));
  }

  app.get("/", (c) => c.json({ users: list() }));

  app.post("/", async (c) => {
    const parsed = z
      .object({
        username: usernameSchema,
        password: passwordSchema,
        role: roleSchema,
        // Por defecto la contraseña que pones tú es temporal: la persona debe cambiarla al entrar.
        mustChangePassword: z.boolean().default(true),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);
    const { username, password, role, mustChangePassword } = parsed.data;

    const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    if (count >= MAX_USERS) return c.json({ error: `Máximo ${MAX_USERS} usuarios` }, 400);
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
      return c.json({ error: "Ya existe un usuario con ese nombre" }, 409);
    }

    const hash = await hashPassword(password, config.scryptN);
    const id = crypto.randomUUID();
    try {
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, created_at, must_change_password) VALUES (?,?,?,?,?,?)",
      ).run(id, username, hash, role, Date.now(), mustChangePassword ? 1 : 0);
    } catch {
      // Carrera con otra creación del mismo nombre (UNIQUE).
      return c.json({ error: "Ya existe un usuario con ese nombre" }, 409);
    }
    audit(db, "user_created", { username: c.get("user")!.username, ip: c.get("ip"), detail: `${username} (${role})` });
    return c.json({ user: list().find((u) => u.id === id) }, 201);
  });

  app.patch("/:id", async (c) => {
    const me = c.get("user")!;
    const target = find(c.req.param("id"));
    if (!target) return c.json({ error: "No existe" }, 404);

    const parsed = z
      .object({ role: roleSchema.optional(), password: passwordSchema.optional(), mustChangePassword: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);
    const { role, password, mustChangePassword } = parsed.data;

    if (password && target.id === me.id) {
      return c.json({ error: "Tu propia contraseña se cambia desde Ajustes → Cuenta" }, 400);
    }

    // Siempre debe quedar al menos un administrador.
    if (role && role !== target.role && target.role === "admin" && adminCount() <= 1) {
      return c.json({ error: "Debe quedar al menos un administrador" }, 400);
    }

    const hash = password ? await hashPassword(password, config.scryptN) : null;
    tx(db, () => {
      if (role && role !== target.role) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);
        audit(db, "role_changed", { username: me.username, ip: c.get("ip"), detail: `${target.username}: ${target.role} → ${role}` });
      }
      if (hash) {
        // Un restablecimiento por parte del administrador es siempre temporal y cierra todas sus sesiones.
        db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(
          hash,
          mustChangePassword === false ? 0 : 1,
          target.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        audit(db, "password_reset", { username: me.username, ip: c.get("ip"), detail: target.username });
      } else if (mustChangePassword !== undefined) {
        db.prepare("UPDATE users SET must_change_password = ? WHERE id = ?").run(mustChangePassword ? 1 : 0, target.id);
      }
    });
    return c.json({ user: list().find((u) => u.id === target.id) });
  });

  app.delete("/:id", (c) => {
    const me = c.get("user")!;
    const target = find(c.req.param("id"));
    if (!target) return c.json({ error: "No existe" }, 404);
    if (target.id === me.id) return c.json({ error: "No puedes eliminar tu propia cuenta" }, 400);
    if (target.role === "admin" && adminCount() <= 1) return c.json({ error: "Debe quedar al menos un administrador" }, 400);

    db.prepare("DELETE FROM users WHERE id = ?").run(target.id); // sus sesiones se borran en cascada
    audit(db, "user_deleted", { username: me.username, ip: c.get("ip"), detail: target.username });
    return c.json({ ok: true });
  });

  // ───────── sesiones de otro usuario ─────────

  app.get("/:id/sessions", (c) => {
    const target = find(c.req.param("id"));
    if (!target) return c.json({ error: "No existe" }, 404);
    return c.json({ sessions: listSessions(db, target.id, c.get("sessionHash")) });
  });

  app.delete("/:id/sessions", (c) => {
    const target = find(c.req.param("id"));
    if (!target) return c.json({ error: "No existe" }, 404);
    const res = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    audit(db, "sessions_revoked", { username: c.get("user")!.username, ip: c.get("ip"), detail: `${target.username}: ${res.changes}` });
    return c.json({ revoked: Number(res.changes) });
  });

  app.delete("/:id/sessions/:sid", (c) => {
    const target = find(c.req.param("id"));
    if (!target) return c.json({ error: "No existe" }, 404);
    const res = db.prepare("DELETE FROM sessions WHERE id_hash = ? AND user_id = ?").run(c.req.param("sid"), target.id);
    if (res.changes === 0) return c.json({ error: "No existe" }, 404);
    audit(db, "session_revoked", { username: c.get("user")!.username, ip: c.get("ip"), detail: target.username });
    return c.json({ ok: true });
  });

  return app;
}
