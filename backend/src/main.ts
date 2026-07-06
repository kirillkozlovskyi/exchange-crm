import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Моніторинг помилок. Вмикається ЛИШЕ якщо задано SENTRY_DSN — без ключа no-op.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
  });
}

process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION ===', err);
  Sentry.captureException(err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('=== UNHANDLED REJECTION ===', reason);
  Sentry.captureException(reason);
  process.exit(1);
});

async function bootstrap() {
  console.log('=== BOOTSTRAP START ===');
  const app = await NestFactory.create(AppModule);
  console.log('=== APP MODULE CREATED ===');

  app.enableCors({ origin: '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 4000;
  // 0.0.0.0 — щоб контейнер був доступний ззовні (вимога Railway та ін. PaaS).
  await app.listen(port, '0.0.0.0');
  console.log(`=== LISTENING ON PORT ${port} ===`);
}
bootstrap().catch((err) => {
  console.error('=== BOOTSTRAP FAILED ===', err);
  Sentry.captureException(err);
  process.exit(1);
});
