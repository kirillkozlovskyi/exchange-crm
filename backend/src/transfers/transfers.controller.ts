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

  @Get('confirmed')
  getConfirmedForDesk(
    @Query('deskId', ParseIntPipe) deskId: number,
    @Query('since') since?: string,
  ) {
    return this.service.getConfirmedForDesk(deskId, since ? new Date(since) : undefined);
  }

  @Post()
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.service.confirm(id, user.sub);
  }

  @Patch(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rejectNote?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.reject(id, user.sub, body.rejectNote);
  }
}
