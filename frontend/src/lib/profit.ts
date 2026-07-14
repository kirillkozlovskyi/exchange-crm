// Оцінка залишків каси в гривні — для нестачі/надлишку при закритті зміни
// (дзеркало backend/common/profit.util.ts). Прибуток тут НЕ рахується: він
// приходить із сервера (op.profit за WAC).

export function midRates(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): Record<string, number> {
  const mid: Record<string, number> = { UAH: 1 };
  for (const r of rates) mid[r.currency] = (Number(r.buy) + Number(r.sell)) / 2;
  return mid;
}

/**
 * Курси ПРОДАЖУ — оцінка нестачі/надлишку каси (дзеркало backend sellRates).
 * Нестача 100 $ коштує стільки, за скільки каса продала б ці 100 $ клієнту.
 */
export function sellRates(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): Record<string, number> {
  const map: Record<string, number> = { UAH: 1 };
  for (const r of rates) map[r.currency] = Number(r.sell);
  return map;
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
