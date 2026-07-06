import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Витрати точки (оренда, зарплати, комунальні тощо). Віднімаються від валового
// прибутку у Фінансах, щоб бачити чистий результат.
@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  private range(date?: string): { gte: Date; lte: Date } | undefined {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    return { gte: new Date(date + 'T00:00:00'), lte: new Date(date + 'T23:59:59.999') };
  }

  async findAll(params: { pointId?: number; date?: string } = {}) {
    const dateRange = this.range(params.date);
    return this.prisma.expense.findMany({
      where: {
        ...(params.pointId ? { exchangePointId: params.pointId } : {}),
        ...(dateRange ? { date: dateRange } : {}),
      },
      orderBy: { date: 'desc' },
      take: dateRange ? undefined : 500,
      include: { exchangePoint: { select: { name: true } } },
    });
  }

  async create(dto: { amount: number; category: string; note?: string; exchangePointId: number; date?: string }) {
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Сума витрати має бути більшою за 0');
    if (!dto.category?.trim()) throw new BadRequestException('Вкажіть категорію витрати');
    if (!dto.exchangePointId) throw new BadRequestException('Вкажіть точку');
    return this.prisma.expense.create({
      data: {
        amount,
        category: dto.category.trim(),
        note: dto.note?.trim() || null,
        exchangePointId: dto.exchangePointId,
        ...(dto.date && /^\d{4}-\d{2}-\d{2}$/.test(dto.date) ? { date: new Date(dto.date + 'T12:00:00') } : {}),
      },
    });
  }

  async remove(id: number) {
    const exists = await this.prisma.expense.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Витрату не знайдено');
    return this.prisma.expense.delete({ where: { id } });
  }

  /** Сума витрат по точках за період — для Фінансів. Повертає { [pointId]: сума }. */
  async sumByPoint(from: Date, to: Date): Promise<Record<number, number>> {
    const rows = await this.prisma.expense.groupBy({
      by: ['exchangePointId'],
      where: { date: { gte: from, lte: to } },
      _sum: { amount: true },
    });
    const map: Record<number, number> = {};
    for (const r of rows) map[r.exchangePointId] = Number(r._sum.amount ?? 0);
    return map;
  }
}
