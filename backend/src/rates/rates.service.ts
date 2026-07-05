import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RatesService {
  constructor(private prisma: PrismaService) {}

  async getByPoint(exchangePointId: number) {
    // Повертаємо тільки валюти, які є в активному довіднику Currency
    const activeCurrencies = await this.prisma.currency.findMany({
      where: { active: true },
      select: { code: true },
    });
    const codes = activeCurrencies.map((c) => c.code);

    return this.prisma.rate.findMany({
      where: { exchangePointId, status: 'ACTIVE', currency: { in: codes } },
      orderBy: { currency: 'asc' },
    });
  }

  async upsert(dto: {
    exchangePointId: number;
    currency: string;
    buy: number;
    sell: number;
  }, userId: number) {
    try {
      // Деактивація старого + створення нового — атомарно. Unique-індекс
      // Rate_point_currency_active_key гарантує один ACTIVE на точку+валюту.
      const [, created] = await this.prisma.$transaction([
        this.prisma.rate.updateMany({
          where: { exchangePointId: dto.exchangePointId, currency: dto.currency, status: 'ACTIVE' },
          data: { status: 'INACTIVE' },
        }),
        this.prisma.rate.create({
          data: {
            currency: dto.currency,
            buy: dto.buy,
            sell: dto.sell,
            exchangePointId: dto.exchangePointId,
            proposedById: userId,
            approvedById: userId,
            status: 'ACTIVE',
          },
        }),
      ]);
      return created;
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new ConflictException('Курс саме оновлюється іншим користувачем — повторіть');
      throw e;
    }
  }

  async getAllActive() {
    return this.prisma.rate.findMany({
      where: { status: 'ACTIVE' },
      include: { exchangePoint: true },
      orderBy: [{ exchangePointId: 'asc' }, { currency: 'asc' }],
    });
  }
}
