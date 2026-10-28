import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, MonitorSmartphone, Plus, Trash2, UserPlus, Wand2 } from "lucide-react";
import { useState } from "react";
import type { Role, SessionDTO, SessionUser, UserDTO } from "@oblivion/sdk";
import { api } from "../api";
import { generatePassword, timeAgo } from "../lib/format";
import { SessionList } from "./AccountPanel";
import { Field, toast } from "./ui";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "viewer", label: "Solo lectura", hint: "Ve el dashboard pero no lo modifica" },
  { value: "admin", label: "Administrador", hint: "Edita todo y gestiona usuarios" },
];

/** Datos de acceso que se muestran UNA vez tras crear un usuario o restablecer su contraseña. */
function Credentials({ username, password, onDone }: { username: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-accent bg-accent-soft p-3 text-sm" role="status">
      <p className="font-medium">Comparte estos datos con la persona. La contraseña no se vuelve a mostrar.</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[13px]">
        <span className="text-muted">Usuario</span>
        <span className="select-all">{username}</span>
        <span className="text-muted">Contraseña</span>
        <span className="select-all break-all">{password}</span>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          className="btn px-2.5 py-1 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`Usuario: ${username}\nContraseña: ${password}`);
              setCopied(true);
            } catch {
              toast("No se pudo copiar; selecciónala a mano.");
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar"}
        </button>
        <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={onDone}>
          Entendido
        </button>
      </div>
    </div>
  );
}

