import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { SecretBox, hashPassword, verifyPassword } from "../src/crypto.js";
import { createSafeHttp, isForbiddenAddress } from "../src/security/safe-http.js";
import { RateLimiter } from "../src/security/ratelimit.js";

describe("cripto", () => {
  it("hash de contraseña: verifica y rechaza", async () => {
    const h = await hashPassword("hunter2hunter2", 2 ** 10);
    assert.ok(h.startsWith("scrypt$"));
    assert.equal(await verifyPassword("hunter2hunter2", h), true);
    assert.equal(await verifyPassword("hunter3hunter3", h), false);
  });

  it("AES-GCM: ida y vuelta, y detecta manipulación", () => {
    const box = new SecretBox(randomBytes(32));
    const enc = box.encrypt("api-key");
    assert.notEqual(enc, box.encrypt("api-key"), "IV aleatorio");
    assert.equal(box.decrypt(enc), "api-key");
    const tampered = enc.slice(0, -2) + (enc.endsWith("AA") ? "BB" : "AA");
    assert.throws(() => box.decrypt(tampered));
    assert.throws(() => new SecretBox(randomBytes(32)).decrypt(enc));
  });
});

describe("red segura para plugins", () => {
  const okFetch = (async () => new Response('{"a":1}', { status: 200 })) as unknown as typeof fetch;
  const publicLookup = async () => ["93.184.216.34"];

  it("solo permite hosts declarados o configurados", async () => {
    const http = createSafeHttp({
      allowedHosts: ["api.example.com"],
      configuredUrls: ["http://192.168.1.10:8096/"],
      lookup: publicLookup,
      fetchImpl: okFetch,
    });
    assert.equal((await http("https://api.example.com/x")).json<{ a: number }>().a, 1);
    assert.equal((await http("http://192.168.1.10:8096/Sessions")).ok, true);
    await assert.rejects(http("https://evil.example.com/"), /permiso/);
    await assert.rejects(http("http://192.168.1.10:9999/"), /permiso/, "otro puerto = otro origen");
  });

  it("bloquea metadatos cloud aunque el usuario los configure", async () => {
    const http = createSafeHttp({
      allowedHosts: [],
      configuredUrls: ["http://169.254.169.254/latest/meta-data/"],
      fetchImpl: okFetch,
    });
    await assert.rejects(http("http://169.254.169.254/latest/meta-data/"), /bloqueada/);
  });

  it("bloquea si el DNS de un host permitido apunta a link-local", async () => {
    const http = createSafeHttp({
      allowedHosts: ["rebind.example.com"],
      configuredUrls: [],
      lookup: async () => ["169.254.169.254"],
      fetchImpl: okFetch,
    });
    await assert.rejects(http("https://rebind.example.com/"), /bloqueada/);
  });

  it("revalida las redirecciones", async () => {
    let calls = 0;
    const redirecting = (async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }) as unknown as typeof fetch;
    const http = createSafeHttp({
      allowedHosts: ["api.example.com"],
      configuredUrls: [],
      lookup: publicLookup,
      fetchImpl: redirecting,
    });
    await assert.rejects(http("https://api.example.com/"), /permiso|bloqueada/);
    assert.equal(calls, 1, "no debe seguir la redirección");
  });

  it("rechaza protocolos no http y credenciales en la URL", async () => {
    const http = createSafeHttp({ allowedHosts: ["a.com"], configuredUrls: [], lookup: publicLookup, fetchImpl: okFetch });
    await assert.rejects(http("file:///etc/passwd"), /Protocolo/);
    await assert.rejects(http("https://user:pw@a.com/"), /credenciales/);
  });

  it("limita el tamaño de la respuesta", async () => {
    const big = (async () => new Response("x".repeat(3 * 1024 * 1024))) as unknown as typeof fetch;
    const http = createSafeHttp({ allowedHosts: ["a.com"], configuredUrls: [], lookup: publicLookup, fetchImpl: big });
    await assert.rejects(http("https://a.com/"), /demasiado grande/);
  });

  it("clasifica direcciones prohibidas", () => {
    assert.equal(isForbiddenAddress("169.254.169.254"), true);
    assert.equal(isForbiddenAddress("0.0.0.0"), true);
    assert.equal(isForbiddenAddress("fe80::1"), true);
    assert.equal(isForbiddenAddress("::ffff:169.254.169.254"), true);
    assert.equal(isForbiddenAddress("192.168.1.10"), false, "la LAN es el caso de uso");
    assert.equal(isForbiddenAddress("127.0.0.1"), false);
  });
});

describe("rate limiter", () => {
  it("bloquea al superar el máximo y se libera con el tiempo", () => {
    const rl = new RateLimiter(2, 1000);
    assert.equal(rl.hit("k", 0).allowed, true);
    assert.equal(rl.hit("k", 1).allowed, true);
    assert.equal(rl.hit("k", 2).allowed, false);
    assert.equal(rl.isBlocked("k", 3).blocked, true);
    assert.equal(rl.hit("k", 1500).allowed, true);
  });
});
