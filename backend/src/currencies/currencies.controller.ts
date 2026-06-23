import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly service: CurrenciesService) {}

  // ── Global currency CRUD (ADMIN) ────────────────────────────────────────────

  @Get('currencies')
  findAll() {
    return this.service.findAll();
  }

  @Post('currencies')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: { code: string; name: string }) {
    return this.service.create(dto);
  }

  @Patch('currencies/:code')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('code') code: string, @Body() dto: { name?: string; active?: boolean }) {
    return this.service.update(code, dto);
  }

  @Delete('currencies/:code')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('code') code: string) {
    return this.service.remove(code);
  }

  // ── Per-point currencies ────────────────────────────────────────────────────

  @Get('exchange-points/:id/currencies')
  getPointCurrencies(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPointCurrencies(id);
  }

  @Post('exchange-points/:id/currencies')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addToPoint(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { currencyCode: string },
  ) {
    return this.service.addToPoint(id, dto.currencyCode);
  }

  @Delete('exchange-points/:id/currencies/:code')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  removeFromPoint(
    @Param('id', ParseIntPipe) id: number,
    @Param('code') code: string,
  ) {
    return this.service.removeFromPoint(id, code);
  }
}
