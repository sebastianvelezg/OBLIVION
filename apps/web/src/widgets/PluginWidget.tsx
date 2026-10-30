import { useQuery } from "@tanstack/react-query";
import { PlugZap, RefreshCw } from "lucide-react";
import type { WidgetData } from "@oblivion/sdk";
import { api } from "../api";
import { ViewRenderer } from "./ViewRenderer";

/** Widget cuyos datos los carga el servidor (plugin) y llegan como vista declarativa. */
export function PluginWidget({ widgetId, refreshSeconds }: { widgetId: string; refreshSeconds: number }) {
  const q = useQuery({
    queryKey: ["widget-data", widgetId],
    queryFn: () => api.get<WidgetData>(`/widgets/${widgetId}/data`),
    refetchInterval: Math.max(5, refreshSeconds) * 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  if (q.isLoading) {
    return (
      <div className="flex size-full flex-col justify-center gap-2" aria-busy>
        <div className="h-8 w-1/2 animate-pulse rounded-lg bg-line" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
      </div>
    );
  }
  const data = q.data;
  const problem = q.isError ? "No se pudo contactar con el servidor" : data && !data.ok ? data.error : null;
  // Si un refresco falla pero ya teníamos datos, el servidor devuelve error; lo mostramos con salida.
  if (problem || !data || !data.ok) {
    return (
      <div className="flex size-full flex-col justify-center gap-2" role="alert">
        <div className="flex items-start gap-2 text-sm text-warn">
          <PlugZap size={17} className="mt-0.5 shrink-0" aria-hidden />
          <p className="min-w-0 [overflow-wrap:anywhere]">{problem}</p>
        </div>
        <button className="btn btn-ghost w-fit px-2 py-1 text-xs" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw size={12} className={q.isFetching ? "animate-spin" : ""} /> Reintentar
        </button>
      </div>
    );
  }
  return <ViewRenderer view={data.view} widgetId={widgetId} />;
}
