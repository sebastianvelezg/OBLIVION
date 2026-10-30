import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { IDS, MOCK_API_KEY, startMockJellyfin, type MockJellyfin } from "./support/mock-jellyfin.js";
import { client, loggedInAdmin, makeApp } from "./helpers.js";

let mock: MockJellyfin;
before(async () => {
  mock = await startMockJellyfin();
});
after(() => mock.close());

async function setup(config: Record<string, unknown> = {}) {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  /** `cfg` son las opciones del widget; `conn` pisa campos de la conexión (url, apiKey). */
  const add = async (type: string, cfg: Record<string, unknown> = {}, conn: Record<string, unknown> = {}) => {
    const made = await c.post("/api/connections", {
      pluginId: "jellyfin",
      name: "Casa",
      config: { url: mock.url, apiKey: MOCK_API_KEY, ...config, ...conn },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const r = await c.post(`/api/pages/${page.id}/widgets`, {
      type,
      config: cfg,
      connectionId: made.json.connection.id,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.widget as { id: string };
  };
  return { ...ctx, c, add };
}

describe("plugin Jellyfin", () => {
  it("se carga con sus cuatro widgets y una sola conexión compartida", async () => {
    const { c } = await setup();
    const widgets = (await c.get("/api/catalog")).json.widgets;
    const types = widgets.map((w: any) => w.fullType);
    for (const t of ["jellyfin.now-playing", "jellyfin.library", "jellyfin.latest", "jellyfin.overview"]) {
      assert.ok(types.includes(t), t);
    }
    for (const w of widgets.filter((w: any) => w.pluginId === "jellyfin")) {
      assert.deepEqual(w.connection.map((f: any) => f.key), ["url", "apiKey"]);
      assert.equal(w.config.some((f: any) => f.key === "url" || f.key === "apiKey"), false, "la URL y la key ya no se piden por widget");
    }
  });

  it("«Panel de Jellyfin» junta las secciones elegidas en un solo widget", async () => {
    const { c, add } = await setup();
    const all = await add("jellyfin.overview", { showNowPlaying: true, showLibrary: true, showLatest: true, limit: 4 });
    const d = (await c.get(`/api/widgets/${all.id}/data`)).json;
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "sections");
    assert.deepEqual(d.view.sections.map((s: any) => [s.title, s.view.kind]), [
      ["Reproduciendo ahora", "list"],
      ["Biblioteca", "stats"],
      ["Últimos añadidos", "media"],
    ]);
    assert.ok(d.view.sections[2].view.items.length <= 4);

    // Solo dos secciones.
    const two = await add("jellyfin.overview", { showNowPlaying: false, showLibrary: true, showLatest: true });
    const d2 = (await c.get(`/api/widgets/${two.id}/data`)).json;
    assert.deepEqual(d2.view.sections.map((s: any) => s.title), ["Biblioteca", "Últimos añadidos"]);

    // Ninguna: pide activar alguna.
    const none = await add("jellyfin.overview", { showNowPlaying: false, showLibrary: false, showLatest: false });
    assert.match((await c.get(`/api/widgets/${none.id}/data`)).json.view.text, /al menos una sección/);

    // Las carátulas de la sección «Últimos añadidos» pasan por el proxy de imágenes del propio panel.
    const img = await c.get(`/api/widgets/${all.id}/image/${IDS.dune}`);
    assert.equal(img.status, 200);
  });

  it("si la conexión falla, el panel muestra el error de la conexión", async () => {
    const { c, add } = await setup();
    const w = await add("jellyfin.overview", {}, { apiKey: "otra-key-equivocada-123" });
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, false);
    assert.match(d.error, /rechazó la API key/);
  });

  it("«Reproduciendo ahora» lista solo a quien reproduce, con progreso y tipo", async () => {
    const { c, add } = await setup();
    const w = await add("jellyfin.now-playing");
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "list");
    assert.equal(d.view.items.length, 2, "el usuario sin reproducción no aparece");

    const [ep, movie] = d.view.items;
    assert.equal(ep.title, "Severance");
    assert.match(ep.subtitle, /T1·E3/);
    assert.match(ep.subtitle, /sebas/);
    assert.equal(ep.right, "Directo");
    assert.equal(ep.progress, 0.25);
    assert.equal(movie.title, "Dune");
    assert.equal(movie.right, "Pausado");
    assert.equal(movie.tone, "warn", "transcodificar se marca como aviso");
  });

  it("«Biblioteca» muestra conteos y datos del servidor", async () => {
    const { c, add } = await setup();
    const w = await add("jellyfin.library");
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, true, JSON.stringify(d));
    const byLabel = Object.fromEntries(d.view.items.map((i: any) => [i.label, i]));
    assert.match(byLabel["Películas"].value, /1/);
    assert.ok(byLabel["Series"] && byLabel["Episodios"] && byLabel["Colecciones"]);
    assert.equal(byLabel["Canciones"], undefined, "los conteos en cero no se muestran");
    assert.equal(byLabel["Servidor"].value, "Casa");
    assert.equal(byLabel["Servidor"].hint, "v10.10.3");
  });

  it("«Últimos añadidos» devuelve carátulas servidas por el dashboard", async () => {
    const { c, add } = await setup();
    const w = await add("jellyfin.latest", { kind: "Movie,Series", limit: 6 });
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "media");
    const dune = d.view.items.find((i: any) => i.title === "Dune");
    assert.equal(dune.badge, "2021");
    assert.equal(dune.image, IDS.dune);
    assert.equal(d.view.items.find((i: any) => i.title.startsWith("Película sin")).image, undefined);
    // La vista no contiene la URL de Jellyfin ni la key: solo claves opacas.
    const raw = JSON.stringify(d);
    assert.equal(raw.includes(mock.url), false);
    assert.equal(raw.includes(MOCK_API_KEY), false);

    // Un episodio usa la carátula de su serie.
    const eps = await add("jellyfin.latest", { kind: "Episode" });
    const e = (await c.get(`/api/widgets/${eps.id}/data`)).json.view.items[0];
    assert.equal(e.title, "Fallout");
    assert.match(e.subtitle, /T1·E1/);
    assert.equal(e.image, IDS.arcane);
  });

  it("«Últimos añadidos» con filas: una fila de carátulas por biblioteca y género", async () => {
    const { c, add } = await setup();
    const w = await add("jellyfin.latest", {
      rows: [
        { title: "Películas", library: "películas", kind: "Movie", limit: 5 },
        { title: "Anime", library: "Anime", kind: "Series", limit: 5 },
        { title: "Animación", genre: "Animation", kind: "Series", limit: 5 },
        { title: "Perdida", library: "Documentales" },
      ],
    });
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.view.kind, "sections");
    const [movies, anime, genre, missing] = d.view.sections;
    assert.equal(movies.title, "Películas");
    assert.equal(movies.view.layout, "row");
    assert.deepEqual(
      movies.view.items.map((i: any) => i.title),
      ["Dune", "Película sin carátula", "Carátula rota"],
      "solo lo de esa biblioteca (el nombre se compara sin tildes ni mayúsculas)",
    );
    assert.deepEqual(anime.view.items.map((i: any) => i.title), ["Frieren"], "el anime solo sale al pedir su biblioteca");
    assert.deepEqual(genre.view.items.map((i: any) => i.title), ["Arcane"]);
    // Una biblioteca que no existe no rompe las demás: avisa y dice cuáles hay.
    assert.equal(missing.view.kind, "message");
    assert.match(missing.view.text, /Documentales/);
    assert.match(missing.view.text, /Películas, Series, Anime/);
    // Sin filas, la vista sigue siendo una cuadrícula sin anime.
    const plain = await add("jellyfin.latest", { kind: "Series" });
    const p = (await c.get(`/api/widgets/${plain.id}/data`)).json.view;
    assert.equal(p.kind, "media");
    assert.equal(p.layout, undefined);
    assert.equal(p.items.some((i: any) => i.title === "Frieren"), false);
  });

  it("el proxy de imágenes sirve PNG y rechaza lo que no es imagen", async () => {
    const { c, add, app } = await setup();
    const w = await add("jellyfin.latest");

    const ok = await app.request(`/api/widgets/${w.id}/image/${IDS.dune}`, { headers: { cookie: c.cookie, host: "localhost" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.equal(new Uint8Array(await ok.arrayBuffer())[1], 0x50);

    // Jellyfin responde HTML diciendo ser image/png → no se reenvía.
    assert.equal((await c.get(`/api/widgets/${w.id}/image/${IDS.htmlImage}`)).status, 404);
    // Sin imagen en Jellyfin.
    assert.equal((await c.get(`/api/widgets/${w.id}/image/${IDS.noImage}`)).status, 404);
    // Claves con formas peligrosas o desconocidas.
    for (const key of ["..%2f..%2fSessions", "a.b", "x".repeat(101), "zzzz", "%3Cscript%3E"]) {
      assert.equal((await c.get(`/api/widgets/${w.id}/image/${key}`)).status, 404, key);
    }
    // Un widget sin `image` (Biblioteca) no sirve imágenes.
    const lib = await add("jellyfin.library");
    assert.equal((await c.get(`/api/widgets/${lib.id}/image/${IDS.dune}`)).status, 404);
  });

  it("las imágenes exigen sesión", async () => {
    const { c, add, app } = await setup();
    const w = await add("jellyfin.latest");
    assert.equal((await client(app).get(`/api/widgets/${w.id}/image/${IDS.dune}`)).status, 401);
    assert.equal((await c.get(`/api/widgets/${w.id}/image/${IDS.dune}`)).status, 200);
  });

  it("envía la API key en la cabecera oficial y nunca la devuelve", async () => {
    const { c, add } = await setup();
    mock.requests.length = 0;
    const w = await add("jellyfin.library");
    const res = await c.get(`/api/widgets/${w.id}/data`);
    assert.equal(JSON.stringify(res.json).includes(MOCK_API_KEY), false);
    const authed = mock.requests.find((r) => r.path.startsWith("/Items/Counts"))!;
    assert.match(authed.auth!, /^MediaBrowser .*Token="test-api-key-1234567890"/);
    // Ni en la lista de widgets.
    assert.equal(JSON.stringify((await c.get("/api/pages")).json).includes(MOCK_API_KEY), false);
  });

  it("explica los fallos de forma útil (key mala, servidor caído, subruta)", async () => {
    const { c, add } = await setup();

    const bad = await add("jellyfin.library", {}, { apiKey: "otra-key-equivocada-123" });
    const r1 = (await c.get(`/api/widgets/${bad.id}/data`)).json;
    assert.equal(r1.ok, false);
    assert.match(r1.error, /rechazó la API key/);

    const weird = await add("jellyfin.library", {}, { apiKey: "has spaces and \"quotes\"" });
    assert.match((await c.get(`/api/widgets/${weird.id}/data`)).json.error, /formato válido/);

    const down = await add("jellyfin.library", {}, { url: "http://127.0.0.1:1" });
    assert.match((await c.get(`/api/widgets/${down.id}/data`)).json.error, /No se pudo conectar con 127\.0\.0\.1:1/);

    const sub = await add("jellyfin.library", {}, { url: mock.url + "/nope" });
    assert.match((await c.get(`/api/widgets/${sub.id}/data`)).json.error, /no encontró esa ruta|rechazó/);
  });

  it("una redirección hacia metadatos cloud se bloquea", async () => {
    const { c, add } = await setup();
    // Usamos la ruta /redirect del simulado como «URL base»: toda llamada redirige a 169.254.169.254.
    const w = await add("jellyfin.library", {}, { url: mock.url + "/redirect?x=" });
    const d = (await c.get(`/api/widgets/${w.id}/data`)).json;
    assert.equal(d.ok, false);
    assert.match(d.error, /permiso|bloqueada|Dirección/);
  });
});
