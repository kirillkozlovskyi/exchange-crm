import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, format } from 'date-fns';
import { usdtProfit } from '../common/usdt.util';
import { ExpensesService } from '../expenses/expenses.service';

/**
 * Фінансові підсумки по точках. Прибуток — ЄДИНА модель із закриттям зміни:
 * реалізований WAC (сума op.profit) + чиста маржа USDT. Сторновані операції не
 * входять ані в прибуток, ані в обсяг.
 */
@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private expenses: ExpensesService,
  ) {}

  async getDailySummary(date: Date = new Date()) {
    return this.summary(startOfDay(date), endOfDay(date));
  }

  async getWeeklySummary(date: Date = new Date()) {
    return this.summary(startOfWeek(date, { weekStartsOn: 1 }), endOfWeek(date, { weekStartsOn: 1 }));
  }

  async getMonthlySummary(date: Date = new Date()) {
    return this.summary(startOfMonth(date), endOfMonth(date));
  }

  /**
   * Серія «прибуток по днях» за останні N днів (для дашборда): сума op.profit
   * (реалізований WAC) + маржа USDT, згрупована по днях.
   */
  async getDailySeries(days = 14) {
    const n = Math.min(Math.max(Math.trunc(days) || 14, 1), 90);
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(new Date(), n - 1));

    const [operations, usdtOps] = await Promise.all([
      this.prisma.operation.findMany({
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        select: { createdAt: true, profit: true },
      }),
      this.prisma.usdtOperation.findMany({
        // Сторновані USDT-операції не входять у прибуток (як і валютні) — інакше
        // денна серія показувала маржу скасованих операцій.
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        select: { createdAt: true, profitUah: true },
      }),
    ]);

    const dayKey = (d: Date | string) => format(new Date(d), 'yyyy-MM-dd');
    const profitByDay: Record<string, number> = {};
    const countByDay: Record<string, number> = {};
    for (const op of operations) {
      const k = dayKey(op.createdAt);
      profitByDay[k] = (profitByDay[k] ?? 0) + Number(op.profit);
      countByDay[k] = (countByDay[k] ?? 0) + 1;
    }
    for (const u of usdtOps) {
      const k = dayKey(u.createdAt);
      profitByDay[k] = (profitByDay[k] ?? 0) + Number(u.profitUah);
    }

    const series: { date: string; profit: number; operations: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = format(subDays(new Date(), i), 'yyyy-MM-dd');
      series.push({
        date: key,
        profit: Math.round((profitByDay[key] ?? 0) * 100) / 100,
        operations: countByDay[key] ?? 0,
      });
    }
    return series;
  }

  private async summary(from: Date, to: Date) {
    const [operations, usdtOps] = await Promise.all([
      this.prisma.operation.findMany({
        // Скасовані (сторно) не входять у фінансові підсумки.
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        include: {
          shift: { include: { cashDesk: { include: { exchangePoint: true } } } },
          cashier: { select: { id: true, name: true } },
        },
      }),
      this.prisma.usdtOperation.findMany({
        // Сторновані не входять ані в маржу, ані в обʼєм/лічильник операцій.
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        include: {
          cashDesk: { include: { exchangePoint: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    type PointAgg = {
      pointName: string;
      totalProfit: number;
      operationsCount: number;
      byCurrency: Record<string, { volume: number; profit: number }>;
      _ops: typeof operations;
      _usdt: typeof usdtOps;
    };
    const byPoint: Record<string, PointAgg> = {};
    const pointOf = (op: { shift?: any; cashDesk?: any }) =>
      op.shift?.cashDesk?.exchangePoint ?? op.cashDesk?.exchangePoint;
    // Каса операції: для звичайних — через зміну, для USDT — напряму.
    const deskOf = (op: { shift?: any; cashDesk?: any }) =>
      op.shift?.cashDesk ?? op.cashDesk;

    const ensure = (point: { id: number; name: string }): PointAgg =>
      (byPoint[String(point.id)] ??= {
        pointName: point.name,
        totalProfit: 0,
        operationsCount: 0,
        byCurrency: {},
        _ops: [],
        _usdt: [],
      });

    // Прибуток беремо з op.profit (реалізований WAC, рахується при операції/закритті).
    // Обʼєм і прибуток групуємо по точці й валюті операції.
    for (const op of operations) {
      const point = pointOf(op);
      if (!point) continue;
      const agg = ensure(point);
      agg._ops.push(op);
      agg.operationsCount += 1;
      const opProfit = Number(op.profit);
      agg.totalProfit += opProfit;
      (agg.byCurrency[op.currency] ??= { volume: 0, profit: 0 });
      agg.byCurrency[op.currency].volume += Number(op.amount);
      agg.byCurrency[op.currency].profit += opProfit;
    }

    // USDT: чиста маржа (profitUah) + обʼєм, окремим рядком «USDT».
    for (const uop of usdtOps) {
      const point = pointOf(uop);
      if (!point) continue;
      const agg = ensure(point);
      agg._usdt.push(uop);
      const margin = usdtProfit([uop as any]);
      agg.operationsCount += 1;
      agg.totalProfit += margin;
      (agg.byCurrency.USDT ??= { volume: 0, profit: 0 });
      agg.byCurrency.USDT.volume += Number(uop.usdtAmount);
      agg.byCurrency.USDT.profit += margin;
    }

    // Витрати по точках за період → чистий прибуток = валовий − витрати.
    const expensesByPoint = await this.expenses.sumByPoint(from, to);

    // Точки, де були лише витрати (без операцій), теж показуємо.
    const missingIds = Object.keys(expensesByPoint)
      .map(Number)
      .filter((id) => !byPoint[String(id)]);
    if (missingIds.length) {
      const pts = await this.prisma.exchangePoint.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, name: true },
      });
      for (const p of pts) ensure(p);
    }

    // Прив'язуємо витрати й чистий прибуток по кожній точці за id + розбивку
    // прибутку по касах точки (валовий прибуток каси = спред її операцій + USDT-маржа).
    const points = Object.entries(byPoint).map(([pid, agg]) => {
      const { _ops, _usdt, ...rest } = agg;

      // Прибуток каси = сума op.profit її операцій (WAC) + USDT-маржа.
      const desks: Record<string, { deskName: string; profit: number; operationsCount: number }> = {};
      const ensureDesk = (d: { id: number; name: string }) =>
        (desks[String(d.id)] ??= { deskName: d.name, profit: 0, operationsCount: 0 });
      for (const op of _ops) { const d = deskOf(op); if (d) { const g = ensureDesk(d); g.profit += Number(op.profit); g.operationsCount += 1; } }
      for (const u of _usdt) { const d = deskOf(u); if (d) { const g = ensureDesk(d); g.profit += usdtProfit([u as any]); g.operationsCount += 1; } }
      const byDesk = Object.values(desks)
        .map((g) => ({ deskName: g.deskName, operationsCount: g.operationsCount, profit: g.profit }))
        .sort((a, b) => a.deskName.localeCompare(b.deskName));

      // Прибуток по КАСИРАХ точки: той самий касир може працювати на різних касах,
      // тому це окремий розріз, а не похідний від byDesk.
      const cashiers: Record<string, { cashierName: string; profit: number; operationsCount: number }> = {};
      const ensureCashier = (u: { id: number; name: string }) =>
        (cashiers[String(u.id)] ??= { cashierName: u.name, profit: 0, operationsCount: 0 });
      for (const op of _ops) {
        const u = (op as any).cashier;
        if (!u) continue;
        const g = ensureCashier(u);
        g.profit += Number(op.profit);
        g.operationsCount += 1;
      }
      for (const u of _usdt) {
        const who = (u as any).createdBy;
        if (!who) continue;
        const g = ensureCashier(who);
        g.profit += usdtProfit([u as any]);
        g.operationsCount += 1;
      }
      const byCashier = Object.values(cashiers).sort((a, b) => b.profit - a.profit);

      const expenses = expensesByPoint[Number(pid)] ?? 0;
      return { ...rest, expenses, netProfit: rest.totalProfit - expenses, byDesk, byCashier };
    });

    const totalProfit = points.reduce((s, p) => s + p.totalProfit, 0);
    const totalExpenses = points.reduce((s, p) => s + p.expenses, 0);
    const totalNetProfit = totalProfit - totalExpenses;
    return { totalProfit, totalExpenses, totalNetProfit, points };
  }
}
