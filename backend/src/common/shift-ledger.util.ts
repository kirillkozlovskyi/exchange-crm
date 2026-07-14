/**
 * Єдиний розрахунок поточної готівки зміни (ledger) — ОДНЕ джерело правди для
 * формули «старт + операції + рух готівки + USDT-готівка + підтверджені передачі».
 *
 * До рефакторингу ця формула збиралась вручну в 4+ місцях (closeShift, перевірка
 * інкасації, перевірка USDT BUY, загальний баланс компанії, фронт) і місця
 * розходились між собою: перевірка інкасації не знала про USDT/передачі й хибно
 * блокувала операції. Всі місця мають використовувати цей модуль.
 */

import { applyOperationsToBalance, BalanceOperation } from './balance.util';
import { cashMovementsDelta, CashMovementRow } from './cash-movements.util';
import { usdtCashDelta, UsdtOp } from './usdt.util';
import { netTransfers, TransferRow } from './transfers.util';

export interface ShiftCashParts {
  startBalance: Record<string, number>;
  operations: BalanceOperation[];
  cashMovements?: CashMovementRow[];
  usdtOperations?: UsdtOp[];
}

const addAll = (acc: Record<string, number>, delta: Record<string, number>) => {
  for (const [cur, d] of Object.entries(delta)) acc[cur] = (acc[cur] ?? 0) + d;
  return acc;
};

/**
 * Поточна готівка зміни. `transfersNet` — нетто підтверджених передач каси
 * (див. confirmedTransfersNetForDesk); передавайте {} якщо передачі не потрібні.
 */
export function shiftCashBalance(
  parts: ShiftCashParts,
  transfersNet: Record<string, number> = {},
): Record<string, number> {
  const bal = applyOperationsToBalance(parts.startBalance ?? {}, parts.operations ?? []);
  addAll(bal, cashMovementsDelta(parts.cashMovements ?? []));
  addAll(bal, usdtCashDelta(parts.usdtOperations ?? []));
  addAll(bal, transfersNet);
  return bal;
}

// Мінімальний контракт Prisma-клієнта, щоб утиліта лишалась тестованою без DI.
interface TransferQuerier {
  transfer: {
    findMany(args: unknown): Promise<
      {
        currency: string;
        amount: unknown;
        fromDeskId: number;
        toDeskId: number;
        counterCurrency: string | null;
        counterAmount: unknown | null;
      }[]
    >;
  };
}

/**
 * Підтверджені передачі каси від моменту `since` (зазвичай openedAt зміни).
 * `until` (closedAt) обовʼязковий для ЗАКРИТИХ змін: без верхньої межі передачі,
 * підтверджені вже на наступній зміні каси, потрапляли б і в закриту.
 */
export async function confirmedTransferRowsForDesk(
  prisma: TransferQuerier,
  deskId: number,
  since: Date,
  until?: Date | null,
): Promise<TransferRow[]> {
  const rows = await prisma.transfer.findMany({
    where: {
      status: 'CONFIRMED',
      confirmedAt: until ? { gte: since, lte: until } : { gte: since },
      OR: [{ fromDeskId: deskId }, { toDeskId: deskId }],
    },
    select: {
      currency: true,
      amount: true,
      fromDeskId: true,
      toDeskId: true,
      counterCurrency: true,
      counterAmount: true,
    },
  });
  return rows.map((t) => ({
    currency: t.currency,
    amount: Number(t.amount),
    fromDeskId: t.fromDeskId,
    toDeskId: t.toDeskId,
    counterCurrency: t.counterCurrency,
    counterAmount: t.counterAmount != null ? Number(t.counterAmount) : null,
  }));
}

/** Нетто підтверджених передач каси по валютах (＋отримано / −відправлено). */
export async function confirmedTransfersNetForDesk(
  prisma: TransferQuerier,
  deskId: number,
  since: Date,
  until?: Date | null,
): Promise<Record<string, number>> {
  return netTransfers(await confirmedTransferRowsForDesk(prisma, deskId, since, until), deskId);
}
