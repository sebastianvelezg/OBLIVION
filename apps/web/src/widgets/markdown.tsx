import { Fragment, type ReactNode } from "react";
import { safeHref } from "./LinksWidget";

/**
 * Markdown mínimo y SEGURO: se construye con elementos de React (nunca con
 * innerHTML), así que el texto de una nota no puede inyectar HTML ni scripts.
 * Soporta: títulos (#), listas (- / 1.), tareas (- [ ] / - [x]), citas (>),
 * línea (---), **negrita**, *cursiva*, `código` y enlaces http(s).
 */

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<>()]+)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-accent-soft px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <Anchor key={key} href={link[2]!} label={link[1]!} />;
    if (/^https?:\/\//.test(part)) return <Anchor key={key} href={part} label={part} />;
    if (
      (part.startsWith("*") && part.endsWith("*") && part.length > 2) ||
      (part.startsWith("_") && part.endsWith("_") && part.length > 2)
    ) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function Anchor({ href, label }: { href: string; label: string }) {
  const safe = safeHref(href);
  if (!safe) return <>{label}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {label}
    </a>
  );
}

export function Markdown({
  text,
  onToggleTask,
}: {
  text: string;
  /** Si se pasa, las casillas `- [ ]` son interactivas; recibe el índice de línea. */
  onToggleTask?: (lineIndex: number) => void;
}) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const key = `l${i}`;

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const cls = level === 1 ? "text-xl font-semibold" : level === 2 ? "text-lg font-semibold" : "text-base font-semibold";
      out.push(
        <p key={key} className={`${cls} mt-2 first:mt-0`}>
          {inline(heading[2]!, key)}
        </p>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key} className="my-3 border-line" />);
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      out.push(
        <blockquote key={key} className="my-1 border-l-2 border-accent pl-3 text-muted">
          {inline(line.slice(2), key)}
        </blockquote>,
      );
      i++;
      continue;
    }

    // Bloque de lista (consecutivas)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: ReactNode[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const raw = lines[i]!;
        const idx = i;
        const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(raw);
        if (task) {
          const done = task[1] !== " ";
          items.push(
            <li key={`l${idx}`} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-3.5 accent-[var(--accent)]"
                checked={done}
                disabled={!onToggleTask}
                onChange={() => onToggleTask?.(idx)}
                aria-label={task[2]}
              />
              <span className={done ? "text-muted line-through" : ""}>{inline(task[2]!, `l${idx}`)}</span>
            </li>,
          );
        } else {
          items.push(<li key={`l${idx}`}>{inline(raw.replace(/^\s*([-*]|\d+\.)\s+/, ""), `l${idx}`)}</li>);
        }
        i++;
      }
      const hasTasks = items.some((it) => (it as any)?.props?.className?.includes("flex"));
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag
          key={key}
          className={`my-1 space-y-0.5 ${hasTasks ? "" : ordered ? "list-decimal pl-5" : "list-disc pl-5"}`}
        >
          {items}
        </Tag>,
      );
      continue;
    }

    // Párrafo: junta líneas consecutivas
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,3}\s|>\s|\s*([-*]|\d+\.)\s+)/.test(lines[i]!) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(
      <p key={key} className="my-1 whitespace-pre-wrap break-words">
        {inline(para.join("\n"), key)}
      </p>,
    );
  }

  return <div className="break-words">{out}</div>;
}

/** Cambia `[ ]` ↔ `[x]` en una línea concreta. */
export function toggleTaskLine(text: string, lineIndex: number): string {
  const lines = text.split("\n");
  const l = lines[lineIndex];
  if (l === undefined) return text;
  lines[lineIndex] = l.replace(/\[( |x|X)\]/, (_, c) => (c === " " ? "[x]" : "[ ]"));
  return lines.join("\n");
}
