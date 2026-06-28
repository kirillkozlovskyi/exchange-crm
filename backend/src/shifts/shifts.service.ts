import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance, operationsDelta } from '../common/balance.util';
import { midRates, shiftProfit } from '../common/profit.util';
import { netTransfers } from '../common/transfers.util';
import { cashMovementsDelta } from '../common/cash-movements.util';

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
      include: { operations: true, cashMovements: true, cashDesk: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');

    const start = shift.startBalance as Record<string, number>;

    // Залишок до руху готівки (лише початок + операції) — база для прибутку.
    const opsBalance = applyOperationsToBalance(start, shift.operations);

    // Підкріплення/інкасації змінюють готівку каси, але це не торговий результат.
    const moveDelta = cashMovementsDelta(shift.cashMovements ?? []);

    // Розрахунковий залишок, який має бути фізично в касі = операції + рух готівки.
    const calcBalance: Record<string, number> = { ...opsBalance };
    for (const [cur, d] of Object.entries(moveDelta)) {
      calcBalance[cur] = (calcBalance[cur] ?? 0) + d;
    }

    // Прибуток = приріст вартості каси за серединним курсом точки на момент закриття
    // (а не сума спредів по операціях, яка подвійно рахує спред). Рахуємо за
    // балансом ДО руху готівки — підкріплення/інкасації не є результатом зміни.
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
    });
    const valuation = midRates(
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    const profit = shiftProfit(start, opsBalance, valuation);

    // Передачі між касами/точками — це рух готівки, а не торговий прибуток.
    // Вилучаємо їх із фактичного залишку, щоб отримана/відправлена валюта не
    // спотворювала фактичний результат зміни.
    const transfers = await this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      select: { currency: true, amount: true, fromDeskId: true, toDeskId: true },
    });
    const net = netTransfers(
      transfers.map((t) => ({
        currency: t.currency,
        amount: Number(t.amount),
        fromDeskId: t.fromDeskId,
        toDeskId: t.toDeskId,
      })),
      shift.cashDeskId,
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
    const factualProfit = shiftProfit(start, factualEnd, valuation);

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
    return { ...updated, factualProfit, valuationRates: valuation, netTransfers: net, netCashMovements: moveDelta };
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

  async getActiveShift(cashDeskId: number) {
    return this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: true,
        operations: { orderBy: { createdAt: 'desc' } },
        cashMovements: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async getShiftById(id: number) {
    return this.prisma.shift.findUnique({
      where: { id },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: true,
        operations: { orderBy: { createdAt: 'desc' } },
        cashMovements: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async getMyActiveShift(userId: number) {
    return this.prisma.shift.findFirst({
      where: { openedById: userId, status: 'OPEN' },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: true,
        operations: { orderBy: { createdAt: 'desc' } },
        cashMovements: { orderBy: { createdAt: 'desc' } },
      },
    });
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
