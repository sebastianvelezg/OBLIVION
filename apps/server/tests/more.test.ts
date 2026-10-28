import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MORE, startMockMore, type MockMore } from "./support/mock-more.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockMore;
before(async () => {
  mock = await startMockMore();
});
after(() => mock.close());

async function setup() {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  const show = async (type: string, connection: Record<string, unknown>, config: Record<string, unknown> = {}) => {
    const pluginId = type.split(".")[0]!;
    const made = await c.post("/api/connections", { pluginId, name: pluginId, config: connection });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const w = await c.post(`/api/pages/${page.id}/widgets`, { type, config, connectionId: made.json.connection.id });
    assert.equal(w.status, 201, JSON.stringify(w.json));
    return (await c.get(`/api/widgets/${w.json.widget.id}/data`)).json;
  };
  const probe = async (pluginId: string, config: Record<string, unknown>) =>
    (await c.post("/api/connections/test", { pluginId, config })).json;
  return { ...ctx, c, page, show, probe };
}

const by = (items: any[], key: string) => Object.fromEntries(items.map((i) => [i[key], i]));
const arr = (app: string, extra = {}) => ({ url: `${mock.url}/${app}`, apiKey: MORE.arrKey, ...extra });

describe("Sonarr", () => {
  it("cola: progreso, estado, tiempo restante y problemas", async () => {
    const { show } = await setup();
    const d = await show("sonarr.queue", arr("sonarr"));
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["En cola"].value, "3");
    assert.equal(stats["Descargando"].value, "1", "solo cuenta lo que baja de verdad");
    assert.equal(stats["Con problemas"].value, "2");

    const [a, b, c] = d.view.sections[1].view.items;
    assert.equal(a.title, "Severance");
    assert.equal(a.subtitle, "T1·E3 · In Perpetuity · Descargando · 12 min");
    assert.equal(a.right, "40%");
    assert.ok(Math.abs(a.progress - 0.4) < 1e-9);
    assert.equal(b.tone, "warn");
    assert.match(b.subtitle, /Pendiente de importar/);
    assert.equal(c.tone, "bad");
    assert.match(c.subtitle, /Fallido · 1 d 2 h/);
  });

  it("calendario: orden por fecha, hoy/mañana y marca lo ya descargado", async () => {
    const { show } = await setup();
    const d = await show("sonarr.calendar", arr("sonarr"), { days: 7 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const items = d.view.items;
    assert.deepEqual(items.map((i: any) => i.title), ["Severance", "Andor"], "sin fecha no sale");
    assert.equal(items[0].right, "Hoy 23:00");
    assert.equal(items[0].tone, "good", "ya está descargado");
    assert.equal(items[1].right, "Mañana 12:00");
    assert.equal(items[1].subtitle, "T2·E5 · Mañana");
  });

  it("faltantes y prueba de conexión; clave mala y formato inválido", async () => {
    const { show, probe } = await setup();
    const m = await show("sonarr.missing", arr("sonarr"));
    assert.equal(m.view.sections[0].view.items[0].value, "5");
    assert.deepEqual(m.view.sections[1].view.items[0].title, "Andor");
    assert.equal(m.view.sections[1].view.items[0].subtitle, "T2·E4 · Faltante");

    assert.deepEqual(await probe("sonarr", arr("sonarr")), { ok: true, message: "Conectado a Sonarr 4.0.9.2244" });
    assert.match((await show("sonarr.queue", arr("sonarr", { apiKey: "ffffffffffffffffffffffffffffffff" }))).error, /rechazó la API key/);
    assert.match((await show("sonarr.queue", arr("sonarr", { apiKey: "corta" }))).error, /formato válido/);
    assert.match((await show("sonarr.queue", { url: mock.url + "/nada", apiKey: MORE.arrKey })).error, /No se encontró la API de Sonarr/);
  });
});

describe("Radarr", () => {
  it("cola, estrenos (con el tipo de estreno) y películas que faltan", async () => {
    const { show } = await setup();
    const q = await show("radarr.queue", arr("radarr"));
    const item = q.view.sections[1].view.items[0];
    assert.equal(item.title, "Dune (2021)");
    assert.match(item.subtitle, /Descargando · 1 d 2 h/);
    assert.equal(item.right, "75%");

    const cal = await show("radarr.calendar", arr("radarr"), { days: 30 });
    assert.deepEqual(cal.view.items.map((i: any) => [i.title, i.subtitle]), [
      ["Película Nueva (2026)", "Digital"],
      ["Solo cines (2026)", "Cines"],
    ]);
    assert.equal(cal.view.items.some((i: any) => i.title.startsWith("Muy lejos")), false, "fuera del rango");

    const miss = await show("radarr.missing", arr("radarr"));
    assert.equal(miss.view.sections[0].view.items[0].value, "2");
    assert.deepEqual(miss.view.sections[1].view.items, [{ title: "Perdida (2019)", subtitle: "A24" }]);
  });
});

describe("Lidarr", () => {
  it("cola, lanzamientos y álbumes que faltan", async () => {
    const { show, probe } = await setup();
    const q = await show("lidarr.queue", arr("lidarr"));
    assert.equal(q.view.sections[1].view.items[0].title, "Radiohead");
    assert.match(q.view.sections[1].view.items[0].subtitle, /^OK Computer · Descargando · 5 min$/);
    const cal = await show("lidarr.calendar", arr("lidarr"));
    assert.deepEqual([cal.view.items[0].title, cal.view.items[0].subtitle], ["Artista X", "Nuevo álbum"]);
    const miss = await show("lidarr.missing", arr("lidarr"));
    assert.equal(miss.view.sections[0].view.items[0].value, "3");
    assert.deepEqual(await probe("lidarr", arr("lidarr")), { ok: true, message: "Conectado a Lidarr 2.4.3" });
  });
});

describe("Prowlarr", () => {
  it("lista los indexadores con los que fallan primero y los desactivados al final", async () => {
    const { show } = await setup();
    const d = await show("prowlarr.indexers", arr("prowlarr"));
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Activos"].value, "1");
    assert.equal(stats["Con fallos"].value, "1");
    assert.equal(stats["Con fallos"].tone, "bad");
    assert.equal(stats["Total"].value, "3");
    const items = d.view.sections[1].view.items;
    assert.deepEqual(items.map((i: any) => [i.title, i.right]), [["1337x", "Con fallos"], ["NZBgeek", "Activo"], ["Viejo", "Desactivado"]]);
    assert.match(items[0].subtitle, /^Torrent · reintenta \d/);
    assert.equal(items[0].tone, "bad");
  });
});

describe("Bazarr", () => {
  it("muestra los subtítulos pendientes y usa la cabecera X-API-KEY", async () => {
    const { show, probe } = await setup();
    const d = await show("bazarr.wanted", arr("bazarr"));
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["Películas"].value, "12");
    assert.equal(s["Episodios"].value, "40");
    assert.equal(s["Episodios"].tone, "warn");
    assert.deepEqual(await probe("bazarr", arr("bazarr")), { ok: true, message: "Conectado a Bazarr 1.4.3" });
    assert.equal((await probe("bazarr", arr("bazarr", { apiKey: "ffffffffffffffffffffffffffffffff" }))).ok, false);
  });
});

