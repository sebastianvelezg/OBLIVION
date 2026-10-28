import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeAgent, generatePassword, timeAgo } from "../src/lib/format";

describe("generatePassword", () => {
  it("tiene la longitud pedida, solo caracteres legibles y no se repite", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      assert.equal(p.length, 20);
      assert.match(p, /^[abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      assert.equal(/[0OIl1]/.test(p), false, "sin caracteres ambiguos");
      seen.add(p);
    }
    assert.equal(seen.size, 200);
    assert.equal(generatePassword(32).length, 32);
  });

  it("usa todo el alfabeto (sin sesgo evidente)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 500; i++) for (const ch of generatePassword(40)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    // 25 minúsculas (sin «l») + 24 mayúsculas (sin «I» ni «O») + 8 dígitos (2-9)
    assert.equal(counts.size, 57, "aparecen los 57 caracteres");
    const values = [...counts.values()];
    assert.ok(Math.max(...values) / Math.min(...values) < 1.5, "frecuencias parejas");
  });
});

describe("describeAgent y timeAgo", () => {
  it("reconoce navegador y sistema", () => {
    assert.equal(
      describeAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
      "Chrome en Windows",
    );
    assert.equal(describeAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130"), "Edge en Windows");
    assert.equal(describeAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604"), "Safari en iOS");
    assert.equal(describeAgent("curl/8.4.0"), "curl");
    assert.equal(describeAgent(null), "Dispositivo desconocido");
  });

  it("formatea tiempos relativos", () => {
    const now = 1_000_000_000_000;
    assert.equal(timeAgo(now - 10_000, now), "ahora mismo");
    assert.equal(timeAgo(now - 5 * 60_000, now), "hace 5 min");
    assert.equal(timeAgo(now - 3 * 3600_000, now), "hace 3 h");
    assert.equal(timeAgo(now - 2 * 86400_000, now), "hace 2 d");
    assert.equal(timeAgo(null, now), "nunca");
  });
});
