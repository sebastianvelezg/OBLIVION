import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { migrate } from "../src/db.js";
import { loggedInAdmin, makeApp, client } from "./helpers.js";

type Admin = Awaited<ReturnType<typeof loggedInAdmin>>;

const docs = async (c: Admin) => {
  const res = (await c.get("/api/config")).json as { documents: { id: string; text: string }[]; variables: string[] };
  return Object.fromEntries(res.documents.map((d) => [d.id, d.text])) as Record<"pages" | "connections" | "appearance", string>;
};
const apply = (c: Admin, documents: Record<string, string>) => c.put("/api/config", { documents });
const plan = (c: Admin, documents: Record<string, string>) => c.post("/api/config/plan", { documents });

afterEach(() => {
  delete process.env.OBLIVION_VAR_ECHO_TOKEN;
});

describe("ids legibles (migración 7)", () => {
  it("cambia los UUID por ids cortos sin romper las relaciones", () => {
    const sqlite = process.getBuiltinModule("node:sqlite")!;
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, 6);
    db.exec(`
      INSERT INTO pages (id, title, position, created_at) VALUES ('11111111-aaaa', 'Inicio', 0, 1), ('22222222-bbbb', 'Medios y más', 1, 2);
      INSERT INTO connections (id, plugin_id, name, config, created_at) VALUES ('33333333-cccc', 'jellyfin', 'Jellyfin (casa)', '{}', 1);
      INSERT INTO widgets (id, page_id, type, title, config, x, y, w, h) VALUES
        ('44444444-dddd', '11111111-aaaa', 'core.clock', '', '{}', 0, 0, 2, 2),
        ('55555555-eeee', '11111111-aaaa', 'core.clock', '', '{}', 2, 0, 2, 2);
      UPDATE widgets SET connection_id = '33333333-cccc' WHERE id = '44444444-dddd';
    `);
    migrate(db);

    assert.deepEqual((db.prepare("SELECT id FROM pages ORDER BY position").all() as { id: string }[]).map((r) => r.id), ["inicio", "medios-y-mas"]);
    assert.deepEqual((db.prepare("SELECT id FROM connections").all() as { id: string }[]).map((r) => r.id), ["jellyfin-casa"]);
    const widgets = db.prepare("SELECT id, page_id, connection_id FROM widgets ORDER BY x").all() as Record<string, string | null>[];
    assert.deepEqual(widgets.map((w) => w.id), ["clock", "clock-2"]);
    assert.equal(widgets[0]!.page_id, "inicio");
    assert.equal(widgets[0]!.connection_id, "jellyfin-casa");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });

  it("lo que se crea desde la interfaz también recibe ids legibles", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = (await c.get("/api/pages")).json.pages[0];
    assert.equal(page.id, "inicio");
    const a = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} });
    const b = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} });
    assert.deepEqual([a.json.widget.id, b.json.widget.id], ["clock", "clock-2"]);
    const copy = await c.post(`/api/widgets/clock/duplicate`, {});
    assert.equal(copy.json.widget.id, "clock-3");
  });
});

describe("configuración en texto: exportar", () => {
  it("solo la ve el administrador", async () => {
    const { app } = await makeApp();
    assert.equal((await client(app).get("/api/config")).status, 401);
  });

  it("genera tres documentos YAML con la disposición y sin secretos", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = (await c.get("/api/pages")).json.pages[0];
    await c.post(`/api/pages/${page.id}/widgets`, { type: "demo.echo", title: "Eco", config: { name: "Ana", token: "super-secreto-1234" } });

    const res = await c.get("/api/config");
    assert.deepEqual(res.json.documents.map((d: any) => d.filename), ["paginas.yml", "conexiones.yml", "apariencia.yml"]);
    const d = await docs(c);
    assert.match(d.pages, /type: demo\.echo/);
    assert.match(d.pages, /layout: \{ x: 0, y: 0, w: 2, h: 2 \}/);
    assert.match(d.pages, /token: ••••••••/);
    assert.equal(JSON.stringify(res.json).includes("super-secreto"), false);
    assert.match(d.appearance, /palette: sand/);
  });

  it("aplicar lo que se exportó no cambia nada", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = (await c.get("/api/pages")).json.pages[0];
    await c.post(`/api/pages/${page.id}/widgets`, { type: "demo.echo", config: { name: "Ana", token: "t0ken-secreto" } });
    await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} });

    const before = await docs(c);
    const p = await plan(c, before);
    assert.equal(p.json.ok, true, JSON.stringify(p.json));
    assert.deepEqual(p.json.changes, []);
    assert.equal((await apply(c, before)).status, 200);
    // El secreto sigue siendo el mismo.
    const w = (await c.get("/api/pages")).json.pages[0].widgets.find((x: any) => x.type === "demo.echo");
    assert.equal((await c.get(`/api/widgets/${w.id}/data`)).json.view.text, "hola Ana t0ken-secreto");
  });
});

