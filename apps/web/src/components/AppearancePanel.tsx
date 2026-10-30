import { RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { DEFAULT_APPEARANCE, PALETTE_IDS, type Appearance, type CardStyle } from "@oblivion/sdk";
import { useAppearance } from "../appearance";
import { ACCENTS, DENSITIES, FONTS, PALETTES, PRESETS, resolvedMode, type Preset } from "../theme";
import { BackgroundEditor } from "./BackgroundEditor";
import { Segmented, Slider } from "./ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-5 py-5 last:border-0">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** Miniatura de un estilo, dibujada con los mismos tokens que usará el dashboard. */
function PresetPreview({ preset, base }: { preset: Preset; base: Appearance }) {
  const a = preset.apply(base);
  const { style, opacity, radius } = a.card;
  const r = Math.max(2, Math.round(radius / 3));
  const bgPct = style === "solid" || style === "brutal" ? 100 : style === "outline" ? 12 : opacity;
  const tile = {
    background: `color-mix(in oklab, var(--surface-solid) ${bgPct}%, transparent)`,
    border:
      style === "brutal"
        ? "2px solid var(--fg)"
        : style === "neon"
          ? "1px solid color-mix(in oklab, var(--accent) 75%, transparent)"
          : `1px solid color-mix(in oklab, var(--fg) ${style === "outline" ? 40 : style === "flat" ? 0 : 20}%, transparent)`,
    borderRadius: r,
    backdropFilter: a.card.blur ? "blur(3px)" : undefined,
    boxShadow:
      style === "brutal"
        ? "3px 3px 0 var(--accent)"
        : style === "neon"
          ? "0 0 10px -2px color-mix(in oklab, var(--accent) 60%, transparent)"
          : a.card.shadow === "none"
            ? "none"
            : "0 4px 8px -4px rgba(0,0,0,.5)",
  } as const;
  const plain = a.background.type === "plain";
  return (
    <div
      className="grid h-16 grid-cols-[1.2fr_1fr] gap-1.5 overflow-hidden rounded-lg p-2"
      style={{
        background: plain
          ? "var(--bg)"
          : "radial-gradient(70% 90% at 0% 0%, color-mix(in oklab, var(--accent) 45%, transparent), transparent), var(--bg)",
        fontFamily: FONTS[a.font].stack,
      }}
    >
      <div style={tile} className="p-1">
        <div className="h-1 w-6 rounded-full bg-accent" />
        <div className="mt-1 h-1 w-8 rounded-full bg-muted/50" />
      </div>
      <div className="grid gap-1.5">
        <div style={tile} />
        <div style={tile} />
      </div>
    </div>
  );
}

export function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { appearance: a, update } = useAppearance();
  const mode = resolvedMode(a);

  const patch = (p: Partial<Appearance>) => update({ ...a, ...p });
  const patchCard = (p: Partial<Appearance["card"]>) => update({ ...a, card: { ...a.card, ...p } });
  const styleHasOpacity = a.card.style !== "solid" && a.card.style !== "brutal";
  const styleHasBlur = ["glass", "outline", "neon"].includes(a.card.style);

  return (
    <aside className="drawer" aria-label="Apariencia">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Apariencia</h2>
          <p className="text-xs text-muted">Los cambios se ven y se guardan al instante.</p>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar panel">
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Estilo">
          <div className="grid grid-cols-2 gap-2.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => update(p.apply(a))}
                className="rounded-xl border border-line bg-surface-2 p-2 text-left transition-colors hover:border-accent"
              >
                <PresetPreview preset={p} base={a} />
                <span className="mt-2 block px-1 text-sm font-medium">{p.name}</span>
                <span className="block px-1 pb-1 text-[11px] leading-tight text-muted">{p.hint}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Color">
          <div>
            <span className="label">Modo</span>
            <Segmented
              value={a.mode}
              onChange={(m) => patch({ mode: m })}
              options={[
                { value: "dark", label: "Oscuro" },
                { value: "light", label: "Claro" },
                { value: "system", label: "Sistema" },
              ]}
            />
          </div>

          <div>
            <span className="label">Paleta</span>
            <div className="grid grid-cols-3 gap-2">
              {PALETTE_IDS.map((id) => {
                const t = PALETTES[id][mode];
                const on = a.palette === id;
                return (
                  <button
                    key={id}
                    onClick={() => patch({ palette: id })}
                    aria-pressed={on}
                    className="rounded-xl border p-1.5 text-left transition-colors"
                    style={{ borderColor: on ? "var(--accent)" : "var(--line)", background: "var(--surface-2)" }}
                  >
                    <span className="flex h-8 overflow-hidden rounded-lg" style={{ background: t.bg }}>
                      <span className="m-1 flex-1 rounded-md" style={{ background: t.solid }} />
                      <span className="m-1 w-3 rounded-md" style={{ background: t.surface2 }} />
                    </span>
                    <span className="mt-1 block px-0.5 text-[11px]">{PALETTES[id].name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="label">Acento</span>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c.value}
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={a.accent.toLowerCase() === c.value}
                  onClick={() => patch({ accent: c.value })}
                  className="size-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ background: c.value, borderColor: a.accent.toLowerCase() === c.value ? "var(--fg)" : "transparent" }}
                />
              ))}
              <label className="ml-1 flex items-center gap-2 text-xs text-muted">
                Otro
                <input
                  type="color"
                  value={a.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-7 w-9 cursor-pointer rounded-md border border-line bg-transparent"
                />
              </label>
            </div>
          </div>
        </Section>

        <Section title="Tarjetas">
          <div>
            <span className="label">Estilo</span>
            <Segmented<CardStyle>
              value={a.card.style}
              onChange={(style) => patchCard({ style })}
              options={[
                { value: "glass", label: "Cristal" },
                { value: "solid", label: "Sólido" },
                { value: "outline", label: "Contorno" },
                { value: "flat", label: "Plano" },
                { value: "neon", label: "Neón" },
                { value: "brutal", label: "Brutal" },
              ]}
            />
          </div>
          {styleHasOpacity && (
            <Slider label="Opacidad" value={a.card.opacity} min={20} max={100} unit="%" onChange={(opacity) => patchCard({ opacity })} />
          )}
          {styleHasBlur && (
            <Slider label="Desenfoque" value={a.card.blur} min={0} max={40} unit="px" onChange={(blur) => patchCard({ blur })} />
          )}
          <Slider label="Redondeo" value={a.card.radius} min={0} max={32} unit="px" onChange={(radius) => patchCard({ radius })} />
          <div>
            <span className="label">Sombra</span>
            <Segmented
              value={a.card.shadow}
              onChange={(shadow) => patchCard({ shadow })}
              options={[
                { value: "none", label: "Ninguna" },
                { value: "soft", label: "Suave" },
                { value: "strong", label: "Fuerte" },
              ]}
            />
          </div>
        </Section>

        <Section title="Fondo">
          <BackgroundEditor value={a.background} onChange={(background) => update({ ...a, background })} />
          <p className="text-[11px] leading-snug text-muted">
            Cada página puede tener su propio fondo: edítalo desde el lápiz de la página (modo Editar).
          </p>
        </Section>

        <Section title="Disposición y letra">
          <div>
            <span className="label">Al mover widgets</span>
            <Segmented
              value={a.layout.free ? "free" : "compact"}
              onChange={(v) => update({ ...a, layout: { free: v === "free" } })}
              options={[
                { value: "compact", label: "Compacto" },
                { value: "free", label: "Libre" },
              ]}
            />
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              Compacto pega los widgets arriba sin dejar huecos. Libre los deja exactamente donde los sueltes.
            </p>
          </div>
          <div>
            <span className="label">Densidad</span>
            <Segmented
              value={a.density}
              onChange={(density) => patch({ density })}
              options={(Object.keys(DENSITIES) as Appearance["density"][]).map((d) => ({ value: d, label: DENSITIES[d].name }))}
            />
          </div>
          <div>
            <span className="label">Tipografía</span>
            <Segmented
              value={a.font}
              onChange={(font) => patch({ font })}
              options={(Object.keys(FONTS) as Appearance["font"][]).map((f) => ({ value: f, label: FONTS[f].name }))}
            />
          </div>
        </Section>
      </div>

      <footer className="flex justify-between border-t border-line px-5 py-3">
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (confirm("¿Restablecer toda la apariencia a los valores por defecto?")) update(DEFAULT_APPEARANCE);
          }}
        >
          <RotateCcw size={15} /> Restablecer
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Listo
        </button>
      </footer>
    </aside>
  );
}
