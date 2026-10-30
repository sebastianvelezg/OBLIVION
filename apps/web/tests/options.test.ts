import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoScale, effectiveScale, ITEM_WIDTH, optionsOf } from "../src/lib/options.js";

const def = { defaultSize: { w: 4, h: 4 }, component: undefined };

describe("escala del contenido", () => {
  it("en su tamaño normal no cambia nada", () => {
    assert.equal(autoScale(def, 4, 4), 1);
  });

  it("crece con la tarjeta, sin pasarse, y encoge un poco", () => {
    assert.ok(autoScale(def, 6, 6) > 1);
    assert.ok(autoScale(def, 8, 8) > autoScale(def, 6, 6));
    assert.equal(autoScale(def, 12, 20), 1.4);
    assert.equal(autoScale(def, 1, 1), 0.9);
  });

  it("se mide por el lado que menos creció: estirar solo a lo ancho no agranda el contenido", () => {
    assert.equal(autoScale(def, 12, 4), 1);
    assert.equal(autoScale(def, 4, 12), 1);
  });

  it("va de 5 en 5 %: no se redibuja con cada píxel al estirar", () => {
    for (let w = 4; w <= 12; w++) assert.equal(Math.round(autoScale(def, w, w) * 100) % 5, 0);
  });

  it("las páginas web y las imágenes no se escalan, y los enlaces solo a mano", () => {
    for (const component of ["embed", "image", "links"]) assert.equal(autoScale({ ...def, component }, 12, 12), 1, component);
    assert.equal(effectiveScale({ scale: 130 }, { ...def, component: "links" }, 4, 4), 1.3);
    assert.equal(effectiveScale({ scale: 130 }, { ...def, component: "embed" }, 4, 4), 1.3, "a mano manda lo que el usuario pide");
  });

  it("una escala elegida manda sobre la automática", () => {
    assert.equal(effectiveScale({ scale: 80 }, def, 12, 12), 0.8);
    assert.equal(effectiveScale({}, def, 4, 4), 1);
    assert.equal(effectiveScale(undefined, undefined, 4, 4), 1);
  });
});

describe("opciones del contenido", () => {
  it("se leen del estilo del widget", () => {
    assert.deepEqual(optionsOf({ itemSize: "l", columns: 3, overflow: "scroll" }), { itemSize: "l", columns: 3, scroll: true });
    assert.deepEqual(optionsOf(undefined), { itemSize: undefined, columns: undefined, scroll: false });
  });

  it("las piezas más grandes miden más", () => {
    const sizes = (["xs", "s", "m", "l", "xl"] as const).map((s) => ITEM_WIDTH[s]);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  });
});
