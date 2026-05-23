import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { ModerationModule } from '../moderation/moderation.module';
import { MessagesModule } from '../messages/messages.module';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [ModerationModule, MessagesModule, RealtimeModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
