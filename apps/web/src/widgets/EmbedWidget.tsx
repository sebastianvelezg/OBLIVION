import { safeHref } from "./LinksWidget";

export function EmbedWidget({ config, editing }: { config: Record<string, any>; editing: boolean }) {
  const href = safeHref(config.url);
  if (!href) return <p className="text-sm text-muted">Configura una URL válida.</p>;

  return (
    <iframe
      src={href}
      title={href}
      loading="lazy"
      referrerPolicy="no-referrer"
      // Sin allow-top-navigation: la página embebida no puede redirigir el dashboard.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      className="size-full rounded-xl border-0 bg-white"
      // En modo edición el iframe se come los eventos del ratón y no deja arrastrar.
      style={{ pointerEvents: editing ? "none" : "auto" }}
    />
  );
}
