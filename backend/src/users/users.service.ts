import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, login: true, role: true, exchangePointId: true, exchangePoint: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, login: true, role: true, exchangePointId: true, exchangePoint: true },
    });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return user;
  }

  async create(dto: { name: string; login: string; password: string; role: string; exchangePointId?: number }) {
    const exists = await this.prisma.user.findUnique({ where: { login: dto.login } });
    if (exists) throw new ConflictException('Логін вже зайнятий');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: { name: dto.name, login: dto.login, passwordHash, role: dto.role as any, exchangePointId: dto.exchangePointId },
      select: { id: true, name: true, login: true, role: true, exchangePointId: true },
    });
  }

  async update(id: number, dto: { name?: string; role?: string; exchangePointId?: number; password?: string }) {
    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.role) data.role = dto.role;
    if (dto.exchangePointId !== undefined) data.exchangePointId = dto.exchangePointId;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, login: true, role: true, exchangePointId: true },
    });
  }

  async remove(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }
}
