import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { BACKGROUND_ID_PATTERN, DEFAULT_APPEARANCE, PALETTE_IDS, type Appearance } from "@oblivion/sdk";
import { requireAdmin, requireUser, type AppEnv } from "../auth.js";
import { audit } from "../db.js";
import { detectImage } from "../security/image.js";
import type { AppDeps } from "../app.js";

export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
const GC_GRACE_MS = 10 * 60 * 1000;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const appearanceSchema = z.object({
  mode: z.enum(["dark", "light", "system"]),
  palette: z.enum(PALETTE_IDS),
  accent: hex,
  font: z.enum(["sans", "mono", "serif"]),
  density: z.enum(["compact", "comfortable", "spacious"]),
  card: z.object({
    style: z.enum(["glass", "solid", "outline", "flat"]),
    opacity: z.number().int().min(20).max(100),
    blur: z.number().int().min(0).max(40),
    radius: z.number().int().min(0).max(32),
    shadow: z.enum(["none", "soft", "strong"]),
  }),
  background: z.object({
    type: z.enum(["aurora", "plain", "gradient", "image"]),
    from: hex,
    to: hex,
    angle: z.number().int().min(0).max(360),
    imageId: z.string().regex(BACKGROUND_ID_PATTERN).nullable(),
    blur: z.number().int().min(0).max(30),
    dim: z.number().int().min(0).max(80),
  }),
}) satisfies z.ZodType<Appearance>;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export function appearanceRoutes({ db, config }: AppDeps) {
  const app = new Hono<AppEnv>();

  function load(): Appearance {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get() as
      | { value: string }
      | undefined;
    if (!row) return DEFAULT_APPEARANCE;
    try {
      const parsed = appearanceSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } catch {
      /* JSON roto: caemos al valor por defecto */
    }
    return DEFAULT_APPEARANCE;
  }

  /**
   * Borra del disco las imágenes que ya no usa la apariencia. Respeta las
   * recientes: una imagen recién subida aún no está referenciada y un guardado
   * anterior no debe llevársela por delante.
   */
  function collectGarbage(keep: string | null, now = Date.now()) {
    if (!fs.existsSync(config.uploadsDir)) return;
    for (const name of fs.readdirSync(config.uploadsDir)) {
      if (name === keep || !BACKGROUND_ID_PATTERN.test(name)) continue;
      const file = path.join(config.uploadsDir, name);
      if (now - fs.statSync(file).mtimeMs < GC_GRACE_MS) continue;
      fs.rmSync(file, { force: true });
    }
  }

  app.get("/", requireUser, (c) => c.json({ appearance: load() }));

  app.put("/", requireAdmin, async (c) => {
    const parsed = appearanceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Apariencia inválida" }, 400);
    const next = parsed.data;

    if (next.background.imageId && !fs.existsSync(path.join(config.uploadsDir, next.background.imageId))) {
      return c.json({ error: "La imagen de fondo no existe" }, 400);
    }
    if (next.background.type === "image" && !next.background.imageId) {
      return c.json({ error: "Sube una imagen para usar el fondo «Foto»" }, 400);
    }

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('appearance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(next));
    collectGarbage(next.background.imageId);
    return c.json({ appearance: next });
  });

  // Subida: el cuerpo es la imagen tal cual (el cliente ya la reduce y le quita los metadatos EXIF).
  app.post("/background", requireAdmin, async (c) => {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) return c.json({ error: "Archivo vacío" }, 400);
    if (buf.byteLength > MAX_BACKGROUND_BYTES) return c.json({ error: "La imagen supera los 8 MB" }, 413);

    const kind = detectImage(buf);
    if (!kind) return c.json({ error: "Formato no admitido (usa JPG, PNG, WebP o AVIF)" }, 415);

    const id = `${createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${kind.ext}`;
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, id), buf, { mode: 0o600 });
    audit(db, "background_uploaded", { username: c.get("user")!.username, ip: c.get("ip"), detail: id });
    return c.json({ imageId: id }, 201);
  });

  app.get("/background/:id", requireUser, (c) => {
    const id = c.req.param("id");
    // El patrón estricto impide cualquier ruta distinta de un archivo de uploads.
    if (!BACKGROUND_ID_PATTERN.test(id)) return c.json({ error: "No encontrado" }, 404);
    const file = path.join(config.uploadsDir, id);
    if (!fs.existsSync(file)) return c.json({ error: "No encontrado" }, 404);
    return new Response(fs.readFileSync(file), {
      headers: {
        "Content-Type": MIME_BY_EXT[id.split(".")[1]!]!,
        // El id es el hash del contenido: nunca cambia.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  });

  return app;
}
