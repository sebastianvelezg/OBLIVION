import { useEffect, useState } from "react";

function salutation(hour: number) {
  if (hour < 6) return "Buenas noches";
  if (hour < 13) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** Saludo según la hora del día, con el nombre que quieras y la fecha opcional. */
export function GreetingWidget({ config }: { config: Record<string, any> }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const name = typeof config.name === "string" ? config.name.trim() : "";
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-3xl font-semibold tracking-tight">
        {salutation(now.getHours())}
        {name && <span className="text-accent-text">, {name}</span>}
      </div>
      {config.date !== false && <div className="mt-1 text-sm text-muted first-letter:uppercase">{date}</div>}
    </div>
  );
}
