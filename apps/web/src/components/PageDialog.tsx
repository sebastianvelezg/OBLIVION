import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PageDTO } from "@oblivion/sdk";
import { api } from "../api";
import { Field, Modal } from "./ui";

/** Crear una página nueva o renombrar/eliminar una existente. */
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
  const [title, setTitle] = useState(page?.title ?? "");
  const [confirm, setConfirm] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (page) {
        await api.patch(`/pages/${page.id}`, { title });
        return undefined;
      }
      const res = await api.post<{ page: PageDTO }>("/pages", { title });
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
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save.mutate();
        }}
      >
        <Field label="Nombre">
          <input className="input" value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {error && <p className="mt-3 text-sm text-bad">{error.message}</p>}
      </form>
    </Modal>
  );
}
