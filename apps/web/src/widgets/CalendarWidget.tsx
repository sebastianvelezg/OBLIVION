import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

export function CalendarWidget({ config }: { config: Record<string, any> }) {
  const weekStart = Number(config.weekStart ?? 1) === 0 ? 0 : 1;
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const { weekdays, cells, title } = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    // 2023-01-01 fue domingo.
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      fmtDay.format(new Date(2023, 0, 1 + ((i + weekStart) % 7))),
    );
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

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-block text-sm font-medium first-letter:uppercase">{title}</span>
        <div className="flex">
          <button className="btn btn-ghost btn-icon" onClick={() => shift(-1)} aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => shift(1)} aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-7 content-start gap-y-1 text-center text-xs">
        {weekdays.map((d, i) => (
          <div key={i} className="pb-1 uppercase text-muted">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="grid place-items-center">
            {d && (
              <span
                className={`grid size-7 place-items-center rounded-full tabular-nums ${
                  isToday(d) ? "bg-accent font-semibold text-accent-fg" : ""
                }`}
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
