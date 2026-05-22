import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './gateways/chat.gateway';
import { PresenceGateway } from './gateways/presence.gateway';
import { SignalingGateway } from './gateways/signaling.gateway';
import { SocialGateway } from './gateways/social.gateway';
import { MediasoupService } from './mediasoup/mediasoup.service';
import { RealtimeEventsService } from './realtime-events.service';
import { WsAuthService } from './ws-auth.service';
import { MessagesModule } from '../modules/messages/messages.module';
import { ModerationModule } from '../modules/moderation/moderation.module';

@Module({
  imports: [
    MessagesModule,
    ModerationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.getOrThrow('JWT_ACCESS_SECRET') }),
    }),
  ],
  providers: [WsAuthService, RealtimeEventsService, ChatGateway, PresenceGateway, SignalingGateway, SocialGateway, MediasoupService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
