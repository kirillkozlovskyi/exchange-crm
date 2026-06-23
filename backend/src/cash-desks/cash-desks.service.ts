import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CashDesksService {
  constructor(private prisma: PrismaService) {}

  async findAll(exchangePointId?: number) {
    const desks = await this.prisma.cashDesk.findMany({
      where: exchangePointId ? { exchangePointId } : undefined,
      include: {
        exchangePoint: true,
        shifts: {
          where: { status: 'OPEN' },
          include: { openedBy: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: [{ exchangePointId: 'asc' }, { name: 'asc' }],
    });

    return desks.map((d) => ({
      ...d,
      isOccupied: d.shifts.length > 0,
      activeShift: d.shifts[0] ?? null,
      shifts: undefined,
    }));
  }

  findOne(id: number) {
    return this.prisma.cashDesk.findUnique({
      where: { id },
      include: { exchangePoint: true },
    });
  }

  async create(dto: { name: string; exchangePointId: number }) {
    const point = await this.prisma.exchangePoint.findUnique({ where: { id: dto.exchangePointId } });
    if (!point) throw new NotFoundException('Обмінний пункт не знайдено');

    return this.prisma.cashDesk.create({
      data: { name: dto.name, exchangePointId: dto.exchangePointId },
      include: { exchangePoint: true },
    });
  }

  async update(id: number, dto: { name?: string; active?: boolean }) {
    const desk = await this.prisma.cashDesk.findUnique({ where: { id } });
    if (!desk) throw new NotFoundException('Касу не знайдено');

    return this.prisma.cashDesk.update({
      where: { id },
      data: dto,
      include: { exchangePoint: true },
    });
  }

  async remove(id: number) {
    const desk = await this.prisma.cashDesk.findUnique({ where: { id } });
    if (!desk) throw new NotFoundException('Касу не знайдено');

    const openShift = await this.prisma.shift.findFirst({ where: { cashDeskId: id, status: 'OPEN' } });
    if (openShift) throw new ConflictException('Не можна видалити касу з відкритою зміною');

    return this.prisma.cashDesk.delete({ where: { id } });
  }
}
