import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION ===', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('=== UNHANDLED REJECTION ===', reason);
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
  await app.listen(port);
  console.log(`=== LISTENING ON PORT ${port} ===`);
}
bootstrap().catch((err) => {
  console.error('=== BOOTSTRAP FAILED ===', err);
  process.exit(1);
});
