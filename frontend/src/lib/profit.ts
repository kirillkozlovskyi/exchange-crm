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

export interface ProfitOperation {
  type: string;
  currency: string;
  amount: number | string;
  totalUah: number | string;
  payCurrency?: string | null;
  payAmount?: number | string | null;
  cancelled?: boolean;
}

/**
 * Реалізований прибуток зміни «з відкупленого» (дзеркало backend realizedProfit).
 *  • Пари з гривнею: відкуплено = min(куплено, продано); прибуток =
 *    відкуплено × (сер.курс продажу − сер.курс купівлі). Непокрита позиція не оцінюється.
 *  • Крос: різниця вартостей за серединним курсом, віднесена до відданої валюти.
 */
export function realizedProfit(
  operations: ProfitOperation[],
  valuation: Record<string, number>,
): { total: number; byCurrency: Record<string, number> } {
  const bought: Record<string, { qty: number; uah: number }> = {};
  const sold: Record<string, { qty: number; uah: number }> = {};
  const byCurrency: Record<string, number> = {};

  const addBuy = (c: string, q: number, u: number) => {
    (bought[c] ??= { qty: 0, uah: 0 });
    bought[c].qty += q;
    bought[c].uah += u;
  };
  const addSell = (c: string, q: number, u: number) => {
    (sold[c] ??= { qty: 0, uah: 0 });
    sold[c].qty += q;
    sold[c].uah += u;
  };
  const addProfit = (c: string, v: number) => {
    byCurrency[c] = (byCurrency[c] ?? 0) + v;
  };

  for (const op of operations) {
    if (op.cancelled) continue;
    const amount = Number(op.amount);
    const totalUah = Number(op.totalUah);
    const payCur = op.payCurrency;
    const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

    if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
      const diff =
        payAmount * (valuation[payCur] ?? 0) - amount * (valuation[op.currency] ?? 0);
      addProfit(op.currency, diff);
    } else if (payCur && payCur !== 'UAH') {
      addBuy(payCur, payAmount, totalUah);
    } else if (op.type === 'BUY') {
      addBuy(op.currency, amount, totalUah);
    } else {
      addSell(op.currency, amount, totalUah);
    }
  }

  const curs = new Set([...Object.keys(bought), ...Object.keys(sold)]);
  for (const c of curs) {
    const b = bought[c] ?? { qty: 0, uah: 0 };
    const s = sold[c] ?? { qty: 0, uah: 0 };
    const matched = Math.min(b.qty, s.qty);
    if (matched <= 0) continue;
    const avgBuy = b.qty > 0 ? b.uah / b.qty : 0;
    const avgSell = s.qty > 0 ? s.uah / s.qty : 0;
    addProfit(c, matched * (avgSell - avgBuy));
  }

  const total = Object.values(byCurrency).reduce((a, v) => a + v, 0);
  return { total, byCurrency };
}
