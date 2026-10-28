import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { viewSchema } from "../src/plugins/schema.js";
import { createSafeHttp } from "../src/security/safe-http.js";
import { startMockStack, STACK, type MockStack } from "./support/mock-stack.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockStack;
before(async () => {
  mock = await startMockStack();
});
after(() => mock.close());

async function setup(opts: Parameters<typeof makeApp>[1] = {}) {
  const ctx = await makeApp({}, { realPlugins: true, ...opts });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  const show = async (type: string, connection: Record<string, unknown> | null, config: Record<string, unknown> = {}) => {
    let connectionId: string | undefined;
    if (connection) {
      const pluginId = type.split(".")[0]!;
      const made = await c.post("/api/connections", { pluginId, name: pluginId, config: connection });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      connectionId = made.json.connection.id;
    }
    const w = await c.post(`/api/pages/${page.id}/widgets`, { type, config, connectionId });
    assert.equal(w.status, 201, JSON.stringify(w.json));
    return (await c.get(`/api/widgets/${w.json.widget.id}/data`)).json;
  };
  const probe = async (pluginId: string, config: Record<string, unknown>) =>
    (await c.post("/api/connections/test", { pluginId, config })).json;
  return { ...ctx, c, page, show, probe };
}

const by = (items: any[], key: string) => Object.fromEntries(items.map((i) => [i[key], i]));

