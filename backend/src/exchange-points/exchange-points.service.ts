import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExchangePointsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.exchangePoint.findMany({
      include: { cashDesks: true },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: number) {
    return this.prisma.exchangePoint.findUnique({
      where: { id },
      include: { cashDesks: true },
    });
  }

  async remove(id: number) {
    const point = await this.prisma.exchangePoint.findUnique({ where: { id } });
    if (!point) throw new NotFoundException('Точку не знайдено');

    const openShifts = await this.prisma.shift.count({
      where: { cashDesk: { exchangePointId: id }, status: 'OPEN' },
    });
    if (openShifts > 0) throw new BadRequestException('Не можна видалити точку з відкритими змінами');

    // Каскадне видалення в правильному порядку
    await this.prisma.$transaction(async (tx) => {
      // Знаходимо всі каси цієї точки
      const desks = await tx.cashDesk.findMany({ where: { exchangePointId: id }, select: { id: true } });
      const deskIds = desks.map((d) => d.id);

      if (deskIds.length > 0) {
        // Знаходимо всі зміни
        const shifts = await tx.shift.findMany({ where: { cashDeskId: { in: deskIds } }, select: { id: true } });
        const shiftIds = shifts.map((s) => s.id);

        if (shiftIds.length > 0) {
          await tx.operation.deleteMany({ where: { shiftId: { in: shiftIds } } });
          await tx.shift.deleteMany({ where: { id: { in: shiftIds } } });
        }

        // Передачі між касами
        await tx.transfer.deleteMany({ where: { fromDeskId: { in: deskIds } } });
        await tx.transfer.deleteMany({ where: { toDeskId: { in: deskIds } } });

        await tx.cashDesk.deleteMany({ where: { exchangePointId: id } });
      }

      // Курси, витрати, валюти точки
      await tx.rate.deleteMany({ where: { exchangePointId: id } });
      await tx.expense.deleteMany({ where: { exchangePointId: id } });
      await tx.pointCurrency.deleteMany({ where: { exchangePointId: id } });

      // Від'єднуємо користувачів (не видаляємо)
      await tx.user.updateMany({
        where: { exchangePointId: id },
        data: { exchangePointId: null },
      });

      await tx.exchangePoint.delete({ where: { id } });
    });
  }

  async create(dto: { name: string; code: string }) {
    const exists = await this.prisma.exchangePoint.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Точка з таким кодом вже існує');
    return this.prisma.exchangePoint.create({
      data: { name: dto.name, code: dto.code.toUpperCase() },
      include: { cashDesks: true },
    });
  }
}
