import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance, operationsDelta } from '../common/balance.util';
import { midRates, shiftProfit } from '../common/profit.util';
import { netTransfers } from '../common/transfers.util';

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
      include: { operations: true, cashDesk: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');

    const start = shift.startBalance as Record<string, number>;

    // Розрахунковий залишок (скасовані операції не враховуються — фільтрує util)
    const calcBalance = applyOperationsToBalance(start, shift.operations);

    // Прибуток = приріст вартості каси за серединним курсом точки на момент закриття
    // (а не сума спредів по операціях, яка подвійно рахує спред).
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
    });
    const valuation = midRates(
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    const profit = shiftProfit(start, calcBalance, valuation);

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
    // мінус нетто-передачі (вони не належать до прибутку каси).
    const factualEnd: Record<string, number> = {
      ...((endBalance as Record<string, number>) ?? calcBalance),
    };
    for (const [cur, amt] of Object.entries(net)) {
      factualEnd[cur] = (factualEnd[cur] ?? 0) - amt;
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
    // factualProfit, valuationRates і netTransfers не зберігаються (без зміни схеми) — повертаємо для звіту
    return { ...updated, factualProfit, valuationRates: valuation, netTransfers: net };
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
      },
    });
  }

  async adjustBalance(shiftId: number, newCurrentBalance: Record<string, number>) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { operations: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // Обчислюємо дельту операцій: Σ(effectPerCurrency)
    const opsDelta = operationsDelta(shift.operations);

    // newStartBalance[cur] = newCurrentBalance[cur] - opsDelta[cur]
    const startBalance = shift.startBalance as Record<string, number>;
    const newStartBalance: Record<string, number> = { ...startBalance };
    for (const [cur, newAmt] of Object.entries(newCurrentBalance)) {
      newStartBalance[cur] = newAmt - (opsDelta[cur] ?? 0);
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
