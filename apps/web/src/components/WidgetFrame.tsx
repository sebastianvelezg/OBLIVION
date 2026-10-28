import { GripVertical, Settings2, Trash2 } from "lucide-react";
import type { CatalogWidget, WidgetDTO } from "@oblivion/sdk";
import { CalculatorWidget } from "../widgets/CalculatorWidget";
import { CalendarWidget } from "../widgets/CalendarWidget";
import { ClockWidget } from "../widgets/ClockWidget";
import { EmbedWidget } from "../widgets/EmbedWidget";
import { LinksWidget } from "../widgets/LinksWidget";
import { NotesWidget } from "../widgets/NotesWidget";
import { PluginWidget } from "../widgets/PluginWidget";
import { RemindersWidget } from "../widgets/RemindersWidget";

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
  const heading = widget.title || null;

  return (
    <div className="card relative flex size-full flex-col overflow-hidden">
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
          {heading}
        </div>
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
