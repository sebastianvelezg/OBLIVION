import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SessionUser } from "@oblivion/sdk";
import { api } from "../api";
import { Field } from "./ui";

/** Pantalla que bloquea el acceso hasta que se cambia una contraseña temporal. */
export function ForcePasswordChange({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  const change = useMutation({
    mutationFn: () => api.post("/auth/password", { current, next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });
  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  const mismatch = again.length > 0 && again !== next;
  const tooShort = next.length > 0 && next.length < 12;
  const same = next.length > 0 && next === current;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mismatch && !tooShort && !same) change.mutate();
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-7">
        <div className="space-y-3">
          <div className="grid size-11 place-items-center rounded-xl bg-accent text-accent-fg">
            <KeyRound size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Elige tu contraseña</h1>
            <p className="mt-1 text-sm text-muted">
              Hola, <b className="text-fg">{user.username}</b>. Entraste con una contraseña temporal: cámbiala por una tuya para continuar.
            </p>
          </div>
        </div>

        <input type="text" value={user.username} autoComplete="username" readOnly hidden />
        <Field label="Contraseña temporal">
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
        </Field>
        <Field label="Contraseña nueva" help="Mínimo 12 caracteres. Una frase larga funciona muy bien.">
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Repite la contraseña nueva">
          <input className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </Field>

        {(change.error || mismatch || tooShort || same) && (
          <p className="text-sm text-bad" role="alert">
            {same
              ? "La contraseña nueva debe ser distinta de la temporal"
              : mismatch
                ? "Las contraseñas no coinciden"
                : tooShort
                  ? "Debe tener al menos 12 caracteres"
                  : change.error!.message}
          </p>
        )}

        <div className="space-y-2">
          <button className="btn btn-primary w-full py-2.5" disabled={change.isPending}>
            {change.isPending ? "Guardando…" : "Guardar y entrar"}
          </button>
          <button type="button" className="btn btn-ghost w-full" onClick={() => logout.mutate()}>
            Cerrar sesión
          </button>
        </div>
      </form>
    </main>
  );
}
