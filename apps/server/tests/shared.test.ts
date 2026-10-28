import assert from "node:assert/strict";
import { describe, it } from "node:test";

// El módulo compartido de los plugins es JavaScript sin tipos.
const fmt: any = await import(new URL("../../../plugins/_shared/fmt.mjs", import.meta.url).href);

describe("utilidades compartidas de los plugins", () => {
  it("remember: acota el tamaño del mapa quitando primero lo caducado y luego lo más antiguo", () => {
    const map = new Map<string, { expires: number }>();
    const now = Date.now();
    fmt.remember(map, "viejo-caducado", { expires: now - 1000 }, 3);
    fmt.remember(map, "a", { expires: now + 60_000 }, 3);
    fmt.remember(map, "b", { expires: now + 60_000 }, 3);
    assert.equal(map.size, 3);

    fmt.remember(map, "c", { expires: now + 60_000 }, 3);
    assert.deepEqual([...map.keys()], ["a", "b", "c"], "se retiró la caducada");

    fmt.remember(map, "d", { expires: now + 60_000 }, 3);
    assert.deepEqual([...map.keys()], ["b", "c", "d"], "se retiró la más antigua");

    fmt.remember(map, "b", { expires: now + 99_000 }, 3); // reinsertar la deja como la más reciente
    assert.deepEqual([...map.keys()], ["c", "d", "b"]);
    for (let i = 0; i < 200; i++) fmt.remember(map, `k${i}`, { expires: now + 60_000 }, 50);
    assert.ok(map.size <= 50);
  });

  it("formatos: tamaños, velocidades y duraciones", () => {
    assert.equal(fmt.bytes(1536), "1.5 KB");
    assert.equal(fmt.bytes(-1), "—");
    assert.equal(fmt.rate(5 * 1024 * 1024), "5.0 MB/s");
    assert.equal(fmt.rate(0), "0 B/s");
    assert.equal(fmt.duration(93784), "1 d 2 h");
    assert.equal(fmt.duration(5400), "1 h 30 min");
    assert.equal(fmt.duration(40), "40 s");
    assert.deepEqual(fmt.basicAuth("", "x"), {});
    assert.equal(fmt.basicAuth("u", "p").Authorization, "Basic " + Buffer.from("u:p").toString("base64"));
  });
});
