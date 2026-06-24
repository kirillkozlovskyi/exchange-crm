import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('operations')
export class OperationsController {
  constructor(private service: OperationsService) {}

  @Post()
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub);
  }

  // Редагування — тільки адмін
  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  // Сторно — доступно всім (обмеження: тільки остання операція зміни)
  @Post(':id/storno')
  storno(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { note?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.storno(id, user.sub, dto.note);
  }

  @Get(':id/edits')
  getEdits(@Param('id', ParseIntPipe) id: number) {
    return this.service.getEdits(id);
  }

  @Get()
  getAll(@Query('type') type?: 'BUY' | 'SELL') {
    return this.service.getAll(type);
  }

  @Get('shift/:shiftId')
  byShift(@Param('shiftId', ParseIntPipe) shiftId: number) {
    return this.service.getByShift(shiftId);
  }

  @Get('daily/point/:pointId')
  daily(@Param('pointId', ParseIntPipe) pointId: number) {
    return this.service.getDailyByPoint(pointId);
  }
}
