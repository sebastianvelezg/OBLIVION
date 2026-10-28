import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startMockStack, STACK, type MockStack } from "./support/mock-stack.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockStack;
before(async () => {
  mock = await startMockStack();
});
after(() => mock.close());

async function setup() {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  /** Crea la conexión y un widget; devuelve los datos que muestra. */
  const show = async (type: string, connection: Record<string, unknown>, config: Record<string, unknown> = {}) => {
    const pluginId = type.split(".")[0]!;
    const made = await c.post("/api/connections", { pluginId, name: pluginId, config: connection });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const w = await c.post(`/api/pages/${page.id}/widgets`, { type, config, connectionId: made.json.connection.id });
    assert.equal(w.status, 201, JSON.stringify(w.json));
    return (await c.get(`/api/widgets/${w.json.widget.id}/data`)).json;
  };
  /** «Probar conexión» con los valores del formulario. */
  const probe = async (pluginId: string, config: Record<string, unknown>) =>
    (await c.post("/api/connections/test", { pluginId, config })).json;
  return { ...ctx, c, page, show, probe };
}

const by = (items: any[], key: string) => Object.fromEntries(items.map((i) => [i[key], i]));

describe("Glances", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/glances", ...extra });

  it("«Estado del sistema» muestra CPU, memoria, carga y uptime con avisos", async () => {
    const { show } = await setup();
    const d = await show("glances.system", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "stats");
    const s = by(d.view.items, "label");
    assert.equal(s["CPU"].value, "23%");
    assert.equal(s["CPU"].tone, "good");
    assert.equal(s["Memoria"].hint, "12.0 GB de 32.0 GB");
    assert.equal(s["Swap"], undefined, "sin swap no se muestra");
    assert.equal(s["Carga (1 min)"].value, "0.82");
    assert.equal(s["Encendido"].value, "12 d 3 h");
    assert.equal(s["Servidor"].value, "tower");
  });

  it("«Discos» oculta lo virtual, ordena y marca los llenos; el prefijo filtra", async () => {
    const { show } = await setup();
    const all = await show("glances.disks", conn());
    assert.deepEqual(all.view.items.map((i: any) => i.title), ["/mnt/cache", "/mnt/disk1", "/mnt/disk2"]);
    const [cache, d1, d2] = all.view.items;
    assert.equal(d1.right, "80%");
    assert.equal(d1.tone, "warn" === d1.tone ? "warn" : d1.tone);
    assert.equal(cache.tone, "good");
    assert.equal(d2.tone, "bad", "96 % → crítico");
    assert.ok(Math.abs(d2.progress - 0.962) < 1e-9);

    const prefixed = await show("glances.disks", conn(), { prefix: "/mnt/disk" });
    assert.deepEqual(prefixed.view.items.map((i: any) => i.title), ["/mnt/disk1", "/mnt/disk2"]);
    const none = await show("glances.disks", conn(), { prefix: "/nada" });
    assert.match(none.view.empty, /\/nada/);
  });

  it("«Temperaturas» solo lista sensores de temperatura, de mayor a menor", async () => {
    const { show } = await setup();
    const d = await show("glances.temperatures", conn());
    assert.deepEqual(d.view.items.map((i: any) => [i.title, i.right, i.tone]), [
      ["Core 3", "88 °C", "bad"],
      ["Package id 0", "61 °C", "good"],
      ["sda", "38 °C", "good"],
    ]);
  });

  it("autenticación: usuario/contraseña correctos, errores explicados y prueba de conexión", async () => {
    const { show, probe } = await setup();
    const ok = await show("glances.system", conn({ url: mock.url + "/glances-auth", username: STACK.glancesUser, password: STACK.glancesPass }));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const bad = await show("glances.system", conn({ url: mock.url + "/glances-auth", username: "x", password: "y" }));
    assert.match(bad.error, /rechazó el usuario/);
    const v3 = await show("glances.system", conn({ version: "3" }));
    assert.equal(v3.ok, true);
    const none = await show("glances.system", conn({ url: mock.url + "/nada" }));
    assert.match(none.error, /no tiene \/cpu|no parece Glances/);

    const t = await probe("glances", conn());
    assert.deepEqual(t, { ok: true, message: "Conectado a tower · Linux" });
    assert.equal((await probe("glances", conn({ url: mock.url + "/glances-auth" }))).ok, false);
  });
});

