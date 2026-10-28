import { z } from "zod";
import type { Field, LeafView, View } from "@oblivion/sdk";

/** Clave opaca de una imagen de `MediaView`: nada que pueda formar rutas o consultas. */
export const IMAGE_KEY = /^[A-Za-z0-9._~-]{1,100}$/;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "usa solo a-z, 0-9 y guiones");
const text = (max: number) => z.string().min(1).max(max);

const fieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    label: text(80),
    type: z.enum(["string", "text", "url", "number", "boolean", "select", "secret", "list"]),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    placeholder: z.string().max(120).optional(),
    help: z.string().max(300).optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).max(100).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    itemFields: z.array(fieldSchema).max(10).optional(),
    maxItems: z.number().int().min(1).max(200).optional(),
  }),
);

const size = z.object({ w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(40) });

export const widgetDefSchema = z.object({
  type: slug,
  name: text(60),
  description: text(200),
  icon: z.string().max(8).optional(),
  defaultSize: size,
  minSize: size.optional(),
  config: z.array(fieldSchema).max(30),
  refreshSeconds: z.number().int().min(5).max(86400).optional(),
  component: z.string().max(40).optional(),
  openLink: z.boolean().optional(),
  load: z.function().optional(),
  image: z.function().optional(),
});

export const pluginDefSchema = z.object({
  id: slug,
  name: text(60),
  version: z.string().max(30),
  description: z.string().max(300).optional(),
  author: z.string().max(80).optional(),
  permissions: z.object({ network: z.array(z.string().max(253)).max(20).optional() }).optional(),
  connection: z.array(fieldSchema).max(10).optional(),
  test: z.function().optional(),
  widgets: z.array(widgetDefSchema).max(50),
});

// ───────────── Validación de lo que devuelve `load()` ─────────────
// Todo son cadenas/números con longitud acotada: el navegador las pinta como
// texto, nunca como HTML, pero igualmente limitamos el tamaño.

const short = z.string().max(300);
const tone = z.enum(["neutral", "good", "warn", "bad"]);

const leafSchema: z.ZodType<LeafView> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metric"),
    icon: z.string().max(8).optional(),
    value: short,
    unit: z.string().max(20).optional(),
    caption: short.optional(),
    rows: z.array(z.object({ label: short, value: short })).max(12).optional(),
    strip: z
      .array(z.object({ label: short, value: short, icon: z.string().max(8).optional() }))
      .max(10)
      .optional(),
  }),
  z.object({
    kind: z.literal("stats"),
    items: z
      .array(z.object({ label: short, value: short, hint: short.optional(), tone: tone.optional() }))
      .max(24),
  }),
  z.object({
    kind: z.literal("list"),
    empty: short.optional(),
    items: z
      .array(
        z.object({
          title: short,
          subtitle: short.optional(),
          right: short.optional(),
          progress: z.number().min(0).max(1).optional(),
          tone: tone.optional(),
          // Solo http(s): nada de `javascript:` ni `data:` aunque el texto venga de un feed ajeno.
          href: z.string().max(500).regex(/^https?:\/\//i).optional(),
        }),
      )
      .max(50),
  }),
  z.object({ kind: z.literal("message"), tone: tone.optional(), text: z.string().max(500) }),
  z.object({
    kind: z.literal("chart"),
    unit: z.string().max(20).optional(),
    labels: z.array(z.string().max(40)).max(200).optional(),
    series: z.array(z.object({ name: short, points: z.array(z.number()).max(200) })).min(1).max(4),
    caption: short.optional(),
  }),
  z.object({
    kind: z.literal("media"),
    empty: short.optional(),
    items: z
      .array(
        z.object({
          title: short,
          subtitle: short.optional(),
          image: z.string().regex(IMAGE_KEY).optional(),
          badge: z.string().max(24).optional(),
          progress: z.number().min(0).max(1).optional(),
        }),
      )
      .max(50),
  }),
]);

export const viewSchema: z.ZodType<View> = z.union([
  leafSchema,
  z.object({
    kind: z.literal("sections"),
    sections: z.array(z.object({ title: short.optional(), view: leafSchema })).min(1).max(6),
  }),
]);
