import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  /** Carpeta con la base de datos y la clave maestra. */
  dataDir: string;
  /** Carpetas donde buscar plugins. */
  pluginDirs: string[];
  /** Carpeta con el frontend compilado (si existe, se sirve). */
  webDir: string;
  /** Confiar en X-Forwarded-* (solo si hay un reverse proxy delante). */
  trustProxy: boolean;
  /** `auto` marca la cookie como Secure si la petición llegó por HTTPS. */
  cookieSecure: "auto" | "always" | "never";
  /** Parámetro de coste de scrypt (potencia de 2). Solo bajar en tests. */
  scryptN: number;
  /** Si se define, el asistente de primer arranque exige este código. */
  setupToken: string | null;
  /** Si no está vacío, solo se atienden peticiones cuyo Host esté en la lista. */
  allowedHosts: string[];
  /** Carpeta de imágenes subidas (fondo). */
  uploadsDir: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ y dist/ están a la misma profundidad: apps/server/{src,dist}
const repoRoot = path.resolve(here, "../../..");

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.OBLIVION_DATA_DIR ?? path.join(repoRoot, "data"));
  const extraPlugins = (env.OBLIVION_PLUGINS_DIR ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const cookieSecure = (env.OBLIVION_COOKIE_SECURE ?? "auto").toLowerCase();

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    pluginDirs: extraPlugins.length ? extraPlugins : [path.join(repoRoot, "plugins")],
    webDir: path.resolve(env.OBLIVION_WEB_DIR ?? path.join(repoRoot, "apps/web/dist")),
    trustProxy: bool(env.OBLIVION_TRUST_PROXY, false),
    cookieSecure:
      cookieSecure === "always" || cookieSecure === "never" ? cookieSecure : "auto",
    scryptN: Number(env.OBLIVION_SCRYPT_N ?? 2 ** 17),
    setupToken: env.OBLIVION_SETUP_TOKEN?.trim() || null,
    allowedHosts: (env.OBLIVION_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    uploadsDir: path.join(dataDir, "uploads"),
  };
}
