import { Controller, Get, Post, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { RatesService } from './rates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('rates')
export class RatesController {
  constructor(private service: RatesService) {}

  @Get()
  getAll() {
    return this.service.getAllActive();
  }

  @Get('point/:pointId')
  getByPoint(@Param('pointId', ParseIntPipe) pointId: number) {
    return this.service.getByPoint(pointId);
  }

  @Post()
  upsert(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.upsert(dto, user.sub);
  }
}
