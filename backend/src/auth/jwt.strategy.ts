import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../common/jwt.config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    // Звіряємо з БД на кожен запит: деактивація діє одразу (раніше вимкнений
    // користувач працював до закінчення токена, до 12 год), а роль/точка
    // беруться актуальні — зміна ролі не чекає перевипуску токена.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true, role: true, exchangePointId: true },
    });
    if (!user || !user.active)
      throw new UnauthorizedException('Обліковий запис деактивовано');
    return { ...payload, role: user.role, exchangePointId: user.exchangePointId };
  }
}
