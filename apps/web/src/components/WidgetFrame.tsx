import { ExternalLink, GripVertical, Settings2, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { CatalogWidget, WidgetDTO } from "@oblivion/sdk";
import { accentVars } from "../theme";
import { CalculatorWidget } from "../widgets/CalculatorWidget";
import { CalendarWidget } from "../widgets/CalendarWidget";
import { ClockWidget } from "../widgets/ClockWidget";
import { EmbedWidget } from "../widgets/EmbedWidget";
import { GreetingWidget } from "../widgets/GreetingWidget";
import { LinksWidget } from "../widgets/LinksWidget";
import { NotesWidget } from "../widgets/NotesWidget";
import { PluginWidget } from "../widgets/PluginWidget";
import { RemindersWidget } from "../widgets/RemindersWidget";
import { SearchWidget } from "../widgets/SearchWidget";

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
  onEdit,
  onDelete,
}: {
  widget: WidgetDTO;
  def: CatalogWidget | undefined;
  editing: boolean;
  /** El usuario es administrador (puede modificar el contenido de notas, tareas...). */
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
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

  return (
    <div className="card group relative flex size-full flex-col overflow-hidden" style={own as CSSProperties}>
      {editing && (
        <div className="drag-handle flex cursor-grab items-center gap-1 border-b border-line bg-accent-soft px-2 py-1 active:cursor-grabbing">
          <GripVertical size={16} className="text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{def?.name ?? widget.type}</span>
          <button className="btn btn-ghost btn-icon no-drag" onClick={onEdit} aria-label="Configurar widget">
            <Settings2 size={15} />
          </button>
          <button className="btn btn-ghost btn-icon no-drag text-bad" onClick={onDelete} aria-label="Eliminar widget">
            <Trash2 size={15} />
          </button>
        </div>
      )}

      {heading && (
        <div
          className="text-xs font-medium uppercase tracking-wide text-muted"
          style={{ padding: "var(--card-pad) var(--card-pad) 0" }}
        >
          {link && !editing ? (
            <a {...linkProps} className="inline-flex items-center gap-1 transition-colors hover:text-accent-text" title={`Abrir ${link}`}>
              {heading}
              <ExternalLink size={11} aria-hidden />
            </a>
          ) : (
            heading
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

      <div className="min-h-0 flex-1 overflow-auto" style={{ padding: "var(--card-pad)" }}>
        {def ? (
          <Body widget={widget} def={def} editing={editing} canEdit={canEdit} />
        ) : (
          <p className="text-sm text-muted">
            El plugin de este widget (<code>{widget.type}</code>) no está instalado.
          </p>
        )}
      </div>
    </div>
  );
}
