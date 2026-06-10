import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt: Date;
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(private configService: ConfigService) {
    const vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const vapidSubject = this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@appchat.com';

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('VAPID keys configured for web-push');
    } else {
      this.logger.warn('VAPID keys not configured. Push notifications will not work.');
    }
  }

  async sendPushNotification(
    subscription: PushSubscription,
    payload: {
      title: string;
      body: string;
      icon?: string;
      badge?: string;
      image?: string;
      data?: Record<string, unknown>;
      tag?: string;
      actions?: Array<{ action: string; title: string; type?: string; placeholder?: string }>;
      renotify?: boolean;
      requireInteraction?: boolean;
    },
  ): Promise<boolean> {
    try {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          icon: payload.icon || '/icons/icon.svg',
          badge: payload.badge || '/icons/icon.svg',
          image: payload.image || undefined,
          data: payload.data || {},
          tag: payload.tag || 'dm',
          vibrate: [200, 100, 200],
          requireInteraction: payload.requireInteraction !== undefined ? payload.requireInteraction : true,
          renotify: payload.renotify || false,
          actions: payload.actions || [],
          timestamp: Date.now(),
        }),
      );

      return true;
    } catch (error: any) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        this.logger.warn(`Push subscription expired or invalid for user ${subscription.userId}`);
        return false;
      }
      this.logger.error(`Failed to send push notification: ${error.message}`);
      return false;
    }
  }
}