describe("configuración en texto: aplicar", () => {
  it("añade, cambia y quita widgets, y recoloca los que no llevan posición", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = (await c.get("/api/pages")).json.pages[0];
    await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {} });

    const text = `pages:
  - id: inicio
    title: Casa
    widgets:
      - id: reloj
        type: core.clock
        title: Hora
        layout: { x: 6, y: 0, w: 3, h: 2 }
      - type: demo.echo
        config: { name: Luis }
      - type: demo.echo
        config: { name: Eva }
`;
    const p = await plan(c, { pages: text });
    assert.equal(p.json.ok, true, JSON.stringify(p.json));
    assert.equal(p.json.changes.filter((x: any) => x.action === "add").length, 3);
    assert.deepEqual(p.json.changes.filter((x: any) => x.action === "remove").map((x: any) => x.id), ["clock"]);

    // Revisar no escribe nada.
    assert.equal((await c.get("/api/pages")).json.pages[0].widgets[0].id, "clock");

    const res = await apply(c, { pages: text });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const pages = (await c.get("/api/pages")).json.pages;
    assert.equal(pages[0].title, "Casa");
    const ws = pages[0].widgets as any[];
    assert.deepEqual(ws.map((w) => w.id).sort(), ["demo-echo", "demo-echo-2", "reloj"]);
    const reloj = ws.find((w) => w.id === "reloj");
    assert.deepEqual([reloj.title, reloj.x, reloj.y, reloj.w, reloj.h], ["Hora", 6, 0, 3, 2]);
    const spots = ws.map((w) => `${w.x},${w.y}`);
    assert.equal(new Set(spots).size, 3, "ninguno se superpone con otro");
  });

  it("crea páginas nuevas y mueve widgets entre páginas conservando su estado", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = (await c.get("/api/pages")).json.pages[0];
    const note = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.notes", config: {} })).json.widget;
    await c.put(`/api/widgets/${note.id}/state`, { text: "no me borres" });

    const res = await apply(c, {
      pages: `pages:
  - id: inicio
    title: Inicio
  - id: medios
    title: Medios
    widgets:
      - id: ${note.id}
        type: core.notes
`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const pages = (await c.get("/api/pages")).json.pages;
    assert.deepEqual(pages.map((p: any) => p.id), ["inicio", "medios"]);
    assert.equal(pages[1].widgets[0].state.text, "no me borres");
    // Si el estado cambia por otro lado, el documento regenerado lo incluye.
    await c.put(`/api/widgets/${note.id}/state`, { text: "otra cosa" });
    assert.match((await docs(c)).pages, /text: otra cosa/);
  });

  it("el estado escrito en el documento se guarda", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const res = await apply(c, {
      pages: `pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: apuntes
        type: core.notes
        state: { text: "hola desde YAML" }
`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((await c.get("/api/pages")).json.pages[0].widgets[0].state.text, "hola desde YAML");
  });

  it("es todo o nada: con un error no se guarda ni lo que estaba bien", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const before = JSON.stringify((await c.get("/api/pages")).json);
    const res = await apply(c, {
      pages: `pages:
  - id: inicio
    title: Cambiada
    widgets:
      - type: core.clock
      - type: no.existe
`,
      appearance: "mode: light\n",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.problems[0].message, "Tipo de widget desconocido: «no.existe»");
    assert.equal(res.json.problems[0].line, 6);
    assert.equal(JSON.stringify((await c.get("/api/pages")).json), before);
    assert.equal((await c.get("/api/appearance")).json.appearance.mode, "dark");
  });

  it("explica los errores con su línea", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const bad = async (pages: string) => (await plan(c, { pages })).json;

    let r = await bad("pages:\n  - title: A\n   widgets: []\n");
    assert.equal(r.ok, false);
    assert.equal(typeof r.problems[0].line, "number");

    r = await bad("pages: []\n");
    assert.match(r.problems[0].message, /al menos una página/);

    r = await bad("pages:\n  - id: Inicio\n    title: A\n");
    assert.match(r.problems[0].message, /Id no válido/);

    r = await bad("pages:\n  - title: A\n    colores: 3\n");
    assert.equal(r.problems[0].message, "Clave desconocida «colores»");

    r = await bad("pages:\n  - title: A\n    widgets:\n      - { id: x, type: core.clock }\n      - { id: x, type: core.clock }\n");
    assert.match(r.problems[0].message, /repetido/);

    r = await bad("pages:\n  - title: A\n    widgets:\n      - { type: core.clock, layout: { x: 11, y: 0, w: 4 } }\n");
    assert.match(r.problems[0].message, /columnas/);

    r = await bad("pages:\n  - title: A\n    widgets:\n      - { type: demo.echo }\n");
    assert.match(r.problems[0].message, /obligatorio/);

    r = await bad("pages:\n  - title: A\n    widgets:\n      - { type: core.clock, connection: nada }\n");
    assert.equal(r.problems[0].message, "Este widget no usa conexiones");
  });

  it("avisa de claves desconocidas y de widgets superpuestos sin impedir aplicar", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const r = await plan(c, {
      pages: `pages:
  - title: A
    widgets:
      - { id: a, type: core.clock, layout: { x: 0, y: 0, w: 4, h: 3 } }
      - { id: b, type: demo.echo, layout: { x: 2, y: 1 }, config: { name: x, nombre: y } }
`,
    });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.warnings.length, 2);
  });

  it("alias de YAML y cuerpos que no son un mapa se rechazan", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    let r = (await plan(c, { appearance: "a: &x 1\nb: *x\n" })).json;
    assert.match(r.problems[0].message, /alias/);
    r = (await plan(c, { appearance: "- uno\n- dos\n" })).json;
    assert.match(r.problems[0].message, /mapa/);
  });
});

