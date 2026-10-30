import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Undo2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigChange, ConfigDocId, ConfigDocsDTO, ConfigPlanDTO } from "@oblivion/sdk";
import { api } from "../api";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { toast } from "./ui";

const TITLES: Record<ConfigDocId, string> = {
  pages: "Páginas y widgets",
  connections: "Conexiones",
  appearance: "Apariencia",
};

const KIND: Record<ConfigChange["kind"], string> = {
  page: "Página",
  widget: "Widget",
  connection: "Conexión",
  appearance: "Apariencia",
};

const SIGN: Record<ConfigChange["action"], string> = { add: "+", update: "~", remove: "−" };

/** Huella rápida (FNV-1a) del contenido: sirve para saber si cambió algo sin guardar ni comparar el texto entero. */
function fingerprint(docs: Partial<Record<ConfigDocId, string>>): string {
  let h = 0x811c9dc5;
  let length = 0;
  for (const id of Object.keys(docs).sort()) {
    const text = `${id}\u0000${docs[id as ConfigDocId]}`;
    length += text.length;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${length}`;
}

/** «+2 nuevos · ~1 cambiado · −3 eliminados» */
function summary(changes: ConfigChange[]): string {
  const words = { add: ["nuevo", "nuevos"], update: ["cambiado", "cambiados"], remove: ["eliminado", "eliminados"] } as const;
  return (["add", "update", "remove"] as const)
    .map((a) => [a, changes.filter((c) => c.action === a).length] as const)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${SIGN[a]}${n} ${words[a][n === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** Lo escrito y aún sin aplicar sobrevive a cerrar y reabrir Ajustes (no a recargar la página). */
let drafts: Partial<Record<ConfigDocId, string>> = {};

export function ConfigTextPanel() {
  const qc = useQueryClient();
  const docsQuery = useQuery({ queryKey: ["config-docs"], queryFn: () => api.get<ConfigDocsDTO>("/config") });
  const server = docsQuery.data;

  const [active, setActive] = useState<ConfigDocId>("pages");
  const [local, setLocal] = useState(drafts);
  const editor = useRef<CodeEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const saved = (id: ConfigDocId) => server?.documents.find((d) => d.id === id)?.text ?? "";
  const text = (id: ConfigDocId) => local[id] ?? saved(id);
  const isDirty = (id: ConfigDocId) => local[id] !== undefined && local[id] !== saved(id);

  const setText = (id: ConfigDocId, value: string) => {
    drafts = { ...drafts, [id]: value };
    setLocal(drafts);
  };
  const discard = (ids?: ConfigDocId[]) => {
    const next = { ...drafts };
    for (const id of ids ?? (Object.keys(next) as ConfigDocId[])) delete next[id];
    drafts = next;
    setLocal(next);
  };

  // Solo se envía lo que se ha tocado.
  const payload = useMemo(() => {
    const out: Partial<Record<ConfigDocId, string>> = {};
    if (server) for (const d of server.documents) if (local[d.id] !== undefined && local[d.id] !== d.text) out[d.id] = local[d.id];
    return out;
  }, [server, local]);
  const dirtyIds = Object.keys(payload) as ConfigDocId[];
  // La clave de la consulta es una huella corta del texto, no el texto entero (puede ser muy largo).
  const key = useMemo(() => fingerprint(payload), [payload]);

  // Revisión en vivo: se espera un momento a que termines de escribir.
  const [settled, setSettled] = useState(key);
  const settledPayload = useRef(payload);
  useEffect(() => {
    const t = setTimeout(() => {
      settledPayload.current = payload;
      setSettled(key);
    }, 600);
    return () => clearTimeout(t);
  }, [key, payload]);
  const plan = useQuery({
    queryKey: ["config-plan", settled],
    queryFn: () => api.post<ConfigPlanDTO>("/config/plan", { documents: settledPayload.current }),
    enabled: dirtyIds.length > 0,
    staleTime: Infinity,
    gcTime: 0,
  });
  const checking = dirtyIds.length > 0 && (settled !== key || plan.isFetching);
  const result = settled === key && dirtyIds.length > 0 ? plan.data : undefined;

  const apply = useMutation({
    mutationFn: () => api.put<ConfigPlanDTO & ConfigDocsDTO>("/config", { documents: payload }),
    onSuccess: (res) => {
      qc.setQueryData<ConfigDocsDTO>(["config-docs"], { documents: res.documents, variables: res.variables });
      discard(dirtyIds);
      for (const k of ["pages", "connections", "connection-status", "appearance", "catalog", "widget-data"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      const n = (a: ConfigChange["action"]) => res.changes.filter((c) => c.action === a).length;
      toast(res.changes.length === 0 ? "Configuración aplicada (sin cambios)" : `Configuración aplicada: ${summary(res.changes)}`, "ok");
    },
    onError: (err) => {
      toast(err.message);
      qc.invalidateQueries({ queryKey: ["config-plan"] });
    },
  });

  const removals = result?.changes.filter((c) => c.action === "remove").length ?? 0;
  const canApply = !!result?.ok && !checking && !apply.isPending;
  const applyNow = () => {
    if (canApply) apply.mutate();
  };

  const problems = (result?.problems ?? []).filter((p) => p.doc === active);
  const warnings = (result?.warnings ?? []).filter((p) => p.doc === active);

  function jump(doc: ConfigDocId, line?: number) {
    setActive(doc);
    if (line) setTimeout(() => editor.current?.goToLine(line), 30);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 500_000) return toast("El archivo es demasiado grande");
    setText(active, await file.text());
  }

  function download() {
    const doc = server?.documents.find((d) => d.id === active);
    const url = URL.createObjectURL(new Blob([text(active)], { type: "text/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = doc?.filename ?? `${active}.yml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (docsQuery.isPending) return <p className="text-sm text-muted">Cargando…</p>;
  if (!server) return <p className="text-sm text-bad">No se pudo cargar la configuración.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Toda tu configuración como texto, para editarla de golpe, guardarla o copiarla. Se revisa mientras escribes y no se guarda nada
        hasta que pulses <strong className="font-medium text-fg">Aplicar</strong>.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="doc-tabs" role="tablist" aria-label="Documento">
          {server.documents.map((d) => {
            const bad = (result?.problems ?? []).some((p) => p.doc === d.id);
            return (
              <button key={d.id} role="tab" aria-selected={active === d.id} className="doc-tab" onClick={() => setActive(d.id)}>
                {TITLES[d.id]}
                {bad ? <span className="dot is-bad" title="Con errores" /> : isDirty(d.id) ? <span className="dot" title="Sin aplicar" /> : null}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <code className="mr-1 hidden text-xs text-muted sm:inline">{server.documents.find((d) => d.id === active)?.filename}</code>
          <input ref={fileInput} type="file" accept=".yml,.yaml,.txt,text/yaml" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="btn btn-ghost btn-icon" onClick={() => fileInput.current?.click()} title="Cargar desde un archivo" aria-label="Cargar desde un archivo">
            <FileUp size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={download} title="Descargar este documento" aria-label="Descargar este documento">
            <Download size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => discard([active])} disabled={!isDirty(active)} title="Descartar mis cambios" aria-label="Descartar mis cambios">
            <Undo2 size={16} />
          </button>
        </div>
      </div>

      <CodeEditor
        key={active}
        ref={editor}
        label={TITLES[active]}
        value={text(active)}
        onChange={(v) => setText(active, v)}
        errorLines={problems.flatMap((p) => (p.line ? [p.line] : []))}
        warnLines={warnings.flatMap((p) => (p.line ? [p.line] : []))}
        onSave={applyNow}
      />

      <div className="min-h-12 space-y-2 text-sm" aria-live="polite">
        {dirtyIds.length === 0 && <p className="text-muted">Sin cambios. Edita el texto de arriba para empezar.</p>}
        {checking && (
          <p className="flex items-center gap-1.5 text-muted">
            <Loader2 size={15} className="animate-spin" /> Revisando…
          </p>
        )}
        {!checking && plan.error && <p className="text-bad">{plan.error.message}</p>}

        {!checking && result && !result.ok && (
          <ul className="space-y-1">
            {result.problems.map((p, i) => (
              <li key={i}>
                <button className="problem is-bad" onClick={() => jump(p.doc, p.line)}>
                  <XCircle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {p.doc !== active && <b>{TITLES[p.doc]} · </b>}
                    {p.line ? <b>línea {p.line}</b> : null}
                    {p.line ? " · " : ""}
                    {p.message}
                    {p.path && <code className="ml-1.5 text-xs opacity-70">{p.path}</code>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!checking && result?.ok && (
          <div className="space-y-2">
            {result.changes.length === 0 ? (
              <p className="flex items-center gap-1.5 text-good">
                <CheckCircle2 size={15} /> El texto es válido y coincide con lo que ya tienes guardado.
              </p>
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-good">
                  <CheckCircle2 size={15} /> Todo correcto. Al aplicar:{" "}
                  <span className="text-fg">
                    {summary(result.changes)}
                  </span>
                </p>
                <details className="changes">
                  <summary>Ver el detalle</summary>
                  <ul>
                    {result.changes.map((c) => (
                      <li key={`${c.kind}:${c.id}:${c.action}`} className={`is-${c.action}`}>
                        <span className="sign">{SIGN[c.action]}</span>
                        <span className="text-muted">{KIND[c.kind]}</span> {c.label}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
            {removals > 0 && (
              <p className="flex items-start gap-1.5 text-warn">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Lo que no aparece en el texto se elimina, con su contenido (notas, tareas...).
              </p>
            )}
          </div>
        )}

        {!checking && (result?.warnings ?? []).length > 0 && (
          <ul className="space-y-1">
            {result!.warnings.map((p, i) => (
              <li key={i}>
                <button className="problem is-warn" onClick={() => jump(p.doc, p.line)}>
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {p.doc !== active && <b>{TITLES[p.doc]} · </b>}
                    {p.line ? <b>línea {p.line} · </b> : null}
                    {p.message}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <details className="help text-xs text-muted">
          <summary>Ayuda del formato</summary>
          <ul>
            <li>
              Los secretos aparecen como <code>••••••••</code>: déjalo así para conservar el valor guardado, o escribe uno nuevo (se cifra al
              aplicar). <code>null</code> lo borra.
            </li>
            <li>
              Para no escribir un secreto aquí, define una variable <code>OBLIVION_VAR_LO_QUE_SEA</code> en el contenedor y úsala como{" "}
              <code>{"{{OBLIVION_VAR_LO_QUE_SEA}}"}</code> (solo en campos secretos).
              {server.variables.length > 0 && (
                <>
                  {" "}
                  Disponibles ahora: {server.variables.map((v) => <code key={v} className="mr-1">{`{{${v}}}`}</code>)}
                </>
              )}
            </li>
            <li>En el editor, <kbd>Tab</kbd> escribe espacios; <kbd>Esc</kbd> suelta el cursor para poder salir con el teclado.</li>
            <li>Los widgets sin <code>layout</code> se colocan en el primer hueco libre. El orden de las páginas es el de la lista.</li>
            <li>Tu texto se conserva con sus comentarios hasta que cambies algo desde la interfaz; entonces se vuelve a generar.</li>
          </ul>
        </details>
        <div className="flex items-center gap-2">
          {dirtyIds.length > 0 && (
            <button className="btn" onClick={() => discard()} disabled={apply.isPending}>
              Descartar todo
            </button>
          )}
          <button className="btn btn-primary" onClick={applyNow} disabled={!canApply}>
            {apply.isPending ? "Aplicando…" : removals > 0 ? `Aplicar y eliminar ${removals}` : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
