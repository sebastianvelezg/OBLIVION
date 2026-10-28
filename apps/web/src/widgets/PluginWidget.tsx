import { useQuery } from "@tanstack/react-query";
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
      <div className="space-y-2" aria-busy>
        <div className="h-8 w-1/2 animate-pulse rounded-lg bg-accent-soft" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-accent-soft" />
      </div>
    );
  }
  if (q.isError) return <p className="text-sm text-bad">No se pudo contactar con el servidor</p>;
  const data = q.data!;
  // Si un refresco falla pero ya teníamos datos, el servidor devuelve error; lo mostramos.
  if (!data.ok) return <p className="text-sm text-warn">{data.error}</p>;
  return <ViewRenderer view={data.view} widgetId={widgetId} />;
}
