import { Controller, Get, Post, Body, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ReconciliationsService } from './reconciliations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('reconciliations')
export class ReconciliationsController {
  constructor(private service: ReconciliationsService) {}

  @Get()
  getAll(@Query('cashDeskId') cashDeskId?: string, @Query('shiftId') shiftId?: string) {
    return this.service.getAll(
      cashDeskId ? Number(cashDeskId) : undefined,
      shiftId ? Number(shiftId) : undefined,
    );
  }

  @Post()
  create(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub);
  }
}
