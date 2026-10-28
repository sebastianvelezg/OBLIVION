/** Marca de Oblivion: un anillo con un punto en el centro (el vacío). Usa el color del texto. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
