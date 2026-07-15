import { Controller, Get, Post, Body, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MaintenanceService } from './maintenance.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private service: MaintenanceService,
    private prisma: PrismaService,
  ) {}

  // Скільки буде видалено — для попередження в модалці.
  @Get('operational-counts')
  counts() {
    return this.service.operationalCounts();
  }

  /**
   * Обнулення операційних даних. Подвійний захист: роль ADMIN + пароль
   * поточного адміна (перевіряємо bcrypt проти його ж хешу; пароль не логуємо).
   */
  @Post('reset-operational')
  async reset(@Body() body: { password?: string }, @CurrentUser() user: any) {
    if (!body?.password) throw new BadRequestException('Введіть пароль для підтвердження');
    const admin = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!admin) throw new ForbiddenException('Користувача не знайдено');
    const ok = await bcrypt.compare(body.password, admin.passwordHash);
    if (!ok) throw new ForbiddenException('Невірний пароль');
    const deleted = await this.service.resetOperational();
    return { ok: true, deleted };
  }
}
