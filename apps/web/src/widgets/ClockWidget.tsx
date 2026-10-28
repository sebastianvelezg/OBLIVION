import { useEffect, useState } from "react";

export function ClockWidget({ config }: { config: Record<string, any> }) {
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

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-5xl font-semibold tracking-tight tabular-nums">{time}</div>
      {config.date !== false && <div className="mt-1 text-sm text-muted first-letter:uppercase">{date}</div>}
      {badTz && <div className="mt-2 text-xs text-warn">Zona horaria no válida</div>}
      {tz && !badTz && <div className="mt-1 text-xs text-muted">{tz}</div>}
    </div>
  );
}
