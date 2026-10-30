import { forwardRef, useImperativeHandle, useMemo, useRef, type KeyboardEvent } from "react";

export interface CodeEditorHandle {
  /** Lleva el cursor al principio de la línea (1 = primera) y la deja a la vista. */
  goToLine: (line: number) => void;
}

const LINE_HEIGHT = 20;

/**
 * Editor de texto plano con números de línea. Sin dependencias: un <textarea> con la sangría
 * automática y el tabulador que hacen falta para escribir YAML cómodamente.
 */
export const CodeEditor = forwardRef<
  CodeEditorHandle,
  {
    value: string;
    onChange: (v: string) => void;
    label: string;
    /** Líneas con un error (se marcan en rojo) y con un aviso (en ámbar). */
    errorLines?: number[];
    warnLines?: number[];
    onSave?: () => void;
  }
>(function CodeEditor({ value, onChange, label, errorLines = [], warnLines = [], onSave }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  // Los números van en un solo bloque de texto (no un elemento por línea): un documento largo no frena al escribir.
  const numbers = useMemo(() => {
    let count = 1;
    for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) count++;
    return Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }, [value]);

  useImperativeHandle(ref, () => ({
    goToLine(line) {
      const ta = area.current;
      if (!ta) return;
      const lines = ta.value.split("\n");
      const n = Math.min(Math.max(line, 1), lines.length);
      const start = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0);
      ta.focus();
      ta.setSelectionRange(start, start + lines[n - 1]!.length);
      ta.scrollTop = Math.max(0, (n - 4) * LINE_HEIGHT);
    },
  }));

  /** Cambia el texto como si se hubiera escrito (para que el cursor y «deshacer» sigan funcionando). */
  function insert(ta: HTMLTextAreaElement, text: string) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    onChange(ta.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
    } else if (e.key === "Escape") {
      // Tab escribe espacios, así que Esc suelta el cursor del editor para poder salir con el teclado.
      // No cierra el diálogo: se perdería lo escrito sin querer.
      e.preventDefault();
      ta.blur();
    } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insert(ta, "  ");
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      // Mantiene la sangría de la línea anterior (y entra un nivel tras «clave:»).
      e.preventDefault();
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf("\n") + 1);
      const indent = /^ */.exec(line)![0];
      insert(ta, "\n" + indent + (/:\s*$/.test(line) ? "  " : ""));
    }
  }

  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutter} aria-hidden>
        <pre>{numbers}</pre>
        {/* Las líneas con problema se marcan encima de los números (cada línea mide LINE_HEIGHT). */}
        {warnLines.map((n) => (
          <span key={`w${n}`} className="mark is-warn" style={{ top: `calc(0.6rem + ${(n - 1) * LINE_HEIGHT}px)` }}>
            {n}
          </span>
        ))}
        {errorLines.map((n) => (
          <span key={`e${n}`} className="mark is-bad" style={{ top: `calc(0.6rem + ${(n - 1) * LINE_HEIGHT}px)` }}>
            {n}
          </span>
        ))}
      </div>
      <textarea
        ref={area}
        className="code-area"
        aria-label={label}
        value={value}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
});
