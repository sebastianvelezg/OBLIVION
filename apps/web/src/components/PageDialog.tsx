import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Appearance, PageDTO } from "@oblivion/sdk";
import { api } from "../api";
import { useAppearance } from "../appearance";
import { BackgroundEditor } from "./BackgroundEditor";
import { Field, Modal } from "./ui";

/** Crear una página nueva o renombrar/eliminar una existente, y darle un fondo propio. */
export function PageDialog({
  page,
  canDelete,
  onDone,
  onClose,
}: {
  page: PageDTO | null;
  canDelete: boolean;
  onDone: (createdId?: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { appearance } = useAppearance();
  const [title, setTitle] = useState(page?.title ?? "");
  const [confirm, setConfirm] = useState(false);
  // Fondo propio: empieza como una copia del general para que sea fácil retocarlo.
  const [own, setOwn] = useState(!!page?.background);
  const [bg, setBg] = useState<Appearance["background"]>(page?.background ?? appearance.background);

  const save = useMutation({
    mutationFn: async () => {
      const background = own ? bg : null;
      if (page) {
        await api.patch(`/pages/${page.id}`, { title, background });
        return undefined;
      }
      const res = await api.post<{ page: PageDTO }>("/pages", { title, background });
      return res.page.id;
    },
    onSuccess: async (createdId) => {
      await qc.invalidateQueries({ queryKey: ["pages"] });
      onDone(createdId);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/pages/${page!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pages"] });
      onDone();
    },
  });

  const error = save.error ?? remove.error;

  return (
    <Modal
      title={page ? "Editar página" : "Nueva página"}
      onClose={onClose}
      footer={
        <>
          {page && canDelete && (
            <button
              className="btn btn-danger mr-auto"
              onClick={() => (confirm ? remove.mutate() : setConfirm(true))}
              disabled={remove.isPending}
            >
              {confirm ? `Confirmar: borrar con ${page.widgets.length} widgets` : "Eliminar página"}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
            Guardar
          </button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save.mutate();
        }}
      >
        <Field label="Nombre">
          <input className="input" value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm">
              Fondo propio
              <span className="block text-xs text-muted">Si lo desactivas, esta página usa el fondo de la apariencia general.</span>
            </span>
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          </label>
          {own && <BackgroundEditor value={bg} onChange={setBg} />}
        </div>

        {error && <p className="text-sm text-bad">{error.message}</p>}
      </form>
    </Modal>
  );
}
