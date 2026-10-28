import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Appearance } from "@oblivion/sdk";
import { api } from "../api";
import { prepareBackground } from "../lib/image";
import { Segmented, Slider, toast } from "./ui";

type Background = Appearance["background"];

/** Editor de fondo (aurora, liso, degradado o foto): lo usan la apariencia general y cada página. */
export function BackgroundEditor({ value: bg, onChange }: { value: Background; onChange: (bg: Background) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<Background>) => onChange({ ...bg, ...p });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const blob = await prepareBackground(file);
      return api.upload<{ imageId: string }>("/appearance/background", blob);
    },
    onSuccess: ({ imageId }) => patch({ imageId, type: "image" }),
    onError: (e) => toast(e.message),
  });

  return (
    <div className="space-y-3">
      <Segmented
        value={bg.type}
        onChange={(type) => {
          if (type === "image" && !bg.imageId) fileRef.current?.click();
          else patch({ type });
        }}
        options={[
          { value: "aurora", label: "Aurora" },
          { value: "plain", label: "Liso" },
          { value: "gradient", label: "Degradado" },
          { value: "image", label: "Foto" },
        ]}
      />

      {bg.type === "gradient" && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted">
              Desde
              <input type="color" value={bg.from} onChange={(e) => patch({ from: e.target.value })} className="h-8 w-10 cursor-pointer rounded-md border border-line bg-transparent" />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              Hasta
              <input type="color" value={bg.to} onChange={(e) => patch({ to: e.target.value })} className="h-8 w-10 cursor-pointer rounded-md border border-line bg-transparent" />
            </label>
          </div>
          <Slider label="Ángulo" value={bg.angle} min={0} max={360} unit="°" onChange={(angle) => patch({ angle })} />
        </div>
      )}

      {bg.type === "image" && bg.imageId && (
        <div className="space-y-3">
          <div
            className="h-24 rounded-xl border border-line bg-cover bg-center"
            style={{ backgroundImage: `url(/api/appearance/background/${bg.imageId})` }}
            role="img"
            aria-label="Vista previa del fondo"
          />
          <Slider label="Desenfoque de la foto" value={bg.blur} min={0} max={30} unit="px" onChange={(blur) => patch({ blur })} />
          <Slider label="Oscurecer" value={bg.dim} min={0} max={80} unit="%" onChange={(dim) => patch({ dim })} />
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" className="btn flex-1" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          <ImagePlus size={16} /> {upload.isPending ? "Procesando…" : bg.imageId ? "Cambiar foto" : "Subir foto"}
        </button>
        {bg.imageId && (
          <button
            type="button"
            className="btn btn-danger"
            aria-label="Quitar foto"
            onClick={() => patch({ imageId: null, type: bg.type === "image" ? "aurora" : bg.type })}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted">
        La foto se reduce y se limpia en tu navegador (se eliminan los datos EXIF, como la ubicación) antes de subirse. Solo la ven quienes inician sesión.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