describe("Paperless-ngx", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/paperless", secret: MORE.paperlessToken, ...extra });

  it("estadísticas y bandeja de entrada", async () => {
    const { show } = await setup();
    const d = await show("paperless.stats", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.match(s["Documentos"].value, /^1\.?234$/);
    assert.equal(s["En la bandeja"].value, "3");
    assert.equal(s["En la bandeja"].tone, "warn");
    const types = d.view.sections[1].view.items;
    assert.deepEqual(types.map((t: any) => t.title), ["PDF", "IMAGEN PNG"], "el más numeroso primero");
    assert.ok(Math.abs(types[0].progress - 1000 / 1200) < 1e-9);

    const inbox = await show("paperless.inbox", conn(), { limit: 5 });
    assert.deepEqual(inbox.view.items.map((i: any) => i.title), ["Factura de la luz", "Documento 8"]);
  });

  it("autentica con usuario y contraseña, y explica los errores", async () => {
    const { show, probe } = await setup();
    const basic = await show("paperless.stats", conn({ username: MORE.paperlessUser, secret: MORE.paperlessPass }));
    assert.equal(basic.ok, true, JSON.stringify(basic));
    assert.match((await show("paperless.stats", conn({ secret: "f".repeat(40) }))).error, /rechazó el token/);
    assert.match((await show("paperless.stats", conn({ secret: "corto" }))).error, /formato válido/);
    assert.equal((await probe("paperless", conn())).ok, true);
  });
});

