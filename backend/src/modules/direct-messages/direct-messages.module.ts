import { Module } from '@nestjs/common';
import { DirectMessagesController } from './direct-messages.controller';
import { DirectMessagesService } from './direct-messages.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [RealtimeModule, RedisModule, PushNotificationsModule],
  controllers: [DirectMessagesController],
  providers: [DirectMessagesService],
  exports: [DirectMessagesService],
})
export class DirectMessagesModule {}
