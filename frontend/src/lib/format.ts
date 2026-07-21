/**
 * Форматування чисел — глобальна опція адміна (Налаштування): роздільник
 * тисяч (кома/пробіл) і чи показувати копійки. За замовчуванням — кома,
 * копійки показуються (як було раніше: 1,000,000.00).
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

/** minDigits/maxDigits — як у toLocaleString: додаткові нулі понад minDigits обрізаються. */
function formatNumber(v: number, maxDigits: number, minDigits: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const neg = n < 0;
  let fixed = Math.abs(n).toFixed(maxDigits);
  if (maxDigits > minDigits) {
    let [intPart, fracPart = ''] = fixed.split('.');
    while (fracPart.length > minDigits && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
    fixed = fracPart.length ? `${intPart}.${fracPart}` : intPart;
  }
  const [intPart, fracPart] = fixed.split('.');
  const sep = prefs.thousands === 'space' ? ' ' : ',';
  const grouped = groupThousands(intPart, sep);
  return (neg ? '-' : '') + grouped + (fracPart ? '.' + fracPart : '');
}

/** Число з розділеними розрядами. digits — максимум знаків після коми (0, якщо копійки вимкнено). */
export function fmtNum(v: unknown, digits = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return formatNumber(n, prefs.decimals ? digits : 0, 0);
}

/** Ціле число з розділеними розрядами (для залишків/сум без копійок). */
export function fmtInt(v: unknown): string {
  return fmtNum(v, 0);
}

/** Гроші: 2 знаки після коми (якщо копійки увімкнено) + розділені розряди. */
export function fmtMoney(v: unknown): string {
  const n = Number(v ?? 0);
  const d = prefs.decimals ? 2 : 0;
  if (!Number.isFinite(n)) return d ? '0.00' : '0';
  return formatNumber(n, d, d);
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
  return formatNumber(n, digits, digits);
}
