import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, loggedInAdmin, makeApp, PASSWORD } from "./helpers.js";

describe("autenticación", () => {
  it("el primer arranque pide configurar y luego se bloquea", async () => {
    const { app } = await makeApp();
    const c = client(app);
    assert.equal((await c.get("/api/auth/status")).json.setupRequired, true);

    const weak = await c.post("/api/auth/setup", { username: "admin", password: "corta" });
    assert.equal(weak.status, 400);

    const ok = await c.post("/api/auth/setup", { username: "admin", password: PASSWORD });
    assert.equal(ok.status, 201);
    assert.equal((await c.get("/api/auth/status")).json.setupRequired, false);

    const again = await client(app).post("/api/auth/setup", { username: "otro", password: PASSWORD });
    assert.equal(again.status, 409);
  });

  it("exige OBLIVION_SETUP_TOKEN cuando está definido", async () => {
    const { app } = await makeApp({ setupToken: "secreto" });
    const c = client(app);
    const bad = await c.post("/api/auth/setup", { username: "admin", password: PASSWORD, token: "x" });
    assert.equal(bad.status, 403);
    const ok = await c.post("/api/auth/setup", { username: "admin", password: PASSWORD, token: "secreto" });
    assert.equal(ok.status, 201);
  });

  it("la cookie de sesión es HttpOnly y SameSite=Strict", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "oblivion" },
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
  });

  it("no se puede usar la API sin sesión", async () => {
    const { app } = await makeApp();
    await loggedInAdmin(app);
    const anon = client(app);
    assert.equal((await anon.get("/api/pages")).status, 401);
    assert.equal((await anon.post("/api/pages", { title: "x" })).status, 401);
  });

  it("login correcto, incorrecto y logout", async () => {
    const { app } = await makeApp();
    await loggedInAdmin(app);
    const c = client(app);

    const bad = await c.post("/api/auth/login", { username: "admin", password: "mala" });
    assert.equal(bad.status, 401);
    const noUser = await c.post("/api/auth/login", { username: "nadie", password: "mala" });
    assert.equal(noUser.json.error, bad.json.error, "no debe revelar si el usuario existe");

    assert.equal((await c.post("/api/auth/login", { username: "ADMIN", password: PASSWORD })).status, 200);
    assert.equal((await c.get("/api/pages")).status, 200);
    await c.post("/api/auth/logout");
    assert.equal((await c.get("/api/pages")).status, 401);
  });

  it("bloquea tras 5 fallos y avisa con Retry-After", async () => {
    const { app } = await makeApp();
    await loggedInAdmin(app);
    const c = client(app);
    for (let i = 0; i < 5; i++) {
      assert.equal((await c.post("/api/auth/login", { username: "admin", password: "x" + i })).status, 401);
    }
    const blocked = await c.post("/api/auth/login", { username: "admin", password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });

  it("rechaza peticiones sin cabecera anti-CSRF o con Origin ajeno", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const noHeader = await app.request("/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c.cookie },
      body: JSON.stringify({ title: "x" }),
    });
    assert.equal(noHeader.status, 403);

    const foreign = await c.post("/api/pages", { title: "x" }, { origin: "https://evil.example" });
    assert.equal(foreign.status, 403);

    const same = await c.post("/api/pages", { title: "x" }, { origin: "http://localhost" });
    assert.equal(same.status, 201);
  });

  it("cambiar contraseña cierra las otras sesiones", async () => {
    const { app } = await makeApp();
    const a = await loggedInAdmin(app);
    const b = client(app);
    await b.post("/api/auth/login", { username: "admin", password: PASSWORD });
    assert.equal((await b.get("/api/pages")).status, 200);

    const wrong = await a.post("/api/auth/password", { current: "nope", next: "una contraseña nueva larga" });
    assert.equal(wrong.status, 403);
    const ok = await a.post("/api/auth/password", { current: PASSWORD, next: "una contraseña nueva larga" });
    assert.equal(ok.status, 200);

    assert.equal((await a.get("/api/pages")).status, 200);
    assert.equal((await b.get("/api/pages")).status, 401);
  });

  it("envía cabeceras de seguridad", async () => {
    const { app } = await makeApp();
    const res = await client(app).get("/api/health");
    assert.match(res.headers.get("content-security-policy")!, /default-src 'self'/);
    assert.match(res.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});
