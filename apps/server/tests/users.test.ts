import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, loggedInAdmin, makeApp, PASSWORD } from "./helpers.js";

const TEMP = "contraseña temporal larga 1";
const NEW = "una contraseña nueva y larga 2";

async function setup() {
  const ctx = await makeApp();
  const admin = await loggedInAdmin(ctx.app);
  const create = (body: Record<string, unknown>) => admin.post("/api/users", body);
  const login = async (username: string, password: string) => {
    const c = client(ctx.app);
    const r = await c.post("/api/auth/login", { username, password });
    return { c, r };
  };
  return { ...ctx, admin, create, login };
}

const audits = (db: any) => (db.prepare("SELECT event FROM audit_log").all() as { event: string }[]).map((r) => r.event);

describe("gestión de usuarios", () => {
  it("el administrador crea usuarios y la lista no expone contraseñas", async () => {
    const { admin, create } = await setup();
    const r = await create({ username: "ana", password: TEMP, role: "viewer" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.user.role, "viewer");
    assert.equal(r.json.user.mustChangePassword, true, "por defecto es temporal");

    const list = (await admin.get("/api/users")).json.users;
    assert.deepEqual(list.map((u: any) => u.username), ["admin", "ana"]);
    assert.equal(JSON.stringify(list).includes("scrypt"), false, "nunca se envían hashes");
    assert.equal(JSON.stringify(list).includes("password_hash"), false);
  });

  it("valida nombre, contraseña, rol y duplicados (sin distinguir mayúsculas)", async () => {
    const { create } = await setup();
    assert.equal((await create({ username: "ab", password: TEMP, role: "viewer" })).status, 400);
    assert.equal((await create({ username: "con espacio", password: TEMP, role: "viewer" })).status, 400);
    assert.equal((await create({ username: "bob", password: "corta", role: "viewer" })).status, 400);
    assert.equal((await create({ username: "bob", password: TEMP, role: "superadmin" })).status, 400);
    assert.equal((await create({ username: "ADMIN", password: TEMP, role: "viewer" })).status, 409);
    assert.equal((await create({ username: "bob", password: TEMP, role: "viewer" })).status, 201);
    assert.equal((await create({ username: "BOB", password: TEMP, role: "viewer" })).status, 409);
  });

  it("solo los administradores gestionan usuarios", async () => {
    const { create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false });
    const { c } = await login("ana", TEMP);
    for (const req of [() => c.get("/api/users"), () => c.post("/api/users", { username: "x1x", password: TEMP, role: "admin" })]) {
      assert.equal((await req()).status, 403);
    }
    assert.equal((await client((await setup()).app).get("/api/users")).status, 401);
  });

  it("no deja quedarse sin administradores ni borrarse a uno mismo", async () => {
    const { admin, create, db } = await setup();
    const me = (await admin.get("/api/users")).json.users[0];

    assert.equal((await admin.patch(`/api/users/${me.id}`, { role: "viewer" })).status, 400, "último admin");
    assert.equal((await admin.del(`/api/users/${me.id}`)).status, 400, "no te borras a ti mismo");

    const other = (await create({ username: "otro", password: TEMP, role: "admin" })).json.user;
    // Con dos administradores ya se puede degradar uno.
    assert.equal((await admin.patch(`/api/users/${other.id}`, { role: "viewer" })).status, 200);
    // Y de nuevo queda uno solo: el actual no puede degradarse.
    assert.equal((await admin.patch(`/api/users/${me.id}`, { role: "viewer" })).status, 400);
    assert.equal(audits(db).includes("role_changed"), true);
  });

  it("al borrar un administrador con otro disponible se permite, y desaparece su acceso", async () => {
    const { admin, create, login } = await setup();
    const other = (await create({ username: "otro", password: TEMP, role: "admin", mustChangePassword: false })).json.user;
    const { c } = await login("otro", TEMP);
    assert.equal((await c.get("/api/pages")).status, 200);
    assert.equal((await admin.del(`/api/users/${other.id}`)).status, 200);
    assert.equal((await c.get("/api/pages")).status, 401, "sus sesiones se cierran al borrarlo");
    assert.equal((await login("otro", TEMP)).r.status, 401);
  });

  it("cambiar el rol surte efecto de inmediato en sesiones ya abiertas", async () => {
    const { admin, create, login } = await setup();
    const u = (await create({ username: "ana", password: TEMP, role: "admin", mustChangePassword: false })).json.user;
    const { c } = await login("ana", TEMP);
    assert.equal((await c.post("/api/pages", { title: "x" })).status, 201);
    await admin.patch(`/api/users/${u.id}`, { role: "viewer" });
    assert.equal((await c.post("/api/pages", { title: "y" })).status, 403);
    assert.equal((await c.get("/api/pages")).status, 200, "sigue pudiendo ver");
  });
});

