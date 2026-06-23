import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RatesService {
  constructor(private prisma: PrismaService) {}

  async getByPoint(exchangePointId: number) {
    return this.prisma.rate.findMany({
      where: { exchangePointId, status: 'ACTIVE' },
      orderBy: { currency: 'asc' },
    });
  }

  async upsert(dto: {
    exchangePointId: number;
    currency: string;
    buy: number;
    sell: number;
  }, userId: number) {
    // Деактивуємо старий курс
    await this.prisma.rate.updateMany({
      where: { exchangePointId: dto.exchangePointId, currency: dto.currency, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });

    return this.prisma.rate.create({
      data: {
        currency: dto.currency,
        buy: dto.buy,
        sell: dto.sell,
        exchangePointId: dto.exchangePointId,
        proposedById: userId,
        approvedById: userId,
        status: 'ACTIVE',
      },
    });
  }

  async getAllActive() {
    return this.prisma.rate.findMany({
      where: { status: 'ACTIVE' },
      include: { exchangePoint: true },
      orderBy: [{ exchangePointId: 'asc' }, { currency: 'asc' }],
    });
  }
}