describe("configuración en texto: secretos", () => {
  const page = (token: string) => `pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: eco
        type: demo.echo
        config:
          name: Ana
          token: ${token}
`;

  it("un secreto escrito se cifra, y el documento guardado ya no lo enseña", async () => {
    const { app, db } = await makeApp();
    const c = await loggedInAdmin(app);
    assert.equal((await apply(c, { pages: page("clave-en-claro-777") })).status, 200);

    assert.equal((await c.get("/api/widgets/eco/data")).json.view.text, "hola Ana clave-en-claro-777");
    assert.equal((db.prepare("SELECT config FROM widgets WHERE id='eco'").get() as { config: string }).config.includes("clave-en-claro"), false);
    const all = JSON.stringify((await c.get("/api/config")).json) + JSON.stringify(db.prepare("SELECT value FROM settings").all());
    assert.equal(all.includes("clave-en-claro-777"), false);
    assert.match((await docs(c)).pages, /token: "?••••••••"?/);
  });

  it("dejar la máscara conserva el valor; null lo borra", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    await apply(c, { pages: page("uno-dos-tres") });
    await apply(c, { pages: page("••••••••") });
    assert.equal((await c.get("/api/widgets/eco/data")).json.view.text, "hola Ana uno-dos-tres");
    await apply(c, { pages: page("null") });
    assert.equal((await c.get("/api/widgets/eco/data")).json.view.text, "hola Ana");
  });

  it("{{OBLIVION_VAR_*}} toma el valor del entorno del servidor", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const text = page('"{{OBLIVION_VAR_ECHO_TOKEN}}"');

    let r = (await plan(c, { pages: text })).json;
    assert.match(r.problems[0].message, /OBLIVION_VAR_ECHO_TOKEN no está definida/);

    process.env.OBLIVION_VAR_ECHO_TOKEN = "del-entorno";
    assert.equal((await apply(c, { pages: text })).status, 200);
    assert.equal((await c.get("/api/widgets/eco/data")).json.view.text, "hola Ana del-entorno");
    // El documento conserva la referencia, no el valor.
    assert.match((await docs(c)).pages, /OBLIVION_VAR_ECHO_TOKEN/);
    assert.deepEqual((await c.get("/api/config")).json.variables, ["OBLIVION_VAR_ECHO_TOKEN"]);
    // Solo las variables con ese prefijo: no se puede leer PATH ni la clave maestra.
    r = (await plan(c, { pages: page('"{{PATH}}"') })).json;
    assert.equal(r.ok, true);
    assert.equal((await apply(c, { pages: page('"{{PATH}}"') })).status, 200);
    assert.equal((await c.get("/api/widgets/eco/data")).json.view.text, "hola Ana {{PATH}}");
  });
});