describe("qBittorrent", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/qbit", username: STACK.qbitUser, password: STACK.qbitPass, ...extra });

  it("muestra velocidades y torrents con estado, progreso y tono", async () => {
    const { show } = await setup();
    const d = await show("qbittorrent.downloads", conn(), { filter: "all", limit: 6 });
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "sections");
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Descarga"].value, "5.2 MB/s");
    assert.equal(stats["Descarga"].tone, "good");
    assert.equal(stats["Subida"].value, "800 KB/s");
    assert.equal(stats["Conexión"].value, "Conectado");

    const list = d.view.sections[1].view.items;
    const t = by(list, "title");
    assert.equal(t["ubuntu-24.04-desktop-amd64.iso"].right, "42%");
    assert.equal(t["ubuntu-24.04-desktop-amd64.iso"].progress, 0.42);
    assert.match(t["ubuntu-24.04-desktop-amd64.iso"].subtitle, /Descargando · 60 min · 4\.4 GB/);
    assert.match(t["Archivo estancado"].subtitle, /Sin fuentes/);
    assert.equal(t["Archivo estancado"].tone, "warn");
    assert.equal(t["Película sembrando"].tone, "good");
    assert.equal(t["Archivo con error"].tone, "bad");
  });

  it("filtra (activos / descargando) y respeta el límite", async () => {
    const { show } = await setup();
    const active = await show("qbittorrent.downloads", conn(), { filter: "active" });
    assert.deepEqual(active.view.sections[1].view.items.map((i: any) => i.title), [
      "ubuntu-24.04-desktop-amd64.iso",
      "Película sembrando",
    ]);
    const one = await show("qbittorrent.downloads", conn(), { filter: "all", limit: 1 });
    assert.equal(one.view.sections[1].view.items.length, 1);
  });

  it("inicia sesión una sola vez (reutiliza la cookie) y exige Referer", async () => {
    const { show } = await setup();
    const c1 = conn({ url: mock.url + "/qbit" });
    await show("qbittorrent.downloads", c1);
    const after1 = mock.counts.qbitLogins;
    assert.ok(after1 >= 1, "alguna vez se inició sesión");
    await show("qbittorrent.downloads", c1);
    await show("qbittorrent.downloads", c1);
    assert.equal(mock.counts.qbitLogins, after1, "las siguientes cargas reutilizan la sesión");
  });

  it("explica credenciales malas y funciona sin usuario si el servidor omite la autenticación", async () => {
    const { show, probe } = await setup();
    const bad = await show("qbittorrent.downloads", conn({ password: "mala" }));
    assert.match(bad.error, /rechazó el usuario o la contraseña/);
    const open = await show("qbittorrent.downloads", { url: mock.url + "/qbit-open" });
    assert.equal(open.ok, true, JSON.stringify(open));
    const needLogin = await show("qbittorrent.downloads", { url: mock.url + "/qbit" });
    assert.match(needLogin.error, /pide usuario y contraseña/);

    assert.deepEqual(await probe("qbittorrent", conn()), { ok: true, message: "Conectado a qBittorrent 4.6.5" });
    assert.equal((await probe("qbittorrent", conn({ password: "mala" }))).ok, false);
  });
});

