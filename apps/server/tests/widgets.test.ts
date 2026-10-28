import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loggedInAdmin, makeApp } from "./helpers.js";

async function firstPage(c: Awaited<ReturnType<typeof loggedInAdmin>>) {
  return (await c.get("/api/pages")).json.pages[0] as { id: string };
}

describe("widgets y páginas", () => {
  it("el catálogo incluye core y plugins", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const types = (await c.get("/api/catalog")).json.widgets.map((w: any) => w.fullType);
    assert.ok(types.includes("core.clock"));
    assert.ok(types.includes("demo.echo"));
  });

  it("crea, mueve y borra un widget", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);

    const created = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} });
    assert.equal(created.status, 201);
    const w = created.json.widget;
    assert.equal(w.config.date, true);

    const layout = await c.put(`/api/pages/${page.id}/layout`, { items: [{ id: w.id, x: 4, y: 2, w: 3, h: 3 }] });
    assert.equal(layout.status, 200);
    const moved = (await c.get("/api/pages")).json.pages[0].widgets[0];
    assert.deepEqual([moved.x, moved.y], [4, 2]);

    assert.equal((await c.del(`/api/widgets/${w.id}`)).status, 200);
    assert.equal((await c.get("/api/pages")).json.pages[0].widgets.length, 0);
  });

  it("coloca los widgets nuevos en el primer hueco libre", async () => {
    const { findFreeSlot } = await import("../src/routes/pages.js");
    assert.deepEqual(findFreeSlot([], 3, 3), { x: 0, y: 0 });
    assert.deepEqual(findFreeSlot([{ x: 0, y: 0, w: 3, h: 3 }], 3, 3), { x: 3, y: 0 });
    assert.deepEqual(findFreeSlot([{ x: 0, y: 0, w: 12, h: 2 }], 4, 4), { x: 0, y: 2 });
    // Hueco bajo un widget corto, al lado de uno alto.
    const taken = [
      { x: 0, y: 0, w: 6, h: 2 },
      { x: 6, y: 0, w: 6, h: 6 },
    ];
    assert.deepEqual(findFreeSlot(taken, 6, 3), { x: 0, y: 2 });
  });

  it("ignora posiciones que se salen de la grilla", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    const w = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} })).json.widget;
    await c.put(`/api/pages/${page.id}/layout`, { items: [{ id: w.id, x: 11, y: 0, w: 5, h: 2 }] });
    const after = (await c.get("/api/pages")).json.pages[0].widgets[0];
    assert.equal(after.x, 0);
  });

  it("rechaza tipos desconocidos y configuración inválida", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    assert.equal((await c.post(`/api/pages/${page.id}/widgets`, { type: "x.y", config: {} })).status, 400);
    const missing = await c.post(`/api/pages/${page.id}/widgets`, { type: "demo.echo", config: {} });
    assert.equal(missing.status, 400);
  });

  it("bloquea URLs peligrosas (javascript:, data:, file:)", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd"]) {
      const r = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.embed", config: { url } });
      assert.equal(r.status, 400, url);
      const l = await c.post(`/api/pages/${page.id}/widgets`, {
        type: "core.links",
        config: { items: [{ label: "x", url }] },
      });
      assert.equal(l.status, 400, url);
    }
    const ok = await c.post(`/api/pages/${page.id}/widgets`, {
      type: "core.links",
      config: { items: [{ label: "Jellyfin", url: "http://192.168.1.10:8096" }], extra: "descartado" },
    });
    assert.equal(ok.status, 201);
    assert.equal("extra" in ok.json.widget.config, false);
  });

  it("los secretos se cifran y nunca vuelven al navegador", async () => {
    const { app, db } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);

    const created = await c.post(`/api/pages/${page.id}/widgets`, {
      type: "demo.echo",
      config: { name: "mundo", token: "SUPER-SECRETO" },
    });
    const w = created.json.widget;
    assert.equal(JSON.stringify(created.json).includes("SUPER-SECRETO"), false);
    assert.deepEqual(w.secretsSet, ["token"]);
    assert.equal("token" in w.config, false);

    const raw = (db.prepare("SELECT config FROM widgets WHERE id = ?").get(w.id) as { config: string }).config;
    assert.equal(raw.includes("SUPER-SECRETO"), false, "no debe estar en claro en la base de datos");
    assert.match(raw, /enc:v1:/);

    // El plugin sí recibe el valor descifrado.
    const data = await c.get(`/api/widgets/${w.id}/data`);
    assert.equal(data.json.ok, true);
    assert.equal(data.json.view.text, "hola mundo SUPER-SECRETO");

    // Editar sin enviar el secreto lo conserva.
    await c.patch(`/api/widgets/${w.id}`, { config: { name: "otro" } });
    const again = await c.get(`/api/widgets/${w.id}/data`);
    assert.equal(again.json.view.text, "hola otro SUPER-SECRETO");

    // null lo borra.
    await c.patch(`/api/widgets/${w.id}`, { config: { name: "otro", token: null } });
    const cleared = await c.get(`/api/widgets/${w.id}/data`);
    assert.equal(cleared.json.view.text, "hola otro");
  });

  it("un viewer no puede modificar nada", async () => {
    const { app, db } = await makeApp();
    const admin = await loggedInAdmin(app);
    const { hashPassword } = await import("../src/crypto.js");
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)").run(
      "v1",
      "viewer",
      await hashPassword("una contraseña larga!", 2 ** 10),
      "viewer",
      Date.now(),
    );
    const { client } = await import("./helpers.js");
    const v = client(app);
    assert.equal((await v.post("/api/auth/login", { username: "viewer", password: "una contraseña larga!" })).status, 200);
    assert.equal((await v.get("/api/pages")).status, 200);
    const page = await firstPage(admin);
    assert.equal((await v.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} })).status, 403);
    assert.equal((await v.post("/api/pages", { title: "x" })).status, 403);
  });

  it("notas y recordatorios guardan su estado y lo validan", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);

    const note = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.notes", config: {} })).json.widget;
    assert.deepEqual(note.state, { text: "" });
    const saved = await c.put(`/api/widgets/${note.id}/state`, { text: "# Hola\n- [ ] algo" });
    assert.equal(saved.status, 200);
    assert.equal((await c.get("/api/pages")).json.pages[0].widgets[0].state.text, "# Hola\n- [ ] algo");

    // Tamaño máximo y forma inválida.
    assert.equal((await c.put(`/api/widgets/${note.id}/state`, { text: "x".repeat(20_001) })).status, 400);
    assert.equal((await c.put(`/api/widgets/${note.id}/state`, { text: 5 })).status, 400);
    assert.equal((await c.put(`/api/widgets/${note.id}/state`, { items: [] })).status, 400);

    const rem = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.reminders", config: {} })).json.widget;
    const good = { items: [{ id: "a", text: "Pagar luz", done: false, due: "2026-11-01", createdAt: 1 }] };
    assert.equal((await c.put(`/api/widgets/${rem.id}/state`, good)).status, 200);
    const badDue = { items: [{ id: "a", text: "x", done: false, due: "mañana", createdAt: 1 }] };
    assert.equal((await c.put(`/api/widgets/${rem.id}/state`, badDue)).status, 400);
    const empty = { items: [{ id: "a", text: "   ", done: false, due: null, createdAt: 1 }] };
    assert.equal((await c.put(`/api/widgets/${rem.id}/state`, empty)).status, 400);
  });

  it("un widget sin estado no acepta PUT /state y un viewer tampoco", async () => {
    const { app, db } = await makeApp();
    const admin = await loggedInAdmin(app);
    const page = await firstPage(admin);
    const clock = (await admin.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} })).json.widget;
    assert.equal((await admin.put(`/api/widgets/${clock.id}/state`, {})).status, 400);

    const note = (await admin.post(`/api/pages/${page.id}/widgets`, { type: "core.notes", config: {} })).json.widget;
    const { hashPassword } = await import("../src/crypto.js");
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)").run(
      "v1", "viewer", await hashPassword("una contraseña larga!", 2 ** 10), "viewer", Date.now(),
    );
    const { client } = await import("./helpers.js");
    const v = client(app);
    await v.post("/api/auth/login", { username: "viewer", password: "una contraseña larga!" });
    assert.equal((await v.put(`/api/widgets/${note.id}/state`, { text: "hack" })).status, 403);
  });

  it("no deja borrar la última página", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    assert.equal((await c.del(`/api/pages/${page.id}`)).status, 400);
  });
});
