import { Bell, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { WidgetDTO } from "@oblivion/sdk";
import { toast } from "../components/ui";
import { useBox } from "../lib/box";
import { dueLabel, newItem, tone, urgency, type Item } from "./reminderStore";
import { useWidgetState } from "./useWidgetState";

export function RemindersWidget({ widget, canEdit }: { widget: WidgetDTO; canEdit: boolean }) {
  const box = useBox();
  const { state, update } = useWidgetState<{ items: Item[] }>(widget, canEdit);
  // Con poco alto el formulario se esconde tras un botón y solo queda la lista.
  const compact = box.h < 210;
  const [adding, setAdding] = useState(false);
  const showDone = (widget.config as { showDone?: boolean }).showDone !== false;
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [now, setNow] = useState(() => new Date());
  const notified = useRef(new Set<string>());

  // Reloj interno: actualiza "vencido" y avisa cuando llega la hora de un recordatorio.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    for (const it of state.items) {
      if (it.done || !it.due || it.due.length <= 10 || notified.current.has(it.id)) continue;
      const at = new Date(it.due).getTime();
      // Solo avisa si venció hace poco (no inunda al abrir la página con cosas antiguas).
      if (at <= now.getTime() && now.getTime() - at < 10 * 60_000) {
        notified.current.add(it.id);
        toast(`⏰ ${it.text}`, "ok");
      }
    }
  }, [now, state.items]);

  const items = useMemo(() => {
    const list = showDone ? state.items : state.items.filter((i) => !i.done);
    const rank = (i: Item) => (i.done ? 2 : i.due ? 0 : 1);
    return [...list].sort(
      (a, b) =>
        rank(a) - rank(b) || (a.due ?? "").localeCompare(b.due ?? "") || a.createdAt - b.createdAt,
    );
  }, [state.items, showDone]);

  const pending = state.items.filter((i) => !i.done).length;
  const doneCount = state.items.length - pending;

  function add(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || state.items.length >= 200) return;
    const due = date ? (time ? `${date}T${time}` : date) : null;
    update({ items: [...state.items, newItem(t, due)] });
    setText("");
    setDate("");
    setTime("");
  }

  const patch = (id: string, p: Partial<Item>) =>
    update({ items: state.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  return (
    <div className="flex size-full flex-col gap-2">
      {canEdit && (!compact || adding) && (
        <form onSubmit={add} className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              className="input min-w-0 flex-1 py-1.5"
              placeholder="Nuevo recordatorio…"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              aria-label="Nuevo recordatorio"
            />
            <button className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Añadir">
              <Plus size={16} />
            </button>
          </div>
          {text.trim() && (
            <div className="flex gap-1.5">
              <input
                type="date"
                className="input min-w-0 flex-1 py-1 text-xs"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (!e.target.value) setTime("");
                }}
                aria-label="Fecha (opcional)"
              />
              {date && (
                <input
                  type="time"
                  className="input w-28 py-1 text-xs"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  aria-label="Hora (opcional)"
                />
              )}
            </div>
          )}
        </form>
      )}

      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {items.length === 0 && (
          <li className="py-4 text-center text-sm text-muted">
            <Bell size={18} className="mx-auto mb-1 opacity-60" />
            {canEdit ? "Nada pendiente. Añade tu primer recordatorio." : "Nada pendiente."}
          </li>
        )}
        {items.map((it) => {
          const u = it.done ? "none" : urgency(it.due, now);
          return (
            <li key={it.id} className="group flex items-center gap-2 border-b border-line px-1 py-1.5 last:border-b-0">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--accent)]"
                checked={it.done}
                disabled={!canEdit}
                onChange={() => patch(it.id, { done: !it.done })}
                aria-label={`Marcar «${it.text}»`}
              />
              <span className={`min-w-0 flex-1 break-words text-sm ${it.done ? "text-muted line-through" : ""}`}>{it.text}</span>
              {it.due && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${it.done ? "text-muted" : tone[u]}`}>
                  {dueLabel(it, u)}
                </span>
              )}
              {canEdit && (
                <button
                  className="btn btn-ghost btn-icon opacity-0 focus:opacity-100 group-hover:opacity-100"
                  onClick={() => update({ items: state.items.filter((i) => i.id !== it.id) })}
                  aria-label={`Borrar «${it.text}»`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {(state.items.length > 0 || (canEdit && compact)) && (
        <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
          <span>
            {pending} pendiente{pending === 1 ? "" : "s"}
          </span>
          {canEdit && compact && (
            <button className="hover:text-fg" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cerrar" : "+ Añadir"}
            </button>
          )}
          {doneCount > 0 && canEdit && (
            <button className="hover:text-fg" onClick={() => update({ items: state.items.filter((i) => !i.done) })}>
              Limpiar completadas ({doneCount})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
