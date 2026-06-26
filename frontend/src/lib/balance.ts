// Спільний розрахунок поточного залишку каси (дзеркало backend/common/balance.util.ts).

export interface BalanceOperation {
  type: 'BUY' | 'SELL' | 'EXCHANGE';
  currency: string;
  amount: number | string;
  totalUah: number | string;
  cancelled?: boolean;
}

/**
 * Поточний залишок = початковий баланс + вплив активних операцій.
 * BUY: +валюта / -UAH; SELL/EXCHANGE: навпаки. Скасовані не враховуються.
 */
export function computeCurrentBalance(
  startBalance: Record<string, number> = {},
  operations: BalanceOperation[] = [],
): Record<string, number> {
  const bal: Record<string, number> = { ...startBalance };
  for (const op of operations) {
    if (op.cancelled) continue;
    const sign = op.type === 'BUY' ? 1 : -1;
    bal[op.currency] = (bal[op.currency] ?? 0) + sign * Number(op.amount);
    bal['UAH'] = (bal['UAH'] ?? 0) - sign * Number(op.totalUah);
  }
  return bal;
}
