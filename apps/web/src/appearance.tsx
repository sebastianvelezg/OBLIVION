import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_APPEARANCE, type Appearance, type SessionUser } from "@oblivion/sdk";
import { api } from "./api";
import { Backdrop } from "./components/Backdrop";
import { toast } from "./components/ui";
import { cacheAppearance, loadCachedAppearance, useAppearanceEffect } from "./theme";

interface Ctx {
  appearance: Appearance;
  /** Aplica al instante y guarda en el servidor (con pequeña espera). */
  update: (next: Appearance) => void;
  canEdit: boolean;
  /** Fondo propio de la página que se está viendo (`null`: el general). */
  setPageBackground: (bg: Appearance["background"] | null) => void;
}

const AppearanceContext = createContext<Ctx>({
  appearance: DEFAULT_APPEARANCE,
  update: () => {},
  canEdit: false,
  setPageBackground: () => {},
});
export const useAppearance = () => useContext(AppearanceContext);

/**
 * La apariencia es del dashboard entero (la edita el administrador). Se pinta
 * desde una copia local al instante y se reconcilia con la del servidor.
 */
export function AppearanceProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  const qc = useQueryClient();
  const canEdit = user?.role === "admin";

  const query = useQuery({
    queryKey: ["appearance"],
    queryFn: () => api.get<{ appearance: Appearance }>("/appearance"),
    // Con contraseña temporal el servidor solo admite cambiarla.
    enabled: !!user && !user.mustChangePassword,
  });

  const appearance = query.data?.appearance ?? loadCachedAppearance() ?? DEFAULT_APPEARANCE;
  useAppearanceEffect(appearance);
  useEffect(() => {
    if (query.data) cacheAppearance(query.data.appearance);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (a: Appearance) => api.put("/appearance", a),
    onError: (e) => {
      toast("No se pudo guardar la apariencia: " + e.message);
      qc.invalidateQueries({ queryKey: ["appearance"] });
    },
  });

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = useCallback(
    (next: Appearance) => {
      qc.setQueryData(["appearance"], { appearance: next });
      cacheAppearance(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save.mutate(next), 450);
    },
    [qc, save],
  );

  const [pageBackground, setPageBackground] = useState<Appearance["background"] | null>(null);
  const value = useMemo(
    () => ({ appearance, update, canEdit, setPageBackground }),
    [appearance, update, canEdit],
  );
  const shown = useMemo(
    () => (pageBackground ? { ...appearance, background: pageBackground } : appearance),
    [appearance, pageBackground],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {/* Sin sesión no se puede pedir la foto (el servidor la protege): se usa el fondo base. */}
      <Backdrop appearance={shown} allowImage={!!user} />
      {children}
    </AppearanceContext.Provider>
  );
}
