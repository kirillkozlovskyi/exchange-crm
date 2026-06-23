import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async getDailySummary(date: Date = new Date()) {
    const from = startOfDay(date);
    const to = endOfDay(date);

    const operations = await this.prisma.operation.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { shift: { include: { cashDesk: { include: { exchangePoint: true } } } } },
    });

    return this.aggregateByPoint(operations);
  }

  async getWeeklySummary(date: Date = new Date()) {
    const from = startOfWeek(date, { weekStartsOn: 1 });
    const to = endOfWeek(date, { weekStartsOn: 1 });

    const operations = await this.prisma.operation.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { shift: { include: { cashDesk: { include: { exchangePoint: true } } } } },
    });

    return this.aggregateByPoint(operations);
  }

  async getMonthlySummary(date: Date = new Date()) {
    const from = startOfMonth(date);
    const to = endOfMonth(date);

    const operations = await this.prisma.operation.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { shift: { include: { cashDesk: { include: { exchangePoint: true } } } } },
    });

    return this.aggregateByPoint(operations);
  }

  private aggregateByPoint(operations: any[]) {
    const byPoint: Record<string, { pointName: string; totalProfit: number; operationsCount: number; byCurrency: Record<string, { volume: number; profit: number }> }> = {};
    let totalProfit = 0;

    for (const op of operations) {
      const point = op.shift?.cashDesk?.exchangePoint;
      if (!point) continue;

      const key = String(point.id);
      if (!byPoint[key]) {
        byPoint[key] = { pointName: point.name, totalProfit: 0, operationsCount: 0, byCurrency: {} };
      }

      const profit = Number(op.profit) || 0;
      byPoint[key].totalProfit += profit;
      byPoint[key].operationsCount += 1;
      totalProfit += profit;

      if (!byPoint[key].byCurrency[op.currency]) {
        byPoint[key].byCurrency[op.currency] = { volume: 0, profit: 0 };
      }
      byPoint[key].byCurrency[op.currency].volume += Number(op.amount);
      byPoint[key].byCurrency[op.currency].profit += profit;
    }

    return { totalProfit, points: Object.values(byPoint) };
  }
}
