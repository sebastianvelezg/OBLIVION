import { Copy, ExternalLink, GripVertical, Settings2, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { CatalogWidget, WidgetDTO } from "@oblivion/sdk";
import { Measured } from "../lib/box";
import { presetFor, sizePresets } from "../lib/sizes";
import { accentVars } from "../theme";
import { CalculatorWidget } from "../widgets/CalculatorWidget";
import { CalendarWidget } from "../widgets/CalendarWidget";
import { ClockWidget } from "../widgets/ClockWidget";
import { EmbedWidget } from "../widgets/EmbedWidget";
import { GreetingWidget } from "../widgets/GreetingWidget";
import { ImageWidget } from "../widgets/ImageWidget";
import { LinksWidget } from "../widgets/LinksWidget";
import { NotesWidget } from "../widgets/NotesWidget";
import { PluginWidget } from "../widgets/PluginWidget";
import { RemindersWidget } from "../widgets/RemindersWidget";
import { SearchWidget } from "../widgets/SearchWidget";
import { WidgetIcon } from "./WidgetIcon";

function Body({
  widget,
  def,
  editing,
  canEdit,
}: {
  widget: WidgetDTO;
  def: CatalogWidget;
  editing: boolean;
  canEdit: boolean;
}) {
  switch (def.component) {
    case "notes":
      return <NotesWidget widget={widget} canEdit={canEdit && !editing} />;
    case "reminders":
      return <RemindersWidget widget={widget} canEdit={canEdit && !editing} />;
    case "clock":
      return <ClockWidget config={widget.config} />;
    case "calendar":
      return <CalendarWidget config={widget.config} />;
    case "calculator":
      return <CalculatorWidget />;
    case "search":
      return <SearchWidget config={widget.config} />;
    case "greeting":
      return <GreetingWidget config={widget.config} />;
    case "links":
      return <LinksWidget config={widget.config} />;
    case "image":
      return <ImageWidget widget={widget} editing={editing} />;
    case "embed":
      return <EmbedWidget config={widget.config} editing={editing} />;
    default:
      if (def.component) return <p className="text-sm text-muted">Componente desconocido</p>;
      return <PluginWidget widgetId={widget.id} refreshSeconds={def.refreshSeconds} />;
  }
}

export function WidgetFrame({
  widget,
  def,
  editing,
  canEdit,
  live,
  onEdit,
  onDelete,
  onDuplicate,
  onResize,
}: {
  widget: WidgetDTO;
  def: CatalogWidget | undefined;
  editing: boolean;
  /** El usuario es administrador (puede modificar el contenido de notas, tareas...). */
  canEdit: boolean;
  /** Tamaño en celdas mientras se está redimensionando (para el indicador). */
  live?: { w: number; h: number } | null;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onResize: (w: number, h: number) => void;
}) {
  // Título: «auto» solo si el usuario escribió uno; «show» cae al nombre del widget; «hide» lo quita.
  const mode = widget.style?.titleMode ?? "auto";
  const heading = mode === "hide" ? null : widget.title || (mode === "show" ? (def?.name ?? null) : null);

  // Retoques propios: se escriben como variables CSS de esta tarjeta (ver styles.css y theme.ts).
  const own: Record<string, string> = {};
  if (widget.style?.accent) {
    const light = document.documentElement.dataset.theme === "light";
    Object.assign(own, accentVars(widget.style.accent, light ? "light" : "dark"));
  }
  if (widget.style?.opacity !== undefined) {
    own["--card-bg"] = `color-mix(in oklab, var(--surface-solid) ${widget.style.opacity}%, transparent)`;
  }

  const link = widget.link;
  const linkProps = { href: link ?? undefined, target: "_blank", rel: "noopener noreferrer" } as const;
  const bare = !!widget.style?.bare;

  const image = widget.style?.image;
  const imageIsInline = def?.component === "image" && widget.config.fit === "contain";
  const blur = widget.style?.imageBlur ?? 0;
  const dim = widget.style?.imageDim ?? 40;

  const presets = def ? sizePresets(def) : [];
  const current = presetFor(presets, widget.w, widget.h);
  const name = widget.title || def?.name || widget.type;

  return (
    <div className="widget-wrap size-full">
    <div
      className={`card widget group flex size-full flex-col overflow-hidden ${bare ? "is-bare" : ""} ${editing ? "is-editing" : ""}`}
      style={own as CSSProperties}
    >
      {image && !imageIsInline && (
        <>
          <div
            className="widget-image"
            style={{
              backgroundImage: `url(/api/appearance/background/${image})`,
              inset: blur > 0 ? `-${blur * 2}px` : 0,
              filter: blur > 0 ? `blur(${blur}px)` : undefined,
            }}
            aria-hidden
          />
          <div
            className="widget-veil"
            style={{ background: `color-mix(in oklab, var(--surface-solid) ${dim}%, transparent)` }}
            aria-hidden
          />
        </>
      )}

      {heading && (
        <div className="widget-head" style={{ padding: "var(--card-pad) var(--card-pad) 0" }}>
          <WidgetIcon emoji={def?.icon} size={15} className="shrink-0 opacity-80" />
          {link && !editing ? (
            <a {...linkProps} className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-accent-text" title={`Abrir ${link}`}>
              <span className="truncate">{heading}</span>
              <ExternalLink size={11} aria-hidden className="shrink-0" />
            </a>
          ) : (
            <span className="truncate">{heading}</span>
          )}
        </div>
      )}

      {/* Sin título visible, el enlace aparece como un icono discreto al pasar el ratón. */}
      {link && !heading && !editing && (
        <a
          {...linkProps}
          className="btn btn-ghost btn-icon absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`Abrir ${def?.name ?? "el servicio"}`}
          title={`Abrir ${link}`}
        >
          <ExternalLink size={14} />
        </a>
      )}

      <div className={`relative min-h-0 flex-1 ${editing ? "pointer-events-none" : ""}`}>
        <Measured
          className="absolute overflow-hidden"
          style={{ inset: heading ? "10px var(--card-pad) var(--card-pad)" : "var(--card-pad)" }}
        >
          {() =>
            def ? (
              <Body widget={widget} def={def} editing={editing} canEdit={canEdit} />
            ) : (
              <p className="text-sm text-muted">
                El plugin de este widget (<code>{widget.type}</code>) no está instalado.
              </p>
            )
          }
        </Measured>
      </div>

      {editing && <div className="edit-veil drag-handle" />}
      {editing && live && (
        <span className="edit-badge">
          {live.w} × {live.h}
        </span>
      )}
    </div>

      {/* La barra de edición «cabalga» sobre el borde superior: así no tapa el contenido. */}
      {editing && (
        <>
          <div className="edit-bar">
            <span className="edit-chip edit-name no-drag min-w-0 cursor-grab">
              <GripVertical size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="truncate">{name}</span>
            </span>
            <span className="pointer-events-none flex-1" />
            {presets.length > 1 && (
              <span className="edit-chip edit-sizes no-drag" role="group" aria-label="Tamaño del widget">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={current?.id === p.id}
                    title={`${p.label} · ${p.w}×${p.h}`}
                    onClick={() => onResize(p.w, p.h)}
                  >
                    {p.short}
                  </button>
                ))}
              </span>
            )}
            <span className="edit-chip no-drag">
              <button type="button" onClick={onDuplicate} aria-label="Duplicar widget" title="Duplicar">
                <Copy size={13} />
              </button>
              <button type="button" onClick={onEdit} aria-label="Configurar widget" title="Configurar">
                <Settings2 size={14} />
              </button>
              <button type="button" className="danger" onClick={onDelete} aria-label="Eliminar widget" title="Eliminar">
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
