import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';

type MessageAuthor = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAnonymousProfile: boolean;
};

type MessageParentPreview = {
  id: string;
  content: string | null;
  attachments: Prisma.JsonValue;
  author: Pick<MessageAuthor, 'id' | 'displayName'> | null;
};

type MessageRow = {
  id: string;
  createdAt: Date;
  content: string | null;
  authorId: string | null;
  parentId: string | null;
  attachments: Prisma.JsonValue;
  status: 'PUBLISHED' | 'PENDING_MODERATION' | 'DELETED';
  author: MessageAuthor | null;
};

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

  private async attachParents(messages: MessageRow[]) {
    const parentIds = Array.from(new Set(messages.map((message) => message.parentId).filter((value): value is string => Boolean(value))));
    if (parentIds.length === 0) {
      return messages.map((message) => ({ ...message, parent: null }));
    }

    const parents = await this.prisma.message.findMany({
      where: {
        id: { in: parentIds },
        deletedAt: null,
        status: 'PUBLISHED',
      },
      select: {
        id: true,
        content: true,
        attachments: true,
        author: { select: { id: true, displayName: true } },
      },
    });

    const parentMap = new Map<string, MessageParentPreview>(
      parents.map((parent) => [
        parent.id,
        {
          id: parent.id,
          content: parent.content,
          attachments: parent.attachments,
          author: parent.author ? { id: parent.author.id, displayName: parent.author.displayName } : null,
        },
      ]),
    );

    return messages.map((message) => ({
      ...message,
      parent: message.parentId ? parentMap.get(message.parentId) ?? null : null,
    }));
  }

  /** Lists recent messages excluding those authored by users the requester blocks (or who block them). */
  async listForChannel(requesterId: string, channelId: string, limit = 50, before?: Date) {
    const messages = await this.prisma.message.findMany({
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

    return this.attachParents(messages as MessageRow[]);
  }

  async create(input: CreateMessageInput) {
    let parentMessageId: string | null = null;
    const channel = await this.prisma.channel.findUnique({ where: { id: input.channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (!channel.isEnabled) throw new ForbiddenException('Channel disabled');
    if (channel.type !== 'TEXT') throw new ForbiddenException('Not a text channel');

    if (input.parentId) {
      const parent = await this.prisma.message.findFirst({
        where: {
          id: input.parentId,
          channelId: input.channelId,
          deletedAt: null,
          status: 'PUBLISHED',
        },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Reply target not found');
      parentMessageId = parent.id;
    }

    const message = await this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: input.authorId,
        content: input.content,
        attachments: input.attachments ?? [],
        parentId: parentMessageId,
        status: input.attachments ? 'PENDING_MODERATION' : 'PUBLISHED',
      },
      include: {
        author: {
          select: { id: true, displayName: true, avatarUrl: true, isAnonymousProfile: true },
        },
      },
    });

    const [serialized] = await this.attachParents([message as MessageRow]);
    return serialized;
  }

  async createSystem(channelId: string, content: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== 'TEXT') throw new ForbiddenException('Not a text channel');

    console.log(`[createSystem] Creating system message in channel ${channelId}: "${content}"`);

    const message = await this.prisma.message.create({
      data: {
        channelId,
        authorId: null,
        content,
        attachments: [],
        status: 'PUBLISHED',
      },
      include: {
        author: {
          select: { id: true, displayName: true, avatarUrl: true, isAnonymousProfile: true },
        },
      },
    });

    console.log(`[createSystem] System message created with ID: ${message.id}, authorId: ${message.authorId}`);

    const [serialized] = await this.attachParents([message as MessageRow]);
    return serialized;
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
