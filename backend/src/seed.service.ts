import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      this.logger.log('SeedService: checking if DB needs seeding...');
      const count = await this.prisma.user.count();
      this.logger.log(`SeedService: user count = ${count}`);
      if (count === 0) {
        const passwordHash = await bcrypt.hash('admin123', 10);
        await this.prisma.user.create({
          data: {
            name: 'Адміністратор',
            login: 'admin',
            passwordHash,
            role: 'ADMIN',
          },
        });
        this.logger.warn('=== DB was empty — default admin created ===');
        this.logger.warn('=== Login: admin  |  Password: admin123   ===');
        this.logger.warn('=== CHANGE THE PASSWORD AFTER FIRST LOGIN! ===');
      } else {
        this.logger.log('SeedService: DB already has users, skipping seed.');
      }
    } catch (err) {
      this.logger.error('SeedService ERROR:', err);
    }
  }
}
