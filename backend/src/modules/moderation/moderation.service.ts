import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ModerationAction, ModerationTarget } from '@prisma/client';

export const MODERATION_QUEUE = 'moderation';

export interface ModerationJob {
  type: 'message' | 'file' | 'avatar';
  refId: string;
  createdAt?: string; // for messages (composite key)
  content?: string;
  fileUrl?: string;
}

@Injectable()
export class ModerationService {
  readonly queue: Queue<ModerationJob>;

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    this.queue = new Queue<ModerationJob>(MODERATION_QUEUE, {
      connection: {
        host: config.get<string>('REDIS_HOST'),
        port: config.get<number>('REDIS_PORT'),
        password: config.get<string>('REDIS_PASSWORD') || undefined,
      },
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    });
  }

  enqueue(job: ModerationJob) {
    return this.queue.add(job.type, job, { removeOnComplete: 1000, removeOnFail: 5000 });
  }

  async log(entry: {
    actorId?: string | null;
    targetType: ModerationTarget;
    targetId: string;
    groupId?: string | null;
    action: ModerationAction;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.moderationLog.create({
      data: {
        actorId: entry.actorId ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        groupId: entry.groupId ?? null,
        action: entry.action,
        reason: entry.reason,
        metadata: (entry.metadata ?? {}) as any,
      },
    });
  }
}
