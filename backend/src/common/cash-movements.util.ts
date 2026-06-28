// Рух готівки каси — підкріплення (IN, +) та інкасація (OUT, −). Це переміщення
// готівки, а не торгівля: змінює залишок каси, але НЕ входить у прибуток зміни
// (як і передачі між касами — див. transfers.util.ts).

export interface CashMovementRow {
  direction: string; // 'IN' | 'OUT'
  currency: string;
  amount: unknown; // Prisma.Decimal | number | string
}

/** Вплив руху готівки на залишок по кожній валюті: IN → +amount, OUT → −amount. */
export function cashMovementsDelta(
  movements: CashMovementRow[],
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const m of movements) {
    const sign = m.direction === 'IN' ? 1 : -1;
    delta[m.currency] = (delta[m.currency] ?? 0) + sign * Number(m.amount);
  }
  return delta;
}

/** Застосувати рух готівки до балансу (підкріплення додає, інкасація віднімає). */
export function applyCashMovements(
  balance: Record<string, number>,
  movements: CashMovementRow[],
): Record<string, number> {
  const result: Record<string, number> = { ...balance };
  const delta = cashMovementsDelta(movements);
  for (const [cur, d] of Object.entries(delta)) {
    result[cur] = (result[cur] ?? 0) + d;
  }
  return result;
}
