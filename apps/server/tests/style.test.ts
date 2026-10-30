import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_APPEARANCE } from "@oblivion/sdk";
import { collectBackgroundGarbage } from "../src/routes/appearance.js";
import { client, loggedInAdmin, makeApp, PASSWORD } from "./helpers.js";

async function setup() {
  const ctx = await makeApp({}, { realPlugins: true });
  const c = await loggedInAdmin(ctx.app);
  const page = (await c.get("/api/pages")).json.pages[0];
  const add = async (body: Record<string, unknown>) => c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {}, ...body });
  return { ...ctx, c, page, add };
}

// PNG mínimo válido (1×1) para subir como fondo.
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
);

describe("estilo por widget", () => {
  it("se guarda, se normaliza y vuelve en la lista de páginas", async () => {
    const { c, add } = await setup();
    const made = await add({ style: { titleMode: "show", accent: "#FF0000", opacity: 40, link: "http://192.168.1.10:8080" } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const w = made.json.widget;
    assert.deepEqual(w.style, { titleMode: "show", accent: "#ff0000", opacity: 40, link: "http://192.168.1.10:8080/" });
    assert.equal(w.link, "http://192.168.1.10:8080/");

    const listed = (await c.get("/api/pages")).json.pages[0].widgets[0];
    assert.deepEqual(listed.style, w.style);

    // `auto`, los nulos y los vacíos no se guardan.
    const cleared = await c.patch(`/api/widgets/${w.id}`, { style: { titleMode: "auto", accent: null, opacity: null, link: "" } });
    assert.deepEqual(cleared.json.widget.style, {});
    assert.equal(cleared.json.widget.link, null);
  });

  it("guarda los ajustes del contenido interior y descarta los valores por defecto", async () => {
    const { c, add } = await setup();
    const made = await add({ style: { scale: 125, itemSize: "l", columns: 3, pad: "roomy", overflow: "scroll" } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual(made.json.widget.style, { scale: 125, itemSize: "l", columns: 3, pad: "roomy", overflow: "scroll" });
    // `normal` y `fit` son lo de fábrica: no se guardan.
    const patched = await c.patch(`/api/widgets/${made.json.widget.id}`, { style: { pad: "normal", overflow: "fit", scale: null, itemSize: null, columns: null } });
    assert.deepEqual(patched.json.widget.style, {});
  });

  it("explica qué ajuste del contenido es inválido", async () => {
    const { c, add } = await setup();
    const made = await add({});
    for (const [style, text] of [
      [{ scale: 49 }, /«scale»/],
      [{ scale: 201 }, /«scale»/],
      [{ scale: 99.5 }, /«scale»/],
      [{ itemSize: "xxl" }, /«itemSize».*xs, s, m, l o xl/],
      [{ columns: 0 }, /«columns»/],
      [{ columns: 9 }, /«columns»/],
      [{ pad: "huge" }, /«pad»/],
      [{ overflow: "hidden" }, /«overflow»/],
      [{ zoom: 2 }, /«zoom» no es un ajuste conocido/],
    ] as const) {
      const r = await c.patch(`/api/widgets/${made.json.widget.id}`, { style });
      assert.equal(r.status, 400, JSON.stringify(style));
      assert.match(r.json.error, text, JSON.stringify(style));
    }
  });

  it("rechaza colores, opacidades, enlaces y claves inválidos", async () => {
    const { c, add } = await setup();
    for (const style of [
      { accent: "red" },
      { accent: "#12345" },
      { opacity: 5 },
      { opacity: 101 },
      { opacity: 50.5 },
      { link: "javascript:alert(1)" },
      { link: "http://user:pass@host/" },
      { titleMode: "siempre" },
      { cssInyectado: "x" },
    ]) {
      assert.equal((await add({ style })).status, 400, JSON.stringify(style));
    }
    const w = (await add({})).json.widget;
    assert.equal((await c.patch(`/api/widgets/${w.id}`, { style: { accent: "azul" } })).status, 400);
  });

  it("el enlace por defecto es la URL de la conexión y el propio enlace la sustituye", async () => {
    const { c, page } = await setup();
    const conn = await c.post("/api/connections", {
      pluginId: "jellyfin",
      name: "J",
      config: { url: "http://192.168.1.10:8096", apiKey: "test-api-key-1234567890" },
    });
    const w = await c.post(`/api/pages/${page.id}/widgets`, {
      type: "jellyfin.library",
      config: {},
      connectionId: conn.json.connection.id,
    });
    assert.equal(w.json.widget.link, "http://192.168.1.10:8096/");

    const own = await c.patch(`/api/widgets/${w.json.widget.id}`, { style: { link: "https://jellyfin.casa.com" } });
    assert.equal(own.json.widget.link, "https://jellyfin.casa.com/");
  });

  it("el enlace por defecto no filtra la query ni el fragmento de la URL de la conexión (también lo ven los viewers)", async () => {
    const { app, c, page } = await setup();
    const conn = await c.post("/api/connections", {
      pluginId: "jellyfin",
      name: "J",
      config: { url: "http://192.168.1.10:8096/jellyfin?apikey=SECRETO123#token=otro", apiKey: "test-api-key-1234567890" },
    });
    const w = await c.post(`/api/pages/${page.id}/widgets`, { type: "jellyfin.library", config: {}, connectionId: conn.json.connection.id });
    assert.equal(w.json.widget.link, "http://192.168.1.10:8096/jellyfin");

    await c.post("/api/users", { username: "ana", password: PASSWORD, role: "viewer", mustChangePassword: false });
    const viewer = client(app);
    await viewer.post("/api/auth/login", { username: "ana", password: PASSWORD });
    const raw = JSON.stringify((await viewer.get("/api/pages")).json);
    assert.equal(raw.includes("SECRETO123"), false);
    assert.equal(raw.includes("apikey"), false);
    assert.ok(raw.includes("http://192.168.1.10:8096/jellyfin"));
  });

  it("solo el administrador cambia estilos", async () => {
    const { app, c, add } = await setup();
    const w = (await add({})).json.widget;
    await c.post("/api/users", { username: "ana", password: PASSWORD, role: "viewer", mustChangePassword: false });
    const viewer = client(app);
    await viewer.post("/api/auth/login", { username: "ana", password: PASSWORD });
    assert.equal((await viewer.patch(`/api/widgets/${w.id}`, { style: { accent: "#ff0000" } })).status, 403);
  });
});

describe("fondo por página", () => {
  const gradient = { type: "gradient", from: "#112233", to: "#445566", angle: 120, imageId: null, blur: 0, dim: 35 };

  it("se puede poner, ver y quitar", async () => {
    const { c, page } = await setup();
    assert.equal(page.background, null);
    assert.equal((await c.patch(`/api/pages/${page.id}`, { background: gradient })).status, 200);
    assert.deepEqual((await c.get("/api/pages")).json.pages[0].background, gradient);

    // Cambiar solo el título no toca el fondo.
    await c.patch(`/api/pages/${page.id}`, { title: "Casa" });
    assert.deepEqual((await c.get("/api/pages")).json.pages[0].background, gradient);

    assert.equal((await c.patch(`/api/pages/${page.id}`, { background: null })).status, 200);
    assert.equal((await c.get("/api/pages")).json.pages[0].background, null);
  });

  it("una página nueva puede nacer con fondo propio", async () => {
    const { c } = await setup();
    const r = await c.post("/api/pages", { title: "Trabajo", background: gradient });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.page.background, gradient);
  });

  it("valida colores, imagen existente y fondo «foto» sin foto", async () => {
    const { c, page } = await setup();
    const patch = (background: unknown) => c.patch(`/api/pages/${page.id}`, { background });
    assert.equal((await patch({ ...gradient, from: "rojo" })).status, 400);
    assert.equal((await patch({ ...gradient, angle: 999 })).status, 400);
    assert.equal((await patch({ ...gradient, type: "video" })).status, 400);
    assert.equal((await patch({ ...gradient, type: "image" })).status, 400, "foto sin imagen");
    assert.equal((await patch({ ...gradient, type: "image", imageId: "a".repeat(32) + ".png" })).status, 400, "la imagen no existe");
    assert.equal((await patch({ ...gradient, imageId: "../../etc/passwd" })).status, 400);
  });

  it("la imagen de una página no se borra al limpiar la apariencia, y sí cuando nadie la usa", async () => {
    const { app, c, db, config, page } = await setup();
    const up = await app.request("/api/appearance/background", {
      method: "POST",
      headers: { cookie: c.cookie, host: "localhost", "x-requested-with": "oblivion", "content-type": "image/png" },
      body: PNG,
    });
    assert.equal(up.status, 201);
    const { imageId } = (await up.json()) as { imageId: string };
    const file = path.join(config.uploadsDir, imageId);

    await c.patch(`/api/pages/${page.id}`, { background: { ...gradient, type: "image", imageId } });
    // Una hora después (pasada la gracia): la apariencia no la usa, pero la página sí.
    collectBackgroundGarbage(db, config.uploadsDir, Date.now() + 3_600_000);
    assert.equal(fs.existsSync(file), true, "la usa una página");

    await c.patch(`/api/pages/${page.id}`, { background: null });
    collectBackgroundGarbage(db, config.uploadsDir, Date.now() + 3_600_000);
    assert.equal(fs.existsSync(file), false, "ya no la usa nadie");
  });

  it("los estilos nuevos de tarjeta (neón, brutalista) se guardan en la apariencia", async () => {
    const { c } = await setup();
    for (const style of ["neon", "brutal"]) {
      const body = { ...DEFAULT_APPEARANCE, card: { ...DEFAULT_APPEARANCE.card, style } };
      assert.equal((await c.put("/api/appearance", body)).status, 200, style);
      assert.equal((await c.get("/api/appearance")).json.appearance.card.style, style);
    }
    assert.equal((await c.put("/api/appearance", { ...DEFAULT_APPEARANCE, card: { ...DEFAULT_APPEARANCE.card, style: "otro" } })).status, 400);
  });
});
