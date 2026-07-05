import { Controller, Get, Post, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { RatesService } from './rates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
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

  // Зміна курсів — лише адмін (курси міняються з адмінки; касир їх тільки читає).
  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  upsert(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.upsert(dto, user.sub);
  }
}