describe("Scrutiny", () => {
  const conn = () => ({ url: mock.url + "/scrutiny" });

  it("cuenta discos sanos, con aviso y con fallos, ignora los archivados y ordena lo malo primero", async () => {
    const { show } = await setup();
    const d = await show("scrutiny.health", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Sanos"].value, "2");
    assert.equal(stats["Con aviso"].value, "1");
    assert.equal(stats["Con fallos"].value, "1");
    assert.equal(stats["Con fallos"].tone, "bad");

    const items = d.view.sections[1].view.items;
    assert.equal(items.length, 4, "el disco archivado no cuenta");
    assert.deepEqual(items.map((i: any) => i.right), ["Falla", "Aviso", "Sano", "Sano"]);
    assert.equal(items[0].title, "Toshiba MG08");
    assert.match(items[0].subtitle, /\/dev\/sdc · 4\.0 TB · 41 °C · 400 d encendido/);
    assert.equal(items[0].tone, "bad");
    assert.ok(!items.some((i: any) => i.title === "Disco viejo"));
  });

  it("explica una URL que no es Scrutiny y prueba la conexión", async () => {
    const { show, probe } = await setup();
    const d = await show("scrutiny.health", { url: mock.url + "/nada" });
    assert.match(d.error, /No se encontró la API de Scrutiny/);
    assert.deepEqual(await probe("scrutiny", conn()), { ok: true, message: "Conectado: 4 discos" });
  });
});

describe("Immich", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/immich", apiKey: STACK.immichKey, ...extra });

  it("muestra fotos, vídeos, espacio y el uso por usuario", async () => {
    const { show } = await setup();
    const d = await show("immich.stats", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.match(s["Fotos"].value, /12\.345|12,345|12345/);
    assert.equal(s["Vídeos"].value, "321");
    assert.equal(s["Espacio usado"].value, "5.5 TB");
    assert.equal(s["Usuarios"].value, "2");
    const users = d.view.sections[1].view.items;
    assert.deepEqual(users.map((u: any) => u.title), ["Sebas", "Ana"], "más espacio primero");
    assert.equal(users[0].right, "4.5 TB");

    const hidden = await show("immich.stats", conn(), { showUsers: false });
    assert.equal(hidden.view.sections.length, 1);
  });

  it("funciona con la ruta de versiones antiguas de Immich", async () => {
    const { show } = await setup();
    const d = await show("immich.stats", conn({ url: mock.url + "/immich-old" }));
    assert.equal(d.ok, true, JSON.stringify(d));
  });

  it("explica clave mala, clave sin permisos de administrador y URL equivocada", async () => {
    const { show, probe } = await setup();
    assert.match((await show("immich.stats", conn({ apiKey: "clave-equivocada-12345" }))).error, /rechazó la API key/);
    assert.match((await show("immich.stats", conn({ apiKey: STACK.immichUserKey }))).error, /administrador/);
    assert.match((await show("immich.stats", conn({ url: mock.url + "/nada" }))).error, /No se encontró la API de Immich/);
    assert.deepEqual(await probe("immich", conn()), { ok: true, message: "Conectado: 12.345 fotos y 321 vídeos" });
  });
});

describe("Jellystat", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/jellystat", apiKey: STACK.jellystatKey, ...extra });

  it("muestra las reproducciones por tipo para los días elegidos", async () => {
    const { show } = await setup();
    const d = await show("jellystat.views", conn(), { days: 7 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const section = d.view.sections[0];
    assert.equal(section.title, "Últimos 7 días");
    const s = by(section.view.items, "label");
    assert.match(s["Películas"].value, /1\.203|1,203|1203/);
    assert.match(s["Episodios"].value, /4\.521|4,521|4521/);
    assert.equal(s["Canciones"].value, "14");
    assert.equal(s["Otros"], undefined, "otros a cero no se muestra");
  });

  it("errores de la clave y prueba de conexión", async () => {
    const { show, probe } = await setup();
    assert.match((await show("jellystat.views", conn({ apiKey: "otra-clave-equivocada" }))).error, /rechazó la API key/);
    assert.deepEqual(await probe("jellystat", conn()), { ok: true, message: "Conectado a Jellystat" });
  });
});

describe("Gluetun", () => {
  it("muestra VPN, IP pública, ubicación y puerto reenviado", async () => {
    const { show } = await setup();
    const d = await show("gluetun.status", { url: mock.url + "/gluetun" });
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["VPN"].value, "Activa");
    assert.equal(s["VPN"].tone, "good");
    assert.equal(s["IP pública"].value, "185.65.134.10");
    assert.equal(s["Ubicación"].value, "Medellín, Antioquia, Colombia");
    assert.equal(s["Puerto reenviado"].value, "51820");
  });

  it("entiende las rutas de versiones antiguas y marca la VPN detenida", async () => {
    const { show } = await setup();
    const d = await show("gluetun.status", { url: mock.url + "/gluetun-old" });
    const s = by(d.view.items, "label");
    assert.equal(s["VPN"].value, "Detenida");
    assert.equal(s["VPN"].tone, "bad");
    assert.equal(s["Puerto reenviado"].value, "4242");
  });

  it("usa la API key cuando el control está protegido", async () => {
    const { show, probe } = await setup();
    assert.equal((await show("gluetun.status", { url: mock.url + "/gluetun-auth", apiKey: STACK.gluetunKey })).ok, true);
    assert.match((await show("gluetun.status", { url: mock.url + "/gluetun-auth" })).error, /rechazó la petición/);
    assert.deepEqual(await probe("gluetun", { url: mock.url + "/gluetun" }), { ok: true, message: "Conectado: IP pública 185.65.134.10" });
  });
});

describe("Feeds RSS", () => {
  const feeds = (...items: { name?: string; url: string }[]) => ({ feeds: items, limit: 10 });

  it("mezcla RSS y Atom por fecha, limpia el texto y solo deja enlaces http(s)", async () => {
    const { show } = await setup();
    const d = await show("feed.latest", null, feeds({ url: mock.url + "/feed/rss" }, { name: "GitHub", url: mock.url + "/feed/atom" }));
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "list");
    const items = d.view.items;
    // Atom (10 min) → «javascript» (1 h, sin enlace) → Oblivion (2 h) → Tom (30 h); el que no tiene título se descarta.
    assert.deepEqual(items.map((i: any) => i.title), ["v1.2.3", "Enlace peligroso", "Novedades de Oblivion 0.2", "Tom & Jerry épico 😀"]);
    assert.equal(items[0].href, "https://github.example/rel/v1.2.3", "Atom: usa el enlace «alternate»");
    assert.equal(items[1].href, undefined, "javascript: nunca llega al navegador");
    assert.equal(items[2].href, "https://blog.example/oblivion-0-2");
    assert.match(items[0].subtitle, /^GitHub · hace 10 min/);
    assert.match(items[2].subtitle, /^Blog & Cía · hace 2 h/, "nombre del feed y entidades decodificadas");
  });

  it("si un feed falla se muestran los demás; si fallan todos, el motivo", async () => {
    const { show } = await setup();
    const some = await show("feed.latest", null, feeds({ url: mock.url + "/feed/rss" }, { url: mock.url + "/feed/html" }));
    assert.equal(some.ok, true);
    assert.equal(some.view.items.length, 3);

    const none = await show("feed.latest", null, feeds({ url: mock.url + "/feed/html" }));
    assert.equal(none.ok, false);
    assert.match(none.error, /no parece un feed/);

    const down = await show("feed.latest", null, feeds({ url: "http://127.0.0.1:1/feed" }));
    assert.match(down.error, /No se pudo conectar con 127\.0\.0\.1:1/);

    assert.match((await show("feed.latest", null, { feeds: [] })).view.text, /al menos un feed/);
  });

  it("solo puede leer los feeds configurados y valida las URLs", async () => {
    const { c, page } = await setup();
    const bad = (url: string) => c.post(`/api/pages/${page.id}/widgets`, { type: "feed.latest", config: { feeds: [{ url }] } });
    assert.equal((await bad("javascript:alert(1)")).status, 400);
    assert.equal((await bad("file:///etc/passwd")).status, 400);
    assert.equal((await bad("http://127.0.0.1/feed")).status, 201);
  });

  it("el esquema de vistas rechaza enlaces que no sean http(s)", () => {
    const list = (href: string) => ({ kind: "list", items: [{ title: "x", href }] });
    assert.equal(viewSchema.safeParse(list("https://ok.example/a")).success, true);
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "ftp://x"]) {
      assert.equal(viewSchema.safeParse(list(href)).success, false, href);
    }
  });
});

