/**
 * USDT — віртуальний гаманець (окремий «банк»), прив'язаний 1:1 до USD.
 * Кожна USDT-операція має ДВІ ноги:
 *   • віртуальну — рух гаманця USDT (тут не рахується, ведеться в UsdtWallet);
 *   • фізичну — рух готівки каси у валюті розрахунку (settleCurrency/settleAmount).
 *
 * SELL (каса продає USDT клієнту): гаманець −USDT, каса ПРИЙМАЄ фізичну готівку (+).
 * BUY  (каса купує USDT у клієнта): гаманець +USDT, каса ВИДАЄ фізичну готівку (−).
 *
 * Прибуток USDT — «чиста маржа» (%) у гривні (`profitUah`), рахується при створенні
 * операції; тут лише підсумовуємо. Гаманець не переоцінюється (1:1 до USD).
 */

export interface UsdtOp {
  side: string; // 'BUY' | 'SELL'
  settleCurrency: string;
  settleAmount: unknown; // Decimal | number | string
  settleRate?: unknown;  // курс USD→settleCurrency (1 для USD)
  usdtAmount?: unknown;
  profitUah?: unknown;
  profitUsd?: unknown;
  cancelled?: boolean; // сторно — не впливає ні на готівку, ні на прибуток
}

/** Вплив USDT-операцій на ФІЗИЧНУ готівку каси по валютах розрахунку. */
export function usdtCashDelta(ops: UsdtOp[]): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const op of ops) {
    if (op.cancelled) continue;
    const amt = Number(op.settleAmount);
    const sign = op.side === 'SELL' ? 1 : -1; // SELL → готівка приходить, BUY → йде
    delta[op.settleCurrency] = (delta[op.settleCurrency] ?? 0) + sign * amt;
  }
  return delta;
}

/** Сумарний прибуток USDT-операцій (чиста маржа %) у гривні. */
export function usdtProfit(ops: UsdtOp[]): number {
  return ops.reduce((sum, op) => sum + (op.cancelled ? 0 : Number(op.profitUah ?? 0)), 0);
}

/**
 * Сумарна маржа USDT у $ (нативна для $-числовника). Для історичних операцій
 * без profitUsd відновлюємо точно з фактичних полів: маржа проти бази 1:1 =
 * ±(settleAmount/settleRate − usdtAmount).
 */
export function usdtProfitUsd(ops: UsdtOp[]): number {
  return ops.reduce((sum, op) => {
    if (op.cancelled) return sum;
    const stored = Number(op.profitUsd ?? 0);
    if (stored !== 0) return sum + stored;
    const rate = Number(op.settleRate ?? 0);
    const usdt = Number(op.usdtAmount ?? 0);
    if (!(rate > 0) || !(usdt > 0)) return sum + stored;
    const settleUsd = Number(op.settleAmount) / rate;
    return sum + (op.side === 'SELL' ? settleUsd - usdt : usdt - settleUsd);
  }, 0);
}
