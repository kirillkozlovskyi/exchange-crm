import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('storno-window')
  getStornoWindow() {
    return this.settingsService.getStornoWindowMinutes().then((minutes) => ({ minutes }));
  }

  @Put('storno-window')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setStornoWindow(@Body() body: { minutes: number }) {
    return this.settingsService.setStornoWindowMinutes(body.minutes).then(() => ({ minutes: body.minutes }));
  }

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

  @Get('balance-edit')
  getBalanceEdit() {
    return this.settingsService.getBalanceEditEnabled().then((enabled) => ({ enabled }));
  }

  @Put('balance-edit')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setBalanceEdit(@Body() body: { enabled: boolean }) {
    return this.settingsService.setBalanceEditEnabled(body.enabled).then(() => ({ enabled: body.enabled }));
  }
}
