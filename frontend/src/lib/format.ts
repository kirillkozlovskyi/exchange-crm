/**
 * Форматування чисел із розділенням розрядів у форматі 1,000,000.00
 * (кома між тисячами, крапка — десятковий роздільник) — вибір власника.
 */

/** Число з розділеними розрядами. digits — максимум знаків після коми. */
export function fmtNum(v: unknown, digits = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Ціле число з розділеними розрядами (для залишків/сум без копійок). */
export function fmtInt(v: unknown): string {
  return fmtNum(v, 0);
}

/** Гроші: завжди 2 знаки після коми + розділені розряди (1,000,000.00). */
export function fmtMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
