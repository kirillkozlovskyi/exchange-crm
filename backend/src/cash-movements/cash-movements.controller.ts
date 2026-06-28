import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { CashMovementsService } from './cash-movements.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('cash-movements')
export class CashMovementsController {
  constructor(private service: CashMovementsService) {}

  @Get()
  getAll(
    @Query('cashDeskId') cashDeskId?: string,
    @Query('direction') direction?: 'IN' | 'OUT',
  ) {
    return this.service.getAll(cashDeskId ? Number(cashDeskId) : undefined, direction);
  }

  @Get('shift/:shiftId')
  getForShift(@Param('shiftId', ParseIntPipe) shiftId: number) {
    return this.service.getForShift(shiftId);
  }

  @Post()
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub);
  }
}
