/**
 * Форматування чисел із розділенням розрядів (1 000 000), щоб великі суми
 * читались. Використовує українську локаль: пробіл між тисячами, кома —
 * десятковий роздільник.
 */

/** Число з розділеними розрядами. digits — максимум знаків після коми. */
export function fmtNum(v: unknown, digits = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Ціле число з розділеними розрядами (для залишків/сум без копійок). */
export function fmtInt(v: unknown): string {
  return fmtNum(v, 0);
}

/** Гроші: завжди 2 знаки після коми + розділені розряди. */
export function fmtMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0,00';
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
