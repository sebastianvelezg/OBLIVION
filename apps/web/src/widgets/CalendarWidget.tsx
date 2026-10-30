import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useBox } from "../lib/box";

/**
 * Calendario con dos versiones: con poco alto, la semana en curso; con más, el mes entero
 * (y un botón para volver a hoy si navegas a otro mes).
 */
export function CalendarWidget({ config }: { config: Record<string, any> }) {
  const box = useBox();
  const weekStart = Number(config.weekStart ?? 1) === 0 ? 0 : 1;
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const { weekdays, cells, title } = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    // 2023-01-01 fue domingo.
    const weekdays = Array.from({ length: 7 }, (_, i) => fmtDay.format(new Date(2023, 0, 1 + ((i + weekStart) % 7))));
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: days }, (_, i) => i + 1),
    ];
    while (cells.length % 7) cells.push(null);
    const title = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first);
    return { weekdays, cells, title };
  }, [cursor, weekStart]);

  const isToday = (d: number) =>
    d === today.getDate() && cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const onThisMonth = cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();

  // ── versión compacta: la semana actual
  if (box.h < 150) {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() - weekStart + 7) % 7));
    const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(today);
    return (
      <div className="flex size-full flex-col justify-center gap-2">
        {box.h >= 96 && <span className="text-sm font-semibold first-letter:uppercase">{month}</span>}
        <div className="grid grid-cols-7 gap-1 text-center">
          {week.map((d, i) => {
            const now = d.toDateString() === today.toDateString();
            return (
              <div key={i} className="min-w-0">
                <div className="text-[11px] text-muted">{weekdays[i]}</div>
                <div
                  className={`mx-auto mt-0.5 grid aspect-square w-full max-w-9 place-items-center rounded-full text-sm tabular-nums ${
                    now ? "bg-accent font-semibold text-accent-fg" : ""
                  }`}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── versión de mes: la cuadrícula se reparte el alto que haya
  const weeks = cells.length / 7;
  const headH = 34;
  const dowH = 20;
  const cellH = (box.h - headH - dowH) / weeks;
  const dot = Math.floor(Math.max(20, Math.min(cellH - 4, box.w / 7 - 4, 44)));
  const big = box.h >= 280;

  return (
    <div className="flex size-full flex-col">
      <div className="flex items-center justify-between" style={{ height: headH }}>
        <span className={`display min-w-0 truncate first-letter:uppercase ${big && box.w > 260 ? "text-2xl" : box.w > 230 ? "text-xl" : "text-lg"}`}>{title}</span>
        <div className="flex items-center">
          {!onThisMonth && (
            <button
              className="btn btn-ghost px-2 py-1 text-xs"
              onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
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
      <div className="grid min-h-0 flex-1 grid-cols-7 text-center text-xs" style={{ gridTemplateRows: `${dowH}px repeat(${weeks}, minmax(0, 1fr))` }}>
        {weekdays.map((d, i) => (
          <div key={i} className="text-muted">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="grid place-items-center">
            {d && (
              <span
                className={`grid place-items-center rounded-full tabular-nums ${isToday(d) ? "bg-accent font-semibold text-accent-fg" : ""}`}
                style={{ width: dot, height: dot, fontSize: dot >= 32 ? 14 : 12 }}
              >
                {d}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