describe("UPS (PeaNUT)", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/peanut", device: MORE.upsName, ...extra });

  it("con corriente: batería, carga, autonomía y entrada", async () => {
    const { show, probe } = await setup();
    const d = await show("peanut.status", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["Estado"].value, "Con corriente");
    assert.equal(s["Estado"].tone, "good");
    assert.equal(s["Estado"].hint, "Back-UPS ES 700G");
    assert.equal(s["Batería"].value, "87%");
    assert.equal(s["Batería"].hint, "cargando");
    assert.equal(s["Carga"].value, "23%");
    assert.equal(s["Carga"].hint, "150 W");
    assert.equal(s["Autonomía"].value, "1 h 30 min");
    assert.equal(s["Entrada"].value, "121 V");
    assert.deepEqual(await probe("peanut", conn()), { ok: true, message: "Conectado a Back-UPS ES 700G: Con corriente" });
  });

  it("avisa cuando va con batería y cuando la batería está baja", async () => {
    const { show } = await setup();
    const low = by((await show("peanut.status", conn({ device: "apagon" }))).view.items, "label");
    assert.equal(low["Estado"].value, "Batería baja");
    assert.equal(low["Estado"].tone, "bad");
    assert.equal(low["Batería"].tone, "bad");
    assert.equal(low["Autonomía"].value, "4 min");
    assert.equal(low["Autonomía"].tone, "bad");

    const onBat = by((await show("peanut.status", conn({ device: "bateria" }))).view.items, "label");
    assert.equal(onBat["Estado"].value, "Con batería");
    assert.equal(onBat["Estado"].tone, "warn");
    assert.equal(onBat["Autonomía"].value, "25 min");
  });

  it("entiende el formato antiguo (upsData) y valida el nombre del UPS", async () => {
    const { show } = await setup();
    const old = by((await show("peanut.status", conn({ url: mock.url + "/peanut-old" }))).view.items, "label");
    assert.equal(old["Estado"].value, "Con corriente");
    assert.equal(old["Batería"].value, "50%");
    assert.equal(old["Carga"].hint, "40 W", "potencia = carga × potencia nominal");
    assert.match((await show("peanut.status", conn({ device: "nada" }))).error, /no conoce un UPS llamado «nada»/);
    assert.match((await show("peanut.status", conn({ device: "../x" }))).error, /nombre del UPS no es válido/);
  });
});

describe("Home Assistant", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/ha", token: MORE.haToken, ...extra });
  const ent = (id: string, name = "") => ({ id, name });

  it("muestra cada entidad con unidad, estados traducidos y avisos", async () => {
    const { show } = await setup();
    const d = await show("homeassistant.entities", conn(), {
      entities: [ent("sensor.temperatura"), ent("sensor.potencia", "Consumo"), ent("light.sala"), ent("person.sebas"), ent("sensor.caido"), ent("sensor.no_existe")],
    });
    assert.equal(d.ok, true, JSON.stringify(d));
    const rows = d.view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right]), [
      ["Temperatura salón", "21.5 °C"],
      ["Consumo", "1250 W"],
      ["Luz sala", "Encendido"],
      ["Sebas", "Fuera"],
      ["Sensor caído", "No disponible"],
      ["sensor.no_existe", "No existe"],
    ]);
    assert.equal(rows[4].tone, "warn");
    assert.equal(rows[5].tone, "warn");
    assert.equal(rows[0].subtitle, "sensor.temperatura");
  });

  it("valida IDs, token y lista vacía", async () => {
    const { show } = await setup();
    assert.match((await show("homeassistant.entities", conn(), { entities: [ent("malo")] })).error, /no es un ID de entidad válido/);
    assert.match((await show("homeassistant.entities", conn({ token: "x".repeat(40) }), { entities: [ent("light.sala")] })).error, /rechazó el token/);
    assert.match((await show("homeassistant.entities", conn(), { entities: [] })).view.text, /al menos una entidad/);
    assert.match((await show("homeassistant.entities", conn({ token: "corto" }), { entities: [ent("light.sala")] })).error, /formato válido/);
  });

  it("resumen de la casa con una plantilla de solo lectura", async () => {
    const { show, probe } = await setup();
    mock.counts.haTemplates.length = 0;
    const d = await show("homeassistant.summary", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["Luces encendidas"].value, "3 / 8");
    assert.equal(s["Interruptores activos"].value, "2");
    assert.equal(s["En casa"].value, "1 / 2");
    assert.equal(s["En casa"].tone, "good");
    assert.equal(s["No disponibles"].value, "4");
    assert.equal(s["No disponibles"].tone, "warn");
    assert.match(mock.counts.haTemplates[0]!, /states\.light/);
    assert.match(mock.counts.haTemplates[0]!, /tojson/);
    assert.deepEqual(await probe("homeassistant", conn()), { ok: true, message: "Conectado: API running." });
  });
});

