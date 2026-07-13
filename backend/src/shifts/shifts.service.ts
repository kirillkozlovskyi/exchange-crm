import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance, operationsDelta } from '../common/balance.util';
import { midRates, valueOf } from '../common/profit.util';
import { cashMovementsDelta } from '../common/cash-movements.util';
import { usdtCashDelta, usdtProfit } from '../common/usdt.util';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';
import { nextDocNumber } from '../common/number-seq.util';

import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfitService } from '../profit/profit.service';

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private profit: ProfitService,
    // optional: юніт-тести створюють сервіс без телеграма/сповіщень
    private telegram?: TelegramService,
    private notifications?: NotificationsService,
  ) {}

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    // Глобальна sequence (раніше — count по точці, що гонило дублікати номерів).
    const seq = await nextDocNumber(this.prisma, 'shift_number_seq');
    return `${pointCode}-${date}-${String(seq).padStart(2, '0')}`;
  }

  async openShift(cashDeskId: number, userId: number, startBalance: object) {
    const existing = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('Зміна вже відкрита на цій касі');

    const desk = await this.prisma.cashDesk.findUnique({
      where: { id: cashDeskId },
      include: { exchangePoint: true },
    });
    if (!desk) throw new NotFoundException('Каса не знайдена');

    const number = await this.generateNumber(desk.exchangePoint.code);

    try {
      const created = await this.prisma.shift.create({
        data: {
          number,
          cashDeskId,
          openedById: userId,
          startBalance,
        },
        include: { cashDesk: { include: { exchangePoint: true } }, openedBy: true },
      });
      // Сповіщення в Telegram (fire-and-forget; без токена — просто лог-скіп)
      void this.telegram?.notifyShiftOpened(
        created.number,
        created.openedBy?.name ?? '',
        created.cashDesk?.exchangePoint?.name ?? '',
      );
      return created;
    } catch (e: any) {
      // Unique-індекс Shift_desk_open_key: гонка подвійного відкриття (подвійний клік).
      if (e?.code === 'P2002')
        throw new BadRequestException('Зміна вже відкрита на цій касі');
      throw e;
    }
  }

  async closeShift(
    shiftId: number,
    endBalance?: object,
    // Хто закриває: касир може закрити лише СВОЮ зміну; адмін/старший — будь-яку.
    actor?: { sub: number; role: string },
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operations: true,
        cashMovements: true,
        usdtOperations: true,
        cashDesk: true,
        openedBy: { select: { name: true } },
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');
    if (actor && actor.role !== 'ADMIN' && shift.openedById !== actor.sub)
      throw new BadRequestException('Закрити можна лише власну зміну');

    const start = shift.startBalance as Record<string, number>;

    // Залишок до руху готівки (лише початок + операції) — база для прибутку.
    const opsBalance = applyOperationsToBalance(start, shift.operations);

    // Підкріплення/інкасації змінюють готівку каси, але це не торговий результат.
    const moveDelta = cashMovementsDelta(shift.cashMovements ?? []);

    // USDT-операції рухають фізичну готівку каси (settleCurrency) — це торгова
    // готівка (входить у прибуток окремою маржею), на відміну від руху готівки.
    const usdtDelta = usdtCashDelta((shift.usdtOperations as any) ?? []);

    // Прибуток за WAC (Варіант 1): продаж реалізується проти ковзної собівартості,
    // яка ПЕРЕНОСИТЬСЯ між змінами. Продаж наявного запасу дає прибуток одразу,
    // навіть без купівлі в цій зміні. Непроданий запас не переоцінюється.
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
    });
    // Серединні курси — лише для оцінки нестачі/надлишку каси (не для прибутку).
    const valuation = midRates(
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    const wac = await this.profit.computeShift({
      cashDeskId: shift.cashDeskId,
      exchangePointId: shift.cashDesk.exchangePointId,
      startBalance: start,
      operations: shift.operations as any,
    });
    // Прибуток USDT — чиста маржа (%) у гривні, окремим рядком «USDT».
    const usdtMargin = usdtProfit((shift.usdtOperations as any) ?? []);
    const profitByCurrency: Record<string, number> = { ...wac.byCurrency };
    if (Math.abs(usdtMargin) >= 0.005) profitByCurrency.USDT = usdtMargin;
    const profit = wac.totalRealized + usdtMargin;

    // Передачі між касами/точками — це рух готівки, а не торговий прибуток.
    // Вилучаємо їх із фактичного залишку, щоб отримана/відправлена валюта не
    // спотворювала фактичний результат зміни.
    const net = await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt);

    // Розрахунковий (очікуваний фізичний) залишок — єдиний ledger-розрахунок:
    // операції + USDT-готівка + рух готівки + підтверджені передачі/свопи (Б1).
    const calcBalance = shiftCashBalance(
      {
        startBalance: start,
        operations: shift.operations,
        cashMovements: shift.cashMovements ?? [],
        usdtOperations: (shift.usdtOperations as any) ?? [],
      },
      net,
    );

    // Фактичний результат (з нестачею/надлишком касира) — за введеним залишком,
    // з якого вилучаємо нетто-передачі та рух готівки (підкріплення/інкасації):
    // жодне з них не належить до прибутку каси.
    const factualEnd: Record<string, number> = {
      ...((endBalance as Record<string, number>) ?? calcBalance),
    };
    for (const [cur, amt] of Object.entries(net)) {
      factualEnd[cur] = (factualEnd[cur] ?? 0) - amt;
    }
    for (const [cur, d] of Object.entries(moveDelta)) {
      factualEnd[cur] = (factualEnd[cur] ?? 0) - d; // IN(+)→прибираємо, OUT(−)→повертаємо
    }
    // Очікувана торгова готівка = операції + USDT-готівка (рух готівки/передачі
    // не входять — їх вилучено з factualEnd вище). Порівнюємо з фактично введеним.
    const expectedTrading: Record<string, number> = { ...opsBalance };
    for (const [cur, d] of Object.entries(usdtDelta)) {
      expectedTrading[cur] = (expectedTrading[cur] ?? 0) + d;
    }
    // Фактичний результат = прибуток (спред + маржа USDT) + нестача/надлишок каси
    // (різниця між фактично введеним і очікуваним залишком за серединним курсом).
    const surplusShort = valueOf(factualEnd, valuation) - valueOf(expectedTrading, valuation);
    const factualProfit = profit + surplusShort;

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        endBalance,
        calcBalance,
        profit,
        // Звіт закриття зберігаємо: історія не залежить від подальших курсів.
        factualProfit,
        profitByCurrency,
        valuationRates: valuation,
      },
    });
    // Переносимо ковзну собівартість на наступну зміну цієї каси + записуємо
    // реалізований прибуток кожної операції (для фінансів/живого підрахунку).
    await this.profit.saveBasis(shift.cashDeskId, wac.ending);
    const opUpdates = wac.ops
      .map((o: any, i: number) => (o.id != null ? { id: o.id, profit: wac.perOp[i] } : null))
      .filter((x): x is { id: number; profit: number } => x != null);
    if (opUpdates.length) {
      await this.prisma.$transaction(
        opUpdates.map((u) => this.prisma.operation.update({ where: { id: u.id }, data: { profit: u.profit } })),
      );
    }

    // Сповіщення в Telegram + центр сповіщень адміна (fire-and-forget)
    const who = (shift as any).openedBy?.name ?? '';
    void this.telegram?.notifyShiftClosed(shift.number, who, profit, factualProfit);
    void this.notifications?.notifyAdmins(
      `Зміну №${shift.number} закрито (${who}). Прибуток: ${factualProfit.toFixed(2)} ₴`,
    );

    return { ...updated, netTransfers: net, netCashMovements: moveDelta, netUsdt: usdtDelta, usdtProfit: usdtMargin };
  }

  // Залишок із закриття останньої зміни цієї каси — для префілу при відкритті нової.
  async getLastEndBalance(cashDeskId: number) {
    const last = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      select: { number: true, closedAt: true, endBalance: true },
    });
    return {
      endBalance: (last?.endBalance as Record<string, number>) ?? {},
      from: last ? { number: last.number, closedAt: last.closedAt } : null,
    };
  }

  // Підтверджені передачі/свопи каси з моменту відкриття зміни — щоб поточний
  // баланс ураховував рух готівки між касами (Б1/Б2).
  private async confirmedTransfersForShift(
    shift: { cashDeskId: number; openedAt: Date } | null,
  ) {
    if (!shift) return [];
    return this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      select: {
        id: true, number: true, currency: true, amount: true,
        fromDeskId: true, toDeskId: true,
        counterCurrency: true, counterAmount: true, confirmedAt: true,
      },
      orderBy: { confirmedAt: 'desc' },
    });
  }

  private readonly activeShiftInclude = {
    cashDesk: { include: { exchangePoint: true } },
    openedBy: true,
    operations: { orderBy: { createdAt: 'desc' as const } },
    cashMovements: { orderBy: { createdAt: 'desc' as const } },
    usdtOperations: { orderBy: { createdAt: 'desc' as const } },
  };

  async getActiveShift(cashDeskId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
      include: this.activeShiftInclude,
    });
    if (!shift) return shift;
    return { ...shift, confirmedTransfers: await this.confirmedTransfersForShift(shift) };
  }

  async getShiftById(id: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        ...this.activeShiftInclude,
        reconciliations: {
          include: { createdBy: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shift) return shift;
    return { ...shift, confirmedTransfers: await this.confirmedTransfersForShift(shift) };
  }

  /**
   * Повний звіт по зміні (для адмінки, кнопка «Скачати звіт»): усі сирі дані
   * (операції з історією редагувань, рух готівки, USDT, передачі, звірки) +
   * розраховані блоки (оборот, ledger-дельти, розбіжність, собівартість WAC).
   * Призначення — вивантаження повного набору даних зміни для аналізу.
   */
  async getShiftReport(id: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: { select: { id: true, name: true } },
        operations: {
          orderBy: { createdAt: 'asc' },
          include: {
            cashier: { select: { id: true, name: true } },
            edits: {
              orderBy: { editedAt: 'asc' },
              include: { editedBy: { select: { id: true, name: true } } },
            },
          },
        },
        cashMovements: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        usdtOperations: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        reconciliations: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');

    // Підтверджені передачі каси за зміну — з іменами кас і користувачів.
    const transfers = await this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      orderBy: { confirmedAt: 'asc' },
      include: {
        fromDesk: { select: { id: true, name: true } },
        toDesk: { select: { id: true, name: true } },
        sentBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
    });

    // Оборот по валютах: куплено/продано (к-сть, грн, середній курс) — як у деталях зміни.
    const turnover: Record<string, { boughtQty: number; boughtUah: number; soldQty: number; soldUah: number }> = {};
    const ensure = (c: string) => (turnover[c] ??= { boughtQty: 0, boughtUah: 0, soldQty: 0, soldUah: 0 });
    for (const op of shift.operations) {
      if (op.cancelled) continue;
      const amount = Number(op.amount);
      const totalUah = Number(op.totalUah);
      const payCur = op.payCurrency;
      const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;
      if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      } else if (payCur && payCur !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
      } else if (op.type === 'BUY') {
        const b = ensure(op.currency); b.boughtQty += amount; b.boughtUah += totalUah;
      } else {
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      }
    }
    const turnoverRows = Object.entries(turnover)
      .map(([currency, t]) => ({
        currency, ...t,
        avgBuyRate: t.boughtQty > 0 ? t.boughtUah / t.boughtQty : null,
        avgSellRate: t.soldQty > 0 ? t.soldUah / t.soldQty : null,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    // Ledger-дельти по складових + повний розрахунковий залишок.
    const transfersNet = await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt);
    const opsDelta = operationsDelta(shift.operations);
    const movesDelta = cashMovementsDelta(shift.cashMovements);
    const usdtDelta = usdtCashDelta(shift.usdtOperations as any);
    const calcBalanceLive = shiftCashBalance(
      {
        startBalance: shift.startBalance as Record<string, number>,
        operations: shift.operations,
        cashMovements: shift.cashMovements,
        usdtOperations: shift.usdtOperations as any,
      },
      transfersNet,
    );

    // Розбіжність факт/розрахунок по валютах (лише для закритих).
    let discrepancy: Record<string, number> | null = null;
    if (shift.status === 'CLOSED') {
      const calc = shift.calcBalance as Record<string, number>;
      const end = shift.endBalance as Record<string, number>;
      discrepancy = {};
      for (const cur of new Set([...Object.keys(calc ?? {}), ...Object.keys(end ?? {})])) {
        const d = Number(end?.[cur] ?? 0) - Number(calc?.[cur] ?? 0);
        if (Math.abs(d) >= 0.005) discrepancy[cur] = d;
      }
    }

    // Контекст моделі прибутку: перехідна собівартість каси (WAC) і активні курси точки.
    const [costBasis, activeRates] = await Promise.all([
      this.profit.getBasis(shift.cashDeskId),
      this.prisma.rate.findMany({
        where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
        select: { currency: true, buy: true, sell: true, updatedAt: true },
      }),
    ]);

    const { operations, cashMovements, usdtOperations, reconciliations, ...shiftMeta } = shift;
    return {
      reportVersion: 1,
      generatedAt: new Date(),
      shift: shiftMeta,
      operations,
      cashMovements,
      usdtOperations,
      transfers,
      reconciliations,
      turnover: turnoverRows,
      ledger: {
        startBalance: shift.startBalance,
        operationsDelta: opsDelta,
        cashMovementsDelta: movesDelta,
        usdtCashDelta: usdtDelta,
        transfersNet,
        calcBalanceLive,
      },
      discrepancy,
      usdtSummary: {
        margin: usdtProfit(shift.usdtOperations as any),
        cashDelta: usdtDelta,
      },
      wacCostBasis: costBasis,
      activeRates,
    };
  }

  // Список змін (для адмінки) — фільтр по точці/касі, найновіші перші.
  async listShifts(pointId?: number, deskId?: number) {
    return this.prisma.shift.findMany({
      where: {
        ...(deskId ? { cashDeskId: deskId } : {}),
        ...(pointId ? { cashDesk: { exchangePointId: pointId } } : {}),
      },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: { select: { name: true } },
        _count: { select: { operations: true, cashMovements: true, reconciliations: true, usdtOperations: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 300,
    });
  }

  async getMyActiveShift(userId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { openedById: userId, status: 'OPEN' },
      include: this.activeShiftInclude,
    });
    if (!shift) return shift;
    return { ...shift, confirmedTransfers: await this.confirmedTransfersForShift(shift) };
  }

  async adjustBalance(shiftId: number, newCurrentBalance: Record<string, number>) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { operations: true, cashMovements: true, usdtOperations: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // Поточний залишок — єдиний ledger-розрахунок (операції + рух готівки +
    // USDT-готівка + передачі). Дельта = ledger із нульовим стартом, тож
    // newStartBalance[cur] = newCurrentBalance[cur] − delta[cur].
    // (Раніше USDT/передачі не враховувались — коригування псувало startBalance.)
    const delta = shiftCashBalance(
      {
        startBalance: {},
        operations: shift.operations,
        cashMovements: shift.cashMovements ?? [],
        usdtOperations: (shift.usdtOperations as any) ?? [],
      },
      await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
    );

    const startBalance = shift.startBalance as Record<string, number>;
    const newStartBalance: Record<string, number> = { ...startBalance };
    for (const [cur, newAmt] of Object.entries(newCurrentBalance)) {
      newStartBalance[cur] = newAmt - (delta[cur] ?? 0);
    }

    return this.prisma.shift.update({
      where: { id: shiftId },
      data: { startBalance: newStartBalance },
    });
  }

  async getAllActiveShifts() {
    return this.prisma.shift.findMany({
      where: { status: 'OPEN' },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: true,
        _count: { select: { operations: true } },
      },
    });
  }
}
