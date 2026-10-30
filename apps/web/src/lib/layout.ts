export type LayoutItem = { id: string; x: number; y: number; w: number; h: number };

const overlap = (a: LayoutItem, b: LayoutItem) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Modo libre: sin «gravedad». Si un widget cambia de tamaño y pisa a otros, solo los pisados
 * bajan lo justo; todo lo demás se queda donde estaba.
 */
export function resolveCollisions(items: LayoutItem[], fixedId: string): LayoutItem[] {
  const fixed = items.find((i) => i.id === fixedId);
  const placed: LayoutItem[] = fixed ? [fixed] : [];
  const rest = items.filter((i) => i.id !== fixedId).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of rest) {
    const next = { ...it };
    for (let guard = 0; guard < 200; guard++) {
      const hit = placed.find((p) => overlap(next, p));
      if (!hit) break;
      next.y = hit.y + hit.h;
    }
    placed.push(next);
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((i) => byId.get(i.id) ?? i);
}