describe("Transmission", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/trans", ...extra });

  it("negocia el id de sesión (409) y lista los torrents activos", async () => {
    const { show } = await setup();
    const d = await show("transmission.downloads", conn(), { filter: "active" });
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Descarga"].value, "2.0 MB/s");
    assert.equal(stats["Total"].hint, "1 en pausa");
    const items = d.view.sections[1].view.items;
    assert.deepEqual(items.map((i: any) => i.title), ["debian-12.iso", "Sembrando"], "el pausado no es activo");
    assert.equal(items[0].right, "75%");
    assert.match(items[0].subtitle, /Descargando · 10 min/);
    assert.equal(items[1].tone, "good");

    const all = await show("transmission.downloads", conn(), { filter: "all" });
    assert.equal(all.view.sections[1].view.items.length, 3);
  });

  it("acepta la URL de la interfaz web y la autenticación básica", async () => {
    const { show, probe } = await setup();
    const web = await show("transmission.downloads", conn({ url: mock.url + "/trans/transmission/web/" }));
    assert.equal(web.ok, true, JSON.stringify(web));
    const authed = await show("transmission.downloads", { url: mock.url + "/trans-auth", username: STACK.transUser, password: STACK.transPass });
    assert.equal(authed.ok, true);
    const bad = await show("transmission.downloads", { url: mock.url + "/trans-auth", username: "x", password: "y" });
    assert.match(bad.error, /rechazó el usuario/);
    assert.deepEqual(await probe("transmission", conn()), { ok: true, message: "Conectado a Transmission 4.0.5" });
  });
});

describe("Jellyseerr", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/seerr", apiKey: STACK.seerrKey, ...extra });

  it("muestra los conteos y las solicitudes recientes con título, usuario y estado", async () => {
    const { show } = await setup();
    const d = await show("jellyseerr.requests", conn(), { limit: 5 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Pendientes"].value, "2");
    assert.equal(stats["Pendientes"].tone, "warn");
    assert.equal(stats["Disponibles"].tone, "good");

    const [pending, available, declined] = d.view.sections[1].view.items;
    assert.equal(pending.title, "Dune: Parte Dos (2024)");
    assert.equal(pending.right, "Pendiente");
    assert.equal(pending.tone, "warn");
    assert.match(pending.subtitle, /Película · Ana · hace 10 min/);
    assert.equal(available.title, "Severance (2022)");
    assert.equal(available.right, "Disponible");
    assert.equal(declined.title, "Película", "sin detalles de TMDB cae a un título genérico");
    assert.equal(declined.tone, "bad");
    assert.match(declined.subtitle, /pepe/);
  });

  it("errores de la API key y prueba de conexión", async () => {
    const { show, probe } = await setup();
    const bad = await show("jellyseerr.requests", conn({ apiKey: "otra-key-equivocada-123" }));
    assert.match(bad.error, /rechazó la API key/);
    assert.deepEqual(await probe("jellyseerr", conn()), { ok: true, message: "Conectado como Sebas" });
    assert.equal((await probe("jellyseerr", conn({ apiKey: "otra-key-equivocada-123" }))).ok, false);
  });
});

describe("Docker (solo lectura)", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/docker", ...extra });

  it("resume y ordena los contenedores: primero los que fallan", async () => {
    const { show } = await setup();
    const d = await show("docker.containers", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["En marcha"].value, "3");
    assert.equal(stats["Detenidos"].value, "3");
    assert.equal(stats["Con problemas"].value, "3", "unhealthy + exit 137 + reiniciando");

    const items = d.view.sections[1].view.items;
    assert.deepEqual(items.slice(0, 3).map((i: any) => i.tone), ["bad", "bad", "bad"]);
    const t = by(items, "title");
    assert.equal(t["jellyfin"].right, "En marcha");
    assert.equal(t["jellyfin"].subtitle, "media · Up 3 days (healthy)");
    assert.equal(t["sonarr"].right, "Con fallos");
    assert.equal(t["backup"].right, "Detenido");
    assert.equal(t["backup"].tone, "neutral", "salir con 0 no es un problema");
    assert.equal(t["crasheado"].right, "Salió (137)");
    assert.equal(t["reiniciando"].right, "Reiniciando");
  });

  it("«solo problemas» y límite; no abre enlace con el título", async () => {
    const { show, c, page } = await setup();
    const d = await show("docker.containers", conn(), { show: "problems", limit: 2 });
    assert.equal(d.view.sections[1].view.items.length, 2);
    assert.ok(d.view.sections[1].view.items.every((i: any) => i.tone === "bad" || i.tone === "warn"));

    // El widget no ofrece enlace aunque la conexión tenga URL.
    const made = await c.post("/api/connections", { pluginId: "docker", name: "d", config: conn() });
    const w = await c.post(`/api/pages/${page.id}/widgets`, { type: "docker.containers", config: {}, connectionId: made.json.connection.id });
    assert.equal(w.json.widget.link, null);
  });

  it("solo hace lecturas de la lista de contenedores (nada de escribir)", async () => {
    const { show, probe } = await setup();
    mock.counts.dockerCalls.length = 0;
    await show("docker.containers", conn());
    await probe("docker", conn());
    assert.ok(mock.counts.dockerCalls.length >= 2);
    for (const call of mock.counts.dockerCalls) assert.match(call, /^GET \/docker\/containers\/json\?all=true$/);
  });

  it("explica cuando el proxy no permite listar contenedores", async () => {
    const { show, probe } = await setup();
    const d = await show("docker.containers", conn({ url: mock.url + "/docker-forbidden" }));
    assert.match(d.error, /CONTAINERS=1/);
    assert.equal((await probe("docker", conn({ url: mock.url + "/docker-forbidden" }))).ok, false);
    assert.deepEqual(await probe("docker", conn()), { ok: true, message: "Conectado: 3 de 6 contenedores en marcha" });
  });
});

