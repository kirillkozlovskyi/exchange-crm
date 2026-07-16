import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { nextDocNumber } from '../common/number-seq.util';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';

type Actor = { sub: number; role: string };
const isSupervisor = (a?: Actor) => a?.role === 'ADMIN';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  private async generateNumber() {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = await nextDocNumber(this.prisma, 'transfer_number_seq');
    return `TR-${date}-${String(seq).padStart(4, '0')}`;
  }

  // Відкрита зміна каси з усім потрібним для ledger-балансу.
  private openShiftOfDesk(cashDeskId: number) {
    return this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
      include: { operations: true, cashMovements: true, usdtOperations: true },
    });
  }

  // Поточна готівка каси за відкритою зміною (єдиний ledger-розрахунок).
  private async deskBalance(shift: NonNullable<Awaited<ReturnType<TransfersService['openShiftOfDesk']>>>) {
    return shiftCashBalance(
      {
        startBalance: shift.startBalance as Record<string, number>,
        operations: shift.operations,
        cashMovements: shift.cashMovements,
        usdtOperations: shift.usdtOperations as any,
      },
      await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
    );
  }

  async create(dto: {
    fromDeskId: number;
    toDeskId: number;
    currency: string;
    amount: number;
    counterCurrency?: string | null;
    counterAmount?: number | null;
    note?: string;
  }, userId: number, actor?: Actor) {
    if (dto.fromDeskId === dto.toDeskId)
      throw new BadRequestException('Не можна переказати на ту ж касу');
    const amount = Number(dto.amount);
    if (!(amount > 0))
      throw new BadRequestException('Сума має бути більшою за 0');

    // Своп (Б2): зустрічне плече має бути повним і в іншій валюті.
    const isSwap = !!dto.counterCurrency;
    if (isSwap) {
      if (!(Number(dto.counterAmount) > 0))
        throw new BadRequestException('Сума зустрічного плеча має бути більшою за 0');
      if (dto.counterCurrency === dto.currency)
        throw new BadRequestException('Валюти свопу мають відрізнятися');
    }

    // Відправляти можна лише з каси з відкритою зміною (інакше мінус передачі
    // не ляже в жодну зміну і баланс компанії розʼїдеться).
    const fromShift = await this.openShiftOfDesk(dto.fromDeskId);
    if (!fromShift)
      throw new BadRequestException('На касі-відправнику немає відкритої зміни');
    // Касир — лише зі своєї каси; адмін/старший — з будь-якої.
    if (!isSupervisor(actor) && fromShift.openedById !== userId)
      throw new BadRequestException('Передачу можна відправити лише зі своєї каси');

    // Достатність готівки — серверна перевірка (раніше була лише на фронті),
    // з урахуванням уже відправлених, але ще не підтверджених передач (PENDING
    // резервує готівку — інакше ті самі гроші можна відправити двічі).
    const balance = await this.deskBalance(fromShift);
    const pendingOut = await this.prisma.transfer.aggregate({
      where: { fromDeskId: dto.fromDeskId, status: 'PENDING', currency: dto.currency },
      _sum: { amount: true },
    });
    const reserved = Number(pendingOut._sum.amount ?? 0);
    const available = (balance[dto.currency] ?? 0) - reserved;
    if (available < amount) {
      throw new BadRequestException(
        `Недостатньо ${dto.currency}: доступно ${available.toFixed(2)}` +
          (reserved > 0 ? ` (у касі ${((balance[dto.currency] ?? 0)).toFixed(2)}, зарезервовано непідтвердженими передачами ${reserved.toFixed(2)})` : '') +
          `, відправляєте ${amount.toFixed(2)}`,
      );
    }

    const number = await this.generateNumber();
    return this.prisma.transfer.create({
      data: {
        number,
        fromDeskId: dto.fromDeskId,
        toDeskId: dto.toDeskId,
        currency: dto.currency,
        amount: dto.amount,
        counterCurrency: isSwap ? dto.counterCurrency : null,
        counterAmount: isSwap ? dto.counterAmount : null,
        note: dto.note,
        sentById: userId,
        status: 'PENDING',
      },
      include: {
        fromDesk: { include: { exchangePoint: true } },
        toDesk: { include: { exchangePoint: true } },
        sentBy: { select: { name: true } },
      },
    });
  }

  // Підтвердити/відхилити може лише касир каси-ОТРИМУВАЧА з відкритою зміною
  // (адмін/старший — будь-яку). Раніше серверної перевірки не було взагалі.
  private async assertReceiver(transfer: { toDeskId: number }, userId: number, actor?: Actor) {
    const toShift = await this.openShiftOfDesk(transfer.toDeskId);
    if (!toShift)
      throw new BadRequestException('На касі-отримувачі немає відкритої зміни');
    if (!isSupervisor(actor) && toShift.openedById !== userId)
      throw new BadRequestException('Підтвердити передачу може лише каса-отримувач');
    return toShift;
  }

  async confirm(id: number, userId: number, actor?: Actor) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        sentBy: { select: { id: true, name: true } },
        confirmedBy: { select: { name: true } },
        fromDesk: { include: { exchangePoint: true } },
        toDesk: { include: { exchangePoint: true } },
      },
    });
    if (!transfer) throw new NotFoundException('Передачу не знайдено');
    if (transfer.status !== 'PENDING') throw new BadRequestException('Передача вже оброблена');

    const toShift = await this.assertReceiver(transfer, userId, actor);

    // Своп: отримувач віддає зустрічну валюту — її має вистачати в касі.
    if (transfer.counterCurrency && transfer.counterAmount != null) {
      const balance = await this.deskBalance(toShift);
      const need = Number(transfer.counterAmount);
      const have = balance[transfer.counterCurrency] ?? 0;
      if (have < need) {
        throw new BadRequestException(
          `Недостатньо ${transfer.counterCurrency} для зустрічного плеча свопу: є ${have.toFixed(2)}, потрібно ${need.toFixed(2)}`,
        );
      }
    }

    const [updated, confirmedUser] = await Promise.all([
      this.prisma.transfer.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt: new Date() },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    // Сповіщення відправнику
    const legText = transfer.counterCurrency
      ? `${Number(transfer.amount).toFixed(2)} ${transfer.currency} ↔ ${Number(transfer.counterAmount).toFixed(2)} ${transfer.counterCurrency}`
      : `${Number(transfer.amount).toFixed(2)} ${transfer.currency}`;
    const toPointName = transfer.toDesk?.exchangePoint?.name ?? transfer.toDesk?.name ?? 'каса';
    await this.prisma.notification.create({
      data: {
        userId: transfer.sentBy.id,
        message: `✅ ${transfer.counterCurrency ? 'Своп' : 'Передачу'} ${legText} прийнято касою «${toPointName}» (${confirmedUser?.name ?? ''})`,
      },
    });

    return updated;
  }

  /**
   * Скасування передачі ВІДПРАВНИКОМ (поки її не підтвердили).
   *
   * Навіщо: відхилити передачу може лише каса-отримувач — а якщо вона вже
   * зачинилась, відправник лишався б із «підвислою» PENDING-передачею і не міг
   * закрити зміну (закриття з непідтвердженими передачами блокується, бо дає
   * хибну нестачу). Скасування повертає гроші у розпорядження каси: PENDING
   * нічого не рухає, тож достатньо перевести передачу в REJECTED.
   */
  async cancel(id: number, userId: number, note?: string, actor?: Actor) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundException('Передачу не знайдено');
    if (transfer.status !== 'PENDING') throw new BadRequestException('Передача вже оброблена');
    if (!isSupervisor(actor) && transfer.sentById !== userId)
      throw new BadRequestException('Скасувати можна лише власну передачу');

    return this.prisma.transfer.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectNote: note?.trim() || 'Скасовано відправником',
      },
    });
  }

  async reject(id: number, userId: number, rejectNote?: string, actor?: Actor) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        sentBy: { select: { id: true, name: true } },
        fromDesk: { include: { exchangePoint: true } },
        toDesk: { include: { exchangePoint: true } },
      },
    });
    if (!transfer) throw new NotFoundException('Передачу не знайдено');
    if (transfer.status !== 'PENDING') throw new BadRequestException('Передача вже оброблена');

    await this.assertReceiver(transfer, userId, actor);

    const [updated, rejectedUser] = await Promise.all([
      this.prisma.transfer.update({
        where: { id },
        data: { status: 'REJECTED', confirmedById: userId, rejectNote: rejectNote ?? null },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    // Сповіщення відправнику
    const legText = transfer.counterCurrency
      ? `${Number(transfer.amount).toFixed(2)} ${transfer.currency} ↔ ${Number(transfer.counterAmount).toFixed(2)} ${transfer.counterCurrency}`
      : `${Number(transfer.amount).toFixed(2)} ${transfer.currency}`;
    const toPointName = transfer.toDesk?.exchangePoint?.name ?? transfer.toDesk?.name ?? 'каса';
    const noteText = rejectNote ? ` Причина: ${rejectNote}` : '';
    await this.prisma.notification.create({
      data: {
        userId: transfer.sentBy.id,
        message: `❌ ${transfer.counterCurrency ? 'Своп' : 'Передачу'} ${legText} відхилено касою «${toPointName}» (${rejectedUser?.name ?? ''}).${noteText}`,
      },
    });

    return updated;
  }

  async getPending(deskId: number) {
    return this.prisma.transfer.findMany({
      where: { toDeskId: deskId, status: 'PENDING' },
      include: {
        fromDesk: { include: { exchangePoint: true } },
        sentBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Власні ВІДПРАВЛЕНІ, ще не підтверджені передачі. Касир має їх бачити: гроші
  // вже пішли з каси, і поки отримувач не підтвердив, зміну закрити не можна.
  async getPendingOut(deskId: number) {
    return this.prisma.transfer.findMany({
      where: { fromDeskId: deskId, status: 'PENDING' },
      include: {
        toDesk: { include: { exchangePoint: true } },
        sentBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Підтверджені передачі каси (відправлені + отримані) від вказаного моменту.
  // Використовується при закритті зміни: вилучити їх із прибутку і показати як
  // рух готівки. Назви точок/кас потрібні, щоб касир бачив кому/від кого передача.
  async getConfirmedForDesk(deskId: number, since?: Date) {
    return this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        OR: [{ fromDeskId: deskId }, { toDeskId: deskId }],
        ...(since ? { confirmedAt: { gte: since } } : {}),
      },
      orderBy: { confirmedAt: 'desc' },
      include: {
        fromDesk: { include: { exchangePoint: { select: { name: true } } } },
        toDesk: { include: { exchangePoint: { select: { name: true } } } },
        sentBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
      },
    });
  }

  async getAll() {
    return this.prisma.transfer.findMany({
      include: {
        fromDesk: { include: { exchangePoint: true } },
        toDesk: { include: { exchangePoint: true } },
        sentBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
