import { Controller, Post, Get, Patch, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  @Post('open')
  open(@Body() body: { cashDeskId: number; startBalance: object }, @CurrentUser() user: any) {
    return this.shiftsService.openShift(body.cashDeskId, user.sub, body.startBalance);
  }

  @Patch(':id/close')
  close(@Param('id', ParseIntPipe) id: number, @Body() body: { endBalance: object }) {
    return this.shiftsService.closeShift(id, body.endBalance);
  }

  @Get('my')
  getMyActive(@CurrentUser() user: any) {
    return this.shiftsService.getMyActiveShift(user.sub);
  }

  @Get('active')
  getAllActive() {
    return this.shiftsService.getAllActiveShifts();
  }

  @Get('active/desk/:cashDeskId')
  getActiveByDesk(@Param('cashDeskId', ParseIntPipe) cashDeskId: number) {
    return this.shiftsService.getActiveShift(cashDeskId);
  }

  @Get('last-balance/desk/:cashDeskId')
  getLastBalance(@Param('cashDeskId', ParseIntPipe) cashDeskId: number) {
    return this.shiftsService.getLastEndBalance(cashDeskId);
  }

  @Patch(':id/adjust-balance')
  adjustBalance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { balance: Record<string, number> },
  ) {
    return this.shiftsService.adjustBalance(id, body.balance);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.getShiftById(id);
  }
}
