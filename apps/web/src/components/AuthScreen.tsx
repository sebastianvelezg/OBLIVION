import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Logo } from "./Logo";
import { Field } from "./ui";

export function AuthScreen({ setup, needsToken }: { setup: boolean; needsToken: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      setup
        ? api.post("/auth/setup", { username, password, ...(needsToken ? { token } : {}) })
        : api.post("/auth/login", { username, password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });

  const mismatch = setup && confirm.length > 0 && confirm !== password;
  const tooShort = setup && password.length > 0 && password.length < 12;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch || tooShort) return;
    submit.mutate();
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-5 p-7" autoComplete="on">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-accent text-accent-fg">
              <Logo size={24} />
            </div>
            <span className="text-sm font-semibold tracking-[0.28em] text-muted">OBLIVION</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {setup ? "Crea tu cuenta de administrador" : "Bienvenido de vuelta"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {setup
                ? "Es la primera vez que abres el dashboard. Esta cuenta podrá editarlo todo."
                : "Inicia sesión para ver tu dashboard."}
            </p>
          </div>
        </div>

        <Field label="Usuario">
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>

        <Field
          label="Contraseña"
          help={setup ? "Mínimo 12 caracteres. Una frase larga funciona muy bien." : undefined}
        >
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={setup ? "new-password" : "current-password"}
            required
          />
        </Field>

        {setup && (
          <Field label="Repite la contraseña">
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        )}

        {setup && needsToken && (
          <Field label="Código de configuración" help="El valor de OBLIVION_SETUP_TOKEN en el servidor.">
            <input className="input" value={token} onChange={(e) => setToken(e.target.value)} required />
          </Field>
        )}

        {(submit.error || mismatch || tooShort) && (
          <p className="text-sm text-bad" role="alert">
            {mismatch
              ? "Las contraseñas no coinciden"
              : tooShort
                ? "La contraseña debe tener al menos 12 caracteres"
                : submit.error!.message}
          </p>
        )}

        <button className="btn btn-primary w-full py-2.5" disabled={submit.isPending}>
          {submit.isPending ? "Un momento…" : setup ? "Crear cuenta" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
