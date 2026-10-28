/** Solo aceptamos formatos raster por su firma real (no por la cabecera ni la extensión). */
export function detectImage(buf: Uint8Array): { ext: "jpg" | "png" | "webp" | "avif"; mime: string } | null {
  const b = buf;
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (ascii(4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(8, 4))) return { ext: "avif", mime: "image/avif" };
  return null; // SVG, GIF, HTML, etc.: no
}
