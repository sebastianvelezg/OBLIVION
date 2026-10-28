// Formatos comunes para los plugins (tamaños, velocidades, tiempos).
//
// Esta carpeta NO es un plugin (no tiene plugin.mjs): la importan los plugins de al lado.

/** 1536 → «1.5 KB». */
export function bytes(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, x)) / Math.log(1024)));
  const v = x / 1024 ** i;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Bytes por segundo → «5.2 MB/s». */
export function rate(bps) {
  const x = Number(bps);
  if (!Number.isFinite(x) || x <= 0) return "0 B/s";
  return `${bytes(x)}/s`;
}

/** Hace cuánto fue `t` (ms, segundos con `sec`, o ISO): «hace 5 min», «hace 2 h», «hace 3 d». */
export function ago(t, { sec = false } = {}) {
  const ms = typeof t === "string" ? Date.parse(t) : sec ? Number(t) * 1000 : Number(t);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 60 * 86400) return `hace ${Math.round(s / 86400)} d`;
  return `hace ${Math.round(s / (30 * 86400))} meses`;
}

/** Segundos → «2 d 3 h» / «1 h 30 min» / «12 min» / «40 s». */
export function duration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(s)} s`;
}

/**
 * Guarda una sesión en un `Map` con un tope: si se llena, retira primero las caducadas y luego las más antiguas.
 * Los plugins con inicio de sesión lo usan para que la memoria no crezca sin límite.
 */
export function remember(map, key, value, max = 50) {
  map.delete(key); // reinsertar la deja como la más reciente
  map.set(key, value);
  if (map.size <= max) return;
  for (const [k, v] of map) {
    if (v && typeof v.expires === "number" && v.expires < Date.now()) map.delete(k);
  }
  while (map.size > max) map.delete(map.keys().next().value);
}

/** Basic auth si hay usuario; si no, sin cabecera. */
export function basicAuth(user, pass) {
  return user ? { Authorization: "Basic " + Buffer.from(`${user}:${pass ?? ""}`).toString("base64") } : {};
}
