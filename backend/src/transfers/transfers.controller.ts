import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private service: TransfersService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Get('pending')
  getPending(@Query('deskId', ParseIntPipe) deskId: number) {
    return this.service.getPending(deskId);
  }

  // Власні відправлені, ще не підтверджені (блокують закриття зміни).
  @Get('pending-out')
  getPendingOut(@Query('deskId', ParseIntPipe) deskId: number) {
    return this.service.getPendingOut(deskId);
  }

  @Get('confirmed')
  getConfirmedForDesk(
    @Query('deskId', ParseIntPipe) deskId: number,
    @Query('since') since?: string,
  ) {
    return this.service.getConfirmedForDesk(deskId, since ? new Date(since) : undefined);
  }

  @Post()
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub, { sub: user.sub, role: user.role });
  }

  @Patch(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.service.confirm(id, user.sub, { sub: user.sub, role: user.role });
  }

  @Patch(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rejectNote?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.reject(id, user.sub, body.rejectNote, { sub: user.sub, role: user.role });
  }

  // Скасування власної непідтвердженої передачі (відправником) — щоб зміна не
  // «зависла», якщо каса-отримувач уже зачинилась і не може ані підтвердити,
  // ані відхилити.
  @Patch(':id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { note?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.cancel(id, user.sub, body.note, { sub: user.sub, role: user.role });
  }
}
