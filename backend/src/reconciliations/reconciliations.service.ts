import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReconciliationsService {
  constructor(private prisma: PrismaService) {}

  // Касир створює звірку: зберігаємо розрахунковий та фактичний залишок + ознаку розбіжності.
  async create(
    dto: { shiftId: number; expected: Record<string, number>; actual: Record<string, number>; note?: string },
    userId: number,
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      select: { id: true, cashDeskId: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');

    const expected = dto.expected ?? {};
    const actual = dto.actual ?? {};
    const currencies = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const hasDiscrepancy = [...currencies].some(
      (c) => Math.abs((Number(actual[c]) || 0) - (Number(expected[c]) || 0)) >= 0.01,
    );

    return this.prisma.reconciliation.create({
      data: {
        shiftId: shift.id,
        cashDeskId: shift.cashDeskId,
        createdById: userId,
        expected,
        actual,
        hasDiscrepancy,
        note: dto.note,
      },
    });
  }

  // Усі звірки, опційно по касі або зміні. Найновіші перші.
  async getAll(cashDeskId?: number, shiftId?: number) {
    return this.prisma.reconciliation.findMany({
      where: {
        ...(cashDeskId ? { cashDeskId } : {}),
        ...(shiftId ? { shiftId } : {}),
      },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        createdBy: { select: { name: true } },
        shift: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
