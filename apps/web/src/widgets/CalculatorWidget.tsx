import { Delete } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

type Op = "+" | "-" | "×" | "÷";

interface State {
  display: string;
  acc: number | null;
  op: Op | null;
  fresh: boolean; // el siguiente dígito reemplaza la pantalla
}

const INITIAL: State = { display: "0", acc: null, op: null, fresh: true };

function apply(a: number, b: number, op: Op): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? NaN : a / b;
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  // Evita 0.1+0.2 = 0.30000000000000004
  return String(Number(n.toPrecision(12)));
}

/** Calculadora de "ejecución inmediata" (sin eval). */
export function CalculatorWidget() {
  const [s, setS] = useState<State>(INITIAL);

  const digit = (d: string) =>
    setS((p) => {
      if (p.display === "Error") p = INITIAL;
      if (p.fresh) return { ...p, display: d === "." ? "0." : d, fresh: false };
      if (d === "." && p.display.includes(".")) return p;
      if (p.display.replace(/[-.]/g, "").length >= 12) return p;
      return { ...p, display: p.display === "0" && d !== "." ? d : p.display + d };
    });

  const operator = (op: Op) =>
    setS((p) => {
      if (p.display === "Error") return p;
      const cur = Number(p.display);
      const acc = p.acc !== null && p.op && !p.fresh ? apply(p.acc, cur, p.op) : cur;
      return { display: fmt(acc), acc: Number.isFinite(acc) ? acc : null, op, fresh: true };
    });

  const equals = () =>
    setS((p) => {
      if (p.acc === null || !p.op || p.display === "Error") return p;
      const r = apply(p.acc, Number(p.display), p.op);
      return { display: fmt(r), acc: null, op: null, fresh: true };
    });

  const negate = () => setS((p) => (p.display === "Error" || p.display === "0" ? p : { ...p, display: p.display.startsWith("-") ? p.display.slice(1) : "-" + p.display }));
  const percent = () => setS((p) => (p.display === "Error" ? p : { ...p, display: fmt(Number(p.display) / 100), fresh: true }));
  const back = () =>
    setS((p) => {
      if (p.fresh || p.display === "Error") return p;
      const next = p.display.slice(0, -1);
      return { ...p, display: next === "" || next === "-" ? "0" : next };
    });

  function onKey(e: KeyboardEvent) {
    if (/^[0-9.]$/.test(e.key)) digit(e.key);
    else if (e.key === "," ) digit(".");
    else if (e.key === "+" || e.key === "-") operator(e.key);
    else if (e.key === "*") operator("×");
    else if (e.key === "/") operator("÷");
    else if (e.key === "Enter" || e.key === "=") equals();
    else if (e.key === "Backspace") back();
    else if (e.key === "Escape") setS(INITIAL);
    else return;
    e.preventDefault();
  }

  const keys: { label: string; run: () => void; kind?: "op" | "eq" | "fn"; span?: number; aria?: string }[] = [
    { label: "C", run: () => setS(INITIAL), kind: "fn" },
    { label: "±", run: negate, kind: "fn" },
    { label: "%", run: percent, kind: "fn" },
    { label: "÷", run: () => operator("÷"), kind: "op" },
    ...["7", "8", "9"].map((d) => ({ label: d, run: () => digit(d) })),
    { label: "×", run: () => operator("×"), kind: "op" as const },
    ...["4", "5", "6"].map((d) => ({ label: d, run: () => digit(d) })),
    { label: "-", run: () => operator("-"), kind: "op" as const },
    ...["1", "2", "3"].map((d) => ({ label: d, run: () => digit(d) })),
    { label: "+", run: () => operator("+"), kind: "op" as const },
    { label: "0", run: () => digit("0"), span: 2 },
    { label: ".", run: () => digit(".") },
    { label: "=", run: equals, kind: "eq" },
  ];

  return (
    <div className="flex h-full flex-col gap-2 outline-none" tabIndex={0} onKeyDown={onKey} aria-label="Calculadora">
      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
        <button className="btn btn-ghost btn-icon" onClick={back} aria-label="Borrar último dígito">
          <Delete size={16} />
        </button>
        <output className="truncate text-right text-3xl font-semibold tabular-nums">{s.display}</output>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-1.5">
        {keys.map((k) => (
          <button
            key={k.label}
            onClick={k.run}
            style={k.span ? { gridColumn: `span ${k.span}` } : undefined}
            className={`rounded-xl text-lg font-medium transition-colors ${
              k.kind === "eq"
                ? "bg-accent text-accent-fg hover:brightness-110"
                : k.kind === "op"
                  ? "bg-accent-soft text-accent-text hover:brightness-125"
                  : k.kind === "fn"
                    ? "bg-surface-2 text-muted hover:text-fg"
                    : "bg-surface-2 hover:bg-accent-soft"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
