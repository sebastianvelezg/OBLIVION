import { useEffect, useState } from "react";
import { useBox } from "../lib/box";

function salutation(hour: number) {
  if (hour < 6) return "Buenas noches";
  if (hour < 13) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** Saludo según la hora del día, con el nombre que quieras y la fecha opcional. */
export function GreetingWidget({ config }: { config: Record<string, any> }) {
  const box = useBox();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const name = typeof config.name === "string" ? config.name.trim() : "";
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(now);
  const hello = salutation(now.getHours());

  // Con alto de sobra, el saludo y el nombre van en dos líneas y crecen; si no, en una.
  const stacked = !!name && box.h >= 118 && box.w < 520;
  const showDate = config.date !== false && box.h >= 64;
  const chars = stacked ? Math.max(hello.length, name.length + 1) : hello.length + (name ? name.length + 2 : 0);
  const lines = stacked ? 2 : 1;
  const fs = Math.floor(
    Math.max(20, Math.min((box.h - (showDate ? 30 : 0)) / (lines * 1.15), box.w / (chars * 0.46), 72)),
  );

  return (
    <div className="flex size-full flex-col justify-center">
      <div className="display" style={{ fontSize: fs, lineHeight: 1.08 }}>
        {hello}
        {name && (
          <span className="text-accent-text">
            {stacked ? <br /> : ", "}
            {name}
          </span>
        )}
      </div>
      {showDate && <div className="mt-2 truncate text-sm text-muted first-letter:uppercase">{date}</div>}
    </div>
  );
}
