import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidation } from './config/env.validation';
import { AppController } from './app.controller';

import { PrismaModule } from './infrastructure/database/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { ImageModule } from './common/image.module';

import { AuthModule } from './modules/auth/auth.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { UsersModule } from './modules/users/users.module';
import { GroupsModule } from './modules/groups/groups.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { MessagesModule } from './modules/messages/messages.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { DirectMessagesModule } from './modules/direct-messages/direct-messages.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { PostsModule } from './modules/posts/posts.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';

import { RealtimeModule } from './realtime/realtime.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: envValidation,
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    ImageModule,
    AuthModule,
    InvitationsModule,
    UsersModule,
    GroupsModule,
    ChannelsModule,
    MessagesModule,
    BlocksModule,
    DirectMessagesModule,
    ModerationModule,
    PostsModule,
    NotificationsModule,
    PushNotificationsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
