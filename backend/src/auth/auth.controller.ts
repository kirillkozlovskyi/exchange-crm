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
}