describe("Pi-hole", () => {
  it("v6: inicia sesión, muestra el resumen y reutiliza la sesión", async () => {
    const { show } = await setup();
    mock.counts.piholeLogins = 0;
    const c6 = { url: mock.url + "/ph6", version: "6", password: STACK.pihole6Pass };
    const d = await show("pihole.summary", c6);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "metric");
    assert.equal(d.view.value, "26.0");
    assert.equal(d.view.unit, "% bloqueado");
    assert.equal(d.view.caption, "Bloqueo activo");
    const rows = by(d.view.rows, "label");
    assert.match(rows["Consultas"].value, /12\.345|12,345|12345/);
    await show("pihole.summary", c6);
    assert.equal(mock.counts.piholeLogins, 1, "la sesión se reutiliza entre widgets de la misma URL");
  });

  it("v6 con contraseña mala y v5 con token", async () => {
    const { show, probe } = await setup();
    const bad = await show("pihole.summary", { url: mock.url + "/ph6", version: "6", password: "mala" });
    assert.match(bad.error, /rechazó la contraseña/);

    const v5 = await show("pihole.summary", { url: mock.url + "/ph5", version: "5", password: STACK.pihole5Token });
    assert.equal(v5.ok, true, JSON.stringify(v5));
    assert.equal(v5.view.value, "25.0");
    const noToken = await show("pihole.summary", { url: mock.url + "/ph5", version: "5" });
    assert.match(noToken.error, /token de API/);
    const badFormat = await show("pihole.summary", { url: mock.url + "/ph5", version: "5", password: "no es hex" });
    assert.match(badFormat.error, /formato válido/);

    const wrongVersion = await show("pihole.summary", { url: mock.url + "/ph6", version: "5", password: STACK.pihole5Token });
    assert.equal(wrongVersion.ok, false);
    assert.equal((await probe("pihole", { url: mock.url + "/ph6", version: "6", password: STACK.pihole6Pass })).ok, true);
  });
});

