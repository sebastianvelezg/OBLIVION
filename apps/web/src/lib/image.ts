const MAX_SIDE = 2560;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/**
 * Prepara una foto de fondo en el navegador: la decodifica, la reduce y la
 * vuelve a codificar. Así se quitan los metadatos (EXIF, ubicación GPS), se
 * neutraliza cualquier contenido raro del archivo y pesa poco.
 */
export async function prepareBackground(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");
  if (file.size > MAX_INPUT_BYTES) throw new Error("La imagen es demasiado grande (máx. 40 MB)");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("No se pudo leer la imagen");
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no puede procesar imágenes");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));

  // WebP si el navegador lo soporta; si no, devuelve PNG y caemos a JPEG.
  let blob = await toBlob("image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", 0.88);
  if (!blob) throw new Error("No se pudo procesar la imagen");
  return blob;
}
