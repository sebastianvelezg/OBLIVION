import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plug, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogWidget, ConnectionDTO, Field as FieldDef } from "@oblivion/sdk";
import { api } from "../api";
import { ConfigForm, defaultsFor } from "./ConfigForm";
import { Field, toast } from "./ui";

/** Plugins que piden conexión, con sus campos (se deducen del catálogo). */
export function connectionPlugins(catalog: CatalogWidget[]) {
  const out = new Map<string, { id: string; name: string; fields: FieldDef[]; testable: boolean }>();
  for (const w of catalog) {
    if (w.connection.length > 0 && !out.has(w.pluginId)) {
      out.set(w.pluginId, { id: w.pluginId, name: w.pluginName, fields: w.connection, testable: w.testable });
    }
  }
  return [...out.values()];
}

/** Lista de conexiones (solo administrador). */
export function useConnections(enabled = true) {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => api.get<{ connections: ConnectionDTO[] }>("/connections"),
    enabled,
  });
}

/** Botón «Probar conexión»: usa lo que hay escrito en el formulario (los secretos en blanco usan los guardados). */
export function TestConnection({ pluginId, id, values }: { pluginId: string; id?: string; values: Record<string, any> }) {
  const test = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; message: string } | { ok: false; error: string }>("/connections/test", {
        pluginId,
        id,
        config: values,
      }),
  });
  const result = test.data;

  return (
    <div className="space-y-2">
      <button type="button" className="btn" onClick={() => test.mutate()} disabled={test.isPending}>
        <Plug size={15} /> {test.isPending ? "Probando…" : "Probar conexión"}
      </button>
      <div aria-live="polite">
        {result?.ok === true && (
          <p className="flex items-start gap-1.5 text-sm text-good">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {result.message}
          </p>
        )}
        {result?.ok === false && (
          <p className="flex items-start gap-1.5 text-sm text-bad">
            <XCircle size={16} className="mt-0.5 shrink-0" /> {result.error}
          </p>
        )}
        {test.error && (
          <p className="flex items-start gap-1.5 text-sm text-bad">
            <XCircle size={16} className="mt-0.5 shrink-0" /> {test.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** Nombre + campos de una conexión: lo usan el panel de ajustes y el diálogo del widget. */
export function ConnectionFields({
  fields,
  name,
  onName,
  values,
  onValues,
  secretsSet,
  test,
}: {
  fields: FieldDef[];
  name: string;
  onName: (v: string) => void;
  values: Record<string, any>;
  onValues: (v: Record<string, any>) => void;
  secretsSet?: string[];
  /** Si se indica, se ofrece «Probar conexión» (el plugin debe saber probarla). */
  test?: { pluginId: string; id?: string };
}) {
  return (
    <div className="space-y-4">
      <Field label="Nombre" help="Para distinguirla si tienes más de una (p. ej. «Jellyfin del salón»).">
        <input className="input" value={name} maxLength={60} onChange={(e) => onName(e.target.value)} />
      </Field>
      <ConfigForm fields={fields} values={values} onChange={onValues} secretsSet={secretsSet} />
      {test && <TestConnection pluginId={test.pluginId} id={test.id} values={values} />}
    </div>
  );
}

function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["connections"] });
    qc.invalidateQueries({ queryKey: ["connection-status"] });
    qc.invalidateQueries({ queryKey: ["pages"] });
    // Los widgets que usan la conexión vuelven a pedir sus datos.
    qc.invalidateQueries({ queryKey: ["widget-data"] });
  };
}