describe("configuración en texto: conexiones", () => {
  it("crea una conexión y un widget que la usa desde el texto", async () => {
    const { app } = await makeApp({}, { realPlugins: true });
    const c = await loggedInAdmin(app);

    const res = await apply(c, {
      connections: `connections:
  jellyfin:
    plugin: jellyfin
    name: Jellyfin
    config:
      url: http://192.168.0.5:8096
      apiKey: abc123
`,
      pages: `pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: novedades
        type: jellyfin.latest
        connection: jellyfin
`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const conn = (await c.get("/api/connections")).json.connections[0];
    assert.deepEqual([conn.id, conn.name, conn.config.url, conn.secretsSet, conn.widgets], ["jellyfin", "Jellyfin", "http://192.168.0.5:8096/", ["apiKey"], 1]);
    assert.match((await docs(c)).connections, /apiKey: "?••••••••"?/);
  });

  it("no deja quitar ni cambiar de plugin una conexión que usa un widget", async () => {
    const { app } = await makeApp({}, { realPlugins: true });
    const c = await loggedInAdmin(app);
    await apply(c, {
      connections: "connections:\n  jf:\n    plugin: jellyfin\n    name: JF\n    config: { url: 'http://192.168.0.5:8096', apiKey: k }\n",
      pages: "pages:\n  - id: inicio\n    title: Inicio\n    widgets:\n      - { id: nov, type: jellyfin.latest, connection: jf }\n",
    });

    let r = (await plan(c, { connections: "connections: {}\n" })).json;
    assert.equal(r.ok, false);
    assert.match(r.problems[0].message, /la usa el widget «nov»/);

    r = (await plan(c, { pages: "pages:\n  - { id: inicio, title: Inicio, widgets: [{ id: nov, type: jellyfin.latest, connection: otra }] }\n" })).json;
    assert.equal(r.problems[0].message, "No existe la conexión «otra»");

    r = (await plan(c, { connections: "connections:\n  jf:\n    plugin: speedtest\n    name: X\n" })).json;
    assert.match(r.problems[0].message, /ya existe para «jellyfin»/);

    // Quitar el widget y la conexión a la vez sí funciona.
    const ok = await apply(c, { connections: "connections: {}\n", pages: "pages:\n  - { id: inicio, title: Inicio }\n" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual((await c.get("/api/connections")).json.connections, []);
  });
});

describe("configuración en texto: apariencia", () => {
  it("lo que se omite vuelve al valor de fábrica y lo escrito se valida", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const res = await apply(c, { appearance: "mode: light\naccent: '#336699'\ncard:\n  radius: 4\nlayout: { free: true }\n" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const a = (await c.get("/api/appearance")).json.appearance;
    assert.deepEqual([a.mode, a.accent, a.card.radius, a.card.style, a.layout.free, a.palette], ["light", "#336699", 4, "solid", true, "sand"]);

    let r = (await plan(c, { appearance: "mode: rojo\n" })).json;
    assert.equal(r.problems[0].path, "mode");
    r = (await plan(c, { appearance: "card: { radio: 3 }\n" })).json;
    assert.equal(r.problems[0].message, "Clave desconocida «radio»");
    r = (await plan(c, { appearance: "background: { type: image }\n" })).json;
    assert.match(r.problems[0].message, /imageId/);
  });
});

describe("configuración en texto: comentarios", () => {
  it("el texto aplicado se conserva con sus comentarios hasta que otra cosa cambie los datos", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const text = `# mi tablero
pages:
  - id: inicio
    title: Inicio   # la de siempre
    widgets:
      - { id: reloj, type: core.clock }
`;
    assert.equal((await apply(c, { pages: text })).status, 200);
    assert.equal((await docs(c)).pages, text);

    // Un cambio hecho con el ratón (layout) vuelve a generar el documento.
    await c.put("/api/pages/inicio/layout", { items: [{ id: "reloj", x: 5, y: 0, w: 2, h: 2 }] });
    const regenerated = (await docs(c)).pages;
    assert.notEqual(regenerated, text);
    assert.match(regenerated, /layout: \{ x: 5, y: 0, w: 2, h: 2 \}/);
  });
});

describe("configuración en texto: los ejemplos de la guía", () => {
  it("son válidos tal como están escritos en docs/configuration.md", async () => {
    process.env.OBLIVION_VAR_JELLYFIN_KEY = "clave";
    try {
      const { app } = await makeApp({}, { realPlugins: true });
      const c = await loggedInAdmin(app);
      const res = await apply(c, {
        connections: `connections:
  jellyfin:
    plugin: jellyfin
    name: Jellyfin del salón
    config:
      url: http://192.168.0.117:8096
      apiKey: "{{OBLIVION_VAR_JELLYFIN_KEY}}"
`,
        pages: `pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: hora
        type: core.clock
        layout: { x: 0, y: 0, w: 4, h: 3 }
      - id: novedades
        type: jellyfin.latest
        connection: jellyfin
        config: { limit: 8 }
        style: { accent: "#e0793f", bare: false }
      - type: core.notes
        state: { text: "Comprar café" }
  - title: Medios
    background: { type: gradient, from: "#1a1a2e", to: "#16213e", angle: 160 }
`,
        appearance: `mode: dark
palette: sand
accent: "#e0793f"
layout: { free: true }
card: { style: solid, radius: 14 }
`,
      });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const pages = (await c.get("/api/pages")).json.pages;
      assert.deepEqual(pages.map((p: any) => p.id), ["inicio", "medios"]);
      assert.equal(pages[0].widgets.length, 3);
      assert.equal(pages[1].background.type, "gradient");
    } finally {
      delete process.env.OBLIVION_VAR_JELLYFIN_KEY;
    }
  });
});

describe("configuración en texto: nada sensible se guarda en claro", () => {
  const widget = (config: string) => `pages:
  - id: inicio
    title: Inicio
    widgets:
      - id: eco
        type: demo.echo
        config: ${config}
`;
  const stored = (db: any) =>
    JSON.stringify(db.prepare("SELECT key, value FROM settings").all()) + JSON.stringify(db.prepare("SELECT config FROM widgets").all());

  it("tapa el secreto escrito entre comillas, en línea, a mitad de una referencia o en una clave ignorada", async () => {
    const { app, db } = await makeApp();
    const c = await loggedInAdmin(app);
    process.env.OBLIVION_VAR_ECHO_TOKEN = "del-entorno";
    for (const config of [
      `{ name: Ana, token: "uno-secreto-1" }`,
      `
          name: Ana
          token: 'dos-secreto-2'  # comentario`,
      `{ name: Ana, token: "dos-{{OBLIVION_VAR_ECHO_TOKEN}}-secreto-3" }`,
      `{ name: Ana, password: cuatro-secreto-4 }`,
    ]) {
      const res = await apply(c, { pages: widget(config) });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const everything = stored(db) + JSON.stringify((await c.get("/api/config")).json);
      assert.doesNotMatch(everything, /(uno|dos|cuatro)-secreto/);
    }
  });

  it("una referencia pura a una variable sí se conserva en el texto", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    process.env.OBLIVION_VAR_ECHO_TOKEN = "del-entorno";
    await apply(c, { pages: widget(`{ name: Ana, token: "{{OBLIVION_VAR_ECHO_TOKEN}}" }`) });
    assert.match((await docs(c)).pages, /\{\{OBLIVION_VAR_ECHO_TOKEN\}\}/);
  });

  it("las variables de entorno solo se leen en campos secretos", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    process.env.OBLIVION_VAR_ECHO_TOKEN = "no-deberia-verse";
    const res = await apply(c, { pages: widget(`{ name: "{{OBLIVION_VAR_ECHO_TOKEN}}" }`) });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const w = (await c.get("/api/pages")).json.pages[0].widgets[0];
    assert.equal(w.config.name, "{{OBLIVION_VAR_ECHO_TOKEN}}");
    assert.equal(JSON.stringify((await c.get("/api/pages")).json).includes("no-deberia-verse"), false);
  });

  it("un documento anidado hasta el absurdo es un error, no un fallo del servidor", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const res = await plan(c, { appearance: "a: " + "[".repeat(40_000) + "]".repeat(40_000) });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, false);
  });
});
