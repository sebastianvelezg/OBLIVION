import { z } from "zod";
import { ConfigError } from "./config.js";

/**
 * Estado editable dentro del propio widget (el texto de una nota, la lista de
 * recordatorios...). Es distinto de la *configuración*: se guarda desde el
 * widget sin entrar al modo edición, y se valida con un esquema por componente.
 */
const notesState = z.object({
  text: z.string().max(20_000),
});

const dueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Fecha inválida")
  .nullable();

const remindersState = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        text: z.string().trim().min(1).max(200),
        done: z.boolean(),
        due: dueSchema,
        createdAt: z.number().int().nonnegative(),
      }),
    )
    .max(200),
});

const VALIDATORS: Record<string, { schema: z.ZodType<any>; empty: unknown }> = {
  notes: { schema: notesState, empty: { text: "" } },
  reminders: { schema: remindersState, empty: { items: [] } },
};

export function isStateful(component: string | undefined): boolean {
  return !!component && component in VALIDATORS;
}

export function emptyState(component: string | undefined): unknown {
  return component && VALIDATORS[component] ? VALIDATORS[component]!.empty : {};
}

export function validateState(component: string | undefined, input: unknown): unknown {
  const v = component ? VALIDATORS[component] : undefined;
  if (!v) throw new ConfigError("Este widget no guarda estado");
  const parsed = v.schema.safeParse(input);
  if (!parsed.success) throw new ConfigError(parsed.error.issues[0]?.message ?? "Datos inválidos");
  return parsed.data;
}
