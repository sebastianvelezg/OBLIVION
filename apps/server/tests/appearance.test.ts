import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_APPEARANCE } from "@oblivion/sdk";
import { housekeeping } from "../src/db.js";
import { client, loggedInAdmin, makeApp } from "./helpers.js";

// Cabeceras mínimas válidas de cada formato (más relleno hasta 32 bytes).
const pad = (head: number[]) => new Uint8Array([...head, ...new Array(32).fill(1)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBP"), ...new Array(16).fill(0)]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>" + " ".repeat(40));

async function upload(c: ReturnType<typeof client>, bytes: Uint8Array) {
  return c.raw("POST", "/api/appearance/background", bytes, { "content-type": "application/octet-stream" });
}

describe("apariencia", () => {
  it("devuelve valores por defecto y guarda cambios válidos", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    assert.deepEqual((await c.get("/api/appearance")).json.appearance, DEFAULT_APPEARANCE);

    const next = { ...DEFAULT_APPEARANCE, mode: "light", accent: "#ff8800", card: { ...DEFAULT_APPEARANCE.card, style: "solid" } };
    const saved = await c.put("/api/appearance", next);
    assert.equal(saved.status, 200);
    assert.deepEqual((await c.get("/api/appearance")).json.appearance, next);
  });

  it("rechaza colores, rangos y valores inventados (inyección CSS)", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const bad = [
      { ...DEFAULT_APPEARANCE, accent: "red; background:url(//evil)" },
      { ...DEFAULT_APPEARANCE, accent: "#12345" },
      { ...DEFAULT_APPEARANCE, palette: "no-existe" },
      { ...DEFAULT_APPEARANCE, card: { ...DEFAULT_APPEARANCE.card, blur: 999 } },
      { ...DEFAULT_APPEARANCE, card: { ...DEFAULT_APPEARANCE.card, radius: -1 } },
      { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, imageId: "../../etc/passwd" } },
      { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, from: "javascript:1" } },
    ];
    for (const b of bad) assert.equal((await c.put("/api/appearance", b)).status, 400, JSON.stringify(b).slice(0, 80));
  });

  it("solo el administrador edita; los demás solo leen", async () => {
    const { app, db } = await makeApp();
    await loggedInAdmin(app);
    const { hashPassword } = await import("../src/crypto.js");
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)").run(
      "v1", "viewer", await hashPassword("una contraseña larga!", 2 ** 10), "viewer", Date.now(),
    );
    const v = client(app);
    await v.post("/api/auth/login", { username: "viewer", password: "una contraseña larga!" });
    assert.equal((await v.get("/api/appearance")).status, 200);
    assert.equal((await v.put("/api/appearance", DEFAULT_APPEARANCE)).status, 403);
    assert.equal((await upload(v, PNG)).status, 403);
  });

  it("anónimo no ve ni la apariencia ni las imágenes", async () => {
    const { app } = await makeApp();
    const admin = await loggedInAdmin(app);
    const { imageId } = (await upload(admin, PNG)).json;
    const anon = client(app);
    assert.equal((await anon.get("/api/appearance")).status, 401);
    assert.equal((await anon.get(`/api/appearance/background/${imageId}`)).status, 401);
  });
});

describe("foto de fondo", () => {
  it("acepta PNG/JPG/WebP y la sirve con su tipo y sin sniffing", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    for (const [bytes, mime] of [[PNG, "image/png"], [JPG, "image/jpeg"], [WEBP, "image/webp"]] as const) {
      const up = await upload(c, bytes);
      assert.equal(up.status, 201);
      const res = await app.request(`/api/appearance/background/${up.json.imageId}`, {
        headers: { cookie: c.cookie, host: "localhost" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), mime);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.match(res.headers.get("cache-control")!, /private/);
    }
  });

  it("rechaza SVG, HTML, vacío y texto aunque digan ser imagen", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    for (const bytes of [SVG, HTML, new Uint8Array(0), new TextEncoder().encode("GIF89a" + "x".repeat(40))]) {
      const r = await c.raw("POST", "/api/appearance/background", bytes, { "content-type": "image/png" });
      assert.ok([400, 415].includes(r.status), `status ${r.status}`);
    }
  });

  it("rechaza imágenes de más de 8 MB", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const big = new Uint8Array(9 * 1024 * 1024);
    big.set(PNG);
    const r = await upload(c, big);
    assert.equal(r.status, 413);
  });

  it("no permite salir de la carpeta de subidas", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    for (const id of ["..%2f..%2fpackage.json", "x.png", "%2e%2e%2fsecret.png", "a".repeat(32) + ".svg"]) {
      const r = await c.get(`/api/appearance/background/${id}`);
      assert.equal(r.status, 404, id);
    }
  });

  it("no deja usar «Foto» sin imagen ni una imagen inexistente", async () => {
    const { app } = await makeApp();
    const c = await loggedInAdmin(app);
    const noImage = { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, type: "image" } };
    assert.equal((await c.put("/api/appearance", noImage)).status, 400);
    const ghost = { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, imageId: "a".repeat(32) + ".png" } };
    assert.equal((await c.put("/api/appearance", ghost)).status, 400);
  });

  it("borra las imágenes que dejan de usarse, pero respeta las recién subidas", async () => {
    const { app, config } = await makeApp();
    const c = await loggedInAdmin(app);
    const a = (await upload(c, PNG)).json.imageId;
    const b = (await upload(c, JPG)).json.imageId;
    const use = (id: string) =>
      c.put("/api/appearance", { ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, type: "image", imageId: id } });

    // Guardar con `a` no debe llevarse por delante a `b`, que acaba de subirse.
    await use(a);
    assert.deepEqual(fs.readdirSync(config.uploadsDir).sort(), [a, b].sort());

    // Cuando `b` ya es antigua y nadie la usa, sí se limpia.
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(`${config.uploadsDir}/${b}`, old, old);
    await use(a);
    assert.deepEqual(fs.readdirSync(config.uploadsDir), [a]);
  });
});

describe("mantenimiento y hosts", () => {
  it("limpia sesiones caducadas y recorta la auditoría", async () => {
    const { db } = await makeApp();
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u','u','x','admin',0)").run();
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const ins = db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, last_seen) VALUES (?,?,?,?)");
    ins.run("fresh", "u", now, now);
    ins.run("idle", "u", now - 10 * day, now - 8 * day);
    ins.run("old", "u", now - 40 * day, now);
    db.prepare("INSERT INTO audit_log (ts, event) VALUES (?, 'old')").run(now - 200 * day);
    db.prepare("INSERT INTO audit_log (ts, event) VALUES (?, 'new')").run(now);
    housekeeping(db, now);
    assert.deepEqual((db.prepare("SELECT id_hash FROM sessions").all() as { id_hash: string }[]).map((r) => r.id_hash), ["fresh"]);
    assert.deepEqual((db.prepare("SELECT event FROM audit_log").all() as { event: string }[]).map((r) => r.event), ["new"]);
  });

  it("con OBLIVION_ALLOWED_HOSTS rechaza Hosts no listados", async () => {
    const { app } = await makeApp({ allowedHosts: ["dash.example.com"] });
    const ok = await app.request("/api/health", { headers: { host: "dash.example.com" } });
    assert.equal(ok.status, 200);
    const bad = await app.request("/api/health", { headers: { host: "evil.example" } });
    assert.equal(bad.status, 421);
  });
});
