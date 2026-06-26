// Прибуток зміни = приріст вартості каси за серединним курсом (дзеркало
// backend/common/profit.util.ts). Прибирає подвійний рахунок спреду.

export function midRates(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): Record<string, number> {
  const mid: Record<string, number> = { UAH: 1 };
  for (const r of rates) mid[r.currency] = (Number(r.buy) + Number(r.sell)) / 2;
  return mid;
}

export function valueOf(
  balance: Record<string, number>,
  valuation: Record<string, number>,
): number {
  return Object.entries(balance).reduce(
    (sum, [cur, amt]) => sum + Number(amt) * (valuation[cur] ?? 0),
    0,
  );
}

export function shiftProfit(
  startBalance: Record<string, number>,
  endBalance: Record<string, number>,
  valuation: Record<string, number>,
): number {
  return valueOf(endBalance, valuation) - valueOf(startBalance, valuation);
}
