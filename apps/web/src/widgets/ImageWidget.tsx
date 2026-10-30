import { ImageIcon } from "lucide-react";
import type { WidgetDTO } from "@oblivion/sdk";

/**
 * Widget «Imagen»: la foto es el fondo de la tarjeta (se sube en «Aspecto de este widget»);
 * aquí solo se dibuja el texto opcional y, si aún no hay foto, una guía para ponerla.
 */
export function ImageWidget({ widget, editing }: { widget: WidgetDTO; editing: boolean }) {
  const caption = typeof widget.config.caption === "string" ? widget.config.caption.trim() : "";
  const contain = widget.config.fit === "contain";
  const src = widget.style.image ? `/api/appearance/background/${widget.style.image}` : null;

  return (
    <div className="relative size-full">
      {src && contain && <img src={src} alt={caption} className="absolute inset-0 size-full object-contain" draggable={false} />}
      {!src && (
        <div className="grid size-full place-items-center text-center text-muted">
          <div className="space-y-1.5">
            <ImageIcon size={22} className="mx-auto opacity-70" aria-hidden />
            <p className="text-xs leading-snug">
              {editing ? "Sube la imagen en «Aspecto de este widget»" : "Sin imagen todavía"}
            </p>
          </div>
        </div>
      )}
      {caption && (
        <p className="display absolute inset-x-0 bottom-0 text-balance text-2xl leading-tight text-[color:var(--fg)] [text-shadow:0_1px_12px_var(--bg)]">
          {caption}
        </p>
      )}
    </div>
  );
}
