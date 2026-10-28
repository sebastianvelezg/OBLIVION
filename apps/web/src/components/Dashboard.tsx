import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Palette, Pencil, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CatalogWidget, PageDTO, SessionUser, WidgetDTO } from "@oblivion/sdk";
import { api } from "../api";
import { AppearancePanel } from "./AppearancePanel";
import { Grid } from "./Grid";
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

  useEffect(() => {
    if (!active) return;
    try {
      localStorage.setItem("oblivion.page", active.id);
    } catch {
      /* modo privado */
    }
  }, [active]);

  // ───────── layout ─────────
  const saveLayout = useMutation({
    mutationFn: (v: { pageId: string; items: { id: string; x: number; y: number; w: number; h: number }[] }) =>
      api.put(`/pages/${v.pageId}/layout`, { items: v.items }),
    onError: (e) => {
      toast("No se pudo guardar la disposición: " + e.message);
      qc.invalidateQueries({ queryKey: ["pages"] });
    },
  });

  function onLayout(items: { id: string; x: number; y: number; w: number; h: number }[]) {
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

  if (pagesQ.isLoading || catalogQ.isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted">Cargando…</div>;
  }

  const empty = active && active.widgets.length === 0;

  return (
    <div className="mx-auto min-h-screen max-w-[1500px] px-4 pb-16 pt-5 sm:px-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="mr-1 grid size-9 place-items-center rounded-xl bg-accent text-accent-fg">
          <Logo size={20} />
        </div>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Páginas">
          {pages.map((p) => {
            const on = p.id === active?.id;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                onDoubleClick={() => isAdmin && editing && setDialog({ kind: "page", page: p })}
                aria-current={on ? "page" : undefined}
                className={`whitespace-nowrap rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  on ? "bg-accent-soft text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {p.title}
              </button>
            );
          })}
          {isAdmin && editing && (
            <>
              {active && (
                <button className="btn btn-ghost btn-icon" onClick={() => setDialog({ kind: "page", page: active })} aria-label="Editar página">
                  <Pencil size={15} />
                </button>
              )}
              <button className="btn btn-ghost btn-icon" onClick={() => setDialog({ kind: "page", page: null })} aria-label="Nueva página">
                <Plus size={16} />
              </button>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {isAdmin && editing && (
            <button className="btn btn-primary" onClick={() => setDialog({ kind: "add" })}>
              <Plus size={16} /> Widget
            </button>
          )}
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
          {isAdmin && (
            <button className={`btn ${editing ? "" : "btn-ghost"}`} onClick={() => setEditing((e) => !e)}>
              {editing ? <Check size={16} /> : <Pencil size={16} />}
              {editing ? "Listo" : "Editar"}
            </button>
          )}
          <button className="btn btn-ghost btn-icon" onClick={() => setDialog({ kind: "settings" })} aria-label="Ajustes">
            <Settings size={18} />
          </button>
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
          />
        )}

        {empty && (
          <div className="card mx-auto mt-16 max-w-md p-8 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-2xl">✨</div>
            <h2 className="text-lg font-semibold tracking-tight">Esta página está vacía</h2>
            <p className="mt-1 text-sm text-muted">
              {isAdmin
                ? "Pulsa «Editar» y luego «Widget» para añadir tu primer widget."
                : "El administrador aún no ha añadido widgets."}
            </p>
            {isAdmin && (
              <button
                className="btn btn-primary mt-5"
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
