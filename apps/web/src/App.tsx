import { useQuery } from "@tanstack/react-query";
import type { SessionUser } from "@oblivion/sdk";
import { api } from "./api";
import { AppearanceProvider } from "./appearance";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { ForcePasswordChange } from "./components/ForcePasswordChange";
import { Toaster } from "./components/ui";

interface AuthStatus {
  setupRequired: boolean;
  setupTokenRequired: boolean;
  user: SessionUser | null;
}

export function App() {
  const status = useQuery({
    queryKey: ["auth"],
    queryFn: () => api.get<AuthStatus>("/auth/status"),
    staleTime: 0,
  });

  let body;
  if (status.isLoading) {
    body = <div className="grid min-h-screen place-items-center text-sm text-muted">Cargando…</div>;
  } else if (status.isError || !status.data) {
    body = (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div className="card max-w-sm p-6">
          <p className="font-medium">No se pudo conectar con el servidor</p>
          <button className="btn btn-primary mt-4" onClick={() => status.refetch()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  } else if (!status.data.user) {
    body = <AuthScreen setup={status.data.setupRequired} needsToken={status.data.setupTokenRequired} />;
  } else if (status.data.user.mustChangePassword) {
    body = <ForcePasswordChange user={status.data.user} />;
  } else {
    body = <Dashboard user={status.data.user} />;
  }

  return (
    <AppearanceProvider user={status.data?.user ?? null}>
      {body}
      <Toaster />
    </AppearanceProvider>
  );
}
