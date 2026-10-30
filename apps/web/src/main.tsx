import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-serif";
import { DEFAULT_APPEARANCE } from "@oblivion/sdk";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api";
import { App } from "./App";
import "./styles.css";
import { applyAppearance, loadCachedAppearance } from "./theme";

// Evita el parpadeo de tema: aplica la copia local antes del primer render.
applyAppearance(loadCachedAppearance() ?? DEFAULT_APPEARANCE);

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      // Sesión caducada o cerrada en otra pestaña → volver a la pantalla de acceso.
      if (err instanceof ApiError && err.status === 401) {
        queryClient.invalidateQueries({ queryKey: ["auth"] });
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
