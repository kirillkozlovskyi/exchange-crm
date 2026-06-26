// Спільний розрахунок поточного залишку каси (дзеркало backend/common/balance.util.ts).

export interface BalanceOperation {
  type: 'BUY' | 'SELL' | 'EXCHANGE';
  currency: string;
  amount: number | string;
  totalUah: number | string;
  payCurrency?: string | null;
  payAmount?: number | string | null;
  cancelled?: boolean;
}

/**
 * Поточний залишок = початковий баланс + вплив активних операцій.
 *  • SELL: -валюта / +UAH;  BUY: +валюта / -UAH (одна валюта + гривня).
 *  • Крос (currency і payCurrency — валюти): +payCurrency / -currency, без UAH.
 *  • Старий BUY (currency='UAH' + payCurrency): +payCurrency / -UAH.
 * Скасовані не враховуються.
 */
export function computeCurrentBalance(
  startBalance: Record<string, number> = {},
  operations: BalanceOperation[] = [],
): Record<string, number> {
  const bal: Record<string, number> = { ...startBalance };
  const add = (cur: string, amt: number) => {
    bal[cur] = (bal[cur] ?? 0) + amt;
  };
  for (const op of operations) {
    if (op.cancelled) continue;
    const amount = Number(op.amount);
    const totalUah = Number(op.totalUah);
    const payCur = op.payCurrency;
    const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

    if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
      add(payCur, payAmount);       // отримали від клієнта
      add(op.currency, -amount);    // віддали клієнту
    } else if (payCur && payCur !== 'UAH') {
      add(payCur, payAmount);       // старий BUY: отримали валюту
      add('UAH', -totalUah);        // віддали гривні
    } else {
      const sign = op.type === 'BUY' ? 1 : -1;
      add(op.currency, sign * amount);
      add('UAH', -sign * totalUah);
    }
  }
  return bal;
}
