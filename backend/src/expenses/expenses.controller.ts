import { Controller, Get, Post, Delete, Body, Query, Param, ParseIntPipe, UseGuards, ForbiddenException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(
    private service: ExpensesService,
    private settings: SettingsService,
  ) {}

  @Get()
  findAll(@Query('pointId') pointId?: string, @Query('date') date?: string) {
    return this.service.findAll({ pointId: pointId ? Number(pointId) : undefined, date });
  }

  // Створювати витрату може адмін завжди; касир — лише якщо адмін дозволив.
  @Post()
  async create(
    @Body() dto: { amount: number; category: string; note?: string; exchangePointId: number; date?: string },
    @CurrentUser() user: any,
  ) {
    if (user.role !== 'ADMIN' && !(await this.settings.getCashierCanExpenses())) {
      throw new ForbiddenException('Створення витрат для касира вимкнено');
    }
    return this.service.create(dto);
  }

  // Видаляти — лише адмін.
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
