import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCollisions } from "../src/lib/layout.js";
import { sizePresets, presetFor } from "../src/lib/sizes.js";
import { makeBox, tierOf, atLeast } from "../src/lib/box.js";

describe("modo libre: resolveCollisions", () => {
  it("baja solo los widgets pisados y deja el resto donde estaba", () => {
    const out = resolveCollisions(
      [
        { id: "a", x: 0, y: 0, w: 6, h: 4 }, // el que crece
        { id: "b", x: 4, y: 0, w: 3, h: 2 }, // pisado
        { id: "c", x: 9, y: 0, w: 3, h: 2 }, // intacto
        { id: "d", x: 0, y: 10, w: 4, h: 2 }, // intacto
      ],
      "a",
    );
    const at = (id: string) => out.find((i) => i.id === id)!;
    assert.equal(at("a").y, 0);
    assert.equal(at("b").y, 4);
    assert.deepEqual([at("c").x, at("c").y], [9, 0]);
    assert.deepEqual([at("d").x, at("d").y], [0, 10]);
  });

  it("encadena: lo que baja puede empujar a otro", () => {
    const out = resolveCollisions(
      [
        { id: "a", x: 0, y: 0, w: 12, h: 3 },
        { id: "b", x: 0, y: 0, w: 6, h: 3 },
        { id: "c", x: 0, y: 3, w: 6, h: 3 },
      ],
      "a",
    );
    const at = (id: string) => out.find((i) => i.id === id)!;
    assert.equal(at("b").y, 3);
    assert.equal(at("c").y, 6);
  });
});

describe("tamaños rápidos", () => {
  const base = { defaultSize: { w: 4, h: 6 }, minSize: { w: 2, h: 3 } };

  it("el medio es el tamaño por defecto y el resto se deduce sin pasar de la grilla", () => {
    const p = sizePresets(base);
    assert.deepEqual(p.map((x) => x.id), ["s", "m", "l", "xl"]);
    assert.deepEqual([p[1]!.w, p[1]!.h], [4, 6]);
    for (const x of p) assert.ok(x.w <= 12 && x.w >= 2 && x.h >= 3);
    assert.ok(p[0]!.w < p[1]!.w && p[3]!.w > p[2]!.w);
  });

  it("respeta lo que declara el widget y el tamaño mínimo", () => {
    const p = sizePresets({ ...base, sizes: { s: { w: 1, h: 1 }, xl: { w: 12, h: 12 } } });
    assert.deepEqual([p[0]!.w, p[0]!.h], [2, 3]); // sube hasta el mínimo
    assert.deepEqual([p[3]!.w, p[3]!.h], [12, 12]);
    assert.equal(presetFor(p, 12, 12)?.id, "xl");
    assert.equal(presetFor(p, 5, 5), undefined);
  });

  it("no repite tamaños iguales", () => {
    const p = sizePresets({ defaultSize: { w: 2, h: 2 }, minSize: { w: 2, h: 2 }, sizes: { s: { w: 2, h: 2 } } });
    const keys = p.map((x) => `${x.w}x${x.h}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("versiones según el alto del widget", () => {
  it("pasa de xs a xl al crecer", () => {
    assert.deepEqual([60, 120, 220, 350, 500].map(tierOf), ["xs", "sm", "md", "lg", "xl"]);
  });
  it("detecta estrecho y ancho", () => {
    assert.equal(makeBox(180, 200).narrow, true);
    assert.equal(makeBox(500, 200).wide, true);
    assert.equal(atLeast(makeBox(300, 300), "md"), true);
    assert.equal(atLeast(makeBox(300, 100), "md"), false);
  });
});
