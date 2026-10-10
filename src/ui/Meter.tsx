import type { Tone } from './format.ts';

interface MeterProps {
  /** 0 to 1. */
  value: number;
  label: string;
  tone: Tone;
  segments?: number;
  /** `cells` for the inspector's gauges, `ticks` for the thin bars of the KPI tiles. */
  variant?: 'cells' | 'ticks';
}

/** Segmented gauge, read like an instrument: lit segments = value. */
export function Meter({ value, label, tone, segments = 20, variant = 'cells' }: MeterProps) {
  const ratio = Math.min(1, Math.max(0, value));
  const lit = Math.round(ratio * segments);
  return (
    <div
      className="meter"
      data-variant={variant}
      data-tone={tone}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      style={{ gridTemplateColumns: `repeat(${segments}, 1fr)` }}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className="meter__cell" data-on={i < lit || undefined} />
      ))}
    </div>
  );
}
