import type { ChartView } from "@oblivion/sdk";

const COLORS = ["var(--accent)", "var(--good)", "var(--warn)", "var(--bad)"];
const W = 300;
const H = 100;
const PAD = 5;

function fmt(n: number) {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
}

/** Gráfica de líneas en SVG (sin dependencias). Todo se pinta como gráficos, nunca como HTML del plugin. */
export function Chart({ view }: { view: ChartView }) {
  const n = Math.max(...view.series.map((s) => s.points.length));
  if (!Number.isFinite(n) || n < 2) return <p className="text-sm text-muted">Aún no hay datos suficientes.</p>;

  const max = Math.max(1, ...view.series.flatMap((s) => s.points)) * 1.12;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (Math.max(0, v) / max) * (H - PAD * 2);
  const line = (pts: number[]) => pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const first = view.series[0]!;
  const unit = view.unit ? ` ${view.unit}` : "";
  const summary = view.series.map((s) => `${s.name}: ${fmt(s.points[s.points.length - 1] ?? 0)}${unit}`).join(", ");

  return (
    <figure className="flex h-full min-h-0 flex-col gap-2">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1">
        {view.series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
            <span className="text-muted">{s.name}</span>
            <span className="font-medium tabular-nums">
              {fmt(s.points[s.points.length - 1] ?? 0)}
              {unit}
            </span>
          </span>
        ))}
      </figcaption>

      <div className="relative min-h-24 flex-1">
        <span className="absolute left-0 top-0 text-[10px] tabular-nums text-muted">
          {fmt(max / 1.12)}
          {unit}
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full overflow-visible" role="img" aria-label={`Gráfica. ${summary}`}>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={0} x2={W} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${line(first.points)} L${x(first.points.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`} fill={COLORS[0]} opacity={0.12} />
          {view.series.map((s, i) => (
            <path key={s.name} d={line(s.points)} fill="none" stroke={COLORS[i]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* Punto del último valor: HTML encima del SVG para que no se deforme al estirarse. */}
        {view.series.map((s, i) => {
          const last = s.points[s.points.length - 1];
          if (last === undefined) return null;
          return (
            <span
              key={s.name}
              aria-hidden
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface-solid)]"
              style={{ left: `${(x(s.points.length - 1) / W) * 100}%`, top: `${(y(last) / H) * 100}%`, background: COLORS[i] }}
            />
          );
        })}
      </div>

      {view.labels && view.labels.length > 1 && (
        <div className="flex justify-between text-[10px] text-muted">
          <span>{view.labels[0]}</span>
          <span>{view.labels[view.labels.length - 1]}</span>
        </div>
      )}
      {view.caption && <figcaption className="text-xs text-muted">{view.caption}</figcaption>}
    </figure>
  );
}
