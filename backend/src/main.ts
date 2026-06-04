import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { RedisIoAdapter } from './realtime/adapters/redis-io.adapter';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  const corsRaw = config.get<string>('CORS_ORIGIN', 'http://localhost:3000');
  const corsOrigins = corsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');

  const uploadsDir = join(__dirname, '..', '..', '..', 'uploads');
  mkdirSync(join(uploadsDir, 'avatars'), { recursive: true });
  mkdirSync(join(uploadsDir, 'groups'), { recursive: true });
  mkdirSync(join(uploadsDir, 'dm'), { recursive: true });
  mkdirSync(join(uploadsDir, 'posts'), { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  // Scaling Socket.io horizontally via Redis pub/sub
  try {
    const ioAdapter = new RedisIoAdapter(app);
    await ioAdapter.connectToRedis(config);
    app.useWebSocketAdapter(ioAdapter);
  } catch (err) {
    Logger.warn(`Redis IO adapter unavailable, falling back to in-memory: ${(err as Error).message}`, 'Bootstrap');
    app.useWebSocketAdapter(new IoAdapter(app));
  }

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  Logger.log(`Appchat backend listening on :${port}`, 'Bootstrap');
}

bootstrap();