describe("API personalizada", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/capi", auth: "none", ...extra });
  const field = (label: string, jsonPath: string, format = "text", unit = "") => ({ label, jsonPath, format, unit });

  it("lee campos con rutas JSON y los da formato", async () => {
    const { show } = await setup();
    const d = await show("custom-api.values", conn(), {
      path: "/stats",
      fields: [
        field("Usuarios", "data.users", "number"),
        field("Libre", "data.free", "bytes"),
        field("CPU", "data.cpu", "percent"),
        field("Encendido", "data.up", "duration"),
        field("OK", "data.ok", "bool"),
        field("Nombre", "data.name", "text", "(srv)"),
        field("Etiquetas", "data.tags.length"),
        field("Elemento", "data.items[1].name"),
        field("Total", "$.total", "number", "uds"),
        field("No existe", "data.nada.nunca"),
        field("Proto", "__proto__.polluted"),
        field("Constructor", "data.constructor"),
      ],
    });
    assert.equal(d.ok, true, JSON.stringify(d));
    const v = Object.fromEntries(d.view.items.map((i: any) => [i.label, i.value]));
    assert.equal(v["Usuarios"], "42");
    assert.equal(v["Libre"], "5.4 TB");
    assert.match(v["CPU"], /^23[,.]5%$/);
    assert.equal(v["Encendido"], "1 d 2 h");
    assert.equal(v["OK"], "Sí");
    assert.equal(v["Nombre"], "tower (srv)");
    assert.equal(v["Etiquetas"], "3");
    assert.equal(v["Elemento"], "Dos");
    assert.equal(v["Total"], "7 uds");
    assert.equal(v["No existe"], "—");
    assert.equal(v["Proto"], "—", "no se puede llegar al prototipo");
    assert.equal(v["Constructor"], "—");
  });

  it("«Lista de una API» arma las filas desde una lista (en la raíz o anidada)", async () => {
    const { show } = await setup();
    const root = await show("custom-api.list", conn(), { path: "/items", titlePath: "name", subtitlePath: "status", rightPath: "size", rightFormat: "bytes", limit: 2 });
    assert.equal(root.ok, true, JSON.stringify(root));
    assert.deepEqual(root.view.items, [
      { title: "Uno", subtitle: "ok", right: "2.0 KB" },
      { title: "Dos", subtitle: "fallo", right: "3.0 GB" },
    ]);

    const nested = await show("custom-api.list", conn(), { path: "/wrapped", itemsPath: "data.items", titlePath: "name" });
    assert.equal(nested.view.items[0].title, "Envuelto");

    const notList = await show("custom-api.list", conn(), { path: "/stats", itemsPath: "data.name", titlePath: "x" });
    assert.match(notList.error, /no apunta a una lista/);
  });

  it("autenticación: Bearer, cabecera y HTTP básico", async () => {
    const { show } = await setup();
    const cfg = { path: "/stats", fields: [field("Usuarios", "data.users")] };
    const bearer = await show("custom-api.values", { url: mock.url + "/capi-bearer", auth: "bearer", secret: STACK.capiToken }, cfg);
    assert.equal(bearer.view.items[0].value, "42");
    const header = await show("custom-api.values", { url: mock.url + "/capi-header", auth: "header", headerName: "X-Api-Key", secret: STACK.capiToken }, cfg);
    assert.equal(header.view.items[0].value, "42");
    const basic = await show("custom-api.values", { url: mock.url + "/capi-basic", auth: "basic", username: STACK.capiUser, secret: STACK.capiPass }, cfg);
    assert.equal(basic.view.items[0].value, "42");

    const wrong = await show("custom-api.values", { url: mock.url + "/capi-bearer", auth: "bearer", secret: "otro-token-equivocado" }, cfg);
    assert.match(wrong.error, /rechazó la petición \(401\)/);
    const missing = await show("custom-api.values", { url: mock.url + "/capi-bearer", auth: "bearer" }, cfg);
    assert.match(missing.error, /Falta el token/);
  });

  it("valida la ruta, la cabecera y la respuesta", async () => {
    const { show } = await setup();
    const one = [field("a", "x")];
    assert.match((await show("custom-api.values", conn(), { path: "stats", fields: one })).error, /empezar por/);
    assert.match((await show("custom-api.values", conn(), { path: "//evil.example/x", fields: one })).error, /no es válida/);
    assert.match((await show("custom-api.values", conn(), { path: "/a b", fields: one })).error, /no es válida/);
    assert.match((await show("custom-api.values", conn(), { path: "/nada", fields: one })).error, /404/);
    assert.match((await show("custom-api.values", conn(), { path: "/texto", fields: one })).error, /no respondió con JSON/);
    assert.match(
      (await show("custom-api.values", { url: mock.url + "/capi-header", auth: "header", headerName: "Host", secret: "abcdefgh" }, { path: "/stats", fields: one })).error,
      /cabecera no es válido/,
    );
    assert.match((await show("custom-api.values", conn(), { path: "/stats", fields: [] })).view.text, /al menos un campo/);
  });

  it("prueba la conexión y no filtra el secreto", async () => {
    const { c, show, probe } = await setup();
    assert.deepEqual(await probe("custom-api", conn()), { ok: true, message: "El servidor responde (HTTP 200)" });
    assert.equal((await probe("custom-api", { url: mock.url + "/capi-bearer", auth: "bearer", secret: "x" })).ok, false);

    const d = await show("custom-api.values", { url: mock.url + "/capi-bearer", auth: "bearer", secret: STACK.capiToken }, { path: "/stats", fields: [field("U", "data.users")] });
    const raw = JSON.stringify([d, (await c.get("/api/pages")).json, (await c.get("/api/connections")).json]);
    assert.equal(raw.includes(STACK.capiToken), false);
  });
});

