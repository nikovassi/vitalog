/**
 * Numeric change between measurements. Describes direction only – never whether a change
 * is good or bad (that requires medical context the platform does not have).
 */

export type TrendDirection = 'up' | 'down' | 'stable';

/**
 * UX convention, NOT a medical rule: changes smaller than 3% of the previous value are
 * labelled "stable" so tiny fluctuations are not shown as a trend.
 */
export const STABLE_THRESHOLD_PCT = 3;

export interface Change {
  latest: number;
  previous: number;
  absolute: number;
  /** null when previous is 0 (percentage undefined). */
  percent: number | null;
  direction: TrendDirection;
}

export function computeChange(latest: number, previous: number): Change {
  const absolute = latest - previous;
  const percent = previous === 0 ? null : (absolute / Math.abs(previous)) * 100;
  let direction: TrendDirection;
  if (percent === null) direction = absolute === 0 ? 'stable' : absolute > 0 ? 'up' : 'down';
  else if (Math.abs(percent) < STABLE_THRESHOLD_PCT) direction = 'stable';
  else direction = absolute > 0 ? 'up' : 'down';
  return { latest, previous, absolute: round(absolute, 6), percent: percent === null ? null : round(percent, 1), direction };
}

export const DIRECTION_LABELS: Record<TrendDirection, string> = {
  up: '↑ Повишава се',
  down: '↓ Намалява',
  stable: '→ Стабилна',
};

/** "Стойността се е увеличила с 12% спрямо предходното измерване." */
export function describeChange(change: Change): string {
  if (change.direction === 'stable') {
    return 'Стойността е без съществена промяна спрямо предходното измерване.';
  }
  const verb = change.absolute > 0 ? 'увеличила' : 'намалила';
  if (change.percent === null) return `Стойността се е ${verb} спрямо предходното измерване.`;
  const pct = Math.abs(change.percent).toLocaleString('bg-BG', { maximumFractionDigits: 1 });
  return `Стойността се е ${verb} с ${pct}% спрямо предходното измерване.`;
}

function round(n: number, digits: number) {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}
