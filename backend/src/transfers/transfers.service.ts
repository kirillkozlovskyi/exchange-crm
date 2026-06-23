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
    note?: string;
  }, userId: number) {
    if (dto.fromDeskId === dto.toDeskId)
      throw new BadRequestException('Не можна переказати на ту ж касу');

    const number = await this.generateNumber();
    return this.prisma.transfer.create({
      data: {
        number,
        fromDeskId: dto.fromDeskId,
        toDeskId: dto.toDeskId,
        currency: dto.currency,
        amount: dto.amount,
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
    const amount = Number(transfer.amount).toFixed(2);
    const toPointName = transfer.toDesk?.exchangePoint?.name ?? transfer.toDesk?.name ?? 'каса';
    await this.prisma.notification.create({
      data: {
        userId: transfer.sentBy.id,
        message: `✅ Передачу ${amount} ${transfer.currency} прийнято касою «${toPointName}» (${confirmedUser?.name ?? ''})`,
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
    const amount = Number(transfer.amount).toFixed(2);
    const toPointName = transfer.toDesk?.exchangePoint?.name ?? transfer.toDesk?.name ?? 'каса';
    const noteText = rejectNote ? ` Причина: ${rejectNote}` : '';
    await this.prisma.notification.create({
      data: {
        userId: transfer.sentBy.id,
        message: `❌ Передачу ${amount} ${transfer.currency} відхилено касою «${toPointName}» (${rejectedUser?.name ?? ''}).${noteText}`,
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
