import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor } from "lucide-react";
import { useState } from "react";
import type { SessionDTO, SessionUser } from "@oblivion/sdk";
import { api } from "../api";
import { describeAgent, timeAgo } from "../lib/format";
import { Field, toast } from "./ui";

/** Lista de sesiones con botón para cerrarlas (las propias o las de otro usuario). */
export function SessionList({
  sessions,
  onRevoke,
  busy,
}: {
  sessions: SessionDTO[];
  onRevoke: (id: string) => void;
  busy?: boolean;
}) {
  if (sessions.length === 0) return <p className="text-sm text-muted">Sin sesiones activas.</p>;
  return (
    <ul className="space-y-1.5">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <Monitor size={18} className="shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {describeAgent(s.userAgent)}
              {s.current && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-text">Esta sesión</span>}
            </div>
            <div className="truncate text-xs text-muted">
              {s.ip ?? "IP desconocida"} · activa {timeAgo(s.lastSeen)}
            </div>
          </div>
          <button className="btn btn-ghost px-2 py-1 text-xs text-bad" disabled={busy} onClick={() => onRevoke(s.id)}>
            Cerrar
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AccountPanel({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: () => api.get<{ sessions: SessionDTO[] }>("/auth/sessions") });

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  const change = useMutation({
    mutationFn: () => api.post("/auth/password", { current, next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setAgain("");
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
      toast("Contraseña actualizada. Las demás sesiones se cerraron.", "ok");
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: (_d, id) => {
      // Si cerraste la tuya, el servidor limpia la cookie: volvemos al login.
      if (sessions.data?.sessions.find((s) => s.id === id)?.current) {
        qc.clear();
        qc.invalidateQueries({ queryKey: ["auth"] });
      } else qc.invalidateQueries({ queryKey: ["my-sessions"] });
    },
    onError: (e) => toast(e.message),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>("/auth/sessions/revoke-others"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
      toast(r.revoked ? `Se cerraron ${r.revoked} sesiones.` : "No había otras sesiones.", "ok");
    },
  });

  const mismatch = again.length > 0 && again !== next;
  const canChange = current && next.length >= 12 && next === again;
  const others = (sessions.data?.sessions ?? []).filter((s) => !s.current).length;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Cambiar contraseña</h3>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canChange) change.mutate();
          }}
        >
          <input type="text" value={user.username} autoComplete="username" readOnly hidden />
          <Field label="Contraseña actual">
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Nueva contraseña" help="Mínimo 12 caracteres.">
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repite la nueva contraseña">
            <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {mismatch && <p className="text-sm text-bad">Las contraseñas no coinciden</p>}
          {change.error && <p className="text-sm text-bad">{change.error.message}</p>}
          <button className="btn" disabled={!canChange || change.isPending}>
            Actualizar contraseña
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Mis sesiones</h3>
            <p className="text-xs text-muted">Dispositivos donde has iniciado sesión. Cierra los que no reconozcas.</p>
          </div>
          {others > 0 && (
            <button className="btn shrink-0 text-xs" disabled={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
              Cerrar las demás ({others})
            </button>
          )}
        </div>
        <SessionList sessions={sessions.data?.sessions ?? []} onRevoke={(id) => revoke.mutate(id)} busy={revoke.isPending} />
      </section>

      <section className="flex items-center justify-between border-t border-line pt-5">
        <div className="text-sm">
          <div className="font-medium">{user.username}</div>
          <div className="text-xs text-muted">{user.role === "admin" ? "Administrador" : "Solo lectura"}</div>
        </div>
        <button className="btn btn-danger" onClick={() => logout.mutate()}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </section>
    </div>
  );
}