describe("Nextcloud", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/nc", secret: MORE.ncToken, ...extra });

  it("usuarios activos, archivos, espacio, memoria y carga", async () => {
    const { show } = await setup();
    const d = await show("nextcloud.server", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["Activos (24 h)"].value, "3");
    assert.equal(s["Activos (24 h)"].hint, "1 ahora");
    assert.equal(s["Usuarios"].value, "5");
    assert.match(s["Archivos"].value, /^123\.?456$/);
    assert.equal(s["Compartidos"].value, "42");
    assert.equal(s["Espacio libre"].value, "2.0 TB");
    assert.equal(s["Memoria"].value, "75%");
    assert.equal(s["Carga (1 min)"].value, "0.52");
  });

  it("autentica con contraseña de aplicación y explica los errores", async () => {
    const { show, probe } = await setup();
    assert.equal((await show("nextcloud.server", conn({ username: MORE.ncUser, secret: MORE.ncAppPass }))).ok, true);
    assert.match((await show("nextcloud.server", conn({ secret: "token-equivocado" }))).error, /rechazó las credenciales/);
    assert.match((await show("nextcloud.server", conn({ username: MORE.ncUser, secret: "mala" }))).error, /rechazó las credenciales/);
    assert.deepEqual(await probe("nextcloud", conn()), { ok: true, message: "Conectado a Nextcloud 29.0.4" });
  });
});

describe("Nginx Proxy Manager", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/npm", identity: MORE.npmUser, password: MORE.npmPass, ...extra });

  it("hosts: activos, desactivados y con error", async () => {
    const { show } = await setup();
    const d = await show("nginx-proxy-manager.hosts", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Activos"].value, "1");
    assert.equal(s["Desactivados"].value, "1");
    assert.equal(s["Con error"].value, "1");
    assert.equal(s["Con error"].tone, "bad");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right]), [
      ["roto.casa.lan", "Error"],
      ["jf.casa.lan +1", "Activo"],
      ["off.casa.lan", "Desactivado"],
    ]);
    assert.equal(rows[1].subtitle, "http://192.168.1.10:8096 · HTTPS");
  });

  it("certificados: los que caducan antes primero, con colores por urgencia", async () => {
    const { show } = await setup();
    const d = await show("nginx-proxy-manager.certificates", conn());
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Certificados"].value, "4");
    assert.equal(stats["Caducan en < 30 d"].value, "3");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["vencido", "Caducado", "bad"],
      ["*.casa.lan", "en 5 d", "bad"],
      ["pronto", "en 15 d", "warn"],
      ["otro", "en 90 d", "good"],
    ]);
    assert.match(rows[1].subtitle, /Let's Encrypt/);
  });

  it("reutiliza el token, renueva si lo rechazan y explica credenciales malas", async () => {
    const { show, probe } = await setup();
    await show("nginx-proxy-manager.hosts", conn());
    const after1 = mock.counts.npmLogins;
    await show("nginx-proxy-manager.hosts", conn());
    await show("nginx-proxy-manager.certificates", conn());
    assert.equal(mock.counts.npmLogins, after1, "el token se reutiliza");

    assert.match((await show("nginx-proxy-manager.hosts", conn({ password: "mala" }))).error, /rechazó el usuario o la contraseña/);
    assert.deepEqual(await probe("nginx-proxy-manager", conn()), { ok: true, message: "Conectado: 3 hosts proxy" });
  });
});

