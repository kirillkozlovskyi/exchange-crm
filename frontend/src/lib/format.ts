/**
 * Форматування чисел — глобальна опція адміна (Налаштування): роздільник
 * тисяч (кома/пробіл) і чи показувати копійки. За замовчуванням — кома,
 * копійки показуються (як було раніше: 1,000,000.00).
 *
 * Копійки/десяткові ЗАВЖДИ показуються рівно `digits` знаків, коли увімкнено
 * (без «обрізання зайвих нулів») — інакше те саме поле то показує .50, то
 * ховає .00 залежно від конкретного значення, що виглядає як баг.
 */

export type NumberFormatPrefs = { thousands: 'comma' | 'space'; decimals: boolean };

let prefs: NumberFormatPrefs = { thousands: 'comma', decimals: true };

/** Застосувати завантажені з сервера налаштування (викликає NumberFormatProvider). */
export function setNumberFormatPrefs(p: NumberFormatPrefs): void {
  prefs = p;
}

export function getNumberFormatPrefs(): NumberFormatPrefs {
  return prefs;
}

function groupThousands(intDigits: string, sep: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function formatNumber(v: number, digits: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [intPart, fracPart] = fixed.split('.');
  const sep = prefs.thousands === 'space' ? ' ' : ',';
  const grouped = groupThousands(intPart, sep);
  return (neg ? '-' : '') + grouped + (fracPart ? '.' + fracPart : '');
}

/** Число з розділеними розрядами. digits — знаків після коми (0, якщо копійки вимкнено). */
export function fmtNum(v: unknown, digits = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return formatNumber(n, prefs.decimals ? digits : 0);
}

/** Ціле число з розділеними розрядами (для залишків/сум без копійок). */
export function fmtInt(v: unknown): string {
  return fmtNum(v, 0);
}

/** Гроші: 2 знаки після коми (якщо копійки увімкнено) + розділені розряди. */
export function fmtMoney(v: unknown): string {
  return fmtNum(v, 2);
}

/**
 * Курс валюти (напр. 44.9500, крос 1.1420) — ЗАВЖДИ рівно `digits` знаків,
 * незалежно від опції «показувати копійки»: приховати точність курсу означало
 * б спотворити його зміст (44.95 ≠ 45), на відміну від округлення суми грошей.
 * Роздільник тисяч застосовується як завжди.
 */
export function fmtRate(v: unknown, digits = 4): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return (0).toFixed(digits);
  return formatNumber(n, digits);
}
