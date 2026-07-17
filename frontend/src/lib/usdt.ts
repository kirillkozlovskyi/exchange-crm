// USDT — віртуальний гаманець (окремий «банк»), 1:1 до USD. Дзеркало
// backend/common/usdt.util.ts. Фізична нога USDT-операції рухає готівку каси:
//  SELL (каса продає USDT) → готівка приходить (+); BUY (каса купує) → йде (−).

export type UsdtSide = 'BUY' | 'SELL';

export interface UsdtOpRow {
  side: UsdtSide | string;
  settleCurrency: string;
  settleAmount: number | string;
  settleRate?: number | string;
  usdtAmount?: number | string;
  profitUah?: number | string;
  profitUsd?: number | string;
  cancelled?: boolean; // сторно — не впливає ні на готівку, ні на прибуток
}

/** Вплив USDT-операцій на фізичну готівку каси по валютах розрахунку. */
export function usdtCashDelta(ops: UsdtOpRow[]): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const op of ops) {
    if (op.cancelled) continue;
    const amt = Number(op.settleAmount);
    const sign = op.side === 'SELL' ? 1 : -1;
    delta[op.settleCurrency] = (delta[op.settleCurrency] ?? 0) + sign * amt;
  }
  return delta;
}

/** Сумарна маржа USDT-операцій (грн). */
export function usdtProfit(ops: UsdtOpRow[]): number {
  return ops.reduce((s, op) => s + (op.cancelled ? 0 : Number(op.profitUah ?? 0)), 0);
}

/** Сумарна маржа USDT у $ (нативна для $-числовника; дзеркало backend usdtProfitUsd). */
export function usdtProfitUsd(ops: UsdtOpRow[]): number {
  return ops.reduce((s, op) => {
    if (op.cancelled) return s;
    const stored = Number(op.profitUsd ?? 0);
    if (stored !== 0) return s + stored;
    const rate = Number(op.settleRate ?? 0);
    const usdt = Number(op.usdtAmount ?? 0);
    if (!(rate > 0) || !(usdt > 0)) return s + stored;
    const settleUsd = Number(op.settleAmount) / rate;
    return s + (op.side === 'SELL' ? settleUsd - usdt : usdt - settleUsd);
  }, 0);
}

/**
 * Підказка суми розрахунку у фізичній валюті (варіант A — за курсом точки).
 * Дзеркало логіки backend UsdtService.create. Повертає { usdValue, settleAmount }.
 */
export function suggestUsdtSettle(params: {
  side: UsdtSide;
  usdtAmount: number;
  pct: number; // %, напр. 1.25
  settleCurrency: string;
  rates: { currency: string; buy: number | string; sell: number | string }[];
}): { usdValue: number; settleAmount: number } {
  const { side, usdtAmount, pct, settleCurrency, rates } = params;
  const frac = pct / 100;
  const usdValue = side === 'SELL' ? usdtAmount * (1 + frac) : usdtAmount * (1 - frac);

  const find = (cur: string) => rates.find((r) => r.currency === cur);
  const usd = find('USD');
  const usdBuy = usd ? Number(usd.buy) : 0;
  const usdSell = usd ? Number(usd.sell) : 0;

  let settleAmount: number;
  if (settleCurrency === 'USD') {
    settleAmount = usdValue;
  } else if (settleCurrency === 'UAH') {
    settleAmount = usdValue * (side === 'SELL' ? usdSell : usdBuy);
  } else {
    const tgt = find(settleCurrency);
    const tgtBuy = tgt ? Number(tgt.buy) : 0;
    const tgtSell = tgt ? Number(tgt.sell) : 0;
    if (side === 'SELL') settleAmount = tgtBuy > 0 ? (usdValue * usdSell) / tgtBuy : 0;
    else settleAmount = tgtSell > 0 ? (usdValue * usdBuy) / tgtSell : 0;
  }
  return { usdValue, settleAmount: Math.round(settleAmount * 100) / 100 };
}