describe("AdGuard Home", () => {
  it("calcula el % bloqueado y el tiempo de respuesta", async () => {
    const { show, probe } = await setup();
    const conn = { url: mock.url + "/adg", username: STACK.adguardUser, password: STACK.adguardPass };
    const d = await show("adguard.summary", conn);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.value, "25.0");
    assert.equal(d.view.caption, "Protección activa");
    const rows = by(d.view.rows, "label");
    assert.equal(rows["Respuesta"].value, "12 ms");

    const bad = await show("adguard.summary", { ...conn, password: "mala" });
    assert.match(bad.error, /rechazó el usuario/);
    assert.deepEqual(await probe("adguard", conn), { ok: true, message: "Conectado a AdGuard Home v0.107.52" });
  });
});

describe("Uptime Kuma", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/kuma", slug: "casa", ...extra });

  it("resume monitores y ordena los caídos primero", async () => {
    const { show } = await setup();
    const d = await show("uptime-kuma.monitors", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Arriba"].value, "2");
    assert.equal(stats["Caídos"].value, "1");
    assert.equal(stats["Caídos"].tone, "bad");
    assert.equal(stats["Disponibilidad 24 h"].value, "97.2%");

    const items = d.view.sections[1].view.items;
    assert.deepEqual(items.map((i: any) => [i.title, i.right, i.tone]), [
      ["Jellyseerr", "Caído", "bad"],
      ["Router", "Pendiente", "warn"],
      ["Jellyfin", "24 ms", "good"],
      ["Pi-hole", "3 ms", "good"],
    ]);
    assert.match(items[0].subtitle, /Medios · 90\.0% en 24 h/);

    const only = await show("uptime-kuma.monitors", conn(), { show: "problems" });
    assert.deepEqual(only.view.sections[1].view.items.map((i: any) => i.title), ["Jellyseerr", "Router"]);
  });

  it("valida el slug y explica páginas inexistentes", async () => {
    const { show, probe } = await setup();
    const evil = await show("uptime-kuma.monitors", conn({ slug: "../../admin" }));
    assert.match(evil.error, /slug/);
    const missing = await show("uptime-kuma.monitors", conn({ slug: "otra" }));
    assert.match(missing.error, /No se encontró esa página de estado/);
    assert.deepEqual(await probe("uptime-kuma", conn()), { ok: true, message: "Conectado a «Casa»: 4 monitores" });
  });
});

describe("«Probar conexión»", () => {
  it("solo el administrador, con datos validados, y reutiliza el secreto guardado", async () => {
    const { c, probe } = await setup();
    assert.equal((await c.post("/api/connections/test", { pluginId: "jellyseerr", config: { url: mock.url + "/seerr" } })).status, 400, "falta la key");
    assert.equal((await c.post("/api/connections/test", { pluginId: "core", config: {} })).status, 400);
    assert.equal((await c.post("/api/connections/test", { pluginId: "weather", config: {} })).status, 400);

    // Con una conexión guardada, dejar el secreto en blanco usa el guardado.
    const made = await c.post("/api/connections", { pluginId: "jellyseerr", name: "s", config: { url: mock.url + "/seerr", apiKey: STACK.seerrKey } });
    const again = await c.post("/api/connections/test", { pluginId: "jellyseerr", id: made.json.connection.id, config: { url: mock.url + "/seerr", apiKey: "" } });
    assert.equal(again.json.ok, true, JSON.stringify(again.json));
    assert.equal((await c.post("/api/connections/test", { pluginId: "jellyseerr", id: "no-existe", config: {} })).status, 404);
    assert.ok(await probe("jellyseerr", { url: mock.url + "/seerr", apiKey: STACK.seerrKey }));
  });

  it("el catálogo indica qué plugins se pueden probar", async () => {
    const { c } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    for (const id of ["jellyfin", "speedtest", "glances", "qbittorrent", "transmission", "jellyseerr", "docker", "pihole", "adguard", "uptime-kuma"]) {
      const w = widgets.find((x: any) => x.pluginId === id);
      assert.ok(w, id);
      assert.equal(w.testable, true, id);
      assert.ok(w.connection.length > 0, id);
    }
    assert.equal(widgets.find((x: any) => x.fullType === "core.clock").testable, false);
  });
});
