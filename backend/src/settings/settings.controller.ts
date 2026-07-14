import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { TelegramService } from '../telegram/telegram.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private telegram: TelegramService,
  ) {}

  // ── Telegram-сповіщення (лише адмін; токен назовні не віддаємо) ───────────
  @Get('telegram')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getTelegram() {
    return this.settingsService.getTelegramMasked();
  }

  @Put('telegram')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async setTelegram(@Body() body: { token?: string; chatId?: string }) {
    await this.settingsService.setTelegram(body);
    return this.settingsService.getTelegramMasked();
  }

  @Post('telegram/test')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async testTelegram() {
    const ok = await this.telegram.send('✅ Тестове сповіщення: обмінник CRM підключено до Telegram');
    return { ok };
  }

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

  @Get('nbu-auto')
  async getNbuAuto() {
    return { enabled: await this.settingsService.getNbuAutoUpdate() };
  }

  @Put('nbu-auto')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setNbuAuto(@Body() body: { enabled: boolean }) {
    return this.settingsService.setNbuAutoUpdate(!!body.enabled);
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

  @Get('large-op')
  getLargeOp() {
    return this.settingsService.getLargeOpUah().then((amount) => ({ amount }));
  }

  @Put('large-op')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setLargeOp(@Body() body: { amount: number }) {
    return this.settingsService.setLargeOpUah(body.amount).then(() => ({ amount: body.amount }));
  }

  @Get('cashier-see-bank')
  getCashierSeeBank() {
    return this.settingsService.getCashierCanSeeBank().then((enabled) => ({ enabled }));
  }

  @Put('cashier-see-bank')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setCashierSeeBank(@Body() body: { enabled: boolean }) {
    return this.settingsService.setCashierCanSeeBank(body.enabled).then(() => ({ enabled: body.enabled }));
  }

  // Картка курсів для Telegram: стиль + постити картинкою замість тексту.
  @Get('rate-card')
  async getRateCard() {
    return {
      theme: await this.settingsService.getRateCardTheme(),
      asImage: await this.settingsService.getRatePostAsImage(),
      config: await this.settingsService.getRateCardConfig(),
    };
  }

  @Put('rate-card')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async setRateCard(@Body() body: { theme?: any; asImage?: boolean; config?: any }) {
    if (body.theme) await this.settingsService.setRateCardTheme(body.theme);
    if (body.asImage !== undefined) await this.settingsService.setRatePostAsImage(!!body.asImage);
    if (body.config) await this.settingsService.setRateCardConfig(body.config);
    return {
      theme: await this.settingsService.getRateCardTheme(),
      asImage: await this.settingsService.getRatePostAsImage(),
      config: await this.settingsService.getRateCardConfig(),
    };
  }

  @Get('cash-bank-enabled')
  getCashBankEnabled() {
    return this.settingsService.getCashBankEnabled().then((enabled) => ({ enabled }));
  }

  @Put('cash-bank-enabled')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setCashBankEnabled(@Body() body: { enabled: boolean }) {
    return this.settingsService.setCashBankEnabled(body.enabled).then(() => ({ enabled: body.enabled }));
  }

  @Get('buyback-margin')
  getBuybackMargin() {
    return this.settingsService.getBuybackMarginEnabled().then((enabled) => ({ enabled }));
  }

  @Put('buyback-margin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setBuybackMargin(@Body() body: { enabled: boolean }) {
    return this.settingsService.setBuybackMarginEnabled(body.enabled).then(() => ({ enabled: body.enabled }));
  }

  @Get('cashier-see-profit')
  getCashierSeeProfit() {
    return this.settingsService.getCashierCanSeeProfit().then((enabled) => ({ enabled }));
  }

  @Put('cashier-see-profit')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setCashierSeeProfit(@Body() body: { enabled: boolean }) {
    return this.settingsService.setCashierCanSeeProfit(body.enabled).then(() => ({ enabled: body.enabled }));
  }

  @Get('currency-order')
  getCurrencyOrder() {
    return this.settingsService.getCurrencyOrder();
  }

  @Put('currency-order')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setCurrencyOrder(@Body() body: { order: string[] }) {
    return this.settingsService.setCurrencyOrder(body.order).then(() => body.order);
  }

  @Get('quick-amounts')
  getQuickAmounts() {
    return this.settingsService.getQuickAmounts();
  }

  @Put('quick-amounts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setQuickAmounts(@Body() body: { amounts: number[] }) {
    return this.settingsService.setQuickAmounts(body.amounts).then(() => body.amounts);
  }

  @Get('usdt-quick-amounts')
  getUsdtQuickAmounts() {
    return this.settingsService.getUsdtQuickAmounts();
  }

  @Put('usdt-quick-amounts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setUsdtQuickAmounts(@Body() body: { amounts: number[] }) {
    return this.settingsService.setUsdtQuickAmounts(body.amounts).then(() => body.amounts);
  }

  @Get('org-name')
  getOrgName() {
    return this.settingsService.getOrgName().then((name) => ({ name }));
  }

  @Put('org-name')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setOrgName(@Body() body: { name: string }) {
    return this.settingsService.setOrgName(body.name ?? '').then(() => ({ name: (body.name ?? '').trim() }));
  }
}
