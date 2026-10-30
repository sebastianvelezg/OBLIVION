import { useState } from "react";
import ReactGridLayout, { noCompactor, useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import type { CatalogWidget, WidgetDTO, WidgetStyle } from "@oblivion/sdk";
import { GRID_COLUMNS } from "@oblivion/sdk";
import { useAppearance } from "../appearance";
import { resolveCollisions, type LayoutItem } from "../lib/layout";
import { DENSITIES } from "../theme";
import { WidgetFrame } from "./WidgetFrame";

/** Por debajo de este ancho los widgets fluyen en 1–3 columnas (de unos 300 px) en vez de la grilla de 12. */
const FLOW_BREAKPOINT = 1024;
const FLOW_MIN_COLUMN = 300;

export type { LayoutItem };

export function Grid({
  widgets,
  catalog,
  editing,
  onLayout,
  onEdit,
  onDelete,
  onDuplicate,
  onStyle,
}: {
  widgets: WidgetDTO[];
  catalog: Map<string, CatalogWidget>;
  editing: boolean;
  onLayout: (items: LayoutItem[]) => void;
  onEdit: (w: WidgetDTO) => void;
  onDelete: (w: WidgetDTO) => void;
  onDuplicate: (w: WidgetDTO) => void;
  onStyle: (w: WidgetDTO, patch: Partial<WidgetStyle>) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const { canEdit, appearance } = useAppearance();
  const { gap: GAP, row: ROW_HEIGHT } = DENSITIES[appearance.density];
  const free = appearance.layout.free;
  const [live, setLive] = useState<{ id: string; w: number; h: number } | null>(null);

  const current: LayoutItem[] = widgets.map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));

  function applySize(id: string, w: number, h: number) {
    const moved = current.map((it) => (it.id === id ? { ...it, w, h, x: Math.min(it.x, GRID_COLUMNS - w) } : it));
    if (free) return onLayout(resolveCollisions(moved, id));
    const layout = moved.map((it) => ({ i: it.id, x: it.x, y: it.y, w: it.w, h: it.h }));
    onLayout(verticalCompactor.compact(layout, GRID_COLUMNS).map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })));
  }

  const frame = (w: WidgetDTO) => (
    <WidgetFrame
      widget={w}
      def={catalog.get(w.type)}
      editing={editing}
      canEdit={canEdit}
      live={live?.id === w.id ? live : null}
      onEdit={() => onEdit(w)}
      onDelete={() => onDelete(w)}
      onDuplicate={() => onDuplicate(w)}
      onResize={(nw, nh) => applySize(w.id, nw, nh)}
      onStyle={(patch) => onStyle(w, patch)}
    />
  );

  // Pantallas medianas y móviles: los widgets fluyen en el orden visual de la grilla, sin arrastrar.
  // Cada uno ocupa la misma proporción del ancho que en la grilla (los muy anchos, la fila entera).
  if (mounted && width < FLOW_BREAKPOINT && !editing) {
    const cols = Math.max(1, Math.min(3, Math.floor((width + GAP) / (FLOW_MIN_COLUMN + GAP))));
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <div
        ref={containerRef}
        className="flow-grid"
        style={
          {
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            "--flow-row": `${ROW_HEIGHT}px`,
            "--flow-gap": `${GAP}px`,
          } as React.CSSProperties
        }
      >
        {ordered.map((w) => {
          const span = Math.min(cols, Math.max(1, Math.round((w.w / GRID_COLUMNS) * cols)));
          return (
            <div key={w.id} style={{ gridColumn: `span ${span}`, gridRow: `span ${Math.max(w.h, 2)}` }}>
              {frame(w)}
            </div>
          );
        })}
      </div>
    );
  }

  const layout: Layout = widgets.map((w) => {
    const min = catalog.get(w.type)?.minSize;
    return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: min?.w, minH: min?.h };
  });

  const save = (l: Layout) => onLayout(l.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })));

  // Guías: un punto en el centro de cada celda mientras se edita.
  const colW = (width - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const guides: React.CSSProperties = editing
    ? {
        backgroundSize: `${colW + GAP}px ${ROW_HEIGHT + GAP}px`,
        backgroundPosition: `${colW / 2}px ${ROW_HEIGHT / 2}px`,
        minHeight: "70vh",
      }
    : {};

  return (
    <div ref={containerRef} className={editing ? "grid-guides" : undefined} style={guides}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLUMNS, rowHeight: ROW_HEIGHT, margin: [GAP, GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: ".drag-handle", cancel: ".no-drag", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["se", "sw", "ne", "nw", "n", "s", "e", "w"] }}
          compactor={free ? noCompactor : verticalCompactor}
          onResizeStart={(_l, _o, n) => n && setLive({ id: n.i, w: n.w, h: n.h })}
          onResize={(_l, _o, n) => n && setLive({ id: n.i, w: n.w, h: n.h })}
          onDragStop={(l) => save(l)}
          onResizeStop={(l) => {
            setLive(null);
            save(l);
          }}
        >
          {widgets.map((w) => (
            <div key={w.id}>{frame(w)}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
