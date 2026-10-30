import { Check, Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WidgetDTO } from "@oblivion/sdk";
import { Markdown, toggleTaskLine } from "./markdown";
import { useWidgetState } from "./useWidgetState";

const SIZES: Record<string, string> = { sm: "text-xs", md: "text-sm", lg: "text-base" };

export function NotesWidget({ widget, canEdit }: { widget: WidgetDTO; canEdit: boolean }) {
  const { state, update, status, flush } = useWidgetState<{ text: string }>(widget, canEdit);
  const [editing, setEditing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const cfg = widget.config as { size?: string; mono?: boolean };
  const cls = `${SIZES[cfg.size ?? "md"] ?? "text-sm"} ${cfg.mono ? "font-mono" : ""}`;

  useEffect(() => {
    if (editing) {
      const el = area.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const indicator =
    status === "saving" ? (
      <Loader2 size={13} className="animate-spin" aria-label="Guardando" />
    ) : status === "saved" ? (
      <Check size={13} className="text-good" aria-label="Guardado" />
    ) : null;

  if (editing && canEdit) {
    return (
      <div className="relative flex h-full flex-col">
        <textarea
          ref={area}
          value={state.text}
          onChange={(e) => update({ text: e.target.value })}
          onBlur={() => {
            setEditing(false);
            flush();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
          maxLength={20000}
          placeholder="Escribe en Markdown: # título, - lista, - [ ] tarea, **negrita**…"
          className={`size-full flex-1 resize-none bg-transparent leading-relaxed outline-none ${cls}`}
          aria-label="Contenido de la nota"
        />
        <div className="pointer-events-none absolute bottom-0 right-0 flex items-center gap-1 text-[11px] text-muted">
          {indicator} Esc para salir
        </div>
      </div>
    );
  }

  const empty = state.text.trim() === "";
  return (
    <div
      className={`group relative h-full overflow-y-auto pr-1 leading-relaxed [scrollbar-width:thin] ${cls} ${canEdit ? "cursor-text" : ""}`}
      onDoubleClick={() => canEdit && setEditing(true)}
    >
      {empty ? (
        <button
          className="text-muted disabled:cursor-default"
          disabled={!canEdit}
          onClick={() => setEditing(true)}
        >
          {canEdit ? "Haz clic para escribir una nota…" : "Nota vacía"}
        </button>
      ) : (
        <Markdown
          text={state.text}
          onToggleTask={canEdit ? (i) => update({ text: toggleTaskLine(state.text, i) }) : undefined}
        />
      )}
      {canEdit && !empty && (
        <button
          className="btn btn-ghost btn-icon absolute right-0 top-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
          onClick={() => setEditing(true)}
          aria-label="Editar nota"
        >
          <Pencil size={14} />
        </button>
      )}
      {!empty && <div className="absolute bottom-0 right-0">{indicator}</div>}
    </div>
  );
}
