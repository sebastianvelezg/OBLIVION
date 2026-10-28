import { useState } from "react";
import type { WidgetStyle } from "@oblivion/sdk";
import { ACCENTS } from "../theme";
import { Field, Slider } from "./ui";

/** Rojo «de alerta», útil para destacar un widget concreto. */
const ALERT = { name: "Rojo alerta", value: "#ef4444" };

/** Retoques de aspecto de un widget: título, acento, opacidad y enlace. Sin definir, manda el estilo global. */
export function WidgetStyleFields({
  style,
  onChange,
  linkHint,
}: {
  style: WidgetStyle;
  onChange: (s: WidgetStyle) => void;
  /** Dirección que abrirá el título si no se escribe otra. */
  linkHint?: string;
}) {
  const set = (patch: Partial<WidgetStyle>) => {
    const next = { ...style, ...patch };
    // Un valor `undefined` significa «volver al global».
    for (const k of Object.keys(next) as (keyof WidgetStyle)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const customised = Object.keys(style).length > 0;
  // Abierto solo al empezar si ya había retoques: después lo controla el usuario (no se cierra al volver a «Global»).
  const [startOpen] = useState(customised);
  const accent = style.accent?.toLowerCase();

  return (
    <details className="rounded-xl border border-line bg-surface-2 p-3" open={startOpen}>
      <summary className="cursor-pointer text-sm font-medium">
        Aspecto de este widget {customised && <span className="ml-1 text-xs font-normal text-accent-text">· personalizado</span>}
      </summary>

      <div className="mt-4 space-y-4">
        <Field label="Título en la tarjeta" help="«Automático» solo muestra el título si escribes uno arriba.">
          <select
            className="input"
            value={style.titleMode ?? "auto"}
            onChange={(e) => set({ titleMode: e.target.value === "auto" ? undefined : (e.target.value as WidgetStyle["titleMode"]) })}
          >
            <option value="auto">Automático</option>
            <option value="show">Mostrar siempre (con el nombre del widget si no hay título)</option>
            <option value="hide">Ocultar</option>
          </select>
        </Field>

        <div>
          <span className="label">Color de acento propio</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`btn px-2.5 py-1 text-xs ${accent ? "btn-ghost" : ""}`}
              aria-pressed={!accent}
              onClick={() => set({ accent: undefined })}
            >
              Global
            </button>
            {[...ACCENTS, ALERT].map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.name}
                aria-label={c.name}
                aria-pressed={accent === c.value}
                onClick={() => set({ accent: c.value })}
                className="size-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{ background: c.value, borderColor: accent === c.value ? "var(--fg)" : "transparent" }}
              />
            ))}
            <label className="ml-1 flex items-center gap-2 text-xs text-muted">
              Otro
              <input
                type="color"
                value={style.accent ?? "#7c8cff"}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded-md border border-line bg-transparent"
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
            Opacidad propia del fondo
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={style.opacity !== undefined}
              onChange={(e) => set({ opacity: e.target.checked ? 60 : undefined })}
            />
          </label>
          {style.opacity !== undefined && (
            <Slider label="Opacidad" value={style.opacity} min={10} max={100} unit="%" onChange={(opacity) => set({ opacity })} />
          )}
        </div>

        <Field label="Enlace del título (opcional)" help={linkHint ? `Por defecto abre ${linkHint}` : "Al pulsar el título se abre esta dirección."}>
          <input
            className="input"
            type="url"
            value={style.link ?? ""}
            placeholder="https://…"
            onChange={(e) => set({ link: e.target.value || undefined })}
          />
        </Field>
      </div>
    </details>
  );
}