describe("Tailscale", () => {
  // La API de Tailscale está en un host fijo: se simula sustituyendo la red de los plugins.
  const calls: { url: string; auth: string | null }[] = [];
  const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url, auth });
    if (!url.startsWith("https://api.tailscale.com/api/v2/tailnet/")) return new Response("{}", { status: 404 });
    if (auth !== "Bearer tskey-api-good-1234567890") return new Response("{}", { status: 401 });
    const now = Date.now();
    return Response.json({
      devices: [
        { name: "tower.tail1234.ts.net", hostname: "tower", addresses: ["100.64.0.1"], os: "linux", clientVersion: "1.76.1-t123", connectedToControl: true, lastSeen: new Date(now).toISOString(), updateAvailable: true, keyExpiryDisabled: true },
        { name: "phone.tail1234.ts.net", hostname: "phone", addresses: ["100.64.0.2"], os: "android", clientVersion: "1.76.1", connectedToControl: false, lastSeen: new Date(now - 3 * 3600_000).toISOString(), keyExpiryDisabled: true },
        { name: "laptop.tail1234.ts.net", addresses: ["100.64.0.3"], os: "macOS", lastSeen: new Date(now - 60_000).toISOString(), keyExpiryDisabled: false, expires: new Date(now + 86400_000).toISOString() },
        { name: "viejo.tail1234.ts.net", hostname: "viejo", addresses: ["100.64.0.4"], os: "windows", connectedToControl: true, lastSeen: new Date(now).toISOString(), keyExpiryDisabled: false, expires: new Date(now - 86400_000).toISOString() },
      ],
    });
  }) as typeof fetch;
  const http: typeof createSafeHttp = (o) => createSafeHttp({ ...o, lookup: async () => ["100.100.100.100"], fetchImpl: fakeFetch });

  it("lista los dispositivos con su estado, en línea primero", async () => {
    const { show } = await setup({ http });
    calls.length = 0;
    const d = await show("tailscale.devices", { apiKey: "tskey-api-good-1234567890", tailnet: "-" });
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["En línea"].value, "3", "tower, laptop (visto hace 1 min) y viejo");
    assert.equal(stats["Total"].value, "4");
    assert.equal(stats["Con actualización"].value, "1");

    const items = d.view.sections[1].view.items;
    assert.deepEqual(items.map((i: any) => i.title), ["laptop", "tower", "viejo", "phone"]);
    const t = by(items, "title");
    assert.equal(t["tower"].subtitle, "100.64.0.1 · linux · v1.76.1");
    assert.equal(t["tower"].right, "En línea");
    assert.equal(t["viejo"].right, "Clave caducada");
    assert.equal(t["viejo"].tone, "warn");
    assert.equal(t["phone"].right, "hace 3 h");
    assert.equal(calls[0]!.url, "https://api.tailscale.com/api/v2/tailnet/-/devices");

    const only = await show("tailscale.devices", { apiKey: "tskey-api-good-1234567890" }, { show: "online" });
    assert.equal(only.view.sections[1].view.items.length, 3);
  });

  it("clave mala, nombre de tailnet inválido y prueba de conexión", async () => {
    const { show, probe } = await setup({ http });
    assert.match((await show("tailscale.devices", { apiKey: "tskey-api-mala-1234567890" })).error, /rechazó la clave/);
    assert.match((await show("tailscale.devices", { apiKey: "tskey-api-good-1234567890", tailnet: "../x" })).error, /tailnet no es válido/);
    assert.match((await show("tailscale.devices", { apiKey: "mala clave" })).error, /formato válido/);
    assert.deepEqual(await probe("tailscale", { apiKey: "tskey-api-good-1234567890" }), { ok: true, message: "Conectado: 3 de 4 dispositivos en línea" });
  });

  it("solo puede llamar a api.tailscale.com", async () => {
    const { show } = await setup({ http });
    calls.length = 0;
    await show("tailscale.devices", { apiKey: "tskey-api-good-1234567890" });
    assert.ok(calls.every((c) => new URL(c.url).host === "api.tailscale.com"));
  });
});

