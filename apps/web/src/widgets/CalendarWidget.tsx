import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Measured, useBox } from "../lib/box";
import { currentItems, dueLabel, MAX_ITEMS, newItem, saveItems, tone, urgency, useReminderLists, ymd, type Item } from "./reminderStore";

const LOCALE = "es";
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Un recordatorio con la lista a la que pertenece. */
type Entry = Item & { listId: string };

/**
 * Calendario. Con poco alto enseña la semana en curso; con más, el mes entero con los días que tienen
 * recordatorios marcados. Al tocar un día se ve su agenda y se pueden añadir cosas (se guardan en tus
 * widgets de Recordatorios). Con sitio de sobra la agenda va al lado o debajo; si no, ocupa el widget.
 */
export function CalendarWidget({ config, canEdit }: { config: Record<string, any>; canEdit: boolean }) {
  const box = useBox();
  const qc = useQueryClient();
  const weekStart = Number(config.weekStart ?? 1) === 0 ? 0 : 1;
  const showReminders = config.showReminders !== false;
  const only = typeof config.remindersFrom === "string" && config.remindersFrom ? config.remindersFrom : undefined;
  const lists = useReminderLists(only, showReminders);

  const today = new Date();
  const todayKey = ymd(today);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [open, setOpen] = useState(false); // la agenda tapa el mes (cuando no cabe al lado)

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const l of lists)
      for (const it of l.items) {
        if (!it.due) continue;
        const key = it.due.slice(0, 10);
        const arr = map.get(key) ?? [];
        arr.push({ ...it, listId: l.id });
        map.set(key, arr);
      }
    for (const arr of map.values()) arr.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "").localeCompare(b.due ?? ""));
    return map;
  }, [lists]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(LOCALE, { weekday: "narrow" });
    // 2023-01-01 fue domingo.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + ((i + weekStart) % 7))));
  }, [weekStart]);

  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const onThisMonth = cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(todayKey);
  };

  // ── escribir en las listas (se ve al instante en el widget de Recordatorios)
  const target = lists[0]?.id;
  const writable = canEdit && !!target;
  const add = (text: string, day: string, time: string) => {
    if (!target) return;
    const cur = currentItems(qc, target);
    if (cur.length >= MAX_ITEMS) return;
    void saveItems(qc, target, [...cur, newItem(text, time ? `${day}T${time}` : day)]);
  };
  const toggle = (e: Entry) => void saveItems(qc, e.listId, currentItems(qc, e.listId).map((i) => (i.id === e.id ? { ...i, done: !i.done } : i)));
  const remove = (e: Entry) => void saveItems(qc, e.listId, currentItems(qc, e.listId).filter((i) => i.id !== e.id));

  // ── versión compacta: la semana actual
  if (box.h < 150) {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() - weekStart + 7) % 7));
    const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    const month = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).format(today);
    return (
      <div className="flex size-full flex-col justify-center gap-2">
        {box.h >= 96 && <span className="text-sm font-semibold first-letter:uppercase">{month}</span>}
        <div className="grid grid-cols-7 gap-1 text-center">
          {week.map((d, i) => {
            const now = d.toDateString() === today.toDateString();
            const n = byDay.get(ymd(d))?.filter((e) => !e.done).length ?? 0;
            return (
              <div key={i} className="min-w-0" title={n ? `${n} pendiente${n === 1 ? "" : "s"}` : undefined}>
                <div className="text-[11px] text-muted">{weekdays[i]}</div>
                <div
                  className={`mx-auto mt-0.5 grid aspect-square w-full max-w-9 place-items-center rounded-full text-sm tabular-nums ${
                    now ? "bg-accent font-semibold text-accent-fg" : ""
                  }`}
                >
                  {d.getDate()}
                </div>
                <div className="mx-auto mt-0.5 h-1 w-1 rounded-full" style={{ background: n ? "var(--accent)" : "transparent" }} aria-hidden />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── versión de mes (+ agenda)
  const side = box.w >= 440 && box.h >= 210;
  const below = !side && box.h >= 400;
  const split = side || below;
  const showAgenda = split || open;
  const showMonth = split || !open;

  const title = cap(new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).format(cursor));
  const agenda = (
    <Agenda
      day={selected}
      month={cursor}
      byDay={byDay}
      writable={writable}
      canEdit={canEdit}
      noList={lists.length === 0}
      onBack={split ? undefined : () => setOpen(false)}
      onAdd={add}
      onToggle={toggle}
      onRemove={remove}
      onPickDay={(d) => {
        setSelected(d);
        const [y, m] = d.split("-").map(Number);
        setCursor(new Date(y!, m! - 1, 1));
      }}
    />
  );

  return (
    <div className={`flex size-full min-h-0 ${side ? "flex-row gap-4" : "flex-col gap-2"}`}>
      {showMonth && (
        <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: side ? "1.1 1 0" : "1 1 0" }}>
          <div className="flex shrink-0 items-center justify-between" style={{ height: 34 }}>
            <span className={`display min-w-0 truncate ${box.w > 260 ? "text-xl" : "text-lg"}`}>{title}</span>
            <div className="flex items-center">
              {(!onThisMonth || selected !== todayKey) && (
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={goToday}>
                  Hoy
                </button>
              )}
              <button className="btn btn-ghost btn-icon" onClick={() => shift(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => shift(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <Measured className="min-h-0 flex-1">
            {() => (
              <MonthGrid
                cursor={cursor}
                weekdays={weekdays}
                weekStart={weekStart}
                todayKey={todayKey}
                selected={selected}
                byDay={byDay}
                onPick={(d) => {
                  setSelected(d);
                  setOpen(true);
                }}
              />
            )}
          </Measured>
        </div>
      )}
      {showAgenda && (
        <div className={`flex min-h-0 min-w-0 flex-col ${side ? "border-l border-line pl-4" : split ? "border-t border-line pt-2" : "flex-1"}`} style={{ flex: side ? "1 1 0" : split ? "0 0 38%" : undefined }}>
          {agenda}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Cuadrícula del mes ─────────────────────────────

function MonthGrid({
  cursor,
  weekdays,
  weekStart,
  todayKey,
  selected,
  byDay,
  onPick,
}: {
  cursor: Date;
  weekdays: string[];
  weekStart: number;
  todayKey: string;
  selected: string;
  byDay: Map<string, Entry[]>;
  onPick: (key: string) => void;
}) {
  const box = useBox();
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const offset = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array.from({ length: offset }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = cells.length / 7;
  const dowH = 20;
  const cellH = (box.h - dowH) / weeks;
  // Con sitio, bajo el número van los puntos de lo que hay ese día.
  const marks = cellH >= 32;
  const dot = Math.floor(Math.max(20, Math.min(cellH - (marks ? 10 : 4), box.w / 7 - 4, 44)));

  return (
    <div className="grid size-full grid-cols-7 text-center text-xs" style={{ gridTemplateRows: `${dowH}px repeat(${weeks}, minmax(0, 1fr))` }}>
      {weekdays.map((d, i) => (
        <div key={i} className="text-muted">
          {d}
        </div>
      ))}
      {cells.map((d, i) => {
        if (!d) return <div key={i} />;
        const key = ymd(new Date(y, m, d));
        const items = byDay.get(key) ?? [];
        const open = items.filter((e) => !e.done);
        const late = open.some((e) => urgency(e.due, new Date()) === "overdue");
        const now = key === todayKey;
        const sel = key === selected;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(key)}
            aria-pressed={sel}
            aria-label={`${d} de ${cursor.toLocaleDateString(LOCALE, { month: "long" })}${items.length ? `, ${open.length} pendiente${open.length === 1 ? "" : "s"}` : ""}`}
            className="group flex min-h-0 flex-col items-center justify-center gap-px rounded-lg transition-colors hover:bg-accent-soft"
          >
            <span
              className={`grid place-items-center rounded-full tabular-nums transition-shadow ${now ? "bg-accent font-semibold text-accent-fg" : ""} ${
                sel && !now ? "ring-2 ring-accent" : sel ? "ring-2 ring-offset-2 ring-offset-transparent ring-accent" : ""
              }`}
              style={{ width: dot, height: dot, fontSize: dot >= 32 ? 14 : 12 }}
            >
              {d}
            </span>
            {marks && (
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {items.slice(0, 3).map((e, k) => (
                  <span
                    key={k}
                    className="size-1 rounded-full"
                    style={{ background: e.done ? "var(--muted)" : late ? "var(--bad)" : "var(--accent)", opacity: e.done ? 0.5 : 1 }}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Agenda ─────────────────────────────

function Agenda({
  day,
  month,
  byDay,
  writable,
  canEdit,
  noList,
  onBack,
  onAdd,
  onToggle,
  onRemove,
  onPickDay,
}: {
  day: string;
  month: Date;
  byDay: Map<string, Entry[]>;
  writable: boolean;
  canEdit: boolean;
  noList: boolean;
  onBack?: () => void;
  onAdd: (text: string, day: string, time: string) => void;
  onToggle: (e: Entry) => void;
  onRemove: (e: Entry) => void;
  onPickDay: (key: string) => void;
}) {
  const [scope, setScope] = useState<"day" | "month">("day");
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const now = new Date();

  const date = new Date(day + "T12:00:00");
  const label = cap(date.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" }));

  const items = useMemo(() => {
    if (scope === "day") return byDay.get(day) ?? [];
    const prefix = ymd(new Date(month.getFullYear(), month.getMonth(), 1)).slice(0, 7);
    return [...byDay.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, v]) => v);
  }, [scope, byDay, day, month]);
  const pending = items.filter((i) => !i.done).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text, day, time);
    setText("");
    setTime("");
  }

  return (
    <div className="flex size-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        {onBack && (
          <button className="btn btn-ghost btn-icon -ml-1" onClick={onBack} aria-label="Volver al mes">
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="display min-w-0 flex-1 truncate text-base">{scope === "day" ? label : cap(month.toLocaleDateString(LOCALE, { month: "long" }))}</span>
        <span className="flex shrink-0 rounded-full border border-line p-0.5 text-[11px]" role="group" aria-label="Qué ver">
          {(["day", "month"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`rounded-full px-2 py-0.5 font-medium transition-colors ${scope === s ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}
            >
              {s === "day" ? "Día" : "Mes"}
            </button>
          ))}
        </span>
      </div>

      {writable && scope === "day" && (
        <form onSubmit={submit} className="shrink-0 space-y-1.5">
          <div className="flex gap-1.5">
            <input
              className="input min-w-0 flex-1 py-1.5"
              placeholder="Añadir para este día…"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              aria-label="Nuevo recordatorio para este día"
            />
            <button className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Añadir">
              <Plus size={16} />
            </button>
          </div>
          {text.trim() && (
            <input type="time" className="input w-28 py-1 text-xs" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora (opcional)" />
          )}
        </form>
      )}
      {canEdit && noList && scope === "day" && (
        <p className="shrink-0 text-xs text-muted">Añade un widget de Recordatorios al dashboard para guardar aquí tus tareas.</p>
      )}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        {items.length === 0 && (
          <li className="py-3 text-center text-sm text-muted">
            <Bell size={18} className="mx-auto mb-1 opacity-60" />
            {scope === "day" ? "Nada para este día." : "Nada este mes."}
          </li>
        )}
        {items.map((it) => {
          const u = it.done ? "none" : urgency(it.due, now);
          const itemDay = it.due!.slice(0, 10);
          return (
            <li key={it.listId + it.id} className="group flex items-center gap-2 border-b border-line px-1 py-1.5 last:border-b-0">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--accent)]"
                checked={it.done}
                disabled={!canEdit}
                onChange={() => onToggle(it)}
                aria-label={`Marcar «${it.text}»`}
              />
              <span className={`min-w-0 flex-1 break-words text-sm ${it.done ? "text-muted line-through" : ""}`}>{it.text}</span>
              {scope === "month" ? (
                <button
                  type="button"
                  onClick={() => onPickDay(itemDay)}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline ${it.done ? "text-muted" : tone[u]}`}
                  title="Ir a este día"
                >
                  {dueLabel(it, u)}
                </button>
              ) : (
                it.due!.length > 10 && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${it.done ? "text-muted" : tone[u]}`}>{it.due!.slice(11)}</span>
                )
              )}
              {canEdit && (
                <button
                  className="btn btn-ghost btn-icon opacity-0 focus:opacity-100 group-hover:opacity-100"
                  onClick={() => onRemove(it)}
                  aria-label={`Borrar «${it.text}»`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > 0 && (
        <p className="shrink-0 text-xs text-muted">
          {pending} pendiente{pending === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