function CreateUser({ onCreated }: { onCreated: (username: string, password: string) => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<Role>("viewer");
  const [temporary, setTemporary] = useState(true);

  const create = useMutation({
    mutationFn: () => api.post("/users", { username, password, role, mustChangePassword: temporary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onCreated(username, password);
      setUsername("");
      setPassword(generatePassword());
    },
  });

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Usuario" help="Letras, números, _ . -">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required minLength={3} maxLength={32} />
        </Field>
        <Field label="Rol">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Contraseña inicial" help="Mínimo 12 caracteres. Generada al azar; puedes cambiarla.">
        <div className="flex gap-2">
          <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required minLength={12} />
          <button type="button" className="btn shrink-0" onClick={() => setPassword(generatePassword())} aria-label="Generar otra contraseña">
            <Wand2 size={15} />
          </button>
        </div>
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        Debe cambiarla al entrar por primera vez (recomendado)
      </label>
      {create.error && <p className="text-sm text-bad">{create.error.message}</p>}
      <button className="btn btn-primary" disabled={create.isPending || username.length < 3 || password.length < 12}>
        <UserPlus size={16} /> Crear usuario
      </button>
    </form>
  );
}

function UserRow({ user, me, onCredentials }: { user: UserDTO; me: SessionUser; onCredentials: (u: string, p: string) => void }) {
  const qc = useQueryClient();
  const self = user.id === me.id;
  const [panel, setPanel] = useState<"none" | "sessions" | "reset">("none");
  const [resetPw, setResetPw] = useState(() => generatePassword());

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const setRole = useMutation({
    mutationFn: (role: Role) => api.patch(`/users/${user.id}`, { role }),
    onSuccess: refresh,
    onError: (e) => toast(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, { password: resetPw }),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["user-sessions", user.id] });
      onCredentials(user.username, resetPw);
      setPanel("none");
      setResetPw(generatePassword());
    },
    onError: (e) => toast(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/users/${user.id}`),
    onSuccess: refresh,
    onError: (e) => toast(e.message),
  });

  const sessions = useQuery({
    queryKey: ["user-sessions", user.id],
    queryFn: () => api.get<{ sessions: SessionDTO[] }>(`/users/${user.id}/sessions`),
    enabled: panel === "sessions",
  });
  const revokeOne = useMutation({
    mutationFn: (sid: string) => api.del(`/users/${user.id}/sessions/${sid}`),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["user-sessions", user.id] });
    },
    onError: (e) => toast(e.message),
  });
  const revokeAll = useMutation({
    mutationFn: () => api.del<{ revoked: number }>(`/users/${user.id}/sessions`),
    onSuccess: (r) => {
      refresh();
      qc.invalidateQueries({ queryKey: ["user-sessions", user.id] });
      toast(`Se cerraron ${r.revoked} sesiones de ${user.username}.`, "ok");
    },
    onError: (e) => toast(e.message),
  });

  return (
    <li className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text">
          {user.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{user.username}</span>
            {self && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-normal text-accent-text">Tú</span>}
            {user.mustChangePassword && (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-normal text-warn" title="Aún no ha cambiado la contraseña temporal">
                Contraseña temporal
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {user.sessions > 0 ? `${user.sessions} sesión${user.sessions === 1 ? "" : "es"} · activo ${timeAgo(user.lastSeen)}` : "Sin sesiones activas"}
          </div>
        </div>

        <select
          className="input w-auto py-1.5 text-xs"
          value={user.role}
          disabled={self || setRole.isPending}
          title={self ? "No puedes cambiar tu propio rol" : undefined}
          onChange={(e) => setRole.mutate(e.target.value as Role)}
          aria-label={`Rol de ${user.username}`}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          <button className={`btn btn-icon ${panel === "sessions" ? "" : "btn-ghost"}`} onClick={() => setPanel(panel === "sessions" ? "none" : "sessions")} aria-label={`Sesiones de ${user.username}`} title="Sesiones">
            <MonitorSmartphone size={16} />
          </button>
          {!self && (
            <>
              <button className={`btn btn-icon ${panel === "reset" ? "" : "btn-ghost"}`} onClick={() => setPanel(panel === "reset" ? "none" : "reset")} aria-label={`Restablecer contraseña de ${user.username}`} title="Restablecer contraseña">
                <KeyRound size={16} />
              </button>
              <button
                className="btn btn-ghost btn-icon text-bad"
                aria-label={`Eliminar a ${user.username}`}
                title="Eliminar usuario"
                onClick={() => {
                  if (confirm(`¿Eliminar a «${user.username}»? Se cerrarán sus sesiones y no podrá volver a entrar.`)) remove.mutate();
                }}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {panel === "sessions" && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <SessionList sessions={sessions.data?.sessions ?? []} onRevoke={(sid) => revokeOne.mutate(sid)} busy={revokeOne.isPending} />
          {user.sessions > 0 && !self && (
            <button className="btn btn-danger text-xs" disabled={revokeAll.isPending} onClick={() => revokeAll.mutate()}>
              Cerrar todas sus sesiones
            </button>
          )}
        </div>
      )}

      {panel === "reset" && (
        <form
          className="mt-3 space-y-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <Field label="Nueva contraseña temporal" help="Se cerrarán todas sus sesiones y tendrá que cambiarla al entrar.">
            <div className="flex gap-2">
              <input className="input font-mono" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="off" minLength={12} required />
              <button type="button" className="btn shrink-0" onClick={() => setResetPw(generatePassword())} aria-label="Generar otra contraseña">
                <Wand2 size={15} />
              </button>
            </div>
          </Field>
          <button className="btn btn-primary text-xs" disabled={reset.isPending || resetPw.length < 12}>
            Restablecer contraseña
          </button>
        </form>
      )}
    </li>
  );
}

export function UsersPanel({ me }: { me: SessionUser }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: UserDTO[] }>("/users") });

  const show = (username: string, password: string) => {
    setCreds({ username, password });
    setShowCreate(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          <b className="font-medium text-fg">Administrador</b> edita y gestiona usuarios; <b className="font-medium text-fg">solo lectura</b> únicamente ve el dashboard.
        </p>
        {!showCreate && (
          <button className="btn btn-primary shrink-0" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Usuario
          </button>
        )}
      </div>

      {creds && <Credentials {...creds} onDone={() => setCreds(null)} />}
      {showCreate && <CreateUser onCreated={show} />}

      {users.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {users.error && <p className="text-sm text-bad">{users.error.message}</p>}
      <ul className="space-y-2">
        {(users.data?.users ?? []).map((u) => (
          <UserRow key={u.id} user={u} me={me} onCredentials={show} />
        ))}
      </ul>
    </div>
  );
}
