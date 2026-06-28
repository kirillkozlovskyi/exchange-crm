import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance } from '../common/balance.util';
import { applyCashMovements } from '../common/cash-movements.util';

type Direction = 'IN' | 'OUT';

@Injectable()
export class CashMovementsService {
  constructor(private prisma: PrismaService) {}

  // Окрема нумерація для підкріплень (REP-) та інкасацій (INC-).
  private async generateNumber(direction: Direction) {
    const date = format(new Date(), 'yyyyMMdd');
    const prefix = direction === 'IN' ? 'REP' : 'INC';
    const count = await this.prisma.cashMovement.count({ where: { direction } });
    return `${prefix}-${date}-${String(count + 1).padStart(4, '0')}`;
  }

  // Касир створює рух готівки на відкритій зміні своєї каси.
  //  • IN  (підкріплення) — готівка приходить, перевірка залишку не потрібна.
  //  • OUT (інкасація) — готівка йде, перевіряємо достатній залишок.
  async create(
    dto: {
      shiftId: number;
      direction: Direction;
      currency: string;
      amount: number;
      source?: string;
      note?: string;
    },
    userId: number,
  ) {
    const amount = Number(dto.amount);
    const direction: Direction = dto.direction === 'IN' ? 'IN' : 'OUT';
    if (!dto.currency) throw new BadRequestException('Не вказано валюту');
    if (!(amount > 0)) throw new BadRequestException('Сума має бути більшою за 0');

    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: { operations: true, cashMovements: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status !== 'OPEN')
      throw new BadRequestException('Рух готівки можливий лише при відкритій зміні');

    if (direction === 'OUT') {
      // Поточний залишок каси = початок + операції + рух готівки.
      const start = shift.startBalance as Record<string, number>;
      const afterOps = applyOperationsToBalance(start, shift.operations);
      const available = applyCashMovements(afterOps, shift.cashMovements);
      const have = available[dto.currency] ?? 0;
      if (have < amount) {
        throw new BadRequestException(
          `Недостатньо ${dto.currency}: в касі ${have.toFixed(2)}, інкасуєте ${amount.toFixed(2)}`,
        );
      }
    }

    const number = await this.generateNumber(direction);
    return this.prisma.cashMovement.create({
      data: {
        number,
        direction,
        currency: dto.currency,
        amount,
        source: dto.source,
        note: dto.note,
        shiftId: shift.id,
        cashDeskId: shift.cashDeskId,
        createdById: userId,
      },
      include: { createdBy: { select: { name: true } } },
    });
  }

  // Рух готівки конкретної зміни (для історії в касі та закриття зміни).
  async getForShift(shiftId: number) {
    return this.prisma.cashMovement.findMany({
      where: { shiftId },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Усі рухи готівки (адмінка), опційно по касі та/або напрямку. Найновіші перші.
  async getAll(cashDeskId?: number, direction?: Direction) {
    return this.prisma.cashMovement.findMany({
      where: {
        ...(cashDeskId ? { cashDeskId } : {}),
        ...(direction ? { direction } : {}),
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
