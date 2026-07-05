// Єдиний розрахунок поточної готівки зміни (дзеркало backend/common/shift-ledger.util.ts):
// старт + операції + рух готівки + USDT-готівка + підтверджені передачі.
// Використовуйте його замість ручної збірки з окремих утиліт — саме розсинхрон
// ручних збірок давав хибні «недостатньо коштів».

import { computeCurrentBalance, type BalanceOperation } from './balance';
import { cashMovementsDelta, type CashMovementRow } from './cash-movements';
import { usdtCashDelta, type UsdtOpRow } from './usdt';
import { netTransfers, type TransferRow } from './transfers';

export interface ShiftCashParts {
  startBalance?: Record<string, number>;
  operations?: BalanceOperation[];
  cashMovements?: CashMovementRow[];
  usdtOperations?: UsdtOpRow[];
}

const addAll = (acc: Record<string, number>, delta: Record<string, number>) => {
  for (const [cur, d] of Object.entries(delta)) acc[cur] = (acc[cur] ?? 0) + d;
  return acc;
};

/** Поточна готівка зміни. Передачі — або готовий нетто-обʼєкт, або rows+deskId. */
export function shiftCashBalance(
  parts: ShiftCashParts,
  transfersNet: Record<string, number> = {},
): Record<string, number> {
  const bal = computeCurrentBalance(parts.startBalance ?? {}, parts.operations ?? []);
  addAll(bal, cashMovementsDelta(parts.cashMovements ?? []));
  addAll(bal, usdtCashDelta(parts.usdtOperations ?? []));
  addAll(bal, transfersNet);
  return bal;
}

/** Зручний хелпер, коли на руках сирі передачі. */
export function shiftCashBalanceWithTransfers(
  parts: ShiftCashParts,
  transfers: TransferRow[],
  deskId: number | null | undefined,
): Record<string, number> {
  const net = deskId != null ? netTransfers(transfers, deskId) : {};
  return shiftCashBalance(parts, net);
}
