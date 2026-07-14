import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';
import { nextDocNumber } from '../common/number-seq.util';
import { CashBankService } from '../cash-bank/cash-bank.service';
import { SettingsService } from '../settings/settings.service';

type Direction = 'IN' | 'OUT';

@Injectable()
export class CashMovementsService {
  constructor(
    private prisma: PrismaService,
    private cashBank: CashBankService,
    private settings: SettingsService,
  ) {}

  // Окрема нумерація для підкріплень (REP-) та інкасацій (INC-).
  private async generateNumber(direction: Direction) {
    const date = format(new Date(), 'yyyyMMdd');
    const prefix = direction === 'IN' ? 'REP' : 'INC';
    const seq = await nextDocNumber(
      this.prisma,
      direction === 'IN' ? 'cash_movement_in_seq' : 'cash_movement_out_seq',
    );
    return `${prefix}-${date}-${String(seq).padStart(4, '0')}`;
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
      counterparty?: string; // 'BANK' | 'EXTERNAL' — контрагент руху
      note?: string;
    },
    userId: number,
  ) {
    const amount = Number(dto.amount);
    const direction: Direction = dto.direction === 'IN' ? 'IN' : 'OUT';
    // Банк можна вимкнути в налаштуваннях — тоді жоден рух не чіпає банк, навіть
    // якщо клієнт (стара вкладка, прямий запит) надішле counterparty=BANK.
    const bankEnabled = await this.settings.getCashBankEnabled();
    const counterparty = dto.counterparty === 'BANK' && bankEnabled ? 'BANK' : 'EXTERNAL';
    if (!dto.currency) throw new BadRequestException('Не вказано валюту');
    if (!(amount > 0)) throw new BadRequestException('Сума має бути більшою за 0');

    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: { operations: true, cashMovements: true, usdtOperations: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status !== 'OPEN')
      throw new BadRequestException('Рух готівки можливий лише при відкритій зміні');

    if (direction === 'OUT') {
      // Поточний залишок каси — єдиний ledger-розрахунок (операції + рух готівки +
      // USDT-готівка + передачі), той самий, що бачить касир на екрані.
      const available = shiftCashBalance(
        {
          startBalance: shift.startBalance as Record<string, number>,
          operations: shift.operations,
          cashMovements: shift.cashMovements,
          usdtOperations: shift.usdtOperations as any,
        },
        await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
      );
      const have = available[dto.currency] ?? 0;
      if (have < amount) {
        throw new BadRequestException(
          `Недостатньо ${dto.currency}: в касі ${have.toFixed(2)}, інкасуєте ${amount.toFixed(2)}`,
        );
      }
    }

    const number = await this.generateNumber(direction);

    // Рух банку (контрагент BANK) і рух готівки каси — ОДНА транзакція: якщо
    // створення CashMovement впаде (напр., гонка нумерації), рух банку
    // відкотиться разом із ним, і баланс компанії не розʼїдеться.
    return this.prisma.$transaction(async (tx) => {
      if (counterparty === 'BANK') {
        await this.cashBank.applyForCashMovement(
          {
            direction,
            currency: dto.currency,
            amount,
            cashDeskId: shift.cashDeskId,
            userId,
            note: dto.note,
          },
          tx,
        );
      }

      return tx.cashMovement.create({
        data: {
          number,
          direction,
          currency: dto.currency,
          amount,
          source: dto.source,
          counterparty,
          note: dto.note,
          shiftId: shift.id,
          cashDeskId: shift.cashDeskId,
          createdById: userId,
        },
        include: { createdBy: { select: { name: true } } },
      });
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
  async getAll(cashDeskId?: number, direction?: Direction, date?: string) {
    // За конкретний день (YYYY-MM-DD) — усі записи дня (щоб фільтр діставав і
    // старі дні); без дати — останні 500.
    let createdAt: { gte: Date; lte: Date } | undefined;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const from = new Date(date + 'T00:00:00');
      const to = new Date(date + 'T23:59:59.999');
      if (!Number.isNaN(from.getTime())) createdAt = { gte: from, lte: to };
    }
    return this.prisma.cashMovement.findMany({
      where: {
        ...(cashDeskId ? { cashDeskId } : {}),
        ...(direction ? { direction } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        createdBy: { select: { name: true } },
        shift: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: createdAt ? undefined : 500,
    });
  }
}
