import type { Appearance } from "@oblivion/sdk";
import { resolvedMode } from "../theme";

/** Capa de fondo fija detrás de todo: aurora, liso, degradado o foto. */
export function Backdrop({ appearance: a, allowImage }: { appearance: Appearance; allowImage: boolean }) {
  const bg = a.background;
  const dark = resolvedMode(a) === "dark";

  let layer: React.CSSProperties = {};
  if (bg.type === "gradient") {
    layer = { background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})` };
  } else if (bg.type === "aurora") {
    layer = {
      background: [
        "radial-gradient(60rem 40rem at 12% -10%, color-mix(in oklab, var(--accent) 24%, transparent), transparent 60%)",
        "radial-gradient(50rem 36rem at 100% 0%, color-mix(in oklab, var(--accent) 13%, transparent), transparent 60%)",
        "radial-gradient(45rem 30rem at 50% 115%, color-mix(in oklab, var(--accent) 9%, transparent), transparent 60%)",
      ].join(", "),
    };
  }

  // La foto solo se pide con sesión iniciada (el servidor la protege con login).
  const showImage = bg.type === "image" && bg.imageId && allowImage;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: "var(--bg)" }}>
      {!showImage && <div className="absolute inset-0" style={layer} />}
      {!showImage && <div className="grain" />}
      {showImage && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(/api/appearance/background/${bg.imageId})`,
              // Margen negativo para que el desenfoque no deje bordes claros.
              inset: bg.blur > 0 ? `-${bg.blur * 2}px` : 0,
              filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
            }}
          />
          <div
            className="absolute inset-0"
            style={{ background: dark ? `rgba(5,6,10,${bg.dim / 100})` : `rgba(255,255,255,${bg.dim / 100})` }}
          />
        </>
      )}
    </div>
  );
}
