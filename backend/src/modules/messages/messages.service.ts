import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';

interface CreateMessageInput {
  authorId: string;
  channelId: string;
  content?: string;
  attachments?: Prisma.InputJsonValue;
  parentId?: string;
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lists recent messages excluding those authored by users the requester blocks (or who block them). */
  async listForChannel(requesterId: string, channelId: string, limit = 50, before?: Date) {
    return this.prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        status: 'PUBLISHED',
        ...(before ? { createdAt: { lt: before } } : {}),
        AND: [
          {
            OR: [
              { authorId: null },
              {
                author: {
                  AND: [
                    { blocksReceived: { none: { blockerId: requesterId } } },
                    { blocksAuthored: { none: { blockedId: requesterId } } },
                  ],
                },
              },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true, isAnonymousProfile: true } },
      },
    });
  }

  async create(input: CreateMessageInput) {
    const channel = await this.prisma.channel.findUnique({ where: { id: input.channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (!channel.isEnabled) throw new ForbiddenException('Channel disabled');
    if (channel.type !== 'TEXT') throw new ForbiddenException('Not a text channel');

    return this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: input.authorId,
        content: input.content,
        attachments: input.attachments ?? [],
        parentId: input.parentId,
        status: input.attachments ? 'PENDING_MODERATION' : 'PUBLISHED',
      },
      include: {
        author: {
          select: { id: true, displayName: true, avatarUrl: true, isAnonymousProfile: true },
        },
      },
    });
  }

  async edit(messageId: string, createdAt: Date, authorId: string, content: string) {
    const updated = await this.prisma.message.updateMany({
      where: { id: messageId, createdAt, authorId, deletedAt: null },
      data: { content, isEdited: true },
    });
    if (updated.count === 0) throw new ForbiddenException();
  }

  async softDelete(messageId: string, createdAt: Date) {
    await this.prisma.message.update({
      where: { id_createdAt: { id: messageId, createdAt } },
      data: { deletedAt: new Date(), status: 'DELETED' },
    });
  }

  async addReaction(messageId: string, createdAt: Date, userId: string, emoji: string) {
    // Atomic JSONB array manipulation via raw SQL: merges user into matching emoji bucket.
    await this.prisma.$executeRaw`
      UPDATE messages
         SET reactions = (
           SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
             FROM (
               SELECT CASE
                        WHEN elem->>'emoji' = ${emoji}
                          THEN jsonb_set(elem, '{user_ids}',
                                 (SELECT to_jsonb(array_agg(DISTINCT u))
                                    FROM jsonb_array_elements_text(elem->'user_ids' || to_jsonb(${userId}::text)) u))
                        ELSE elem
                      END AS elem
                 FROM jsonb_array_elements(
                   CASE WHEN reactions @> jsonb_build_array(jsonb_build_object('emoji', ${emoji}))
                        THEN reactions
                        ELSE reactions || jsonb_build_array(jsonb_build_object('emoji', ${emoji}, 'user_ids', '[]'::jsonb))
                   END
                 ) elem
             ) s
         )
       WHERE id = ${messageId}::uuid AND created_at = ${createdAt}
    `;
  }

  async pin(messageId: string, createdAt: Date, pinned: boolean) {
    await this.prisma.message.update({
      where: { id_createdAt: { id: messageId, createdAt } },
      data: { isPinned: pinned },
    });
  }
}
