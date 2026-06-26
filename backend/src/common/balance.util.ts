/**
 * Спільна логіка розрахунку залишку каси на основі операцій зміни.
 * Використовується в ShiftsService (закриття зміни, коригування балансу).
 *
 * Форми операцій (скасовані cancelled не враховуються):
 *  • SELL  (валюта + payCurrency=NULL): каса віддає amount валюти, отримує totalUah UAH.
 *  • BUY   (валюта + payCurrency=NULL): каса отримує amount валюти, віддає totalUah UAH.
 *  • Крос  (currency і payCurrency — обидві валюти): каса отримує payAmount payCurrency,
 *          віддає amount currency. Гривня не рухається.
 *  • Старий BUY (currency='UAH' + payCurrency=валюта): каса отримує payAmount валюти,
 *          віддає totalUah UAH. (До міграції 20260626120000.)
 */

export interface BalanceOperation {
  type: string; // 'BUY' | 'SELL' | 'EXCHANGE'
  currency: string;
  amount: unknown; // Prisma.Decimal | number | string
  totalUah: unknown;
  payCurrency?: string | null;
  payAmount?: unknown;
  cancelled?: boolean;
}

/** Чистий вплив операцій на залишок по кожній валюті (без початкового балансу). */
export function operationsDelta(operations: BalanceOperation[]): Record<string, number> {
  const delta: Record<string, number> = {};
  const add = (cur: string, amt: number) => {
    delta[cur] = (delta[cur] ?? 0) + amt;
  };
  for (const op of operations) {
    if (op.cancelled) continue;
    const amount = Number(op.amount);
    const totalUah = Number(op.totalUah);
    const payCur = op.payCurrency;
    const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

    if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
      // Крос: отримали payCurrency, віддали currency (без UAH)
      add(payCur, payAmount);
      add(op.currency, -amount);
    } else if (payCur && payCur !== 'UAH') {
      // Старий формат BUY: отримали payCurrency, віддали UAH
      add(payCur, payAmount);
      add('UAH', -totalUah);
    } else {
      // Класичні SELL/BUY: одна валюта + UAH
      const sign = op.type === 'BUY' ? 1 : -1;
      add(op.currency, sign * amount);
      add('UAH', -sign * totalUah);
    }
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