describe("What's Up Docker", () => {
  it("lista las actualizaciones: las mayores primero y con su salto", async () => {
    const { show } = await setup();
    const d = await show("wud.updates", { url: mock.url + "/wud" });
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Vigilados"].value, "4");
    assert.equal(stats["Con actualización"].value, "3");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["traefik", "Mayor", "bad"],
      ["jellyfin", "Menor", "warn"],
      ["latest-app", "Imagen nueva", "warn"],
    ]);
    assert.equal(rows[1].subtitle, "jellyfin/jellyfin:10.9.1 → 10.10.0");

    const all = await show("wud.updates", { url: mock.url + "/wud" }, { show: "all" });
    assert.equal(all.view.sections[1].view.items.at(-1).right, "Al día");
  });

  it("autenticación básica y prueba de conexión", async () => {
    const { show, probe } = await setup();
    const ok = await show("wud.updates", { url: mock.url + "/wud-auth", username: MORE.wudUser, password: MORE.wudPass });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match((await show("wud.updates", { url: mock.url + "/wud-auth", username: "x", password: "y" })).error, /rechazó el usuario/);
    assert.deepEqual(await probe("wud", { url: mock.url + "/wud" }), { ok: true, message: "Conectado: 3 actualizaciones de 4 contenedores" });
  });
});

describe("Watchtower", () => {
  it("lee las métricas en formato Prometheus", async () => {
    const { show, probe } = await setup();
    const conn = { url: mock.url + "/wt", token: MORE.wtToken };
    const d = await show("watchtower.scan", conn);
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.equal(s["Revisados"].value, "24");
    assert.equal(s["Actualizados"].tone, "good");
    assert.equal(s["Fallidos"].value, "1");
    assert.equal(s["Fallidos"].tone, "bad");
    assert.equal(s["Análisis totales"].value, "105");
    assert.equal(s["Análisis totales"].hint, "3 omitidos");

    assert.match((await show("watchtower.scan", { ...conn, token: "token-equivocado" })).error, /rechazó el token/);
    assert.match((await show("watchtower.scan", { ...conn, url: mock.url + "/wt-off" })).error, /--http-api-metrics/);
    assert.deepEqual(await probe("watchtower", conn), { ok: true, message: "Conectado: 24 contenedores revisados en el último análisis" });
  });
});

describe("Gatus", () => {
  const conn = () => ({ url: mock.url + "/gatus" });

  it("arriba/caídos, disponibilidad y orden con los caídos primero", async () => {
    const { show } = await setup();
    const d = await show("gatus.endpoints", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Arriba"].value, "1");
    assert.equal(s["Caídos"].value, "2", "sin resultados cuenta como caído");
    assert.equal(s["Disponibilidad"].value, "75.0%");
    assert.equal(s["Disponibilidad"].tone, "warn");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right]), [["Router", "Caído"], ["Vacío", "Caído"], ["Jellyfin", "25 ms"]]);
    assert.equal(rows[2].subtitle, "media");

    const only = await show("gatus.endpoints", conn(), { show: "problems" });
    assert.equal(only.view.sections[1].view.items.length, 2);
  });

  it("prueba de conexión y URL equivocada", async () => {
    const { show, probe } = await setup();
    assert.deepEqual(await probe("gatus", conn()), { ok: true, message: "Conectado: 1 de 3 endpoints arriba" });
    assert.match((await show("gatus.endpoints", { url: mock.url + "/nada" })).error, /No se encontró la API de Gatus/);
  });
});

describe("Healthchecks", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/hc", apiKey: MORE.hcKey, ...extra });

  it("estado de cada tarea con las caídas primero", async () => {
    const { show } = await setup();
    const d = await show("healthchecks.checks", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Al día"].value, "1");
    assert.equal(s["Caídas"].value, "1");
    assert.equal(s["Caídas"].tone, "bad");
    assert.equal(s["En gracia"].value, "1");
    assert.equal(s["Pausadas"].value, "1");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["Rsync a la nube", "Caído", "bad"],
      ["Script de limpieza", "En gracia", "warn"],
      ["Backup diario", "Al día", "good"],
      ["Pausado", "Pausado", "neutral"],
    ]);
    assert.equal(rows[0].subtitle, "último aviso hace 1 d");
    assert.equal(rows[2].subtitle, "último aviso hace 2 h");
    assert.equal(rows[3].subtitle, "sin avisos todavía");
  });

  it("filtra por etiqueta y por «solo problemas»; valida la etiqueta y la clave", async () => {
    const { show, probe } = await setup();
    const tagged = await show("healthchecks.checks", conn(), { tag: "backup" });
    assert.deepEqual(tagged.view.sections[1].view.items.map((r: any) => r.title), ["Rsync a la nube", "Backup diario"]);
    const problems = await show("healthchecks.checks", conn(), { show: "problems" });
    assert.deepEqual(problems.view.sections[1].view.items.map((r: any) => r.title), ["Rsync a la nube", "Script de limpieza"]);
    assert.match((await show("healthchecks.checks", conn(), { tag: "a b&x" })).error, /etiqueta solo puede/);
    assert.match((await show("healthchecks.checks", conn({ apiKey: "clave-equivocada-1234567" }))).error, /rechazó la API key/);
    assert.deepEqual(await probe("healthchecks", conn()), { ok: true, message: "Conectado: 4 tareas" });
  });
});

