import {
  Controller, Get, Post, Put, Body, Param, Query, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { UsdtService } from './usdt.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('usdt')
export class UsdtController {
  constructor(private service: UsdtService) {}

  // ── Гаманці / налаштування ──────────────────────────────────────────────
  @Get('wallets')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SENIOR_CASHIER')
  getWallets() {
    return this.service.getWallets();
  }

  @Get('wallet/:pointId')
  getWallet(@Param('pointId', ParseIntPipe) pointId: number) {
    return this.service.getWallet(pointId);
  }

  @Put('wallet/:pointId/pct')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setPct(
    @Param('pointId', ParseIntPipe) pointId: number,
    @Body() dto: { buyPct?: number; sellPct?: number },
  ) {
    return this.service.setPct(pointId, dto);
  }

  @Post('wallet/:pointId/adjust')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  adjust(
    @Param('pointId', ParseIntPipe) pointId: number,
    @Body() dto: { delta: number },
  ) {
    return this.service.adjustBalance(pointId, Number(dto.delta));
  }

  // ── Операції ────────────────────────────────────────────────────────────
  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SENIOR_CASHIER')
  getAll(
    @Query('exchangePointId') exchangePointId?: string,
    @Query('cashDeskId') cashDeskId?: string,
    @Query('side') side?: 'BUY' | 'SELL',
  ) {
    return this.service.getAll({
      exchangePointId: exchangePointId ? Number(exchangePointId) : undefined,
      cashDeskId: cashDeskId ? Number(cashDeskId) : undefined,
      side,
    });
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
