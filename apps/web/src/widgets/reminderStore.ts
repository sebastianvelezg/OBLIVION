import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PageDTO } from "@oblivion/sdk";
import { api } from "../api";
import { toast } from "../components/ui";

/** Un recordatorio. Lo comparten el widget de Pendientes y el Calendario. */
export interface Item {
  id: string;
  text: string;
  done: boolean;
  due: string | null; // YYYY-MM-DD o YYYY-MM-DDTHH:mm
  createdAt: number;
}

export const MAX_ITEMS = 200;

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type Urgency = "overdue" | "today" | "tomorrow" | "later" | "none";

export function urgency(due: string | null, now: Date): Urgency {
  if (!due) return "none";
  const day = due.slice(0, 10);
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (due.length > 10 && new Date(due) < now) return "overdue";
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day === tomorrow) return "tomorrow";
  return "later";
}

export function dueLabel(item: Item, u: Urgency): string {
  const time = item.due && item.due.length > 10 ? item.due.slice(11) : "";
  if (u === "today") return time ? `Hoy ${time}` : "Hoy";
  if (u === "tomorrow") return time ? `Mañana ${time}` : "Mañana";
  if (u === "overdue" && item.due && item.due.slice(0, 10) === ymd(new Date())) return `Venció ${time}`;
  const d = new Date(item.due!.slice(0, 10) + "T12:00:00");
  const text = d.toLocaleDateString("es", { day: "numeric", month: "short" });
  return time ? `${text} ${time}` : text;
}

export const tone: Record<Urgency, string> = {
  overdue: "bg-bad/15 text-bad",
  today: "bg-warn/15 text-warn",
  tomorrow: "bg-accent-soft text-fg",
  later: "bg-accent-soft text-muted",
  none: "",
};

export const newItem = (text: string, due: string | null): Item => ({
  id: crypto.randomUUID().slice(0, 8),
  text: text.trim().slice(0, 200),
  done: false,
  due,
  createdAt: Date.now(),
});

// ───────────── varias listas, un solo sitio donde leer y escribir ─────────────

export interface ReminderList {
  id: string;
  title: string;
  items: Item[];
}

const itemsOf = (state: unknown): Item[] => {
  const items = (state as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Item[]) : [];
};

/**
 * Todas las listas de recordatorios del dashboard (de cualquier página), tal como están en la caché de
 * páginas. Con `only` se limita a una. El calendario las junta para marcar los días.
 */
export function useReminderLists(only?: string, enabled = true): ReminderList[] {
  // Solo observa la caché que ya carga el dashboard: no vuelve a pedir nada al servidor.
  const q = useQuery({ queryKey: ["pages"], enabled: false, queryFn: () => api.get<{ pages: PageDTO[] }>("/pages") });
  const pages = q.data?.pages;
  return useMemo(() => {
    const out: ReminderList[] = [];
    if (!enabled) return out;
    for (const p of pages ?? [])
      for (const w of p.widgets)
        if (w.type === "core.reminders" && (!only || w.id === only)) out.push({ id: w.id, title: w.title || "Pendientes", items: itemsOf(w.state) });
    return out;
  }, [pages, only, enabled]);
}

/** Lo que hay ahora mismo en una lista (leído de la caché, no de lo último que se pintó). */
export function currentItems(qc: QueryClient, listId: string): Item[] {
  const pages = qc.getQueryData<{ pages: PageDTO[] }>(["pages"])?.pages ?? [];
  for (const p of pages) for (const w of p.widgets) if (w.id === listId) return itemsOf(w.state);
  return [];
}

/** Guarda la lista: se ve al instante en todos los widgets y se envía al servidor. */
export async function saveItems(qc: QueryClient, listId: string, items: Item[]) {
  const state = { items };
  qc.setQueryData<{ pages: PageDTO[] }>(
    ["pages"],
    (old) => old && { pages: old.pages.map((p) => ({ ...p, widgets: p.widgets.map((w) => (w.id === listId ? { ...w, state } : w)) })) },
  );
  try {
    await api.put(`/widgets/${listId}/state`, state);
  } catch (e) {
    toast("No se pudo guardar: " + (e as Error).message);
    qc.invalidateQueries({ queryKey: ["pages"] });
  }
}
