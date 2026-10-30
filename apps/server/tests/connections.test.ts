import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { SecretBox } from "../src/crypto.js";
import { migrate } from "../src/db.js";
import { MOCK_API_KEY, startMockJellyfin, type MockJellyfin } from "./support/mock-jellyfin.js";
import { client, loggedInAdmin, makeApp, PASSWORD } from "./helpers.js";

let mock: MockJellyfin;
before(async () => {
  mock = await startMockJellyfin();
});
after(() => mock.close());

async function setup() {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  const connect = async (config: Record<string, unknown> = {}, name = "Casa") => {
    const r = await c.post("/api/connections", {
      pluginId: "jellyfin",
      name,
      config: { url: mock.url, apiKey: MOCK_API_KEY, ...config },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.connection as { id: string; secretsSet: string[]; widgets: number; config: Record<string, unknown> };
  };
  const widget = async (type: string, connectionId: string | undefined, config: Record<string, unknown> = {}) =>
    c.post(`/api/pages/${page.id}/widgets`, { type, config, connectionId });
  return { ...ctx, c, page, connect, widget };
}

describe("conexiones", () => {
  it("se crean validadas y nunca devuelven el secreto", async () => {
    const { c, connect } = await setup();
    const made = await connect();
    assert.deepEqual(made.secretsSet, ["apiKey"]);
    assert.equal(made.config.apiKey, undefined);
    assert.equal(made.config.url, mock.url + "/");

    const raw = JSON.stringify((await c.get("/api/connections")).json);
    assert.equal(raw.includes(MOCK_API_KEY), false);

    const bad = (body: unknown) => c.post("/api/connections", body);
    assert.equal((await bad({ pluginId: "jellyfin", name: "x", config: { url: "javascript:alert(1)", apiKey: MOCK_API_KEY } })).status, 400);
    assert.equal((await bad({ pluginId: "jellyfin", name: "x", config: { url: mock.url } })).status, 400, "falta la API key");
    assert.equal((await bad({ pluginId: "jellyfin", name: "  ", config: { url: mock.url, apiKey: MOCK_API_KEY } })).status, 400);
    assert.equal((await bad({ pluginId: "inexistente", name: "x", config: {} })).status, 400);
    assert.equal((await bad({ pluginId: "core", name: "x", config: {} })).status, 400, "core no usa conexiones");
  });

  it("solo el administrador las ve y gestiona", async () => {
    const { app, c, connect } = await setup();
    const made = await connect();
    await c.post("/api/users", { username: "ana", password: PASSWORD, role: "viewer", mustChangePassword: false });
    const viewer = client(app);
    assert.equal((await viewer.post("/api/auth/login", { username: "ana", password: PASSWORD })).status, 200);
    assert.equal((await viewer.get("/api/pages")).status, 200, "puede ver el dashboard: el 403 siguiente es por su rol, no por la contraseña temporal");
    assert.equal((await viewer.get("/api/connections")).status, 403);
    assert.equal((await viewer.post("/api/connections", { pluginId: "jellyfin", name: "x", config: {} })).status, 403);
    assert.equal((await viewer.patch(`/api/connections/${made.id}`, { name: "otra" })).status, 403);
    assert.equal((await viewer.del(`/api/connections/${made.id}`)).status, 403);
  });

  it("varios widgets comparten una conexión y editarla los actualiza a todos", async () => {
    const { c, connect, widget } = await setup();
    const conn = await connect();
    const a = (await widget("jellyfin.library", conn.id)).json.widget;
    const b = (await widget("jellyfin.now-playing", conn.id)).json.widget;
    assert.equal(a.connectionId, conn.id);
    assert.equal((await c.get(`/api/widgets/${a.id}/data`)).json.ok, true);
    assert.equal((await c.get(`/api/widgets/${b.id}/data`)).json.ok, true);
    assert.equal((await c.get("/api/connections")).json.connections[0].widgets, 2);

    // Una key equivocada en la conexión rompe ambos widgets (los datos cacheados se descartan).
    const patched = await c.patch(`/api/connections/${conn.id}`, { config: { url: mock.url, apiKey: "otra-key-equivocada-123" } });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    for (const w of [a, b]) {
      const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
      assert.equal(d.ok, false);
      assert.match(d.error, /rechazó la API key/);
    }

    // Dejar el secreto en blanco conserva el guardado; el nombre se puede cambiar solo.
    await c.patch(`/api/connections/${conn.id}`, { config: { url: mock.url, apiKey: MOCK_API_KEY } });
    const kept = await c.patch(`/api/connections/${conn.id}`, { name: "Salón", config: { url: mock.url, apiKey: "" } });
    assert.equal(kept.json.connection.name, "Salón");
    assert.equal((await c.get(`/api/widgets/${a.id}/data`)).json.ok, true);
  });

  it("un widget de un plugin con conexión la exige y debe ser de su plugin", async () => {
    const { c, connect, widget, page } = await setup();
    const conn = await connect();
    assert.equal((await widget("jellyfin.library", undefined)).status, 400);
    assert.equal((await widget("jellyfin.library", "no-existe")).status, 400);

    const other = (
      await c.post("/api/connections", { pluginId: "speedtest", name: "ST", config: { url: mock.url, version: "1" } })
    ).json.connection;
    assert.equal((await widget("jellyfin.library", other.id)).status, 400, "conexión de otro plugin");
    assert.equal((await widget("speedtest.latest", conn.id)).status, 400, "conexión de otro plugin");

    // Un plugin sin conexión no admite ninguna.
    const clock = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {}, connectionId: conn.id });
    assert.equal(clock.status, 400);
    assert.equal((await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} })).status, 201);
  });

  it("se puede cambiar un widget a otra conexión", async () => {
    const { c, connect, widget } = await setup();
    const good = await connect({}, "Buena");
    const bad = await connect({ apiKey: "otra-key-equivocada-123" }, "Mala");
    const w = (await widget("jellyfin.library", bad.id)).json.widget;
    assert.equal((await c.get(`/api/widgets/${w.id}/data`)).json.ok, false);

    const moved = await c.patch(`/api/widgets/${w.id}`, { connectionId: good.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.widget.connectionId, good.id);
    assert.equal((await c.get(`/api/widgets/${w.id}/data`)).json.ok, true);
  });

  it("no se puede borrar una conexión en uso", async () => {
    const { c, connect, widget } = await setup();
    const conn = await connect();
    const w = (await widget("jellyfin.library", conn.id)).json.widget;

    const blocked = await c.del(`/api/connections/${conn.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.error, /La usan 1 widget/);

    await c.del(`/api/widgets/${w.id}`);
    assert.equal((await c.del(`/api/connections/${conn.id}`)).status, 200);
    assert.equal((await c.get("/api/connections")).json.connections.length, 0);
    assert.equal((await c.del(`/api/connections/${conn.id}`)).status, 404);
  });

  it("los secretos de la conexión no aparecen en la lista de páginas ni en la de widgets", async () => {
    const { c, connect, widget } = await setup();
    const conn = await connect();
    await widget("jellyfin.library", conn.id);
    const raw = JSON.stringify([(await c.get("/api/pages")).json, (await c.get("/api/catalog")).json]);
    assert.equal(raw.includes(MOCK_API_KEY), false);
  });
});

describe("plugins con conexión", () => {
  it("se rechaza un plugin cuyo widget repite un campo de la conexión", async () => {
    const { registry } = await makeApp();
    const clash = () =>
      registry.register({
        id: "choque",
        name: "Choque",
        version: "1.0.0",
        connection: [{ key: "url", label: "URL", type: "url" }],
        widgets: [
          {
            type: "w",
            name: "W",
            description: "d",
            defaultSize: { w: 1, h: 1 },
            config: [{ key: "url", label: "Otra URL", type: "url" }],
            load: () => ({ kind: "message", text: "x" }),
          },
        ],
      });
    assert.throws(clash, /ya existe en la conexión/);
  });
});

describe("migración a conexiones", () => {
  it("agrupa los widgets antiguos que apuntaban al mismo servidor y conserva los secretos cifrados", async () => {
    const { db } = await makeApp();
    // Estado anterior: sin tabla de conexiones y con URL/key dentro de cada widget.
    const sqlite = process.getBuiltinModule("node:sqlite")!;
    const old = new sqlite.DatabaseSync(":memory:");
    old.exec("PRAGMA foreign_keys = ON");
    migrate(old, 3);

    const box = new SecretBox(randomBytes(32));
    old.prepare("INSERT INTO pages (id, title, position, created_at) VALUES ('p', 'Inicio', 0, 0)").run();
    const ins = old.prepare(
      "INSERT INTO widgets (id, page_id, type, title, config, x, y, w, h) VALUES (?, 'p', ?, '', ?, 0, 0, 4, 4)",
    );
    ins.run("w1", "jellyfin.library", JSON.stringify({ url: "http://192.168.1.5:8096/", apiKey: box.encrypt(MOCK_API_KEY) }));
    ins.run("w2", "jellyfin.latest", JSON.stringify({ url: "http://192.168.1.5:8096/", apiKey: box.encrypt(MOCK_API_KEY), kind: "Movie", limit: 6 }));
    ins.run("w3", "jellyfin.library", JSON.stringify({ url: "http://otro:8096/", apiKey: box.encrypt("otra-key-1234567") }));
    ins.run("w4", "speedtest.latest", JSON.stringify({ url: "http://192.168.1.5:8765/", version: "2", apiKey: box.encrypt("token-1234567890") }));
    ins.run("w5", "core.clock", JSON.stringify({ format: "24h" }));

    migrate(old, 6); // solo hasta las conexiones: los ids legibles (7) tienen su propia prueba

    const conns = old.prepare("SELECT * FROM connections ORDER BY plugin_id, name").all() as any[];
    assert.equal(conns.length, 3, "dos Jellyfin distintos + un Speedtest");
    assert.deepEqual(
      conns.map((c) => c.name),
      ["Jellyfin (192.168.1.5:8096)", "Jellyfin (otro:8096)", "Speedtest Tracker (192.168.1.5:8765)"],
    );

    const row = (id: string) => old.prepare("SELECT config, connection_id FROM widgets WHERE id = ?").get(id) as any;
    assert.equal(row("w1").connection_id, row("w2").connection_id, "mismo servidor → una conexión (aunque cada cifrado tenga nonce distinto)");
    assert.notEqual(row("w1").connection_id, row("w3").connection_id);
    assert.deepEqual(JSON.parse(row("w2").config), { kind: "Movie", limit: 6 }, "el widget conserva solo sus opciones");
    assert.equal(row("w5").connection_id, null);
    assert.deepEqual(JSON.parse(row("w5").config), { format: "24h" });

    // El secreto sigue cifrado y se descifra con la misma clave.
    const shared = JSON.parse(conns[0].config);
    assert.equal(box.decrypt(shared.apiKey), MOCK_API_KEY);
    assert.equal(JSON.parse(conns[2].config).version, "2");
    assert.equal((old.prepare("PRAGMA user_version").get() as any).user_version, 6);
    assert.ok(db);
  });
});
