import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { login },
      include: { exchangePoint: true },
    });

    if (!user || !user.active) throw new UnauthorizedException('Невірний логін або пароль');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Невірний логін або пароль');

    const payload = {
      sub: user.id,
      login: user.login,
      role: user.role,
      exchangePointId: user.exchangePointId,
      name: user.name,
    };

    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        login: user.login,
        role: user.role,
        exchangePoint: user.exchangePoint,
      },
    };
  }

  async getMe(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        login: true,
        role: true,
        phone: true,
        active: true,
        exchangePointId: true,
        exchangePoint: true,
      },
    });
  }

  async updateProfile(userId: number, dto: { name?: string; phone?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name && { name: dto.name }),
        phone: dto.phone ?? null,
      },
      select: {
        id: true,
        name: true,
        login: true,
        role: true,
        phone: true,
        exchangePointId: true,
        exchangePoint: true,
      },
    });
  }
}
