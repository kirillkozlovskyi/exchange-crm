import { Controller, Post, Body, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { IsString, IsNotEmpty } from 'class-validator';

class LoginDto {
  @IsString() @IsNotEmpty() login: string;
  @IsString() @IsNotEmpty() password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.login, dto.password);
  }

  @Get('setup-needed')
  setupNeeded() {
    return this.authService.isSetupNeeded().then((needed) => ({ needed }));
  }

  @Post('setup')
  setup(@Body() dto: { name: string; login: string; password: string }) {
    return this.authService.setupFirstAdmin(dto);
  }

  // Ковзне подовження сесії (фронт викликає у фоні, коли токен «старіє»).
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  refresh(@CurrentUser() user: any) {
    return this.authService.refresh(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: any, @Body() dto: { name?: string; phone?: string }) {
    return this.authService.updateProfile(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: any,
    @Body() dto: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
