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
  profitUah?: unknown;
}

/** Вплив USDT-операцій на ФІЗИЧНУ готівку каси по валютах розрахунку. */
export function usdtCashDelta(ops: UsdtOp[]): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const op of ops) {
    const amt = Number(op.settleAmount);
    const sign = op.side === 'SELL' ? 1 : -1; // SELL → готівка приходить, BUY → йде
    delta[op.settleCurrency] = (delta[op.settleCurrency] ?? 0) + sign * amt;
  }
  return delta;
}

/** Сумарний прибуток USDT-операцій (чиста маржа %) у гривні. */
export function usdtProfit(ops: UsdtOp[]): number {
  return ops.reduce((sum, op) => sum + Number(op.profitUah ?? 0), 0);
}
