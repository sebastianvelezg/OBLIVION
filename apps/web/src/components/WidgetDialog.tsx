import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plug, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogWidget, WidgetDTO, WidgetStyle } from "@oblivion/sdk";
import { api } from "../api";
import { sizePresets } from "../lib/sizes";
import { ConfigForm, defaultsFor } from "./ConfigForm";
import { ConnectionFields, TestConnection, useConnections } from "./ConnectionsPanel";
import { WidgetIcon } from "./WidgetIcon";
import { WidgetStyleFields } from "./WidgetStyleFields";
import { Field, Modal } from "./ui";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Elegir un widget del catálogo (con búsqueda y sabiendo qué servicios ya tienen conexión) y configurarlo. */
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
  const [query, setQuery] = useState("");
  const connsQ = useConnections(true);
  const connected = useMemo(() => new Set((connsQ.data?.connections ?? []).map((c) => c.pluginId)), [connsQ.data]);

  const groups = useMemo(() => {
    const q = plain(query.trim());
    const hit = (w: CatalogWidget) => !q || plain(`${w.name} ${w.description} ${w.pluginName}`).includes(q);
    const map = new Map<string, { id: string; name: string; widgets: CatalogWidget[] }>();
    for (const w of catalog) {
      if (!hit(w)) continue;
      if (!map.has(w.pluginId)) map.set(w.pluginId, { id: w.pluginId, name: w.pluginName, widgets: [] });
      map.get(w.pluginId)!.widgets.push(w);
    }
    // Primero los básicos, luego los servicios ya conectados y al final el resto, por orden alfabético.
    const rank = (id: string) => (id === "core" ? 0 : connected.has(id) ? 1 : 2);
    return [...map.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "es"));
  }, [catalog, query, connected]);

  if (picked) {
    return <ConfigureDialog mode="add" pageId={pageId} def={picked} onBack={() => setPicked(null)} onClose={onClose} />;
  }

  return (
    <Modal title="Añadir widget" onClose={onClose} wide>
      <div className="space-y-6">
        <label className="relative block">
          <span className="sr-only">Buscar widgets</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            className="input pl-9"
            type="search"
            autoFocus
            placeholder="Buscar: reloj, Jellyfin, descargas, clima…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {groups.length === 0 && <p className="py-8 text-center text-sm text-muted">Ningún widget coincide con «{query}».</p>}

        {groups.map((g) => {
          const needs = g.widgets[0]!.connection.length > 0;
          return (
            <section key={g.id}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                {g.name}
                {g.id === "core" && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-text">Sin conexión</span>}
                {needs && connected.has(g.id) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 font-medium text-good">
                    <CheckCircle2 size={11} /> Conectado
                  </span>
                )}
                {needs && !connected.has(g.id) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-line px-2 py-0.5 font-medium">
                    <Plug size={11} /> Pide conexión
                  </span>
                )}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.widgets.map((w) => (
                  <button
                    key={w.fullType}
                    onClick={() => setPicked(w)}
                    className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-left transition-colors hover:border-accent"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                      <WidgetIcon emoji={w.icon} size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{w.name}</span>
                      <span className="line-clamp-2 block text-xs text-muted">{w.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
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

/** Miniatura de la huella de un tamaño dentro de la grilla de 12 columnas. */
function Footprint({ w, h }: { w: number; h: number }) {
  return (
    <span className="relative block h-9 w-full rounded-md bg-line/60" aria-hidden>
      <span
        className="absolute left-1 top-1 rounded-[3px] bg-accent"
        style={{ width: `calc(${(w / 12) * 100}% - 2px)`, height: `${Math.min(100, (h / 12) * 100)}%`, minHeight: 6, maxHeight: "calc(100% - 8px)" }}
      />
    </span>
  );
}

function ConfigureDialog(props: Props) {
  const { def, onClose } = props;
  const qc = useQueryClient();
  const editing = props.mode === "edit";
  const usesConnection = def.connection.length > 0;
  const presets = useMemo(() => sizePresets(def), [def]);
  const [sizeId, setSizeId] = useState<string>("m");
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
  const chosen = existing.find((c) => c.id === connectionId);
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
      if (editing) return api.patch(`/widgets/${props.widget.id}`, { title, config: values, connectionId: useId, style });
      const size = presets.find((p) => p.id === sizeId);
      return api.post(`/pages/${props.pageId}/widgets`, {
        type: def.fullType,
        title,
        config: values,
        connectionId: useId,
        style,
        size: size && { w: size.w, h: size.h },
      });
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
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text">
            <WidgetIcon emoji={def.icon} size={20} />
          </span>
          <p className="text-sm text-muted">{def.description}</p>
        </div>

        {!editing && presets.length > 1 && (
          <div>
            <span className="label">Tamaño inicial</span>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Tamaño inicial">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={sizeId === p.id}
                  onClick={() => setSizeId(p.id)}
                  className="rounded-xl border p-2 text-left transition-colors hover:border-accent"
                  style={{ borderColor: sizeId === p.id ? "var(--accent)" : "var(--line)", background: sizeId === p.id ? "var(--accent-soft)" : undefined }}
                >
                  <Footprint w={p.w} h={p.h} />
                  <span className="mt-1.5 block text-xs font-medium">{p.label}</span>
                  <span className="block text-[11px] tabular-nums text-muted">
                    {p.w} × {p.h}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">Luego puedes cambiarlo con S · M · L al editar, o estirando los bordes.</p>
          </div>
        )}

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
            {chosen && def.testable && <TestConnection pluginId={def.pluginId} id={chosen.id} values={chosen.config} />}
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
