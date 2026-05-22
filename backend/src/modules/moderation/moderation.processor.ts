import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ModerationService, ModerationJob, MODERATION_QUEUE } from './moderation.service';
import { NsfwImageAdapter } from './adapters/nsfw-image.adapter';
import { TextModerationAdapter } from './adapters/text-moderation.adapter';

@Injectable()
export class ModerationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationProcessor.name);
  private worker?: Worker<ModerationJob>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mod: ModerationService,
    private readonly nsfw: NsfwImageAdapter,
    private readonly text: TextModerationAdapter,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ModerationJob>(
      MODERATION_QUEUE,
      async (job) => this.handle(job.data),
      {
        connection: {
          host: this.config.get<string>('REDIS_HOST'),
          port: this.config.get<number>('REDIS_PORT'),
          password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        },
        concurrency: 8,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Moderation job ${job?.id} failed: ${err.message}`),
    );
  }

  private async handle(job: ModerationJob) {
    if (job.type === 'message') {
      const result = await this.text.analyze(job.content ?? '');
      if (result.blocked) {
        await this.prisma.message.updateMany({
          where: { id: job.refId },
          data: { status: 'BLOCKED', deletedAt: new Date() },
        });
        await this.mod.log({
          targetType: 'MESSAGE',
          targetId: job.refId,
          action: 'NSFW_BLOCK',
          reason: result.reason,
          metadata: result.scores,
        });
      } else {
        await this.prisma.message.updateMany({
          where: { id: job.refId },
          data: { status: 'PUBLISHED' },
        });
      }
    } else if (job.type === 'file' || job.type === 'avatar') {
      if (!job.fileUrl) return;
      const result = await this.nsfw.analyze(job.fileUrl);
      if (result.blocked) {
        await this.mod.log({
          targetType: 'FILE',
          targetId: job.refId,
          action: 'NSFW_BLOCK',
          reason: result.reason,
          metadata: result.scores,
        });
      }
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
