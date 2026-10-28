import { Plus, Trash2 } from "lucide-react";
import type { Field as FieldDef } from "@oblivion/sdk";
import { Field } from "./ui";

type Values = Record<string, any>;

/**
 * Formulario generado a partir de los campos que declara el widget/plugin.
 * Los secretos nunca se precargan: si ya hay uno guardado se indica y solo se
 * envía si el usuario escribe uno nuevo (o lo borra explícitamente con `null`).
 */
export function ConfigForm({
  fields,
  values,
  onChange,
  secretsSet = [],
}: {
  fields: FieldDef[];
  values: Values;
  onChange: (v: Values) => void;
  secretsSet?: string[];
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted">Este widget no necesita configuración.</p>;
  }
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(v) => set(f.key, v)}
          secretSaved={secretsSet.includes(f.key)}
        />
      ))}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  secretSaved,
}: {
  field: FieldDef;
  value: any;
  onChange: (v: unknown) => void;
  secretSaved?: boolean;
}) {
  const label = f.label + (f.required ? " *" : "");

  switch (f.type) {
    case "boolean":
      return (
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <span className="text-sm">{f.label}</span>
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      );

    case "select":
      return (
        <Field label={label} help={f.help}>
          <select className="input" value={value ?? f.default ?? ""} onChange={(e) => onChange(e.target.value)}>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      );

    case "text":
      return (
        <Field label={label} help={f.help}>
          <textarea
            className="input min-h-24"
            value={value ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case "number":
      return (
        <Field label={label} help={f.help}>
          <input
            className="input"
            type="number"
            min={f.min}
            max={f.max}
            value={value ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      );

    case "secret":
      return (
        <Field
          label={label}
          help={
            value === null
              ? "Se borrará al guardar."
            : secretSaved
              ? "Ya hay un valor guardado (cifrado). Déjalo vacío para conservarlo."
              : f.help
          }
        >
          <div className="flex gap-2">
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={typeof value === "string" ? value : ""}
              placeholder={secretSaved ? "••••••••••••" : f.placeholder}
              onChange={(e) => onChange(e.target.value)}
            />
            {secretSaved && value !== null && (
              <button type="button" className="btn btn-danger" onClick={() => onChange(null)}>
                Borrar
              </button>
            )}
          </div>
        </Field>
      );

    case "list": {
      const items: Values[] = Array.isArray(value) ? value : [];
      const max = f.maxItems ?? 50;
      return (
        <div>
          <span className="label">{label}</span>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {f.itemFields?.map((sub) => (
                    <FieldInput
                      key={sub.key}
                      field={sub}
                      value={item[sub.key]}
                      onChange={(v) => onChange(items.map((it, j) => (j === i ? { ...it, [sub.key]: v } : it)))}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost mt-2 px-2 py-1 text-xs text-bad"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} /> Quitar
                </button>
              </div>
            ))}
            {items.length < max && (
              <button type="button" className="btn w-full" onClick={() => onChange([...items, {}])}>
                <Plus size={16} /> Añadir
              </button>
            )}
          </div>
          {f.help && <span className="mt-1 block text-xs text-muted">{f.help}</span>}
        </div>
      );
    }

    default:
      return (
        <Field label={label} help={f.help}>
          <input
            className="input"
            type={f.type === "url" ? "url" : "text"}
            value={value ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
  }
}

/** Valores iniciales: los `default` de cada campo. */
export function defaultsFor(fields: FieldDef[]): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === "boolean") out[f.key] = false;
    else if (f.type === "list") out[f.key] = [];
  }
  return out;
}
