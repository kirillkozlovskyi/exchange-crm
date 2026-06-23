import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('nbu-rates')
  getNbuRates() {
    return this.settingsService.getNbuRates();
  }

  @Put('nbu-rates')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setNbuRates(@Body() body: { buyPct: number; sellPct: number }) {
    return this.settingsService.setNbuRates(body.buyPct, body.sellPct);
  }
}