describe("Buscador y Saludo (widgets del dashboard)", () => {
  it("están en el catálogo y se pueden añadir con su configuración validada", async () => {
    const { c, page } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    assert.equal(widgets.find((w: any) => w.fullType === "core.search").component, "search");
    assert.equal(widgets.find((w: any) => w.fullType === "core.greeting").component, "greeting");

    const add = (type: string, config: unknown) => c.post(`/api/pages/${page.id}/widgets`, { type, config });
    assert.equal((await add("core.search", { engine: "duckduckgo" })).status, 201);
    assert.equal((await add("core.search", { engine: "custom", custom: "https://buscador.casa/?q=%s" })).status, 201);
    assert.equal((await add("core.search", { engine: "altavista" })).status, 400, "buscador inexistente");
    assert.equal((await add("core.search", { engine: "custom", custom: "javascript:alert(1)" })).status, 400);
    assert.equal((await add("core.greeting", { name: "Sebastián", date: true })).status, 201);
  });
});

describe("catálogo", () => {
  it("todos los plugins nuevos traen conexión y se pueden probar (salvo feed y tailscale sin URL)", async () => {
    const { c } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    for (const id of ["scrutiny", "immich", "jellystat", "gluetun", "custom-api", "tailscale"]) {
      const w = widgets.find((x: any) => x.pluginId === id);
      assert.ok(w, id);
      assert.equal(w.testable, true, id);
      assert.ok(w.connection.length > 0, id);
    }
    const feed = widgets.find((x: any) => x.pluginId === "feed");
    assert.equal(feed.connection.length, 0, "el feed se configura en el propio widget");
  });
});
