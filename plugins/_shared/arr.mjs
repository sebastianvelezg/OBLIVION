// Código común de la familia *arr (Sonarr, Radarr, Lidarr, Prowlarr, Bazarr).
//
// Esta carpeta NO es un plugin (no tiene plugin.mjs): la importan los plugins de al lado.
// Todos usan la cabecera `X-Api-Key` y las mismas formas de cola y calendario.

/** Campos de conexión: URL y API key (Ajustes → General → Seguridad → Clave API). */
export const arrConnection = (placeholder) => [
  { key: "url", label: "URL", type: "url", required: true, placeholder },
  { key: "apiKey", label: "API key", type: "secret", required: true, help: "Ajustes → General → Seguridad → Clave API." },
];

/** GET JSON con errores que el usuario entiende. `app` es el nombre para los mensajes. */
export async function arrGet(ctx, app, path, { header = "X-Api-Key" } = {}) {
  const key = String(ctx.config.apiKey ?? "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) ctx.fail("La API key no tiene un formato válido.");
  const res = await ctx.http(String(ctx.config.url).replace(/\/+$/, "") + path, {
    headers: { Accept: "application/json", [header]: key },
  });
  if (res.status === 401 || res.status === 403) ctx.fail(`${app} rechazó la API key.`);
  if (res.status === 404) ctx.fail(`No se encontró la API de ${app}. ¿La URL es la de su interfaz web (y la versión es reciente)?`);
  if (!res.ok) ctx.fail(`${app} respondió con error ${res.status}`);
  try {
    return res.json();
  } catch {
    return ctx.fail(`La URL responde, pero no parece ${app}.`);
  }
}

// ───────────────────────── cola de descargas ─────────────────────────

const STATE = {
  downloading: ["Descargando", "neutral"],
  paused: ["Pausado", "neutral"],
  queued: ["En cola", "neutral"],
  delay: ["En espera", "neutral"],
  downloadClientUnavailable: ["Cliente no disponible", "bad"],
  importPending: ["Pendiente de importar", "warn"],
  importBlocked: ["Importación bloqueada", "bad"],
  importing: ["Importando", "good"],
  imported: ["Importado", "good"],
  failedPending: ["Fallo, reintentando", "warn"],
  failed: ["Fallido", "bad"],
  ignored: ["Ignorado", "neutral"],
};

/** Una fila de la cola de Sonarr/Radarr/Lidarr. `title`/`subtitle` los pone cada app. */
export function queueRow(rec, title, subtitle) {
  const [label, tone0] = STATE[rec.trackedDownloadState] ?? STATE[rec.status] ?? [String(rec.status ?? "—"), "neutral"];
  const size = Number(rec.size);
  const left = Number(rec.sizeleft);
  const progress = size > 0 && Number.isFinite(left) ? Math.min(1, Math.max(0, 1 - left / size)) : undefined;
  const problem = rec.trackedDownloadStatus === "error" ? "bad" : rec.trackedDownloadStatus === "warning" ? "warn" : tone0;
  return {
    title: String(title || rec.title || "Sin título"),
    subtitle: [subtitle, label, remaining(rec.timeleft)].filter(Boolean).join(" · "),
    right: progress === undefined ? undefined : `${Math.round(progress * 100)}%`,
    progress,
    tone: problem,
  };
}

/** `timeleft` llega como «00:12:34» (o «1.02:00:00» con días). */
function remaining(t) {
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(String(t ?? ""));
  if (!m) return "";
  const d = Number(m[1] ?? 0);
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${min} min`;
  return min > 0 ? `${min} min` : "<1 min";
}

/** Sección de resumen + lista para una cola. `records` son los registros originales (para saber cuáles descargan). */
export function queueView(total, rows, records = [], empty = "No hay nada en la cola de descargas.") {
  const downloading = records.filter((r) => r.trackedDownloadState === "downloading" || r.status === "downloading").length;
  const problems = rows.filter((r) => r.tone === "bad" || r.tone === "warn").length;
  return {
    kind: "sections",
    sections: [
      {
        view: {
          kind: "stats",
          items: [
            { label: "En cola", value: String(total) },
            { label: "Descargando", value: String(downloading), tone: downloading > 0 ? "good" : "neutral" },
            { label: "Con problemas", value: String(problems), tone: problems > 0 ? "warn" : "neutral" },
          ],
        },
      },
      { view: { kind: "list", empty, items: rows } },
    ],
  };
}

// ───────────────────────── fechas ─────────────────────────

/** Rango `start`/`end` (ISO) para el calendario: desde hoy hasta dentro de `days` días. */
export function range(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** «Hoy 20:00», «Mañana», «vie 3 oct». */
export function whenLabel(iso, withTime = true) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400_000);
  const hour = withTime && /T\d\d:\d\d/.test(String(iso)) ? ` ${d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : "";
  if (diff === 0) return `Hoy${hour}`;
  if (diff === 1) return `Mañana${hour}`;
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

export const episodeTag = (e) =>
  e && e.seasonNumber != null && e.episodeNumber != null ? `T${e.seasonNumber}·E${e.episodeNumber}` : "";
