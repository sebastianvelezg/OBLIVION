import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageDTO, WidgetDTO } from "@oblivion/sdk";
import { api } from "../api";
import { toast } from "../components/ui";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Estado editable de un widget (nota, lista...). Se muestra al instante, se
 * guarda en el servidor con una pequeña espera y se vacía al desmontar para no
 * perder lo último que escribiste. Solo el administrador puede guardar.
 */
export function useWidgetState<T>(widget: WidgetDTO, canEdit: boolean) {
  const qc = useQueryClient();
  const [state, setState] = useState<T>(widget.state as T);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const pending = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    setStatus("saving");
    try {
      await api.put(`/widgets/${widget.id}/state`, next);
      // Mantiene la caché al día para que al cambiar de página no reaparezca el valor viejo.
      qc.setQueryData<{ pages: PageDTO[] }>(["pages"], (old) =>
        old && {
          pages: old.pages.map((p) => ({
            ...p,
            widgets: p.widgets.map((w) => (w.id === widget.id ? { ...w, state: next } : w)),
          })),
        },
      );
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      toast("No se pudo guardar: " + (e as Error).message);
    }
  }, [qc, widget.id]);

  const update = useCallback(
    (next: T) => {
      if (!canEdit) return;
      setState(next);
      pending.current = next;
      setStatus("idle");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 700);
    },
    [canEdit, flush],
  );

  // Otro widget (el calendario) puede cambiar este estado: si no hay nada sin guardar aquí, lo seguimos.
  const incoming = widget.state as T;
  useEffect(() => {
    if (pending.current === null) setState((cur) => (cur === incoming ? cur : incoming));
  }, [incoming]);

  useEffect(() => () => void flush(), [flush]);

  return { state, update, status, flush };
}
