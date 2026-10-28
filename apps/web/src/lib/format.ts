/** «hace 5 min», «hace 2 h»… */
export function timeAgo(ms: number | null, now = Date.now()): string {
  if (ms === null) return "nunca";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "ahora mismo";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

/** Navegador y sistema a partir del User-Agent (aproximado, solo para reconocer la sesión). */
export function describeAgent(ua: string | null): string {
  if (!ua) return "Dispositivo desconocido";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /curl\//.test(ua) ? "curl"
    : "Navegador";
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return os ? `${browser} en ${os}` : browser;
}

const CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres que se confunden

/** Contraseña aleatoria de 20 caracteres (CSPRNG del navegador, sin sesgo). */
export function generatePassword(length = 20): string {
  const out: string[] = [];
  const limit = 256 - (256 % CHARS.length);
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) {
      if (b < limit && out.length < length) out.push(CHARS[b % CHARS.length]!);
    }
  }
  return out.join("");
}
