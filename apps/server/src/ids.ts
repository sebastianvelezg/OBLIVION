import type { DB } from "./db.js";

/** Ids que se pueden escribir a mano en los documentos de configuración (`inicio`, `reloj-1`...). */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** «Jellyfin (casa)» → `jellyfin-casa`. Siempre devuelve un id válido. */
export function slugify(text: string, fallback = "item"): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** Primer `base`, `base-2`, `base-3`... que no esté en `taken`. */
export function uniqueId(base: string, taken: { has(id: string): boolean }): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

type Table = "pages" | "connections" | "widgets";

/** Id legible y libre en la tabla para algo nuevo (la base suele ser el título o el tipo). */
export function newId(db: DB, table: Table, base: string, fallback: string): string {
  const rows = db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[];
  return uniqueId(slugify(base, fallback), new Set(rows.map((r) => r.id)));
}
