/**
 * Спільна логіка розрахунку залишку каси на основі операцій зміни.
 * Використовується в ShiftsService (закриття зміни, коригування балансу).
 *
 * Правило: BUY — каса отримує валюту (+amount) і віддає гривню (-totalUah);
 * SELL/EXCHANGE — навпаки. Скасовані (cancelled) операції не враховуються.
 */

export interface BalanceOperation {
  type: string; // 'BUY' | 'SELL' | 'EXCHANGE'
  currency: string;
  amount: unknown; // Prisma.Decimal | number | string
  totalUah: unknown;
  cancelled?: boolean;
}

/** Чистий вплив операцій на залишок по кожній валюті (без початкового балансу). */
export function operationsDelta(operations: BalanceOperation[]): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const op of operations) {
    if (op.cancelled) continue;
    const sign = op.type === 'BUY' ? 1 : -1;
    delta[op.currency] = (delta[op.currency] ?? 0) + sign * Number(op.amount);
    delta['UAH'] = (delta['UAH'] ?? 0) - sign * Number(op.totalUah);
  }
  return delta;
}

/** Початковий баланс + дельта операцій = поточний (розрахунковий) залишок. */
export function applyOperationsToBalance(
  startBalance: Record<string, number>,
  operations: BalanceOperation[],
): Record<string, number> {
  const result: Record<string, number> = { ...startBalance };
  const delta = operationsDelta(operations);
  for (const [cur, d] of Object.entries(delta)) {
    result[cur] = (result[cur] ?? 0) + d;
  }
  return result;
}
