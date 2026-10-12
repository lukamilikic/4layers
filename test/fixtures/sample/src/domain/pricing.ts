// Clean domain file: pure functions, no imports at all.
export function applyDiscount(total: number, percent: number): number {
  return Math.round(total * (1 - percent / 100) * 100) / 100;
}
