import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, toggleTaskLine } from "../src/widgets/markdown";
import { safeHref } from "../src/widgets/LinksWidget";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown seguro", () => {
  it("escapa HTML y scripts del texto", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)"> <b>hola</b>');
    assert.equal(out.includes("<script"), false);
    assert.equal(out.includes("<img"), false);
    assert.equal(out.includes("<b>"), false);
    assert.match(out, /&lt;script&gt;/);
  });

  it("no genera enlaces javascript:, data: ni file:", () => {
    const out = html("[x](javascript:alert(1)) [y](data:text/html,hi) [z](file:///etc/passwd) javascript:alert(1)");
    assert.equal(/href="(javascript|data|file):/i.test(out), false);
  });

  it("los enlaces http(s) llevan noopener noreferrer y target=_blank", () => {
    const out = html("[ok](https://example.com/a?b=1) y https://example.org");
    assert.match(out, /href="https:\/\/example\.com\/a\?b=1"/);
    assert.match(out, /href="https:\/\/example\.org\/"/);
    assert.equal((out.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
    assert.equal((out.match(/target="_blank"/g) ?? []).length, 2);
  });

  it("no deja salir atributos por el texto del enlace", () => {
    const out = html('[x" onmouseover="alert(1)](https://a.com)');
    assert.equal(/onmouseover="/.test(out), false);
  });

  it("renderiza formato básico", () => {
    const out = html("# Título\n- uno\n- dos\n\n**negrita** y *cursiva* y `código`\n\n> cita\n\n---");
    assert.match(out, /Título/);
    assert.match(out, /<ul/);
    assert.match(out, /<strong>negrita<\/strong>/);
    assert.match(out, /<em>cursiva<\/em>/);
    assert.match(out, /<code[^>]*>código<\/code>/);
    assert.match(out, /<blockquote/);
    assert.match(out, /<hr/);
  });

  it("las tareas son casillas y solo se pueden marcar si se permite", () => {
    const text = "- [ ] pendiente\n- [x] hecha";
    const ro = renderToStaticMarkup(<Markdown text={text} />);
    assert.match(ro, /type="checkbox"[^>]*disabled/);
    const rw = renderToStaticMarkup(<Markdown text={text} onToggleTask={() => {}} />);
    assert.equal(/disabled/.test(rw), false);
    assert.match(rw, /checked/);
  });

  it("toggleTaskLine alterna solo la línea indicada", () => {
    const t = "- [ ] a\n- [x] b\ntexto";
    assert.equal(toggleTaskLine(t, 0), "- [x] a\n- [x] b\ntexto");
    assert.equal(toggleTaskLine(t, 1), "- [ ] a\n- [ ] b\ntexto");
    assert.equal(toggleTaskLine(t, 2), t);
    assert.equal(toggleTaskLine(t, 99), t);
  });
});

describe("safeHref", () => {
  it("solo http(s)", () => {
    assert.equal(safeHref("https://a.com"), "https://a.com/");
    assert.equal(safeHref("http://192.168.1.10:8096"), "http://192.168.1.10:8096/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//evil.com", "", null, 5]) {
      assert.equal(safeHref(bad), null, String(bad));
    }
  });
});