describe("Netdata", () => {
  it("alarmas y gráfica de CPU y memoria (de antiguo a reciente, sin contar «guest» dos veces)", async () => {
    const { show, probe } = await setup();
    const d = await show("netdata.overview", { url: mock.url + "/netdata" }, { minutes: 10 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const alarms = by(d.view.sections[0].view.items, "label");
    assert.equal(alarms["Normales"].value, "20");
    assert.equal(alarms["Avisos"].tone, "warn");
    assert.equal(alarms["Críticas"].tone, "bad");

    const chart = d.view.sections[1];
    assert.equal(chart.title, "Últimos 10 min");
    assert.equal(chart.view.kind, "chart");
    assert.equal(chart.view.unit, "%");
    assert.deepEqual(chart.view.series.map((s: any) => s.name), ["CPU", "Memoria"]);
    assert.deepEqual(chart.view.series[0].points, [5, 15, 31]);
    assert.deepEqual(chart.view.series[1].points, [25, 37.5, 50]);
    assert.equal(chart.view.labels.length, 3);
    assert.deepEqual(await probe("netdata", { url: mock.url + "/netdata" }), { ok: true, message: "Conectado a Netdata v1.45.0" });
  });

  it("si la gráfica falla se muestran solo las alarmas", async () => {
    const { show } = await setup();
    const d = await show("netdata.overview", { url: mock.url + "/netdata-nochart" });
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.sections.length, 1);
  });
});

describe("Beszel", () => {
  const conn = (extra = {}) => ({ url: mock.url + "/beszel", identity: MORE.beszelUser, password: MORE.beszelPass, ...extra });

  it("sistemas con estado y uso de CPU, memoria y disco", async () => {
    const { show } = await setup();
    const d = await show("beszel.systems", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["En línea"].value, "2");
    assert.equal(s["Caídos"].value, "1");
    assert.equal(s["Total"].value, "3");
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["nas2", "Caído", "bad"],
      ["pi", "En línea", "warn"],
      ["tower", "En línea", "good"],
    ]);
    assert.equal(rows[2].subtitle, "CPU 23% · RAM 41% · Disco 68%");
    assert.ok(Math.abs(rows[2].progress - 0.234) < 1e-9);
    assert.equal(rows[0].progress, undefined);
  });

  it("prueba las colecciones de usuarios de versiones antiguas y reutiliza el token", async () => {
    const { show, probe } = await setup();
    const admin = await show("beszel.systems", conn({ url: mock.url + "/beszel-admin" }));
    assert.equal(admin.ok, true, JSON.stringify(admin));

    const before = mock.counts.beszelLogins;
    await show("beszel.systems", conn());
    const after1 = mock.counts.beszelLogins;
    await show("beszel.systems", conn());
    assert.equal(mock.counts.beszelLogins, after1, "el token se reutiliza");
    assert.ok(after1 >= before);

    assert.match((await show("beszel.systems", conn({ password: "mala" }))).error, /rechazó el correo o la contraseña/);
    assert.deepEqual(await probe("beszel", conn()), { ok: true, message: "Conectado: 2 de 3 sistemas en línea" });
  });
});

describe("catálogo (segunda tanda)", () => {
  it("todos traen conexión y se pueden probar; la carpeta compartida no es un plugin", async () => {
    const { c } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    const ids = ["sonarr", "radarr", "lidarr", "prowlarr", "bazarr", "paperless", "peanut", "homeassistant", "nextcloud", "nginx-proxy-manager", "wud", "watchtower", "gatus", "healthchecks", "netdata", "beszel"];
    for (const id of ids) {
      const w = widgets.find((x: any) => x.pluginId === id);
      assert.ok(w, id);
      assert.equal(w.testable, true, id);
      assert.ok(w.connection.length > 0, id);
    }
    assert.equal(widgets.some((w: any) => w.pluginId === "_shared"), false);
  });
});
