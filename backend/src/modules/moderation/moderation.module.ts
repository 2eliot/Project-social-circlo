import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationProcessor } from './moderation.processor';
import { NsfwImageAdapter } from './adapters/nsfw-image.adapter';
import { TextModerationAdapter } from './adapters/text-moderation.adapter';

@Module({
  providers: [ModerationService, ModerationProcessor, NsfwImageAdapter, TextModerationAdapter],
  exports: [ModerationService],
})
export class ModerationModule {}
