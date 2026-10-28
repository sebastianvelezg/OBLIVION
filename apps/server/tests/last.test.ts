import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSafeHttp } from "../src/security/safe-http.js";
import { LAST, startMockLast, type MockLast } from "./support/mock-last.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockLast;
before(async () => {
  mock = await startMockLast();
});
after(() => mock.close());

async function setup(opts: Parameters<typeof makeApp>[1] = {}) {
  const ctx = await makeApp({}, { realPlugins: true, ...opts });
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
const u = (path: string) => mock.url + path;

describe("Syncthing", () => {
  const conn = (extra = {}) => ({ url: u("/st"), apiKey: LAST.stKey, ...extra });

  it("carpetas con su estado y dispositivos conectados", async () => {
    const { show } = await setup();
    const d = await show("syncthing.status", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.equal(stats["Carpetas"].value, "5");
    assert.equal(stats["Carpetas"].hint, "1 al día");
    assert.equal(stats["Dispositivos"].value, "1 / 3", "no cuenta el propio dispositivo");
    assert.equal(stats["Errores"].value, "1");
    assert.equal(stats["Errores"].tone, "bad");

    const rows = by(d.view.sections[1].view.items, "title");
    assert.deepEqual([rows["Documentos"].right, rows["Documentos"].tone], ["Sincronizada", "good"]);
    assert.deepEqual([rows["Fotos"].right, rows["Fotos"].tone], ["Escaneando", "warn"]);
    assert.deepEqual([rows["Vieja"].right, rows["Vieja"].tone], ["Pausada", "neutral"]);
    assert.deepEqual([rows["Sincronizando"].right, rows["Sincronizando"].tone, rows["Sincronizando"].progress], ["50%", "warn", 0.5]);
    assert.deepEqual([rows["Con error"].right, rows["Con error"].tone], ["Con errores", "bad"]);

    const devices = by(d.view.sections[2].view.items, "title");
    assert.equal(devices["portátil"].right, "Conectado");
    assert.deepEqual([devices["móvil"].right, devices["móvil"].tone, devices["móvil"].subtitle], ["Desconectado", "warn", "visto hace 3 h"]);
    assert.equal(devices["viejo"].right, "Pausado");

    const noDevices = await show("syncthing.status", conn(), { showDevices: false });
    assert.equal(noDevices.view.sections.length, 2);
  });

  it("clave mala, formato inválido y prueba de conexión", async () => {
    const { show, probe } = await setup();
    assert.match((await show("syncthing.status", conn({ apiKey: "clave-equivocada-1234567890" }))).error, /rechazó la API key/);
    assert.match((await show("syncthing.status", conn({ apiKey: "corta" }))).error, /formato válido/);
    assert.deepEqual(await probe("syncthing", conn()), { ok: true, message: "Conectado: AAAAAAA, encendido 2 h" });
  });
});

describe("Audiobookshelf", () => {
  const conn = (extra = {}) => ({ url: u("/abs"), apiKey: LAST.absToken, ...extra });

  it("bibliotecas con totales y quién escucha ahora", async () => {
    const { show } = await setup();
    const d = await show("audiobookshelf.libraries", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Elementos"].value, "150");
    assert.equal(s["Duración"].value, "550 h");
    assert.equal(s["Tamaño"].value, "7.0 GB");
    const libs = d.view.sections[1].view.items;
    assert.deepEqual(libs[0], { title: "Audiolibros", subtitle: "120 elementos · 20 d 20 h", right: "5.0 GB" });
    const now = d.view.sections[2];
    assert.equal(now.title, "Escuchando ahora");
    assert.deepEqual([now.view.items[0].title, now.view.items[0].subtitle], ["Proyecto Hail Mary", "sebas · Andy Weir"]);
  });

  it("sin permiso de administrador oculta «escuchando» sin romper; errores y prueba", async () => {
    const { show, probe } = await setup();
    const d = await show("audiobookshelf.libraries", conn({ url: u("/abs-user") }));
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.sections.length, 2);
    assert.match((await show("audiobookshelf.libraries", conn({ apiKey: "otro-token-equivocado-123" }))).error, /rechazó el token/);
    assert.deepEqual(await probe("audiobookshelf", conn()), { ok: true, message: "Conectado: 2 bibliotecas" });
  });
});

describe("Navidrome", () => {
  const conn = (extra = {}) => ({ url: u("/nav"), username: LAST.navUser, password: LAST.navPass, ...extra });

  it("reproduciendo ahora: una o varias entradas y ninguna", async () => {
    const { show } = await setup();
    const d = await show("navidrome.now-playing", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.deepEqual(d.view.items.map((i: any) => [i.title, i.subtitle, i.right]), [
      ["Karma Police", "Radiohead · ana · Feishin", "ahora"],
      ["Roads", "Portishead · luis · DSub", "hace 5 min"],
    ]);
    const single = await show("navidrome.now-playing", conn({ url: u("/nav-single") }));
    assert.equal(single.view.items.length, 1, "Subsonic devuelve un objeto cuando hay uno solo");
    const none = await show("navidrome.now-playing", conn({ url: u("/nav-empty") }));
    assert.equal(none.view.items.length, 0);
    assert.match(none.view.empty, /Nadie/);
  });

  it("últimos álbumes con el tamaño de la biblioteca; sal distinta en cada petición", async () => {
    const { show, probe } = await setup();
    const d = await show("navidrome.recent", conn(), { limit: 5 });
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.match(d.view.sections[0].view.items[0].value, /^12\.?345$/);
    assert.deepEqual(d.view.sections[1].view.items[0], { title: "OK Computer", subtitle: "Radiohead", right: "1997" });
    const salts = mock.counts.navSalts.slice(-3);
    assert.equal(new Set(salts).size, 3, "cada petición usa su propia sal");

    assert.match((await show("navidrome.now-playing", conn({ password: "mala" }))).error, /rechazó el usuario o la contraseña/);
    assert.deepEqual(await probe("navidrome", conn()), { ok: true, message: "Conectado a Navidrome" });
  });

  it("nunca envía la contraseña en claro", async () => {
    const { show } = await setup();
    await show("navidrome.now-playing", conn());
    // El simulado solo acepta el token md5; si la contraseña viajara en la URL, el servidor la vería en `p=`.
    assert.ok(mock.counts.navSalts.every((s) => /^[0-9a-f]{16}$/.test(s)));
  });
});

describe("Kavita", () => {
  const conn = (extra = {}) => ({ url: u("/kav"), username: LAST.kavUser, password: LAST.kavPass, ...extra });

  it("estadísticas y últimas series (si el endpoint existe)", async () => {
    const { show } = await setup();
    const d = await show("kavita.library", conn(), { limit: 5 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Series"].value, "250");
    assert.equal(s["Volúmenes"].value, "900");
    assert.match(s["Archivos"].value, /^5\.?400$/);
    assert.equal(s["Tamaño"].value, "3.0 TB");
    assert.deepEqual(d.view.sections[1].view.items[0], { title: "Berserk", subtitle: "Manga", right: "hace 2 h" });

    const old = await show("kavita.library", conn({ url: u("/kav-old") }), { limit: 5 });
    assert.equal(old.view.sections.length, 1, "si falta el endpoint solo se muestran las estadísticas");
  });

  it("acepta la clave de API sin usuario, reutiliza el token y explica los errores", async () => {
    const { show, probe } = await setup();
    const withKey = await show("kavita.library", conn({ username: undefined, password: LAST.kavApiKey }));
    assert.equal(withKey.ok, true, JSON.stringify(withKey));

    await show("kavita.library", conn());
    const after1 = mock.counts.kavitaLogins;
    await show("kavita.library", conn());
    assert.equal(mock.counts.kavitaLogins, after1, "el token se reutiliza");

    assert.match((await show("kavita.library", conn({ password: "mala" }))).error, /rechazó el usuario o la contraseña/);
    assert.deepEqual(await probe("kavita", conn()), { ok: true, message: "Conectado: 250 series" });
  });
});

describe("Komga", () => {
  const conn = (extra = {}) => ({ url: u("/komga"), secret: LAST.komgaKey, ...extra });

  it("bibliotecas, series y libros con API key, y últimas series", async () => {
    const { show } = await setup();
    const d = await show("komga.library", conn(), { limit: 5 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Bibliotecas"].value, "2");
    assert.equal(s["Series"].value, "300");
    assert.match(s["Libros"].value, /^4\.?500$/);
    assert.deepEqual(d.view.sections[1].view.items[0], { title: "One Piece", subtitle: "105 libros", right: "hace 3 h" });

    const none = await show("komga.library", conn(), { limit: 0 });
    assert.equal(none.view.sections.length, 1);
  });

  it("usa POST …/list en versiones nuevas, autentica con usuario y explica errores", async () => {
    const { show, probe } = await setup();
    const v2 = await show("komga.library", conn({ url: u("/komga2") }), { limit: 0 });
    assert.equal(by(v2.view.sections[0].view.items, "label")["Series"].value, "301");

    const basic = await show("komga.library", conn({ username: LAST.komgaUser, secret: LAST.komgaPass }), { limit: 0 });
    assert.equal(basic.ok, true, JSON.stringify(basic));
    assert.match((await show("komga.library", conn({ secret: "clave-equivocada-1234" }))).error, /rechazó la API key/);
    assert.deepEqual(await probe("komga", conn()), { ok: true, message: "Conectado: 2 bibliotecas" });
  });
});

describe("Mealie", () => {
  const conn = (extra = {}) => ({ url: u("/mealie"), token: LAST.mealieToken, ...extra });

  it("estadísticas y menú ordenado por día y comida", async () => {
    const { show } = await setup();
    const st = await show("mealie.stats", conn());
    assert.equal(st.ok, true, JSON.stringify(st));
    const s = by(st.view.items, "label");
    assert.deepEqual([s["Recetas"].value, s["Categorías"].value, s["Etiquetas"].value, s["Herramientas"].value, s["Usuarios"].value], ["321", "12", "40", "5", "3"]);

    const plan = await show("mealie.mealplan", conn(), { days: 7 });
    assert.deepEqual(plan.view.items.map((i: any) => [i.title, i.subtitle, i.right, i.tone]), [
      ["Tostadas", "Desayuno", "Hoy", "good"],
      ["Lasaña", "Cena", "Hoy", "good"],
      ["Ensalada", "Almuerzo", "Mañana", "neutral"],
    ]);
  });

  it("funciona con Mealie v1 (rutas /groups) y explica errores", async () => {
    const { show, probe } = await setup();
    const v1 = await show("mealie.stats", conn({ url: u("/mealie-v1") }));
    assert.equal(v1.ok, true, JSON.stringify(v1));
    assert.equal((await show("mealie.mealplan", conn({ url: u("/mealie-v1") }))).view.items.length, 3);
    assert.match((await show("mealie.stats", conn({ token: "token-equivocado-1234567890" }))).error, /rechazó el token/);
    assert.match((await show("mealie.stats", conn({ token: "corto" }))).error, /formato válido/);
    assert.deepEqual(await probe("mealie", conn()), { ok: true, message: "Conectado: 321 recetas" });
  });
});

describe("Karakeep", () => {
  const conn = (extra = {}) => ({ url: u("/kk"), apiKey: LAST.kkKey, ...extra });

  it("estadísticas y últimos marcadores con enlace seguro", async () => {
    const { show, probe } = await setup();
    const st = await show("karakeep.stats", conn());
    const s = by(st.view.items, "label");
    assert.deepEqual([s["Marcadores"].value, s["Favoritos"].value, s["Etiquetas"].value], ["850", "42", "77"]);

    const d = await show("karakeep.latest", conn(), { limit: 5 });
    assert.equal(d.ok, true, JSON.stringify(d));
    const [a, b, c] = d.view.items;
    assert.deepEqual([a.title, a.subtitle, a.href, a.right], ["Un artículo", "example.com · lectura, tech", "https://example.com/articulo", "hace 1 h"]);
    assert.equal(b.title, "Nota mía");
    assert.equal(b.href, undefined);
    assert.equal(c.title, "Peligro");
    assert.equal(c.href, undefined, "un enlace javascript: nunca se ofrece");
    assert.match((await show("karakeep.stats", conn({ apiKey: "clave-equivocada-12345" }))).error, /rechazó la clave/);
    assert.deepEqual(await probe("karakeep", conn()), { ok: true, message: "Conectado: 850 marcadores" });
  });
});

describe("Linkwarden", () => {
  const conn = (extra = {}) => ({ url: u("/lw"), token: LAST.lwToken, ...extra });

  it("colecciones, enlaces y etiquetas con las colecciones más grandes primero", async () => {
    const { show, probe } = await setup();
    const d = await show("linkwarden.overview", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.deepEqual([s["Colecciones"].value, s["Enlaces"].value, s["Etiquetas"].value], ["3", "31", "3"]);
    assert.deepEqual(d.view.sections[1].view.items.map((i: any) => [i.title, i.right]), [["Trabajo", "30 enlaces"], ["Recetas", "1 enlace"], ["Vacía", "0 enlaces"]]);
    assert.equal(d.view.sections[1].view.items[0].subtitle, "Cosas del curro");
    assert.match((await show("linkwarden.overview", conn({ token: "token-equivocado-12345" }))).error, /rechazó el token/);
    assert.deepEqual(await probe("linkwarden", conn()), { ok: true, message: "Conectado: 3 colecciones" });
  });
});

describe("Duplicati", () => {
  const conn = (extra = {}) => ({ url: u("/dup"), password: LAST.dupPass, ...extra });

  it("trabajos: errores y avisos de cada uno, y los más urgentes primero", async () => {
    const { show } = await setup();
    const d = await show("duplicati.jobs", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Trabajos"].value, "4");
    assert.equal(s["Trabajos"].hint, "4.7 GB");
    assert.equal(s["Errores"].value, "1", "una notificación sin BackupID no cuenta");
    assert.equal(s["Errores"].tone, "bad");
    assert.equal(s["Avisos"].value, "1");
    assert.equal(s["En curso"].value, "No");

    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["Con error", "Con errores", "bad"],
      ["Fotos", "Con avisos", "warn"],
      ["Nueva", "Nunca", "warn"],
      ["Documentos", "hace 2 h", "good"],
    ]);
    assert.match(rows[3].subtitle, /^última copia hace 2 h · siguiente .+ · 4\.7 GB$/);
    assert.equal(rows[2].subtitle, "sin copias todavía");
  });

  it("marca el trabajo que está en curso y reutiliza el token", async () => {
    const { show, probe } = await setup();
    const d = await show("duplicati.jobs", conn({ url: u("/dup-running") }));
    assert.equal(by(d.view.sections[0].view.items, "label")["En curso"].value, "Sí");
    assert.deepEqual(d.view.sections[1].view.items.find((r: any) => r.title === "Documentos").right, "En curso");

    const after1 = mock.counts.dupLogins;
    await show("duplicati.jobs", conn());
    await show("duplicati.jobs", conn());
    assert.ok(mock.counts.dupLogins - after1 <= 1, "el token se reutiliza");
    assert.match((await show("duplicati.jobs", conn({ password: "mala" }))).error, /rechazó la contraseña/);
    assert.deepEqual(await probe("duplicati", conn()), { ok: true, message: "Conectado: 4 trabajos de copia" });
  });
});

describe("Kopia", () => {
  const conn = (extra = {}) => ({ url: u("/kopia"), username: LAST.kopiaUser, password: LAST.kopiaPass, ...extra });

  it("orígenes: con error, sin copia reciente y en curso", async () => {
    const { show, probe } = await setup();
    const d = await show("kopia.snapshots", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Orígenes"].value, "5");
    assert.equal(s["Con errores"].value, "1");
    assert.equal(s["Con errores"].tone, "bad");
    assert.equal(s["Sin copia > 48 h"].value, "2");
    assert.equal(s["Sin copia > 48 h"].tone, "warn");

    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["/mnt/user/err", "3 errores", "bad"],
      ["/mnt/user/fotos", "hace 4 d", "warn"],
      ["/mnt/user/nunca", "Nunca", "warn"],
      ["/mnt/user/docs", "hace 3 h", "good"],
      ["/mnt/user/subiendo", "En curso", "good"],
    ]);
    assert.match(rows[3].subtitle, /^root@tower · /);
    assert.match((await show("kopia.snapshots", conn({ password: "mala" }))).error, /rechazó el usuario/);
    assert.deepEqual(await probe("kopia", conn()), { ok: true, message: "Conectado: 5 orígenes de copia" });
  });
});

describe("Backrest", () => {
  const conn = (extra = {}) => ({ url: u("/backrest"), ...extra });

  it("planes: último resultado, balance de 30 días y datos añadidos", async () => {
    const { show, probe } = await setup();
    const d = await show("backrest.plans", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Planes"].value, "4");
    assert.equal(s["Última correcta"].value, "2");
    assert.equal(s["Última con error"].value, "1");
    assert.equal(s["Última con error"].tone, "bad");
    assert.equal(s["Fallos (30 d)"].value, "3", "los int64 llegan como texto");
    assert.equal(s["Fallos (30 d)"].tone, "warn");
    assert.equal(s["Añadido (30 d)"].value, "1.0 GB");

    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.right, r.tone]), [
      ["fotos", "Error", "bad"],
      ["avisos", "hace 4 h", "warn"],
      ["documentos", "hace 3 h", "good"],
      ["nueva", "Sin copias", "neutral"],
    ]);
    assert.equal(rows[2].subtitle, "30 d: 28 ok · 0 fallos · 1.0 GB añadidos");
    assert.deepEqual(await probe("backrest", conn()), { ok: true, message: "Conectado: 4 planes de copia" });
  });

  it("autenticación básica opcional", async () => {
    const { show } = await setup();
    const ok = await show("backrest.plans", conn({ url: u("/backrest-auth"), username: LAST.backrestUser, password: LAST.backrestPass }));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match((await show("backrest.plans", conn({ url: u("/backrest-auth"), username: "x", password: "y" }))).error, /rechazó el usuario/);
  });
});

describe("SABnzbd", () => {
  const conn = (extra = {}) => ({ url: u("/sab"), apiKey: LAST.sabKey, ...extra });

  it("velocidad, cola y estado de cada descarga", async () => {
    const { show, probe } = await setup();
    const d = await show("sabnzbd.downloads", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Velocidad"].value, "5.2 MB/s");
    assert.equal(s["Velocidad"].tone, "good");
    assert.equal(s["En cola"].value, "3");
    assert.equal(s["En cola"].hint, "2.0 GB restantes");
    assert.equal(s["Tiempo restante"].value, "0:06:30");
    assert.equal(s["Estado"].value, "Descargando");

    const [a, b] = d.view.sections[1].view.items;
    assert.deepEqual([a.title, a.right, a.progress, a.subtitle], ["Pelicula.2024", "42%", 0.42, "movies · Downloading · 0:03:00"]);
    assert.deepEqual([b.title, b.tone, b.subtitle], ["Serie.S01", "warn", "tv · Paused"]);

    assert.match((await show("sabnzbd.downloads", conn({ apiKey: "f".repeat(32) }))).error, /rechazó la API key/);
    assert.match((await show("sabnzbd.downloads", conn({ apiKey: "corta" }))).error, /formato válido/);
    assert.deepEqual(await probe("sabnzbd", conn()), { ok: true, message: "Conectado: 3 en cola (Downloading)" });
  });
});

describe("NZBGet", () => {
  const conn = (extra = {}) => ({ url: u("/nzb"), username: LAST.nzbUser, password: LAST.nzbPass, ...extra });

  it("velocidad, restante con estimación y cola", async () => {
    const { show, probe } = await setup();
    const d = await show("nzbget.downloads", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Velocidad"].value, "3.0 MB/s");
    assert.equal(s["Restante"].value, "2.0 GB");
    assert.equal(s["Restante"].hint, "≈ 11 min");
    assert.equal(s["Descargado"].value, "4.0 GB");
    assert.equal(s["Estado"].value, "Descargando");

    const [a, b] = d.view.sections[1].view.items;
    assert.deepEqual([a.title, a.right, a.progress, a.subtitle], ["Peli", "50%", 0.5, "Movies · Descargando"]);
    assert.deepEqual([b.title, b.tone, b.subtitle], ["Pausada", "warn", "Pausada"]);

    assert.match((await show("nzbget.downloads", conn({ password: "mala" }))).error, /rechazó el usuario/);
    assert.deepEqual(await probe("nzbget", conn()), { ok: true, message: "Conectado: 3.0 MB/s" });
  });
});

describe("Deluge", () => {
  const conn = (extra = {}) => ({ url: u("/deluge"), password: LAST.delugePass, ...extra });

  it("velocidades y torrents activos con progreso", async () => {
    const { show } = await setup();
    const d = await show("deluge.downloads", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.equal(s["Descarga"].value, "2.0 MB/s");
    assert.equal(s["Subida"].value, "100 KB/s");
    assert.equal(s["Descargando"].value, "1");
    assert.equal(s["Sembrando"].value, "1");
    const [a, b] = d.view.sections[1].view.items;
    assert.deepEqual([a.title, a.right, a.subtitle, a.tone], ["debian", "76%", "Descargando · 10 min", "neutral"]);
    assert.ok(Math.abs(a.progress - 0.755) < 1e-9);
    assert.deepEqual([b.title, b.right, b.subtitle, b.tone], ["seed", "100%", "Sembrando · ↑ 100 KB/s", "good"]);
    assert.equal(d.view.sections[1].view.items.length, 2, "el torrent en pausa no es activo");

    const all = await show("deluge.downloads", conn(), { filter: "all" });
    assert.equal(all.view.sections[1].view.items.length, 3);
  });

  it("reutiliza la sesión y vuelve a iniciarla si caduca", async () => {
    const { show } = await setup();
    await show("deluge.downloads", conn());
    const after1 = mock.counts.delugeLogins;
    await show("deluge.downloads", conn());
    assert.equal(mock.counts.delugeLogins, after1, "la cookie se reutiliza");

    mock.counts.delugeExpireNext = true; // la siguiente petición responde «no autenticado»
    const d = await show("deluge.downloads", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(mock.counts.delugeLogins, after1 + 1, "inició sesión de nuevo");
  });

  it("explica contraseña mala, demonio desconectado y prueba de conexión", async () => {
    const { show, probe } = await setup();
    assert.match((await show("deluge.downloads", conn({ password: "mala" }))).error, /rechazó la contraseña/);
    assert.match((await show("deluge.downloads", conn({ url: u("/deluge-off") }))).error, /no está conectada a un demonio/);
    assert.deepEqual(await probe("deluge", conn()), { ok: true, message: "Conectado: 3 torrents" });
  });
});

describe("Traefik", () => {
  const conn = (extra = {}) => ({ url: u("/traefik"), ...extra });

  it("resumen con avisos y los routers con problemas", async () => {
    const { show, probe } = await setup();
    const d = await show("traefik.overview", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.deepEqual([s["Routers"].value, s["Routers"].hint, s["Routers"].tone], ["12", "2 errores · 1 avisos", "bad"]);
    assert.deepEqual([s["Servicios"].value, s["Servicios"].hint, s["Servicios"].tone], ["10", undefined, "neutral"]);
    const bad = d.view.sections[1];
    assert.equal(bad.title, "Con problemas");
    assert.deepEqual(bad.view.items.map((i: any) => [i.title, i.right, i.tone]), [["roto@docker", "Desactivado", "bad"], ["aviso@docker", "Aviso", "warn"]]);
    assert.match(bad.view.items[0].subtitle, /Host\(/);
    assert.deepEqual(await probe("traefik", conn()), { ok: true, message: "Conectado: 12 routers HTTP" });
  });

  it("autenticación básica opcional", async () => {
    const { show } = await setup();
    assert.equal((await show("traefik.overview", conn({ url: u("/traefik-auth"), username: LAST.traefikUser, password: LAST.traefikPass }))).ok, true);
    assert.match((await show("traefik.overview", conn({ url: u("/traefik-auth"), username: "x", password: "y" }))).error, /rechazó el usuario/);
  });
});

describe("Caddy", () => {
  it("destinos con los que fallan primero; y explica el rechazo del origen", async () => {
    const { show, probe } = await setup();
    const d = await show("caddy.upstreams", { url: u("/caddy") });
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.sections[0].view.items, "label");
    assert.deepEqual([s["Destinos"].value, s["Peticiones activas"].value, s["Fallos"].value, s["Fallos"].tone], ["3", "3", "3", "warn"]);
    assert.deepEqual(d.view.sections[1].view.items.map((i: any) => [i.title, i.right, i.tone]), [
      ["192.168.1.11:80", "3 fallos", "warn"],
      ["192.168.1.10:8096", "Bien", "good"],
      ["x:1", "Bien", "good"],
    ]);
    assert.match((await show("caddy.upstreams", { url: u("/caddy-denied") })).error, /rechazó la petición/);
    assert.deepEqual(await probe("caddy", { url: u("/caddy") }), { ok: true, message: "Conectado: 3 destinos" });
  });
});

describe("Gotify", () => {
  const conn = (extra = {}) => ({ url: u("/gotify"), token: LAST.gotifyClient, ...extra });

  it("notificaciones con su prioridad; usa el nombre de la aplicación si no hay título", async () => {
    const { show, probe } = await setup();
    const d = await show("gotify.messages", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const stats = by(d.view.sections[0].view.items, "label");
    assert.deepEqual([stats["Aplicaciones"].value, stats["Mensajes recientes"].value], ["2", "3"]);
    const rows = d.view.sections[1].view.items;
    assert.deepEqual(rows.map((r: any) => [r.title, r.tone]), [["Actualizado", "warn"], ["Backups", "bad"], ["Backup ok", "neutral"]]);
    assert.equal(rows[1].subtitle, "Backup falló");
    assert.equal(rows[0].right, "hace 10 min");

    assert.match((await show("gotify.messages", conn({ token: LAST.gotifyApp }))).error, /rechazó el token/);
    assert.deepEqual(await probe("gotify", conn()), { ok: true, message: "Conectado: 2 aplicaciones" });
  });
});

describe("ntfy", () => {
  const conn = (extra = {}) => ({ url: u("/ntfy"), ...extra });
  const topics = (...t: string[]) => ({ topics: t.map((topic) => ({ topic })) });

  it("mensajes de un tema, solo eventos «message», del más nuevo al más viejo", async () => {
    const { show } = await setup();
    const d = await show("ntfy.messages", conn(), topics("alertas"));
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.deepEqual(d.view.items.map((i: any) => [i.title, i.subtitle, i.right, i.tone]), [
      ["Alerta", "Disco lleno · warning · Urgente", "hace un momento", "bad"],
      ["Hola mundo", "", "hace 1 h", "neutral"],
    ]);
  });

  it("varios temas a la vez", async () => {
    const { show } = await setup();
    const d = await show("ntfy.messages", conn(), topics("alertas", "casa"));
    assert.deepEqual(d.view.items.map((i: any) => [i.title, i.subtitle, i.tone]), [
      ["Alerta", "alertas · Disco lleno · warning · Urgente", "bad"],
      ["Puerta abierta", "casa · Alta", "warn"],
      ["Hola mundo", "alertas", "neutral"],
    ]);
  });

  it("temas con acceso (token), validación del tema y prueba de conexión", async () => {
    const { show, probe } = await setup();
    assert.match((await show("ntfy.messages", conn(), topics("privado"))).error, /rechazó el acceso/);
    assert.equal((await show("ntfy.messages", conn({ token: LAST.ntfyToken }), topics("privado"))).ok, true);
    assert.match((await show("ntfy.messages", conn(), topics("../x"))).error, /no es válido/);
    assert.match((await show("ntfy.messages", conn(), { topics: [] })).view.text, /al menos un tema/);
    assert.deepEqual(await probe("ntfy", conn()), { ok: true, message: "Conectado a ntfy" });
  });
});

describe("Cloudflare Tunnel", () => {
  // La API de Cloudflare está en un host fijo: se simula sustituyendo la red de los plugins.
  const calls: string[] = [];
  const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get("authorization");
    const base = `https://api.cloudflare.com/client/v4/accounts/${LAST.cfAccount}/cfd_tunnel/`;
    if (!url.startsWith(base)) return new Response("{}", { status: 404 });
    if (auth !== `Bearer ${LAST.cfToken}`) return Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 });
    const tunnel = url.slice(base.length).replace(/\/connections$/, "");
    const isConn = url.endsWith("/connections");
    if (tunnel === LAST.cfTunnel) {
      return Response.json({
        success: true,
        result: isConn
          ? [{ id: "c1", conns: [{ colo_name: "mde01", origin_ip: "185.1.2.3" }, { colo_name: "bog01", origin_ip: "185.1.2.3" }] }]
          : { id: tunnel, name: "casa", status: "healthy", conns_active_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
      });
    }
    if (tunnel === LAST.cfTunnelDegraded) return Response.json({ success: true, result: isConn ? [] : { id: tunnel, name: "roto", status: "degraded" } });
    return Response.json({ success: false, errors: [{ message: "Tunnel not found" }] }, { status: 404 });
  }) as typeof fetch;
  const http: typeof createSafeHttp = (o) => createSafeHttp({ ...o, lookup: async () => ["104.16.0.1"], fetchImpl: fakeFetch });
  const conn = (extra = {}) => ({ token: LAST.cfToken, accountId: LAST.cfAccount, tunnelId: LAST.cfTunnel, ...extra });

  it("estado del túnel, conexiones, centros y origen", async () => {
    const { show, probe } = await setup({ http });
    calls.length = 0;
    const d = await show("cloudflared.tunnel", conn());
    assert.equal(d.ok, true, JSON.stringify(d));
    const s = by(d.view.items, "label");
    assert.deepEqual([s["Estado"].value, s["Estado"].tone, s["Estado"].hint], ["Activo", "good", "casa"]);
    assert.equal(s["Conexiones"].value, "2");
    assert.equal(s["Centros"].value, "mde01, bog01");
    assert.equal(s["Origen"].value, "185.1.2.3");
    assert.equal(s["Activo desde"].value, "5 h");
    assert.ok(calls.every((c) => new URL(c).host === "api.cloudflare.com"), "solo llama a api.cloudflare.com");

    const degraded = by((await show("cloudflared.tunnel", conn({ tunnelId: LAST.cfTunnelDegraded }))).view.items, "label");
    assert.deepEqual([degraded["Estado"].value, degraded["Estado"].tone, degraded["Conexiones"].tone], ["Degradado", "warn", "bad"]);
    assert.deepEqual(await probe("cloudflared", conn()), { ok: true, message: "Conectado: túnel «casa» (Activo)" });
  });

  it("valida los identificadores y explica token malo y túnel inexistente", async () => {
    const { show } = await setup({ http });
    assert.match((await show("cloudflared.tunnel", conn({ token: "cf-token-equivocado-1234567" }))).error, /rechazó el token/);
    assert.match((await show("cloudflared.tunnel", conn({ tunnelId: "00000000-2222-3333-4444-555555555555" }))).error, /no encuentra ese túnel/);
    assert.match((await show("cloudflared.tunnel", conn({ accountId: "../x" }))).error, /ID de la cuenta no es válido/);
    assert.match((await show("cloudflared.tunnel", conn({ tunnelId: "a/b" }))).error, /ID del túnel no es válido/);
  });
});

describe("catálogo (tercera tanda)", () => {
  it("todos traen conexión y se pueden probar", async () => {
    const { c } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    const ids = ["syncthing", "audiobookshelf", "navidrome", "kavita", "komga", "mealie", "karakeep", "linkwarden", "duplicati", "kopia", "backrest", "sabnzbd", "nzbget", "deluge", "traefik", "caddy", "cloudflared", "gotify", "ntfy"];
    for (const id of ids) {
      const w = widgets.find((x: any) => x.pluginId === id);
      assert.ok(w, id);
      assert.equal(w.testable, true, id);
      assert.ok(w.connection.length > 0, id);
    }
  });
});
