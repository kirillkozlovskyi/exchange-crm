import { Controller, Get, Post, Body, Param, Query, Res, UseGuards, ParseIntPipe } from '@nestjs/common';
import { Response } from 'express';
import { RatesService } from './rates.service';
import { NbuAutoService } from './nbu-auto.service';
import { parseCardTheme } from '../telegram/rate-card';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('rates')
export class RatesController {
  constructor(
    private service: RatesService,
    private nbu: NbuAutoService,
  ) {}

  @Get()
  getAll() {
    return this.service.getAllActive();
  }

  // Довідкові курси НБУ (для колонки «НБУ» на сторінці курсів).
  @Get('nbu')
  async getNbu() {
    const ref = await this.nbu.getReference();
    if (!ref) return { date: null, rates: {} };
    return ref;
  }

  @Get('point/:pointId')
  getByPoint(@Param('pointId', ParseIntPipe) pointId: number) {
    return this.service.getByPoint(pointId);
  }

  // Зміна курсів — лише адмін (курси міняються з адмінки; касир їх тільки читає).
  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  upsert(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.upsert(dto, user.sub);
  }

  // Ручна публікація курсів точки в Telegram-канали.
  @Post('publish/:pointId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  publish(@Param('pointId', ParseIntPipe) pointId: number) {
    return this.service.publishPoint(pointId);
  }

  // Прев'ю картки курсів (PNG) — щоб адмін бачив, що піде в канал.
  @Get('card/:pointId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async card(
    @Param('pointId', ParseIntPipe) pointId: number,
    @Query('theme') theme: string | undefined,
    @Res() res: Response,
  ) {
    const t = parseCardTheme(theme);
    const png = await this.service.renderCard(pointId, t);
    if (!png) {
      res.status(404).json({ message: 'Немає активних курсів для цієї точки' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }
}
