import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Сповіщення всім активним адмінам (центр сповіщень у хедері). Fire-and-forget:
   * помилка запису не має валити основну операцію (закриття зміни, велика оп. тощо).
   */
  async notifyAdmins(message: string) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', active: true },
        select: { id: true },
      });
      if (!admins.length) return;
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({ userId: a.id, message })),
      });
    } catch {
      /* мовчазно ігноруємо — сповіщення не критичні */
    }
  }

  async getUnread(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: number, userId: number) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: number) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
