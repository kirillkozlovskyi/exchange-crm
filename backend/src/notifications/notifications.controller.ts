import { Controller, Get, Patch, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  getUnread(@CurrentUser() user: any) {
    return this.service.getUnread(user.sub);
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.service.markRead(id, user.sub);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.service.markAllRead(user.sub);
  }
}
