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

export interface ProfitOperation {
  type: string; // 'BUY' | 'SELL' | 'EXCHANGE'
  currency: string;
  amount: unknown;
  totalUah: unknown;
  payCurrency?: string | null;
  payAmount?: unknown;
  cancelled?: boolean;
}

/**
 * Реалізований прибуток зміни («з відкупленого»).
 *
 *  • Пари з гривнею: по кожній валюті рахуємо, скільки куплено і скільки продано.
 *    Відкуплено = min(куплено, продано); прибуток = відкуплено × (сер.курс продажу
 *    − сер.курс купівлі). Непокритий залишок позиції НЕ оцінюється — він просто
 *    переноситься як запас (собівартість між змінами не тягнемо).
 *  • Крос-операції (валюта↔валюта, без гривні): різниця вартостей за серединним
 *    курсом (як і раніше), віднесена до валюти, яку каса віддала.
 *
 * Повертає загальний прибуток і розбивку по валютах (сума розбивки = total).
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
      // Крос: віддали op.currency, отримали payCurrency — різниця за серединним курсом.
      const diff =
        payAmount * (valuation[payCur] ?? 0) - amount * (valuation[op.currency] ?? 0);
      addProfit(op.currency, diff);
    } else if (payCur && payCur !== 'UAH') {
      // Старий формат BUY: отримали payCurrency, віддали UAH.
      addBuy(payCur, payAmount, totalUah);
    } else if (op.type === 'BUY') {
      addBuy(op.currency, amount, totalUah);
    } else {
      // SELL / EXCHANGE: віддали валюту, отримали UAH.
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
