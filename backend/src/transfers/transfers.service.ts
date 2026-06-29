import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  private async generateNumber() {
    const date = format(new Date(), 'yyyyMMdd');
    const count = await this.prisma.transfer.count();
    return `TR-${date}-${String(count + 1).padStart(4, '0')}`;
  }

  async create(dto: {
    fromDeskId: number;
    toDeskId: number;
    currency: string;
    amount: number;
    counterCurrency?: string | null;
    counterAmount?: number | null;
    note?: string;
  }, userId: number) {
    if (dto.fromDeskId === dto.toDeskId)
      throw new BadRequestException('Не можна переказати на ту ж касу');
    if (!(Number(dto.amount) > 0))
      throw new BadRequestException('Сума має бути більшою за 0');

    // Своп (Б2): зустрічне плече має бути повним і в іншій валюті.
    const isSwap = !!dto.counterCurrency;
    if (isSwap) {
      if (!(Number(dto.counterAmount) > 0))
        throw new BadRequestException('Сума зустрічного плеча має бути більшою за 0');
      if (dto.counterCurrency === dto.currency)
        throw new BadRequestException('Валюти свопу мають відрізнятися');
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

  async confirm(id: number, userId: number) {
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

  async reject(id: number, userId: number, rejectNote?: string) {
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

  // Підтверджені передачі каси (відправлені + отримані) від вказаного моменту.
  // Використовується при закритті зміни, щоб вилучити їх із прибутку.
  async getConfirmedForDesk(deskId: number, since?: Date) {
    return this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        OR: [{ fromDeskId: deskId }, { toDeskId: deskId }],
        ...(since ? { confirmedAt: { gte: since } } : {}),
      },
      orderBy: { confirmedAt: 'desc' },
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
