import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SPEEDTEST_TOKEN, startMockHomelab, type MockHomelab } from "./support/mock-homelab.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockHomelab;
before(async () => {
  mock = await startMockHomelab();
});
after(() => mock.close());

async function setup() {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  // `config` mezcla, como antes, conexión y opciones del widget: aquí se separan.
  const add = async (type: string, config: Record<string, unknown>) => {
    let connectionId: string | undefined;
    let own = config;
    if (type.startsWith("speedtest.")) {
      const { url, version, apiKey, ...rest } = config;
      own = rest;
      const made = await c.post("/api/connections", { pluginId: "speedtest", name: "Speedtest", config: { url, version, apiKey } });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      connectionId = made.json.connection.id;
    }
    const r = await c.post(`/api/pages/${page.id}/widgets`, { type, config: own, connectionId });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.widget as { id: string };
  };
  const data = async (type: string, config: Record<string, unknown>) => {
    const w = await add(type, config);
    return (await c.get(`/api/widgets/${w.id}/data`)).json;
  };
  return { ...ctx, c, add, data };
}

const v1 = (extra = {}) => ({ url: mock.url + "/old", version: "1", ...extra });
const v2 = (extra = {}) => ({ url: mock.url + "/new", version: "2", apiKey: SPEEDTEST_TOKEN, ...extra });

describe("plugin Speedtest Tracker", () => {
  it("API antigua: muestra descarga, subida y ping sin autenticación", async () => {
    const { data } = await setup();
    mock.requests.length = 0;
    const d = await data("speedtest.latest", v1());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "metric");
    assert.equal(d.view.value, "94.3");
    assert.equal(d.view.unit, "Mbps ↓");
    const rows = Object.fromEntries(d.view.rows.map((r: any) => [r.label, r.value]));
    assert.equal(rows["Subida"], "20.6 Mbps");
    assert.equal(rows["Ping"], "10 ms");
    assert.match(rows["Hace"], /2 h/);
    assert.equal(mock.requests.at(-1)!.path, "/old/api/speedtest/latest");
    assert.equal(mock.requests.at(-1)!.auth, undefined, "la API antigua no recibe credenciales");
  });

  it("API nueva: envía Bearer + Accept y convierte bits/s a Gbps/Mbps", async () => {
    const { data } = await setup();
    mock.setLatestV2(undefined);
    mock.requests.length = 0;
    const d = await data("speedtest.latest", v2());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.value, "940");
    assert.equal(d.view.unit, "Mbps ↓");
    assert.equal(d.view.caption, "Último test · Claro Colombia");
    const sent = mock.requests.find((r) => r.path === "/new/api/v1/results/latest")!;
    assert.equal(sent.auth, `Bearer ${SPEEDTEST_TOKEN}`);
    assert.equal(sent.accept, "application/json");
  });

  it("API nueva: pasa a Gbps y entiende la respuesta envuelta en {data}", async () => {
    const { data } = await setup();
    mock.setLatestV2({ data: { download_bits: 2_350_000_000, upload_bits: 900_000_000, ping: 5, created_at: new Date().toISOString(), status: "completed" } });
    const d = await data("speedtest.latest", v2());
    assert.equal(d.view.value, "2.35");
    assert.equal(d.view.unit, "Gbps ↓");
  });

  it("avisa cuando el último test falló o aún no hay tests", async () => {
    const { data } = await setup();
    mock.setLatestV2({ download_bits: 0, upload_bits: 0, ping: 0, created_at: new Date().toISOString(), status: "failed" });
    const failed = await data("speedtest.latest", v2());
    assert.equal(failed.view.kind, "message");
    assert.equal(failed.view.tone, "bad");

    const none = await data("speedtest.latest", { url: mock.url + "/empty", version: "1" });
    assert.match(none.view.text, /ningún test/);
  });

  it("historial: lista los tests con barra relativa y marca los fallidos", async () => {
    const { data } = await setup();
    const d = await data("speedtest.history", v2({ limit: 8, mode: "list" }));
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "list");
    assert.equal(d.view.items.length, 4);
    const [a, b, failed] = d.view.items;
    assert.match(a.title, /↓ 940 Mbps/);
    assert.equal(b.progress, 1, "el mayor es la referencia");
    assert.ok(a.progress < 1 && a.progress > 0.7);
    assert.equal(failed.tone, "bad");
    assert.match(failed.title, /failed/);
    assert.match(b.title, /1\.20 Gbps/);
  });

  it("historial como gráfica: dos series de antiguo a reciente, sin los tests fallidos", async () => {
    const { data } = await setup();
    const d = await data("speedtest.history", v2());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "chart");
    assert.equal(d.view.unit, "Mbps");
    assert.deepEqual(d.view.series.map((s: any) => s.name), ["Descarga", "Subida"]);
    // 4 resultados, 1 fallido → 3 puntos; el más reciente (940.4) va al final.
    assert.deepEqual(d.view.series[0].points, [310.2, 1204.7, 940.4]);
    assert.equal(d.view.labels.length, 3);
    assert.match(d.view.caption, /3 tests · ping medio 15 ms/);
  });

  it("errores explicados: sin token, token malo, versión equivocada", async () => {
    const { data } = await setup();
    const noKey = await data("speedtest.latest", { url: mock.url + "/new", version: "2" });
    assert.match(noKey.error, /token de API/);

    const badKey = await data("speedtest.latest", v2({ apiKey: "token-equivocado-123" }));
    assert.match(badKey.error, /rechazó el token/);

    const wrongVersion = await data("speedtest.latest", { url: mock.url + "/new", version: "1" });
    assert.match(wrongVersion.error, /No se encontró la API antigua/);

    const hist1 = await data("speedtest.history", v1());
    assert.match(hist1.error, /versión nueva/);
  });

  it("nunca devuelve el token", async () => {
    const { c, add } = await setup();
    const w = await add("speedtest.latest", v2());
    const raw = JSON.stringify([(await c.get(`/api/widgets/${w.id}/data`)).json, (await c.get("/api/pages")).json]);
    assert.equal(raw.includes(SPEEDTEST_TOKEN), false);
  });
});

