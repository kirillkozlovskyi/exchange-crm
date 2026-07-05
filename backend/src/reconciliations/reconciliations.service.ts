import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class ReconciliationsService {
  constructor(
    private prisma: PrismaService,
    private telegram?: TelegramService,
  ) {}

  // Касир створює звірку: зберігаємо розрахунковий та фактичний залишок + ознаку розбіжності.
  async create(
    dto: { shiftId: number; expected: Record<string, number>; actual: Record<string, number>; note?: string },
    userId: number,
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      select: {
        id: true,
        cashDeskId: true,
        cashDesk: { select: { name: true, exchangePoint: { select: { name: true } } } },
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');

    const expected = dto.expected ?? {};
    const actual = dto.actual ?? {};
    const currencies = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const hasDiscrepancy = [...currencies].some(
      (c) => Math.abs((Number(actual[c]) || 0) - (Number(expected[c]) || 0)) >= 0.01,
    );

    // Розбіжність — сповіщаємо власника в Telegram (fire-and-forget).
    if (hasDiscrepancy) {
      const diffs = [...currencies]
        .map((c) => {
          const exp = Number(expected[c]) || 0;
          const act = Number(actual[c]) || 0;
          const d = act - exp;
          return Math.abs(d) >= 0.01
            ? `${c}: факт ${act.toFixed(2)} / очік. ${exp.toFixed(2)} (<b>${d > 0 ? '+' : ''}${d.toFixed(2)}</b>)`
            : null;
        })
        .filter((s): s is string => !!s);
      void (async () => {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        await this.telegram?.notifyDiscrepancy(
          `${shift.cashDesk?.exchangePoint?.name ?? ''} · ${shift.cashDesk?.name ?? ''}`,
          user?.name ?? '',
          diffs,
        );
      })().catch(() => {});
    }

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
