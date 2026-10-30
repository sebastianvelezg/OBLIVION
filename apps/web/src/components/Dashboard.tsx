import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutGrid, Magnet, Move, Palette, Pencil, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CatalogWidget, PageDTO, SessionUser, WidgetDTO } from "@oblivion/sdk";
import { api } from "../api";
import { useAppearance } from "../appearance";
import { AppearancePanel } from "./AppearancePanel";
import { Grid, type LayoutItem } from "./Grid";
import { Logo } from "./Logo";
import { PageDialog } from "./PageDialog";
import { SettingsDialog } from "./SettingsDialog";
import { toast } from "./ui";
import { AddWidgetDialog, EditWidgetDialog } from "./WidgetDialog";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; widget: WidgetDTO }
  | { kind: "settings" }
  | { kind: "appearance" }
  | { kind: "page"; page: PageDTO | null }
  | null;

export function Dashboard({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const isAdmin = user.role === "admin";

  const pagesQ = useQuery({ queryKey: ["pages"], queryFn: () => api.get<{ pages: PageDTO[] }>("/pages") });
  const catalogQ = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.get<{ widgets: CatalogWidget[] }>("/catalog"),
    staleTime: Infinity,
  });

  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("oblivion.page");
    } catch {
      return null;
    }
  });

  const pages = pagesQ.data?.pages ?? [];
  const active = pages.find((p) => p.id === activeId) ?? pages[0];
  const catalog = useMemo(() => new Map((catalogQ.data?.widgets ?? []).map((w) => [w.fullType, w])), [catalogQ.data]);

  // El fondo propio de la página activa sustituye al general mientras se la mira.
  const { setPageBackground, appearance, update: updateAppearance } = useAppearance();
  const pageBg = JSON.stringify(active?.background ?? null);
  useEffect(() => {
    setPageBackground(JSON.parse(pageBg));
    return () => setPageBackground(null);
  }, [pageBg, setPageBackground]);

  useEffect(() => {
    if (!active) return;
    try {
      localStorage.setItem("oblivion.page", active.id);
    } catch {
      /* modo privado */
    }
  }, [active]);

  // Esc cierra el modo edición (si hay un diálogo abierto, Esc ya lo cierra a él).
  useEffect(() => {
    if (!editing || dialog) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dialog]);

  // ───────── layout ─────────
  const saveLayout = useMutation({
    mutationFn: (v: { pageId: string; items: LayoutItem[] }) => api.put(`/pages/${v.pageId}/layout`, { items: v.items }),
    onError: (e) => {
      toast("No se pudo guardar la disposición: " + e.message);
      qc.invalidateQueries({ queryKey: ["pages"] });
    },
  });

  function onLayout(items: LayoutItem[]) {
    if (!active) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const changed = active.widgets.some((w) => {
      const n = byId.get(w.id);
      return n && (n.x !== w.x || n.y !== w.y || n.w !== w.w || n.h !== w.h);
    });
    if (!changed) return;
    // Actualización optimista para que no "rebote" mientras se guarda.
    qc.setQueryData<{ pages: PageDTO[] }>(["pages"], (old) =>
      old && {
        pages: old.pages.map((p) =>
          p.id !== active.id ? p : { ...p, widgets: p.widgets.map((w) => ({ ...w, ...(byId.get(w.id) ?? {}) })) },
        ),
      },
    );
    saveLayout.mutate({ pageId: active.id, items });
  }

  const remove = useMutation({
    mutationFn: (w: WidgetDTO) => api.del(`/widgets/${w.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pages"] }),
    onError: (e) => toast(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (w: WidgetDTO) => api.post(`/widgets/${w.id}/duplicate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pages"] }),
    onError: (e) => toast(e.message),
  });

  if (pagesQ.isLoading || catalogQ.isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted">Cargando…</div>;
  }

  const empty = active && active.widgets.length === 0;

  return (
    <div className="mx-auto min-h-screen max-w-[1500px] overflow-x-clip px-4 pb-28 pt-6 sm:px-8">
      <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-1 text-accent" title="Oblivion">
          <Logo size={26} />
        </div>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Páginas">
          {pages.map((p) => {
            const on = p.id === active?.id;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                onDoubleClick={() => isAdmin && editing && setDialog({ kind: "page", page: p })}
                aria-current={on ? "page" : undefined}
                className={`relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors ${
                  on ? "text-fg after:bg-accent" : "text-muted after:bg-transparent hover:text-fg"
                }`}
              >
                {p.title}
              </button>
            );
          })}
          {isAdmin && editing && (
            <>
              {active && (
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => setDialog({ kind: "page", page: active })}
                  aria-label="Editar página"
                  title="Editar página"
                >
                  <Pencil size={15} />
                </button>
              )}
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setDialog({ kind: "page", page: null })}
                aria-label="Nueva página"
                title="Nueva página"
              >
                <Plus size={16} />
              </button>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1.5">
          {isAdmin && (
            <button
              className={`btn btn-icon ${dialog?.kind === "appearance" ? "" : "btn-ghost"}`}
              onClick={() => setDialog(dialog?.kind === "appearance" ? null : { kind: "appearance" })}
              aria-label="Apariencia"
              aria-pressed={dialog?.kind === "appearance"}
              title="Apariencia"
            >
              <Palette size={18} />
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={() => setDialog({ kind: "settings" })} aria-label="Ajustes" title="Ajustes y conexiones">
            <Settings size={18} />
          </button>
          {isAdmin && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              <Pencil size={15} /> Editar
            </button>
          )}
        </div>
      </header>

      <main>
        {active && !empty && (
          <Grid
            widgets={active.widgets}
            catalog={catalog}
            editing={editing && isAdmin}
            onLayout={onLayout}
            onEdit={(w) => setDialog({ kind: "edit", widget: w })}
            onDelete={(w) => {
              if (confirm(`¿Eliminar «${w.title || catalog.get(w.type)?.name || w.type}»?`)) remove.mutate(w);
            }}
            onDuplicate={(w) => duplicate.mutate(w)}
          />
        )}

        {empty && (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-line p-10 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-line text-muted">
              <LayoutGrid size={22} strokeWidth={1.5} />
            </div>
            <h2 className="display text-3xl">Una página en blanco</h2>
            <p className="mt-2 text-sm text-muted">
              {isAdmin
                ? "Añade tu primer widget y colócalo donde quieras. Cada uno se puede hacer pequeño, mediano o grande."
                : "El administrador aún no ha añadido widgets."}
            </p>
            {isAdmin && (
              <button
                className="btn btn-primary mt-6"
                onClick={() => {
                  setEditing(true);
                  setDialog({ kind: "add" });
                }}
              >
                <Plus size={16} /> Añadir widget
              </button>
            )}
          </div>
        )}
      </main>

      {isAdmin && editing && (
        <div className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-3" role="toolbar" aria-label="Edición">
          <div
            className="edit-chip h-auto gap-1 rounded-2xl p-1.5 shadow-xl"
            style={{ background: "color-mix(in oklab, var(--surface-solid) 94%, transparent)" }}
          >
            <span className="hidden items-center gap-1.5 px-2 text-xs font-medium text-muted sm:flex">
              <Move size={13} aria-hidden /> Arrastra, estira los bordes o usa S · M · L
            </span>
            <button
              type="button"
              className="!h-9 !gap-1.5 !px-3 !text-sm"
              aria-pressed={appearance.layout.free}
              title={
                appearance.layout.free
                  ? "Libre: cada widget se queda donde lo sueltes"
                  : "Compacto: los widgets se pegan arriba sin dejar huecos"
              }
              onClick={() => updateAppearance({ ...appearance, layout: { free: !appearance.layout.free } })}
            >
              <Magnet size={14} /> {appearance.layout.free ? "Libre" : "Compacto"}
            </button>
            <button type="button" className="!h-9 !gap-1.5 !px-3 !text-sm" onClick={() => setDialog({ kind: "add" })}>
              <Plus size={15} /> Widget
            </button>
            <button
              type="button"
              className="!h-9 !gap-1.5 !bg-[var(--accent)] !px-4 !text-sm !text-[var(--accent-fg)]"
              onClick={() => setEditing(false)}
            >
              <Check size={15} /> Listo
            </button>
          </div>
        </div>
      )}

      {dialog?.kind === "add" && active && (
        <AddWidgetDialog pageId={active.id} catalog={catalogQ.data?.widgets ?? []} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "edit" && catalog.get(dialog.widget.type) && (
        <EditWidgetDialog widget={dialog.widget} def={catalog.get(dialog.widget.type)!} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "settings" && <SettingsDialog user={user} onClose={() => setDialog(null)} />}
      {dialog?.kind === "appearance" && isAdmin && <AppearancePanel onClose={() => setDialog(null)} />}
      {dialog?.kind === "page" && (
        <PageDialog
          page={dialog.page}
          canDelete={pages.length > 1}
          onClose={() => setDialog(null)}
          onDone={(createdId) => {
            if (createdId) setActiveId(createdId);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
