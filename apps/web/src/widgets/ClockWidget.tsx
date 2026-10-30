import { useEffect, useState } from "react";
import { useBox } from "../lib/box";

const DAY = 86_400_000;

export function ClockWidget({ config }: { config: Record<string, any> }) {
  const box = useBox();
  const [now, setNow] = useState(() => new Date());
  const seconds = !!config.seconds;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), seconds ? 1000 : 10_000);
    return () => clearInterval(id);
  }, [seconds]);

  const tz = typeof config.timezone === "string" && config.timezone ? config.timezone : undefined;
  let time: string;
  let date: string;
  let badTz = false;
  try {
    time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: seconds ? "2-digit" : undefined,
      hour12: !!config.hour12,
      timeZone: tz,
    }).format(now);
    date = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: tz,
    }).format(now);
  } catch {
    badTz = true;
    time = now.toLocaleTimeString();
    date = now.toLocaleDateString();
  }

  // Qué se enseña según el espacio: la hora siempre; la fecha, la zona y el avance del año, si caben.
  const showDate = config.date !== false && box.h >= 92;
  const showZone = (!!tz || badTz) && box.h >= 150;
  const showYear = box.h >= 210 && box.w >= 200;
  const reserved = (showDate ? 26 : 0) + (showZone ? 20 : 0) + (showYear ? 44 : 0);
  const fs = Math.floor(Math.max(26, Math.min((box.h - reserved) * 0.78, box.w / (time.length * 0.5))));

  const start = new Date(now.getFullYear(), 0, 0).getTime();
  const dayOfYear = Math.floor((now.getTime() - start) / DAY);
  const total = Math.round((new Date(now.getFullYear(), 11, 31).getTime() - start) / DAY);

  return (
    <div className="flex size-full flex-col justify-center">
      <div className="display" style={{ fontSize: fs }}>
        {time}
      </div>
      {showDate && <div className="mt-1.5 truncate text-sm text-muted first-letter:uppercase">{date}</div>}
      {showZone && (
        <div className={`mt-0.5 truncate text-xs ${badTz ? "text-warn" : "text-muted"}`}>
          {badTz ? "Zona horaria no válida" : tz}
        </div>
      )}
      {showYear && (
        <div className="mt-4" title={`Día ${dayOfYear} de ${total}`}>
          <div className="h-[3px] overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(dayOfYear / total) * 100}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] tabular-nums text-muted">
            Día {dayOfYear} de {total}
          </div>
        </div>
      )}
    </div>
  );
}