describe("contraseñas temporales", () => {
  it("bloquea todo salvo cambiar la contraseña hasta que se cambie", async () => {
    const { create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer" });
    const { c, r } = await login("ana", TEMP);
    assert.equal(r.json.user.mustChangePassword, true);

    const blocked = await c.get("/api/pages");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, "password_change_required");
    assert.equal((await c.get("/api/appearance")).status, 403);
    assert.equal((await c.get("/api/auth/status")).json.user.mustChangePassword, true);

    // Debe ser distinta de la actual.
    assert.equal((await c.post("/api/auth/password", { current: TEMP, next: TEMP })).status, 400);
    assert.equal((await c.post("/api/auth/password", { current: TEMP, next: NEW })).status, 200);

    assert.equal((await c.get("/api/pages")).status, 200, "desbloqueado");
    assert.equal((await c.get("/api/auth/status")).json.user.mustChangePassword, false);
    assert.equal((await login("ana", NEW)).r.status, 200);
  });

  it("también se puede cerrar sesión estando bloqueado", async () => {
    const { create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer" });
    const { c } = await login("ana", TEMP);
    assert.equal((await c.post("/api/auth/logout")).status, 200);
  });

  it("restablecer la contraseña de alguien la deja temporal y cierra sus sesiones", async () => {
    const { admin, create, login, db } = await setup();
    const u = (await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false })).json.user;
    const { c } = await login("ana", TEMP);
    assert.equal((await c.get("/api/pages")).status, 200);

    const reset = await admin.patch(`/api/users/${u.id}`, { password: "otra temporal muy larga 3" });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.user.mustChangePassword, true);
    assert.equal(reset.json.user.sessions, 0);
    assert.equal((await c.get("/api/pages")).status, 401, "la sesión anterior ya no sirve");
    assert.equal((await login("ana", TEMP)).r.status, 401, "la contraseña vieja ya no sirve");
    assert.equal((await login("ana", "otra temporal muy larga 3")).r.status, 200);
    assert.ok(audits(db).includes("password_reset"));
  });

  it("el administrador no restablece su propia contraseña por esa vía", async () => {
    const { admin } = await setup();
    const me = (await admin.get("/api/users")).json.users[0];
    assert.equal((await admin.patch(`/api/users/${me.id}`, { password: TEMP })).status, 400);
  });
});

describe("sesiones", () => {
  it("cada usuario ve las suyas y marca cuál es la actual", async () => {
    const { admin, create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false });
    const a = (await login("ana", TEMP)).c;
    const b = (await login("ana", TEMP)).c;

    const mine = (await a.get("/api/auth/sessions")).json.sessions;
    assert.equal(mine.length, 2);
    assert.equal(mine.filter((s: any) => s.current).length, 1);
    // Las del administrador no se mezclan.
    assert.equal((await admin.get("/api/auth/sessions")).json.sessions.length, 1);
    assert.equal(JSON.stringify(mine).includes("oblivion_sid"), false);

    // Cerrar la otra sesión la invalida.
    const other = mine.find((s: any) => !s.current);
    assert.equal((await a.del(`/api/auth/sessions/${other.id}`)).status, 200);
    assert.equal((await a.get("/api/pages")).status, 200);
    assert.equal((await b.get("/api/pages")).status, 401);
  });

  it("no se puede cerrar la sesión de otra persona con su identificador", async () => {
    const { admin, create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false });
    const ana = (await login("ana", TEMP)).c;
    const adminSession = (await admin.get("/api/auth/sessions")).json.sessions[0];
    assert.equal((await ana.del(`/api/auth/sessions/${adminSession.id}`)).status, 404);
    assert.equal((await admin.get("/api/pages")).status, 200);
  });

  it("«cerrar las demás» conserva la actual", async () => {
    const { create, login } = await setup();
    await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false });
    const a = (await login("ana", TEMP)).c;
    const b = (await login("ana", TEMP)).c;
    const c3 = (await login("ana", TEMP)).c;
    const r = await a.post("/api/auth/sessions/revoke-others");
    assert.equal(r.json.revoked, 2);
    assert.equal((await a.get("/api/pages")).status, 200);
    assert.equal((await b.get("/api/pages")).status, 401);
    assert.equal((await c3.get("/api/pages")).status, 401);
  });

  it("cerrar la propia sesión actual limpia la cookie", async () => {
    const { admin } = await setup();
    const cur = (await admin.get("/api/auth/sessions")).json.sessions[0];
    assert.equal((await admin.del(`/api/auth/sessions/${cur.id}`)).status, 200);
    assert.equal((await admin.get("/api/pages")).status, 401);
  });

  it("el administrador ve y cierra las sesiones de otros usuarios", async () => {
    const { admin, create, login, db } = await setup();
    const u = (await create({ username: "ana", password: TEMP, role: "viewer", mustChangePassword: false })).json.user;
    const a = (await login("ana", TEMP)).c;
    await login("ana", TEMP);

    assert.equal((await admin.get(`/api/users/${u.id}/sessions`)).json.sessions.length, 2);
    assert.equal((await admin.get("/api/users")).json.users.find((x: any) => x.id === u.id).sessions, 2);

    const one = (await admin.get(`/api/users/${u.id}/sessions`)).json.sessions[0];
    assert.equal((await admin.del(`/api/users/${u.id}/sessions/${one.id}`)).status, 200);
    assert.equal((await admin.del(`/api/users/${u.id}/sessions/${one.id}`)).status, 404);

    const all = await admin.del(`/api/users/${u.id}/sessions`);
    assert.equal(all.json.revoked, 1);
    assert.equal((await a.get("/api/pages")).status, 401);
    assert.ok(audits(db).includes("sessions_revoked"));
  });
});

describe("auditoría de usuarios", () => {
  it("registra altas, bajas y cambios sin guardar contraseñas", async () => {
    const { admin, create, db } = await setup();
    const u = (await create({ username: "ana", password: TEMP, role: "viewer" })).json.user;
    await admin.patch(`/api/users/${u.id}`, { role: "admin" });
    await admin.del(`/api/users/${u.id}`);
    const events = audits(db);
    for (const e of ["user_created", "role_changed", "user_deleted"]) assert.ok(events.includes(e), e);
    const dump = JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    assert.equal(dump.includes(TEMP), false);
    assert.equal(dump.includes(PASSWORD), false);
  });
});
