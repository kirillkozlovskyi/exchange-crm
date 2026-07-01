import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance, operationsDelta } from '../common/balance.util';
import { midRates, valueOf, realizedProfit } from '../common/profit.util';
import { netTransfers } from '../common/transfers.util';
import { cashMovementsDelta } from '../common/cash-movements.util';
import { usdtCashDelta, usdtProfit } from '../common/usdt.util';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    const count = await this.prisma.shift.count({
      where: { cashDesk: { exchangePoint: { code: pointCode } } },
    });
    return `${pointCode}-${date}-${String(count + 1).padStart(2, '0')}`;
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

    return this.prisma.shift.create({
      data: {
        number,
        cashDeskId,
        openedById: userId,
        startBalance,
      },
      include: { cashDesk: { include: { exchangePoint: true } }, openedBy: true },
    });
  }

  async closeShift(shiftId: number, endBalance?: object) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { operations: true, cashMovements: true, usdtOperations: true, cashDesk: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');

    const start = shift.startBalance as Record<string, number>;

    // Залишок до руху готівки (лише початок + операції) — база для прибутку.
    const opsBalance = applyOperationsToBalance(start, shift.operations);

    // Підкріплення/інкасації змінюють готівку каси, але це не торговий результат.
    const moveDelta = cashMovementsDelta(shift.cashMovements ?? []);

    // USDT-операції рухають фізичну готівку каси (settleCurrency) — це торгова
    // готівка (входить у прибуток окремою маржею), на відміну від руху готівки.
    const usdtDelta = usdtCashDelta((shift.usdtOperations as any) ?? []);

    // Розрахунковий залишок у касі = операції + USDT-готівка + рух готівки.
    const calcBalance: Record<string, number> = { ...opsBalance };
    for (const [cur, d] of Object.entries(usdtDelta)) {
      calcBalance[cur] = (calcBalance[cur] ?? 0) + d;
    }
    for (const [cur, d] of Object.entries(moveDelta)) {
      calcBalance[cur] = (calcBalance[cur] ?? 0) + d;
    }

    // Прибуток = реалізований спред «з відкупленого»: по кожній валюті
    // відкуплено = min(куплено, продано) × (сер.курс продажу − сер.курс купівлі);
    // непокрита позиція не оцінюється, крос — різниця за серединним курсом.
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
    });
    const valuation = midRates(
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    const realized = realizedProfit(shift.operations, valuation);
    // Прибуток USDT — чиста маржа (%) у гривні, окремим рядком «USDT».
    const usdtMargin = usdtProfit((shift.usdtOperations as any) ?? []);
    const profitByCurrency = { ...realized.byCurrency };
    if (Math.abs(usdtMargin) >= 0.005) profitByCurrency.USDT = usdtMargin;
    const profit = realized.total + usdtMargin;

    // Передачі між касами/точками — це рух готівки, а не торговий прибуток.
    // Вилучаємо їх із фактичного залишку, щоб отримана/відправлена валюта не
    // спотворювала фактичний результат зміни.
    const transfers = await this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      select: {
        currency: true, amount: true, fromDeskId: true, toDeskId: true,
        counterCurrency: true, counterAmount: true,
      },
    });
    const net = netTransfers(
      transfers.map((t) => ({
        currency: t.currency,
        amount: Number(t.amount),
        fromDeskId: t.fromDeskId,
        toDeskId: t.toDeskId,
        counterCurrency: t.counterCurrency,
        counterAmount: t.counterAmount != null ? Number(t.counterAmount) : null,
      })),
      shift.cashDeskId,
    );

    // Б1: підтверджені передачі/свопи рухають очікуваний залишок каси
    // (раніше їх не додавали — звідси фантомні розбіжності).
    for (const [cur, amt] of Object.entries(net)) {
      calcBalance[cur] = (calcBalance[cur] ?? 0) + amt;
    }

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
      },
    });
    // factualProfit, valuationRates, netTransfers і netCashMovements не зберігаються
    // (без зміни схеми) — повертаємо для звіту
    return { ...updated, factualProfit, profitByCurrency, valuationRates: valuation, netTransfers: net, netCashMovements: moveDelta, netUsdt: usdtDelta, usdtProfit: usdtMargin };
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
      include: { operations: true, cashMovements: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // Поточний залишок = початок + операції + рух готівки. Тож
    // newStartBalance[cur] = newCurrentBalance[cur] − opsDelta[cur] − moveDelta[cur].
    const opsDelta = operationsDelta(shift.operations);
    const moveDelta = cashMovementsDelta(shift.cashMovements ?? []);

    const startBalance = shift.startBalance as Record<string, number>;
    const newStartBalance: Record<string, number> = { ...startBalance };
    for (const [cur, newAmt] of Object.entries(newCurrentBalance)) {
      newStartBalance[cur] = newAmt - (opsDelta[cur] ?? 0) - (moveDelta[cur] ?? 0);
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
