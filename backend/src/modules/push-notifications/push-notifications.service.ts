import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const admin = require('firebase-admin');

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  fcmToken: string | null;
  platform: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private fcmApp: any = null;

  constructor(private configService: ConfigService) {
    // Configure VAPID for web-push (PWA)
    const vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const vapidSubject = this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@appchat.com';

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('VAPID keys configured for web-push');
    } else {
      this.logger.warn('VAPID keys not configured. Web push will not work.');
    }

    // Configure Firebase Admin for FCM (native app)
    const firebaseProjectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const firebaseClientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const firebasePrivateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (firebaseProjectId && firebaseClientEmail && firebasePrivateKey) {
      try {
        if (admin.getApps().length === 0) {
          this.fcmApp = admin.initializeApp({
            credential: admin.cert({
              projectId: firebaseProjectId,
              clientEmail: firebaseClientEmail,
              privateKey: firebasePrivateKey.replace(/\\n/g, '\n'),
            }),
          });
        } else {
          this.fcmApp = admin.getApp();
        }
        this.logger.log('Firebase Admin SDK configured for FCM');
      } catch (err: any) {
        this.logger.warn(`Firebase Admin SDK failed to initialize: ${err.message}`);
      }
    } else {
      this.logger.warn('FCM not configured. Native push notifications will not work.');
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
    // FCM (native app) — priority over web-push
    if (subscription.fcmToken && subscription.platform === 'android') {
      return this.sendFcmNotification(subscription, payload);
    }

    // Web-push (PWA / browser)
    if (subscription.endpoint && subscription.p256dh && subscription.auth) {
      return this.sendWebPushNotification(subscription, payload);
    }

    this.logger.warn(`No valid push target for user ${subscription.userId}`);
    return false;
  }

  private async sendFcmNotification(
    subscription: PushSubscription,
    payload: {
      title: string;
      body: string;
      icon?: string;
      badge?: string;
      image?: string;
      data?: Record<string, unknown>;
      tag?: string;
      requireInteraction?: boolean;
    },
  ): Promise<boolean> {
    if (!this.fcmApp) {
      this.logger.warn('FCM not initialized, cannot send native push');
      return false;
    }

    try {
      const message: any = {
        token: subscription.fcmToken,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data
          ? Object.fromEntries(
              Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
            )
          : {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            icon: 'ic_launcher',
            color: '#6366f1',
            tag: payload.tag || 'dm',
            clickAction: 'cloud.socialcircleinfo.app.OPEN',
          },
        },
      };

      await admin.messaging(this.fcmApp).send(message);
      return true;
    } catch (error: any) {
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        this.logger.warn(`FCM token invalid for user ${subscription.userId}, should be cleaned`);
        return false;
      }
      this.logger.error(`FCM send failed: ${error.message}`);
      return false;
    }
  }

  private async sendWebPushNotification(
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
        endpoint: subscription.endpoint!,
        keys: {
          p256dh: subscription.p256dh!,
          auth: subscription.auth!,
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
      this.logger.error(`Failed to send web push: ${error.message}`);
      return false;
    }
  }
}