function NewConnection({ plugins, onDone }: { plugins: ReturnType<typeof connectionPlugins>; onDone: () => void }) {
  const refresh = useRefreshAll();
  const [pluginId, setPluginId] = useState(plugins[0]?.id ?? "");
  const plugin = plugins.find((p) => p.id === pluginId);
  const [name, setName] = useState(plugins[0]?.name ?? "");
  const [values, setValues] = useState<Record<string, any>>(() => defaultsFor(plugins[0]?.fields ?? []));

  const create = useMutation({
    mutationFn: () => api.post("/connections", { pluginId, name, config: values }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });

  function pick(id: string) {
    const p = plugins.find((x) => x.id === id);
    setPluginId(id);
    setName(p?.name ?? "");
    setValues(defaultsFor(p?.fields ?? []));
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-line bg-surface-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Servicio">
        <select className="input" value={pluginId} onChange={(e) => pick(e.target.value)}>
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {plugin && (
        <ConnectionFields
          fields={plugin.fields}
          name={name}
          onName={setName}
          values={values}
          onValues={setValues}
          test={plugin.testable ? { pluginId: plugin.id } : undefined}
        />
      )}
      {create.error && <p className="text-sm text-bad" role="alert">{create.error.message}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Guardando…" : "Guardar conexión"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ConnectionRow({
  conn,
  fields,
  pluginName,
  testable,
}: {
  conn: ConnectionDTO;
  fields: FieldDef[];
  pluginName: string;
  testable: boolean;
}) {
  const refresh = useRefreshAll();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(conn.name);
  const [values, setValues] = useState<Record<string, any>>({ ...defaultsFor(fields), ...conn.config });

  const save = useMutation({
    mutationFn: () => api.patch(`/connections/${conn.id}`, { name, config: values }),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/connections/${conn.id}`),
    onSuccess: refresh,
    onError: (e) => toast(e.message),
  });

  const url = typeof conn.config.url === "string" ? conn.config.url : "";

  // Al abrir el panel cada conexión se prueba sola: de un vistazo se ve cuáles funcionan.
  const status = useQuery({
    queryKey: ["connection-status", conn.id, JSON.stringify(conn.config)],
    queryFn: () =>
      api.post<{ ok: true; message: string } | { ok: false; error: string }>("/connections/test", {
        pluginId: conn.pluginId,
        id: conn.id,
        config: conn.config,
      }),
    enabled: testable,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const state: "unknown" | "checking" | "ok" | "bad" = !testable
    ? "unknown"
    : status.isFetching
      ? "checking"
      : status.data?.ok
        ? "ok"
        : status.data || status.isError
          ? "bad"
          : "unknown";
  const statusText = status.data?.ok === true ? status.data.message : status.data?.ok === false ? status.data.error : status.error?.message;
  const dot = { unknown: "bg-muted/40", checking: "animate-pulse bg-muted", ok: "bg-good", bad: "bg-bad" }[state];

  return (
    <li className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
          <Plug size={17} />
          <span className={`absolute -right-0.5 -top-0.5 size-3 rounded-full ring-2 ring-[var(--surface-2)] ${dot}`} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{conn.name}</div>
          <div className="truncate text-xs text-muted">
            {pluginName}
            {url && <> · {url.replace(/\/$/, "")}</>} · {conn.widgets === 0 ? "sin widgets" : `${conn.widgets} widget${conn.widgets === 1 ? "" : "s"}`}
          </div>
          {state === "ok" && <div className="mt-0.5 truncate text-xs text-good">{statusText}</div>}
          {state === "bad" && <div className="mt-0.5 text-xs text-bad [overflow-wrap:anywhere]">{statusText}</div>}
          {state === "checking" && <div className="mt-0.5 text-xs text-muted">Probando…</div>}
        </div>
        <div className="flex gap-1">
          {testable && (
            <button className="btn btn-ghost btn-icon" onClick={() => status.refetch()} disabled={status.isFetching} aria-label={`Probar ${conn.name}`} title="Probar de nuevo">
              <RefreshCw size={15} className={status.isFetching ? "animate-spin" : ""} />
            </button>
          )}
          <button
            className={`btn btn-icon ${editing ? "" : "btn-ghost"}`}
            onClick={() => {
              // Al abrir se parte siempre de lo guardado (no de una edición anterior sin guardar).
              if (!editing) {
                setName(conn.name);
                setValues({ ...defaultsFor(fields), ...conn.config });
              }
              setEditing((e) => !e);
            }}
            aria-label={`Editar ${conn.name}`}
            title="Editar"
          >
            <Pencil size={16} />
          </button>
          <button
            className="btn btn-ghost btn-icon text-bad"
            aria-label={`Eliminar ${conn.name}`}
            title="Eliminar"
            onClick={() => {
              if (confirm(`¿Eliminar la conexión «${conn.name}»?`)) remove.mutate();
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {editing && (
        <form
          className="mt-3 space-y-4 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ConnectionFields
            fields={fields}
            name={name}
            onName={setName}
            values={values}
            onValues={setValues}
            secretsSet={conn.secretsSet}
            test={testable ? { pluginId: conn.pluginId, id: conn.id } : undefined}
          />
          {save.error && <p className="text-sm text-bad" role="alert">{save.error.message}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={save.isPending || !name.trim()}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function ConnectionsPanel() {
  const conns = useConnections();
  const catalogQ = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.get<{ widgets: CatalogWidget[] }>("/catalog"),
    staleTime: Infinity,
  });
  const plugins = useMemo(() => connectionPlugins(catalogQ.data?.widgets ?? []), [catalogQ.data]);
  const [creating, setCreating] = useState(false);
  const list = conns.data?.connections ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          Una conexión guarda la URL y las credenciales de un servicio <b className="font-medium text-fg">una sola vez</b>:
          todos los widgets de ese servicio la comparten. Las claves se guardan cifradas y nunca llegan al navegador.
        </p>
        {!creating && plugins.length > 0 && (
          <button className="btn btn-primary shrink-0" onClick={() => setCreating(true)}>
            <Plus size={16} /> Conexión
          </button>
        )}
      </div>

      {creating && <NewConnection plugins={plugins} onDone={() => setCreating(false)} />}

      {conns.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {conns.error && <p className="text-sm text-bad">{conns.error.message}</p>}
      {!conns.isLoading && list.length === 0 && !creating && (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Aún no hay conexiones. Se crean aquí o al añadir tu primer widget de Jellyfin o Speedtest Tracker.
        </p>
      )}
      <ul className="space-y-2">
        {list.map((c) => {
          const plugin = plugins.find((p) => p.id === c.pluginId);
          return (
            <ConnectionRow
              key={c.id}
              conn={c}
              fields={plugin?.fields ?? []}
              pluginName={plugin?.name ?? c.pluginId}
              testable={plugin?.testable ?? false}
            />
          );
        })}
      </ul>
    </div>
  );
}
