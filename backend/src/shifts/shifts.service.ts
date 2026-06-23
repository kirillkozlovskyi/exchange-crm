import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';

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
      include: { operations: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');

    const profit = shift.operations.reduce(
      (sum, op) => sum + Number(op.profit), 0,
    );

    // Розраховуємо розрахунковий залишок
    const calcBalance = { ...shift.startBalance as object };
    for (const op of shift.operations) {
      const cur = op.currency;
      const prev = calcBalance[cur] || 0;
      if (op.type === 'BUY') {
        calcBalance[cur] = prev + Number(op.amount);
        calcBalance['UAH'] = (calcBalance['UAH'] || 0) - Number(op.totalUah);
      } else {
        calcBalance[cur] = prev - Number(op.amount);
        calcBalance['UAH'] = (calcBalance['UAH'] || 0) + Number(op.totalUah);
      }
    }

    return this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        endBalance,
        calcBalance,
        profit,
      },
    });
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
