import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import type { CatalogWidget, WidgetDTO } from "@oblivion/sdk";
import { GRID_COLUMNS } from "@oblivion/sdk";
import { useAppearance } from "../appearance";
import { DENSITIES } from "../theme";
import { WidgetFrame } from "./WidgetFrame";

const MOBILE_BREAKPOINT = 700;

export function Grid({
  widgets,
  catalog,
  editing,
  onLayout,
  onEdit,
  onDelete,
}: {
  widgets: WidgetDTO[];
  catalog: Map<string, CatalogWidget>;
  editing: boolean;
  onLayout: (items: { id: string; x: number; y: number; w: number; h: number }[]) => void;
  onEdit: (w: WidgetDTO) => void;
  onDelete: (w: WidgetDTO) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const { canEdit } = useAppearance();
  const { gap: GAP, row: ROW_HEIGHT } = DENSITIES[useAppearance().appearance.density];

  const frame = (w: WidgetDTO) => (
    <WidgetFrame
      widget={w}
      def={catalog.get(w.type)}
      editing={editing}
      canEdit={canEdit}
      onEdit={() => onEdit(w)}
      onDelete={() => onDelete(w)}
    />
  );

  // En móvil: una sola columna, en el orden visual de la grilla. Sin arrastrar.
  if (mounted && width < MOBILE_BREAKPOINT && !editing) {
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <div ref={containerRef} className="flex flex-col gap-3.5">
        {ordered.map((w) => (
          <div key={w.id} style={{ height: Math.max(w.h, 3) * ROW_HEIGHT + (Math.max(w.h, 3) - 1) * GAP }}>
            {frame(w)}
          </div>
        ))}
      </div>
    );
  }

  const layout: Layout = widgets.map((w) => {
    const min = catalog.get(w.type)?.minSize;
    return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: min?.w, minH: min?.h };
  });

  const save = (l: Layout) =>
    onLayout(l.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })));

  return (
    <div ref={containerRef} className={editing ? "editing" : undefined}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLUMNS, rowHeight: ROW_HEIGHT, margin: [GAP, GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: ".drag-handle", cancel: ".no-drag", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["se"] }}
          compactor={verticalCompactor}
          onDragStop={(l) => save(l)}
          onResizeStop={(l) => save(l)}
        >
          {widgets.map((w) => (
            <div key={w.id}>{frame(w)}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
