import { Controller, Get, Post, Delete, Body, Query, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Get()
  findAll(@Query('pointId') pointId?: string, @Query('date') date?: string) {
    return this.service.findAll({ pointId: pointId ? Number(pointId) : undefined, date });
  }

  @Post()
  create(@Body() dto: { amount: number; category: string; note?: string; exchangePointId: number; date?: string }) {
    return this.service.create(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
