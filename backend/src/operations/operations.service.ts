import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';

@Injectable()
export class OperationsService {
  constructor(private prisma: PrismaService) {}

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    const count = await this.prisma.operation.count();
    return `${pointCode}-${date}-${String(count + 1).padStart(6, '0')}`;
  }

  async create(dto: {
    shiftId: number;
    // getCurrency — що клієнт отримує
    currency: string;
    amount: number;
    rate: number;
    // payCurrency — що клієнт дає (null = UAH)
    payCurrency?: string;
    payAmount?: number;
    note?: string;
  }, cashierId: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: { cashDesk: { include: { exchangePoint: true } } },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    const exchangePointId = shift.cashDesk.exchangePointId;

    // Отримуємо активні курси для обох валют
    const getCurrencyRate = dto.currency !== 'UAH'
      ? await this.prisma.rate.findFirst({
          where: { exchangePointId, currency: dto.currency, status: 'ACTIVE' },
        })
      : null;

    const payCurrencyRate = dto.payCurrency && dto.payCurrency !== 'UAH'
      ? await this.prisma.rate.findFirst({
          where: { exchangePointId, currency: dto.payCurrency, status: 'ACTIVE' },
        })
      : null;

    // Допоміжні функції для rate
    const getBuyRate = (cur: string) => {
      if (cur === 'UAH') return 1;
      if (cur === dto.currency && getCurrencyRate) return Number(getCurrencyRate.buy);
      if (cur === dto.payCurrency && payCurrencyRate) return Number(payCurrencyRate.buy);
      return 0;
    };
    const getSellRate = (cur: string) => {
      if (cur === 'UAH') return 1;
      if (cur === dto.currency && getCurrencyRate) return Number(getCurrencyRate.sell);
      if (cur === dto.payCurrency && payCurrencyRate) return Number(payCurrencyRate.sell);
      return 0;
    };

    const payCur = dto.payCurrency || 'UAH';
    const getCur = dto.currency;

    // Визначаємо тип та рахуємо totalUah і profit
    let type: 'BUY' | 'SELL' | 'EXCHANGE';
    let totalUah: number;
    let profit: number;

    if (payCur === 'UAH' && getCur !== 'UAH') {
      // Класичний SELL: клієнт платить UAH, отримує валюту
      type = 'SELL';
      totalUah = dto.amount * dto.rate; // rate = sell rate of getCurrency
      profit = getCurrencyRate
        ? dto.amount * (Number(getCurrencyRate.sell) - Number(getCurrencyRate.buy))
        : 0;
    } else if (getCur === 'UAH' && payCur !== 'UAH') {
      // Класичний BUY: клієнт дає валюту, отримує UAH
      type = 'BUY';
      totalUah = dto.amount * dto.rate; // rate = buy rate of payCurrency, amount = payAmount
      profit = payCurrencyRate
        ? dto.amount * (Number(payCurrencyRate.sell) - Number(payCurrencyRate.buy))
        : 0;
    } else {
      // Крос-обмін: валюта → валюта
      type = 'EXCHANGE';
      const payUah = (dto.payAmount ?? 0) * getBuyRate(payCur);
      totalUah = payUah;
      // Прибуток = payAmount * sell_rate[payCur] - getAmount * buy_rate[getCur]
      profit =
        (dto.payAmount ?? 0) * getSellRate(payCur) -
        dto.amount * getBuyRate(getCur);
    }

    const number = await this.generateNumber(shift.cashDesk.exchangePoint.code);

    return this.prisma.operation.create({
      data: {
        number,
        type,
        currency: dto.currency,
        amount: dto.amount,
        rate: dto.rate,
        totalUah,
        profit,
        note: dto.note,
        payCurrency: payCur !== 'UAH' ? payCur : null,
        payAmount: dto.payAmount ?? null,
        shiftId: dto.shiftId,
        cashierId,
      },
    });
  }

  async getByShift(shiftId: number) {
    return this.prisma.operation.findMany({
      where: { shiftId },
      orderBy: { createdAt: 'desc' },
      include: {
        cashier: { select: { name: true } },
        _count: { select: { edits: true } },
      },
    });
  }

  async getDailyByPoint(exchangePointId: number) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return this.prisma.operation.findMany({
      where: {
        createdAt: { gte: start },
        shift: { cashDesk: { exchangePointId } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: number,
    dto: { amount: number; rate: number; note?: string },
    editorId: number,
  ) {
    const op = await this.prisma.operation.findUnique({
      where: { id },
      include: {
        shift: {
          include: { cashDesk: { include: { exchangePoint: true } } },
        },
      },
    });
    if (!op) throw new NotFoundException('Операцію не знайдено');
    if (op.shift.status === 'CLOSED')
      throw new BadRequestException('Зміна закрита — редагування неможливе');

    const exchangePointId = op.shift.cashDesk.exchangePointId;

    const getCurrencyRate = op.currency !== 'UAH'
      ? await this.prisma.rate.findFirst({
          where: { exchangePointId, currency: op.currency, status: 'ACTIVE' },
        })
      : null;

    const payCurrencyRate = op.payCurrency && op.payCurrency !== 'UAH'
      ? await this.prisma.rate.findFirst({
          where: { exchangePointId, currency: op.payCurrency, status: 'ACTIVE' },
        })
      : null;

    // Зберігаємо запис про редагування
    await this.prisma.operationEdit.create({
      data: {
        operationId: id,
        editedById: editorId,
        note: dto.note,
        prevAmount: op.amount,
        prevRate: op.rate,
        newAmount: dto.amount,
        newRate: dto.rate,
      },
    });

    // Перераховуємо totalUah та profit
    let totalUah: number;
    let profit: number;

    if (op.type === 'SELL') {
      totalUah = dto.amount * dto.rate;
      profit = getCurrencyRate
        ? dto.amount * (Number(getCurrencyRate.sell) - Number(getCurrencyRate.buy))
        : 0;
    } else if (op.type === 'BUY') {
      totalUah = dto.amount * dto.rate;
      profit = payCurrencyRate
        ? dto.amount * (Number(payCurrencyRate.sell) - Number(payCurrencyRate.buy))
        : 0;
    } else {
      // EXCHANGE: payAmount і payCurrency незмінні, перераховуємо на основі нового rate
      const payUah = Number(op.payAmount ?? 0) * (payCurrencyRate ? Number(payCurrencyRate.buy) : 1);
      totalUah = payUah;
      profit =
        Number(op.payAmount ?? 0) * (payCurrencyRate ? Number(payCurrencyRate.sell) : 1) -
        dto.amount * (getCurrencyRate ? Number(getCurrencyRate.buy) : 1);
    }

    return this.prisma.operation.update({
      where: { id },
      data: { amount: dto.amount, rate: dto.rate, totalUah, profit },
    });
  }

  async getEdits(operationId: number) {
    return this.prisma.operationEdit.findMany({
      where: { operationId },
      orderBy: { editedAt: 'asc' },
      include: { editedBy: { select: { name: true } } },
    });
  }

  async getAll(type?: 'BUY' | 'SELL' | 'EXCHANGE') {
    return this.prisma.operation.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        cashier: { select: { name: true } },
        shift: {
          include: {
            cashDesk: {
              include: { exchangePoint: { select: { name: true } } },
            },
          },
        },
      },
    });
  }
}
