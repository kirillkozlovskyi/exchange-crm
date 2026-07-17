import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@UseGuards(JwtAuthGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Post('open')
  open(
    @Body() body: { cashDeskId: number; startBalance: object; costBasis?: Record<string, number> },
    @CurrentUser() user: any,
  ) {
    return this.shiftsService.openShift(body.cashDeskId, user.sub, body.startBalance, body.costBasis);
  }

  @Patch(':id/close')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { endBalance: object },
    @CurrentUser() user: any,
  ) {
    // Касир закриває лише свою зміну (перевірка в сервісі), адмін/старший — будь-яку.
    return this.shiftsService.closeShift(id, body.endBalance, { sub: user.sub, role: user.role });
  }

  @Get('my')
  getMyActive(@CurrentUser() user: any) {
    return this.shiftsService.getMyActiveShift(user.sub);
  }

  @Get('active')
  getAllActive() {
    return this.shiftsService.getAllActiveShifts();
  }

  @Get('list')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  list(@Query('pointId') pointId?: string, @Query('deskId') deskId?: string) {
    return this.shiftsService.listShifts(
      pointId ? Number(pointId) : undefined,
      deskId ? Number(deskId) : undefined,
    );
  }

  @Get('active/desk/:cashDeskId')
  getActiveByDesk(@Param('cashDeskId', ParseIntPipe) cashDeskId: number) {
    return this.shiftsService.getActiveShift(cashDeskId);
  }

  @Get('last-balance/desk/:cashDeskId')
  getLastBalance(@Param('cashDeskId', ParseIntPipe) cashDeskId: number) {
    return this.shiftsService.getLastEndBalance(cashDeskId);
  }

  // Редагування сер. курсу (собівартості) відкритої зміни + перерахунок прибутку.
  // Викликає касир із форми закриття (лише своя зміна) або адмін.
  @Patch(':id/cost-basis')
  updateCostBasis(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { costBasis: Record<string, number> },
    @CurrentUser() user: any,
  ) {
    return this.shiftsService.updateCostBasis(id, body.costBasis ?? {}, { sub: user.sub, role: user.role });
  }

  // Кастомний прибуток зміни від адміна (довідковий, поруч із системним).
  // null/порожнє — очистити.
  @Patch(':id/admin-profit')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateAdminProfit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { profitUsd?: number | null; profitUah?: number | null; note?: string | null },
  ) {
    return this.shiftsService.updateAdminProfit(id, body);
  }

  // Коригування залишку зміни — лише адмін (жоден UI касира це не викликає).
  @Patch(':id/adjust-balance')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  adjustBalance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { balance: Record<string, number> },
  ) {
    return this.shiftsService.adjustBalance(id, body.balance);
  }

  // Повний звіт по зміні (JSON для вивантаження/аналізу) — лише адмінка.
  @Get(':id/report')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getReport(@Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.getShiftReport(id);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.getShiftById(id);
  }
}
