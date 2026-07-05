import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

// Захист від перебору пароля: після MAX_ATTEMPTS невдалих спроб по одному
// логіну — блокування на LOCK_MS. In-memory (скидається рестартом) — цього
// достатньо проти онлайн-брутфорсу без зовнішніх залежностей.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

function checkThrottle(key: string) {
  const rec = attempts.get(key);
  if (!rec) return;
  if (rec.lockedUntil > Date.now()) {
    const min = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
    throw new UnauthorizedException(`Забагато невдалих спроб. Спробуйте через ${min} хв`);
  }
}

function noteFailure(key: string) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = now + LOCK_MS;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    checkThrottle(login);

    const user = await this.prisma.user.findUnique({
      where: { login },
      include: { exchangePoint: true },
    });

    if (!user || !user.active) {
      noteFailure(login);
      throw new UnauthorizedException('Невірний логін або пароль');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      noteFailure(login);
      throw new UnauthorizedException('Невірний логін або пароль');
    }
    attempts.delete(login); // успішний вхід скидає лічильник

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

  // Ковзне подовження сесії: видаємо свіжий токен на новий строк. Актуальність
  // користувача (active/role) вже перевірила JwtStrategy на цьому ж запиті.
  async refresh(payload: { sub: number; login: string; role: string; exchangePointId: number | null; name: string }) {
    const fresh = {
      sub: payload.sub,
      login: payload.login,
      role: payload.role,
      exchangePointId: payload.exchangePointId,
      name: payload.name,
    };
    return { access_token: this.jwt.sign(fresh) };
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

  async isSetupNeeded(): Promise<boolean> {
    const count = await this.prisma.user.count();
    return count === 0;
  }

  async setupFirstAdmin(dto: { name: string; login: string; password: string }) {
    const count = await this.prisma.user.count();
    if (count > 0) throw new ForbiddenException('Перший адмін вже створений');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { name: dto.name, login: dto.login, passwordHash, role: 'ADMIN' },
      include: { exchangePoint: true },
    });
    const payload = { sub: user.id, login: user.login, role: user.role, name: user.name };
    return {
      access_token: this.jwt.sign(payload),
      user: { id: user.id, name: user.name, login: user.login, role: user.role, exchangePoint: null },
    };
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
