import { Controller, Post, Delete, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { PushNotificationsService } from './push-notifications.service';

@Controller('push')
@UseGuards(AuthGuard('jwt'))
export class PushNotificationsController {
  constructor(
    private prisma: PrismaService,
    private pushService: PushNotificationsService,
  ) {}

  @Post('subscribe')
  async subscribe(
    @Req() req: any,
    @Body() body: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ) {
    const userId = req.user.id;

    // Upsert subscription
    await this.prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId, endpoint: body.endpoint } },
      update: {
        p256dh: body.p256dh,
        auth: body.auth,
        userAgent: body.userAgent || null,
      },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
        userAgent: body.userAgent || null,
      },
    });

    return { success: true };
  }

  @Delete('unsubscribe')
  async unsubscribe(@Req() req: any, @Body() body: { endpoint: string }) {
    const userId = req.user.id;

    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: body.endpoint },
    });

    return { success: true };
  }
}
