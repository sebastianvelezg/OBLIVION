import type { Field } from "@oblivion/sdk";
import { SecretBox } from "../crypto.js";

export class ConfigError extends Error {}

type Stored = Record<string, unknown>;

/**
 * Valida la configuración que llega del navegador contra el esquema de campos
 * del widget y devuelve lo que se guarda en la base de datos (secretos cifrados).
 *
 * - Las claves desconocidas se descartan.
 * - Un campo `secret` vacío/ausente conserva el valor ya guardado; `null` lo borra.
 */
export function buildStoredConfig(
  fields: Field[],
  input: unknown,
  existing: Stored,
  box: SecretBox,
): Stored {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ConfigError("La configuración debe ser un objeto");
  }
  const src = input as Record<string, unknown>;
  const out: Stored = {};

  for (const f of fields) {
    const raw = src[f.key];

    if (f.type === "secret") {
      if (raw === null) continue; // borrar
      if (raw === undefined || raw === "") {
        if (existing[f.key] !== undefined) out[f.key] = existing[f.key];
        else if (f.required) throw new ConfigError(`«${f.label}» es obligatorio`);
        continue;
      }
      if (typeof raw !== "string" || raw.length > 2000) {
        throw new ConfigError(`«${f.label}» no es válido`);
      }
      out[f.key] = box.encrypt(raw);
      continue;
    }

    const value = coerce(f, raw === undefined ? f.default : raw);
    if (value !== undefined) out[f.key] = value;
  }
  return out;
}

function coerce(f: Field, raw: unknown): unknown {
  const empty = raw === undefined || raw === null || raw === "";
  if (empty) {
    if (f.type === "boolean") return false;
    if (f.type === "list") return [];
    if (f.required) throw new ConfigError(`«${f.label}» es obligatorio`);
    return undefined;
  }

  switch (f.type) {
    case "string":
    case "text": {
      if (typeof raw !== "string") throw new ConfigError(`«${f.label}» debe ser texto`);
      const max = f.type === "text" ? 5000 : 500;
      if (raw.length > max) throw new ConfigError(`«${f.label}» es demasiado largo`);
      return raw.trim();
    }
    case "url": {
      if (typeof raw !== "string") throw new ConfigError(`«${f.label}» debe ser una URL`);
      return normalizeUrl(raw.trim(), f.label);
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new ConfigError(`«${f.label}» debe ser un número`);
      if (f.min !== undefined && n < f.min) throw new ConfigError(`«${f.label}» mínimo ${f.min}`);
      if (f.max !== undefined && n > f.max) throw new ConfigError(`«${f.label}» máximo ${f.max}`);
      return n;
    }
    case "boolean":
      return raw === true || raw === "true";
    case "select": {
      if (typeof raw !== "string" || !f.options?.some((o) => o.value === raw)) {
        throw new ConfigError(`«${f.label}» tiene una opción inválida`);
      }
      return raw;
    }
    case "list": {
      if (!Array.isArray(raw)) throw new ConfigError(`«${f.label}» debe ser una lista`);
      const max = f.maxItems ?? 50;
      if (raw.length > max) throw new ConfigError(`«${f.label}»: máximo ${max} elementos`);
      const itemFields = f.itemFields ?? [];
      return raw.map((item) => {
        if (item === null || typeof item !== "object") {
          throw new ConfigError(`«${f.label}» contiene un elemento inválido`);
        }
        const o: Stored = {};
        for (const sub of itemFields) {
          const v = coerce(sub, (item as Record<string, unknown>)[sub.key] ?? sub.default);
          if (v !== undefined) o[sub.key] = v;
        }
        return o;
      });
    }
    default:
      return undefined;
  }
}

/** Solo http/https: bloquea `javascript:`, `data:`, `file:`... */
export function normalizeUrl(value: string, label = "URL"): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new ConfigError(`«${label}» no es una URL válida`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ConfigError(`«${label}» debe empezar por http:// o https://`);
  }
  if (u.username || u.password) {
    throw new ConfigError(`«${label}» no puede incluir usuario o contraseña`);
  }
  return u.toString();
}

/** Lo que ve el navegador: sin secretos, con la lista de cuáles están definidos. */
export function maskConfig(fields: Field[], stored: Stored): { config: Stored; secretsSet: string[] } {
  const config: Stored = {};
  const secretsSet: string[] = [];
  const secretKeys = new Set(fields.filter((f) => f.type === "secret").map((f) => f.key));
  for (const [k, v] of Object.entries(stored)) {
    if (secretKeys.has(k)) secretsSet.push(k);
    else config[k] = v;
  }
  return { config, secretsSet };
}

/** Lo que recibe el plugin: secretos descifrados. */
export function revealConfig(fields: Field[], stored: Stored, box: SecretBox): Stored {
  const out: Stored = { ...stored };
  for (const f of fields) {
    if (f.type !== "secret") continue;
    const v = stored[f.key];
    if (SecretBox.isEncrypted(v)) out[f.key] = box.decrypt(v);
  }
  return out;
}

/**
 * URLs escritas por el usuario (la lista de destinos permitidos del plugin):
 * campos `url` del widget y también los `url` dentro de campos `list`.
 */
export function collectUrls(fields: Field[], stored: Stored): string[] {
  const urls: string[] = [];
  for (const f of fields) {
    const v = stored[f.key];
    if (f.type === "url" && typeof v === "string") urls.push(v);
    if (f.type === "list" && Array.isArray(v)) {
      for (const item of v) {
        if (item === null || typeof item !== "object") continue;
        for (const sub of f.itemFields ?? []) {
          const s = (item as Record<string, unknown>)[sub.key];
          if (sub.type === "url" && typeof s === "string") urls.push(s);
        }
      }
    }
  }
  return urls;
}
