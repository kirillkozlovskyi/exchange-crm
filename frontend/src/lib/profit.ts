// Оцінка залишків каси — для нестачі/надлишку при закритті зміни та «каси в
// доларах» (дзеркало backend/common/profit.util.ts + wac-profit.util.ts).
// Прибуток тут НЕ рахується: він приходить із сервера (op.profitUsd/op.profit).

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

/** Активний курс продажу USD точки (S — база $-числовника). */
export function activeUsdSell(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): number {
  const usd = rates.find((r) => r.currency === 'USD');
  return usd ? Number(usd.sell) : 0;
}

/**
 * «Каса в доларах» — підсумок каси за принципом власника (дзеркало backend
 * tillUsdValue): долари всіх видів (USD, USDT, USDW, USDG) — «готова валюта»
 * 1:1 по факту; UAH — ÷ сер. курс (₴/$); інші валюти — × їх $-крос (курс
 * задає власник). basis — людський формат (UAH: 44.95, EUR: 1.1420).
 * Валюта без бази оцінюється в 0 (чесний нуль, а не вигадана вартість).
 */
export function tillUsd(
  balance: Record<string, number>,
  basis: Record<string, number>,
): { byCurrency: Record<string, number>; total: number } {
  const byCurrency: Record<string, number> = {};
  let total = 0;
  for (const [cur, raw] of Object.entries(balance)) {
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty === 0) continue;
    let usd = 0;
    if (cur.startsWith('USD')) usd = qty;
    else if (cur === 'UAH') usd = basis.UAH > 0 ? qty / basis.UAH : 0;
    else usd = qty * (basis[cur] > 0 ? basis[cur] : 0);
    byCurrency[cur] = usd;
    total += usd;
  }
  return { byCurrency, total };
}
