export function parseProposalPercentage(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(text)) return null;
  const percentage = Number(text.replace(',', '.'));
  return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 ? percentage : null;
}

export function consideredProposalValue(value: number | null, percentage: number): number | null {
  if (value == null) return null;
  const cents = value * percentage;
  return Math.round(cents + Number.EPSILON * Math.abs(cents)) / 100;
}