describe("plugin Estado de servicios", () => {
  it("distingue arriba, vivo-con-login, con error, redirección y caído", async () => {
    const { data } = await setup();
    const d = await data("services.status", {
      items: [
        { name: "Dockge", url: mock.url + "/up" },
        { name: "Portainer", url: mock.url + "/login-required" },
        { name: "Roto", url: mock.url + "/boom" },
        { name: "SSO", url: mock.url + "/redirect-login" },
        { name: "Apagado", url: "http://127.0.0.1:1/" },
      ],
    });
    assert.equal(d.ok, true, JSON.stringify(d));
    const by = Object.fromEntries(d.view.items.map((i: any) => [i.title, i]));

    assert.equal(by["Dockge"].tone, "good");
    assert.match(by["Dockge"].right, /^\d+ ms$/);
    assert.equal(by["Portainer"].tone, "good", "un 401 significa que el servicio está vivo");
    assert.equal(by["Roto"].right, "Error 500");
    assert.equal(by["Roto"].tone, "bad");
    assert.equal(by["SSO"].tone, "good", "una redirección a un login también está viva");
    assert.equal(by["Apagado"].right, "Caído");
    assert.equal(by["Apagado"].tone, "bad");
    assert.match(by["Apagado"].subtitle, /No se pudo conectar con 127\.0\.0\.1:1/);
  });

  it("sin servicios pide configurarlos", async () => {
    const { data } = await setup();
    const d = await data("services.status", { items: [] });
    assert.equal(d.view.kind, "message");
  });

  it("valida las URLs de la lista (nada de javascript: ni elementos incompletos)", async () => {
    const { c, add } = await setup();
    const page = (await c.get("/api/pages")).json.pages[0];
    const bad = (items: unknown) => c.post(`/api/pages/${page.id}/widgets`, { type: "services.status", config: { items } });
    assert.equal((await bad([{ name: "x", url: "javascript:alert(1)" }])).status, 400);
    assert.equal((await bad([{ name: "x" }])).status, 400);
    assert.equal((await bad([{ url: mock.url }])).status, 400);
    await add("services.status", { items: [{ name: "ok", url: mock.url }] });
  });

  it("solo puede comprobar las URLs configuradas, no otras", async () => {
    const { c, add } = await setup();
    // Un widget con una sola URL no puede alcanzar el resto del host simulado por otro origen.
    const w = await add("services.status", { items: [{ name: "Mock", url: mock.url + "/up" }] });
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.view.items.length, 1);
  });
});
