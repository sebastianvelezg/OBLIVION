import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_APPEARANCE } from "@oblivion/sdk";
import { collectBackgroundGarbage } from "../src/routes/appearance.js";
import { loggedInAdmin, makeApp } from "./helpers.js";

const pad = (head: number[]) => new Uint8Array([...head, ...new Array(32).fill(1)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function firstPage(c: Awaited<ReturnType<typeof loggedInAdmin>>) {
  return (await c.get("/api/pages")).json.pages[0] as { id: string };
}

describe("tamaños de widget", () => {
  it("el catálogo publica los tamaños rápidos de los widgets básicos", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const clock = (await c.get("/api/catalog")).json.widgets.find((w: any) => w.fullType === "core.clock");
    assert.deepEqual(Object.keys(clock.sizes).sort(), ["l", "m", "s", "xl"]);
    assert.deepEqual(clock.sizes.m, clock.defaultSize);
  });

  it("crea el widget con el tamaño elegido, sin bajar de su mínimo ni salirse de la grilla", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);

    const big = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {}, size: { w: 6, h: 5 } });
    assert.equal(big.status, 201);
    assert.deepEqual([big.json.widget.w, big.json.widget.h], [6, 5]);

    // El reloj no baja de 2×2 aunque se pida 1×1.
    const tiny = await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {}, size: { w: 1, h: 1 } });
    assert.deepEqual([tiny.json.widget.w, tiny.json.widget.h], [2, 2]);

    assert.equal((await c.post(`/api/pages/${page.id}/widgets`, { type: "core.clock", config: {}, size: { w: 13, h: 2 } })).status, 400);
  });
});

describe("duplicar widgets", () => {
  it("copia configuración, secretos y estado en un hueco libre", async () => {
    const { app, db } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    const made = await c.post(`/api/pages/${page.id}/widgets`, {
      type: "demo.echo",
      title: "Original",
      config: { name: "Ana", token: "super-secreto-1234" },
    });
    const orig = made.json.widget;

    const copy = await c.post(`/api/widgets/${orig.id}/duplicate`, {});
    assert.equal(copy.status, 201);
    const w = copy.json.widget;
    assert.notEqual(w.id, orig.id);
    assert.equal(w.title, "Original");
    assert.equal(w.config.name, "Ana");
    assert.deepEqual(w.secretsSet, ["token"]);
    assert.equal(JSON.stringify(copy.json).includes("super-secreto"), false);
    assert.ok(w.x !== orig.x || w.y !== orig.y, "no se superpone con el original");

    // El secreto cifrado sigue siendo usable en la copia.
    const data = await c.get(`/api/widgets/${w.id}/data`);
    assert.equal(data.json.view.text, "hola Ana super-secreto-1234");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM widgets").get() as { n: number }).n, 2);
  });

  it("solo el administrador y solo si existe", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    assert.equal((await c.post("/api/widgets/no-existe/duplicate", {})).status, 404);
  });
});

describe("imagen de fondo de un widget", () => {
  async function upload(c: Awaited<ReturnType<typeof loggedInAdmin>>) {
    return (await c.raw("POST", "/api/appearance/background", PNG, { "content-type": "image/png" })).json.imageId as string;
  }

  it("guarda la imagen y sus ajustes, y la sirve a la web", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    const image = await upload(c);
    const w = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.image", config: {}, style: { image, imageDim: 30, imageBlur: 4, bare: true } })).json.widget;
    assert.deepEqual(w.style, { bare: true, image, imageDim: 30, imageBlur: 4 });
    assert.equal((await c.get(`/api/appearance/background/${image}`)).status, 200);
  });

  it("rechaza ids raros, imágenes que no existen y valores fuera de rango", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    const post = (style: unknown) => c.post(`/api/pages/${page.id}/widgets`, { type: "core.image", config: {}, style });
    assert.equal((await post({ image: "../../etc/passwd" })).status, 400);
    assert.equal((await post({ image: "a".repeat(32) + ".png" })).status, 400);
    const image = await upload(c);
    assert.equal((await post({ image, imageDim: 99 })).status, 400);
    assert.equal((await post({ image, imageBlur: -1 })).status, 400);
  });

  it("la limpieza respeta las imágenes que usa algún widget y borra las que no", async () => {
    const { app, db, config } = await makeApp();
    const c = await loggedInAdmin(app);
    const page = await firstPage(c);
    const used = await upload(c);
    const w = (await c.post(`/api/pages/${page.id}/widgets`, { type: "core.image", config: {}, style: { image: used } })).json.widget;

    const orphan = "b".repeat(32) + ".png";
    fs.writeFileSync(`${config.uploadsDir}/${orphan}`, PNG);
    collectBackgroundGarbage(db, config.uploadsDir, Date.now() + 3600_000);
    assert.deepEqual(fs.readdirSync(config.uploadsDir), [used]);

    // Al quitarle la imagen al widget, deja de estar protegida.
    await c.patch(`/api/widgets/${w.id}`, { style: {} });
    collectBackgroundGarbage(db, config.uploadsDir, Date.now() + 3600_000);
    assert.deepEqual(fs.readdirSync(config.uploadsDir), []);
  });
});

describe("apariencia: compatibilidad", () => {
  it("una apariencia guardada antes de la disposición libre se conserva (no vuelve a la de fábrica)", async () => {
    const { app, db } = await makeApp();
    const c = await loggedInAdmin(app);
    const { layout: _omit, ...legacy } = { ...DEFAULT_APPEARANCE, accent: "#112233", font: "mono" as const };
    db.prepare("INSERT INTO settings (key, value) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      JSON.stringify(legacy),
    );
    const got = (await c.get("/api/appearance")).json.appearance;
    assert.equal(got.accent, "#112233");
    assert.equal(got.font, "mono");
    assert.deepEqual(got.layout, { free: false });
  });

  it("acepta la tipografía humanista, la disposición libre y las paletas nuevas", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const next = { ...DEFAULT_APPEARANCE, font: "humanist", palette: "ink", layout: { free: true } };
    assert.equal((await c.put("/api/appearance", next)).status, 200);
    assert.deepEqual((await c.get("/api/appearance")).json.appearance.layout, { free: true });
  });
});
