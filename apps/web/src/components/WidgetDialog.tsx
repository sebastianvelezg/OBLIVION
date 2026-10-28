import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CatalogWidget, WidgetDTO, WidgetStyle } from "@oblivion/sdk";
import { api } from "../api";
import { ConfigForm, defaultsFor } from "./ConfigForm";
import { ConnectionFields, useConnections } from "./ConnectionsPanel";
import { WidgetStyleFields } from "./WidgetStyleFields";
import { Field, Modal } from "./ui";

/** Elegir un widget del catálogo y configurarlo. */
export function AddWidgetDialog({
  pageId,
  catalog,
  onClose,
}: {
  pageId: string;
  catalog: CatalogWidget[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<CatalogWidget | null>(null);
  const groups = Object.entries(
    catalog.reduce<Record<string, CatalogWidget[]>>((acc, w) => {
      (acc[w.pluginName] ??= []).push(w);
      return acc;
    }, {}),
  );

  if (picked) {
    return <ConfigureDialog mode="add" pageId={pageId} def={picked} onBack={() => setPicked(null)} onClose={onClose} />;
  }

  return (
    <Modal title="Añadir widget" onClose={onClose} wide>
      <div className="space-y-6">
        {groups.map(([plugin, widgets]) => (
          <section key={plugin}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{plugin}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {widgets.map((w) => (
                <button
                  key={w.fullType}
                  onClick={() => setPicked(w)}
                  className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent"
                >
                  <span className="text-2xl">{w.icon ?? "🧩"}</span>
                  <span>
                    <span className="block text-sm font-medium">{w.name}</span>
                    <span className="block text-xs text-muted">{w.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function EditWidgetDialog({
  widget,
  def,
  onClose,
}: {
  widget: WidgetDTO;
  def: CatalogWidget;
  onClose: () => void;
}) {
  return <ConfigureDialog mode="edit" widget={widget} def={def} onClose={onClose} />;
}

type Props =
  | { mode: "add"; pageId: string; def: CatalogWidget; onBack: () => void; onClose: () => void }
  | { mode: "edit"; widget: WidgetDTO; def: CatalogWidget; onClose: () => void };

const NEW = "new";

function ConfigureDialog(props: Props) {
  const { def, onClose } = props;
  const qc = useQueryClient();
  const editing = props.mode === "edit";
  const usesConnection = def.connection.length > 0;
  const [title, setTitle] = useState(editing ? props.widget.title : "");
  const [values, setValues] = useState<Record<string, any>>(() => ({
    ...defaultsFor(def.config),
    ...(editing ? props.widget.config : {}),
  }));

  const [style, setStyle] = useState<WidgetStyle>(editing ? (props.widget.style ?? {}) : {});

  // Conexión: una existente del mismo plugin o una nueva que se crea al guardar.
  const connsQ = useConnections(usesConnection);
  const existing = (connsQ.data?.connections ?? []).filter((c) => c.pluginId === def.pluginId);
  const [picked, setPicked] = useState<string | null>(editing ? props.widget.connectionId : null);
  const connectionId = picked ?? existing[0]?.id ?? NEW;
  const [newName, setNewName] = useState(def.pluginName);
  const [newValues, setNewValues] = useState<Record<string, any>>(() => defaultsFor(def.connection));

  const save = useMutation({
    mutationFn: async () => {
      let useId: string | undefined;
      if (usesConnection) {
        if (connectionId === NEW) {
          const made = await api.post<{ connection: { id: string } }>("/connections", {
            pluginId: def.pluginId,
            name: newName,
            config: newValues,
          });
          useId = made.connection.id;
        } else {
          useId = connectionId;
        }
      }
      return editing
        ? api.patch(`/widgets/${props.widget.id}`, { title, config: values, connectionId: useId, style })
        : api.post(`/pages/${props.pageId}/widgets`, { type: def.fullType, title, config: values, connectionId: useId, style });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["connections"] }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pages"] });
      if (editing) qc.invalidateQueries({ queryKey: ["widget-data", props.widget.id] });
      onClose();
    },
  });

  return (
    <Modal
      title={editing ? `Configurar ${def.name}` : `Nuevo widget: ${def.name}`}
      onClose={onClose}
      footer={
        <>
          {props.mode === "add" && (
            <button className="btn mr-auto" onClick={props.onBack}>
              Atrás
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || (usesConnection && connsQ.isLoading)}
          >
            {save.isPending ? "Guardando…" : editing ? "Guardar" : "Añadir"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título (opcional)">
          <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        {usesConnection && (
          <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
            <Field
              label={`Conexión a ${def.pluginName}`}
              help={
                existing.length > 0
                  ? "La URL y las credenciales se guardan una sola vez y las comparten todos los widgets. Edítalas en Ajustes → Conexiones."
                  : "Aún no hay ninguna: se creará y podrás reutilizarla en los demás widgets."
              }
            >
              <select className="input" value={connectionId} onChange={(e) => setPicked(e.target.value)}>
                {existing.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW}>＋ Nueva conexión…</option>
              </select>
            </Field>
            {connectionId === NEW && (
              <ConnectionFields
                fields={def.connection}
                name={newName}
                onName={setNewName}
                values={newValues}
                onValues={setNewValues}
                test={def.testable ? { pluginId: def.pluginId } : undefined}
              />
            )}
          </div>
        )}

        {def.config.length > 0 || !usesConnection ? (
          <ConfigForm
            fields={def.config}
            values={values}
            onChange={setValues}
            secretsSet={editing ? props.widget.secretsSet : []}
          />
        ) : (
          <p className="text-sm text-muted">Este widget no tiene más opciones: usa la conexión elegida.</p>
        )}
        <WidgetStyleFields
          style={style}
          onChange={setStyle}
          linkHint={
            style.link || def.component || def.connection.length === 0
              ? undefined
              : (existing.find((c) => c.id === connectionId)?.config.url as string | undefined)
          }
        />
        {save.error && (
          <p className="text-sm text-bad" role="alert">
            {save.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
