import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CurrenciesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  async create(dto: { code: string; name: string }) {
    const code = (dto.code ?? '').toUpperCase().trim();
    const name = (dto.name ?? '').trim();
    // Дозволяємо будь-який власний код (USDT, образці тощо): A–Z/0–9, 2–10 символів.
    if (!/^[A-Z0-9]{2,10}$/.test(code))
      throw new BadRequestException('Код валюти: 2–10 символів A–Z/0–9');
    if (!name) throw new BadRequestException('Вкажіть назву валюти');
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (existing) throw new ConflictException(`Валюта ${code} вже існує`);
    return this.prisma.currency.create({ data: { code, name } });
  }

  async update(code: string, dto: { name?: string; active?: boolean }) {
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException(`Валюта ${code} не знайдена`);
    return this.prisma.currency.update({ where: { code }, data: dto });
  }

  async remove(code: string) {
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException(`Валюта ${code} не знайдена`);
    // Видаляємо разом з усіма PointCurrency (cascade)
    await this.prisma.pointCurrency.deleteMany({ where: { currencyCode: code } });
    return this.prisma.currency.delete({ where: { code } });
  }

  // ── Per-point currencies ────────────────────────────────────────────────────

  getPointCurrencies(exchangePointId: number) {
    return this.prisma.pointCurrency.findMany({
      where: { exchangePointId },
      include: { currency: true },
      orderBy: { currencyCode: 'asc' },
    });
  }

  async addToPoint(exchangePointId: number, currencyCode: string) {
    const code = currencyCode.toUpperCase().trim();
    const currency = await this.prisma.currency.findUnique({ where: { code } });
    if (!currency) throw new NotFoundException(`Валюта ${code} не знайдена`);
    try {
      return await this.prisma.pointCurrency.create({
        data: { exchangePointId, currencyCode: code },
        include: { currency: true },
      });
    } catch {
      throw new ConflictException(`Валюта ${code} вже є в цій точці`);
    }
  }

  async removeFromPoint(exchangePointId: number, currencyCode: string) {
    const code = currencyCode.toUpperCase().trim();
    const pc = await this.prisma.pointCurrency.findUnique({
      where: { exchangePointId_currencyCode: { exchangePointId, currencyCode: code } },
    });
    if (!pc) throw new NotFoundException(`Валюта ${code} не знайдена в цій точці`);
    return this.prisma.pointCurrency.delete({
      where: { exchangePointId_currencyCode: { exchangePointId, currencyCode: code } },
    });
  }
}
