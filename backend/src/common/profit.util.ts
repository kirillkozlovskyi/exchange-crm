/**
 * Оцінка залишків каси в гривні (для нестачі/надлишку при закритті зміни).
 * ПРИБУТОК тут НЕ рахується — він рахується за WAC (wac-profit.util.ts) і, як
 * додатковий показник, за маржею з відкупу (buyback-margin.util.ts).
 */

export interface RatePair {
  currency: string;
  buy: number;
  sell: number;
}

/** Серединний курс валюти: (buy+sell)/2. UAH = 1. Невідомі валюти — 0 (не оцінюються). */
export function midRates(rates: RatePair[]): Record<string, number> {
  const mid: Record<string, number> = { UAH: 1 };
  for (const r of rates) mid[r.currency] = (Number(r.buy) + Number(r.sell)) / 2;
  return mid;
}

/**
 * Курси ПРОДАЖУ — оцінка нестачі/надлишку каси (рішення власника 2026-07-14).
 * Нестача 100 $ коштує стільки, за скільки каса ці 100 $ продала б клієнту, а не
 * серединний курс. UAH = 1; валюта без активного курсу — 0 (не оцінюється).
 */
export function sellRates(rates: RatePair[]): Record<string, number> {
  const map: Record<string, number> = { UAH: 1 };
  for (const r of rates) map[r.currency] = Number(r.sell);
  return map;
}

/** Вартість балансу в гривні за курсами оцінки. */
export function valueOf(
  balance: Record<string, number>,
  valuation: Record<string, number>,
): number {
  let total = 0;
  for (const [cur, amt] of Object.entries(balance)) {
    total += Number(amt) * (valuation[cur] ?? 0);
  }
  return total;
}
