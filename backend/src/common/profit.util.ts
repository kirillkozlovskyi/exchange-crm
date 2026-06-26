/**
 * Прибуток зміни = приріст вартості каси, оцінений у гривні за ЄДИНИМ
 * (серединним) курсом. Це прибирає подвійний рахунок спреду, який давала
 * сума прибутків окремих операцій.
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

/** Прибуток = вартість(кінець) − вартість(початок) за курсами оцінки. */
export function shiftProfit(
  startBalance: Record<string, number>,
  endBalance: Record<string, number>,
  valuation: Record<string, number>,
): number {
  return valueOf(endBalance, valuation) - valueOf(startBalance, valuation);
}
