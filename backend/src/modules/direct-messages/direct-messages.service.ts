import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';

@Injectable()
export class DirectMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  private async assertNotBlocked(meId: string, peerId: string) {
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: meId, blockedId: peerId },
          { blockerId: peerId, blockedId: meId },
        ],
      },
      select: { blockerId: true },
    });
    if (blocked) throw new ForbiddenException('Blocked');
  }

  private serializeConversation(userId: string, conv: {
    id: string;
    userAId: string;
    userBId: string;
    initiatorId: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    acceptedAt: Date | null;
    rejectedAt: Date | null;
    createdAt: Date;
    userA: { id: string; displayName: string; avatarUrl: string | null };
    userB: { id: string; displayName: string; avatarUrl: string | null };
    messages?: Array<{ id: string; content: string | null; createdAt: Date; authorId: string | null; attachments: Prisma.JsonValue }>;
  }) {
    const peer = conv.userAId === userId ? conv.userB : conv.userA;
    const isRequester = conv.initiatorId === userId;
    const pendingForMe = conv.status === 'PENDING' && !isRequester;
    const lastMessage = conv.messages?.[0] ?? null;

    return {
      id: conv.id,
      status: conv.status,
      initiatorId: conv.initiatorId,
      acceptedAt: conv.acceptedAt,
      rejectedAt: conv.rejectedAt,
      createdAt: conv.createdAt,
      peer,
      pendingForMe,
      canSendIntro: conv.status === 'PENDING' && isRequester && (conv.messages?.length ?? 0) === 0,
      canReply: conv.status === 'ACCEPTED',
      lastMessage,
    };
  }

  /** Resolves (or creates) a canonical DM conversation between two users. */
  async openConversation(meId: string, peerId: string) {
    if (meId === peerId) throw new ForbiddenException("You can't DM yourself");
    await this.assertNotBlocked(meId, peerId);

    const [a, b] = meId < peerId ? [meId, peerId] : [peerId, meId];
    const existing = await this.prisma.directConversation.findUnique({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      include: {
        userA: { select: { id: true, displayName: true, avatarUrl: true } },
        userB: { select: { id: true, displayName: true, avatarUrl: true } },
        messages: {
          where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId: meId } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
        },
      },
    });

    if (existing && existing.status !== 'REJECTED') {
      /* Un-hide if the current user had hidden this conversation */
      const isUserA = existing.userAId === meId;
      if ((isUserA && existing.userAHiddenAt) || (!isUserA && existing.userBHiddenAt)) {
        const updated = await this.prisma.directConversation.update({
          where: { id: existing.id },
          data: isUserA ? { userAHiddenAt: null } : { userBHiddenAt: null },
          include: {
            userA: { select: { id: true, displayName: true, avatarUrl: true } },
            userB: { select: { id: true, displayName: true, avatarUrl: true } },
            messages: {
              where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId: meId } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
            },
          },
        });
        return this.serializeConversation(meId, updated);
      }
      return this.serializeConversation(meId, existing);
    }

    const conversation = existing
      ? await this.prisma.directConversation.update({
          where: { id: existing.id },
          data: {
            initiatorId: meId,
            status: 'PENDING',
            acceptedAt: null,
            rejectedAt: null,
            /* Also un-hide for the current user */
            ...(existing.userAId === meId ? { userAHiddenAt: null } : { userBHiddenAt: null }),
          },
          include: {
            userA: { select: { id: true, displayName: true, avatarUrl: true } },
            userB: { select: { id: true, displayName: true, avatarUrl: true } },
            messages: {
              where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId: meId } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
            },
          },
        })
      : await this.prisma.directConversation.create({
          data: { userAId: a, userBId: b, initiatorId: meId, status: 'PENDING' },
          include: {
            userA: { select: { id: true, displayName: true, avatarUrl: true } },
            userB: { select: { id: true, displayName: true, avatarUrl: true } },
            messages: {
              where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId: meId } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
            },
          },
        });
    return this.serializeConversation(meId, conversation);
  }

  async listConversations(userId: string) {
    const blockedRows = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blockedRows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId));

    const conversations = await this.prisma.directConversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: { id: true, displayName: true, avatarUrl: true } },
        userB: { select: { id: true, displayName: true, avatarUrl: true } },
        messages: {
          where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return conversations
      .filter((conversation) => {
        const peerId = conversation.userAId === userId ? conversation.userBId : conversation.userAId;
        if (blockedIds.includes(peerId)) return false;
        /* Skip if the current user has hidden this conversation */
        if (conversation.userAId === userId && conversation.userAHiddenAt) return false;
        if (conversation.userBId === userId && conversation.userBHiddenAt) return false;
        return true;
      })
      .map((conversation) => this.serializeConversation(userId, conversation));
  }

  async getConversation(userId: string, conversationId: string) {
    const conv = await this.prisma.directConversation.findUnique({
      where: { id: conversationId },
      include: {
        userA: { select: { id: true, displayName: true, avatarUrl: true } },
        userB: { select: { id: true, displayName: true, avatarUrl: true } },
        messages: {
          where: { deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, authorId: true, attachments: true },
        },
      },
    });
    if (!conv || (conv.userAId !== userId && conv.userBId !== userId)) throw new NotFoundException();
    /* Return 404 if the current user has hidden this conversation */
    if (conv.userAId === userId && conv.userAHiddenAt) throw new NotFoundException();
    if (conv.userBId === userId && conv.userBHiddenAt) throw new NotFoundException();
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);
    return this.serializeConversation(userId, conv);
  }

  async listMessages(userId: string, conversationId: string, limit = 50, before?: Date) {
    const conv = await this.assertParticipant(userId, conversationId);
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);
    return this.prisma.directMessage.findMany({
      where: {
        conversationId,
        deletedAt: null,
        status: 'PUBLISHED',
        hiddenFor: { none: { userId } },
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        author: { select: { id: true, displayName: true, avatarUrl: true } },
        parent: {
          select: {
            id: true,
            content: true,
            attachments: true,
            author: { select: { id: true, displayName: true } },
          },
        },
      },
    });
  }

  async send(userId: string, conversationId: string, content?: string, attachments?: Array<Record<string, unknown>>, parentId?: string) {
    const trimmed = content?.trim() ?? '';
    const normalizedAttachments = Array.isArray(attachments) ? attachments.slice(0, 4) : [];
    if (!trimmed && normalizedAttachments.length === 0) throw new BadRequestException('Message is required');

    const conv = await this.assertParticipant(userId, conversationId);
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);

    let parentMessageId: string | null = null;
    if (parentId) {
      const parent = await this.prisma.directMessage.findFirst({
        where: {
          id: parentId,
          conversationId,
          deletedAt: null,
          status: 'PUBLISHED',
        },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Reply target not found');
      parentMessageId = parent.id;
    }

    const existingMessages = await this.prisma.directMessage.count({
      where: { conversationId, deletedAt: null, status: 'PUBLISHED', hiddenFor: { none: { userId } } },
    });

    if (conv.status === 'PENDING') {
      if (conv.initiatorId !== userId) {
        throw new ForbiddenException('Pending acceptance');
      }
      if (existingMessages > 0) {
        throw new ForbiddenException('Intro already sent');
      }
    } else if (conv.status !== 'ACCEPTED') {
      throw new ForbiddenException('Conversation unavailable');
    }

    const message = await this.prisma.directMessage.create({
      data: {
        conversationId,
        authorId: userId,
        parentId: parentMessageId,
        content: trimmed || null,
        attachments: normalizedAttachments as Prisma.InputJsonValue,
        status: 'PUBLISHED',
      },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    this.realtimeEvents.emitDmMessage(peerId, {
      conversationId,
      messageId: message.id,
      authorId: userId,
      authorDisplayName: message.author?.displayName ?? 'Usuario',
      authorAvatarUrl: message.author?.avatarUrl ?? null,
      content: message.content,
      attachments: message.attachments,
      createdAt: message.createdAt,
    });

    return message;
  }

  async acceptConversation(userId: string, conversationId: string) {
    const conv = await this.assertParticipant(userId, conversationId);
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);
    if (conv.initiatorId === userId) throw new ForbiddenException('Only the recipient can accept');
    if (conv.status !== 'PENDING') return this.getConversation(userId, conversationId);

    await this.prisma.directConversation.update({
      where: { id: conversationId },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), rejectedAt: null },
    });
    return this.getConversation(userId, conversationId);
  }

  async rejectConversation(userId: string, conversationId: string) {
    const conv = await this.assertParticipant(userId, conversationId);
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);
    if (conv.initiatorId === userId) throw new ForbiddenException('Only the recipient can reject');

    await this.prisma.$transaction([
      this.prisma.directConversation.update({
        where: { id: conversationId },
        data: { status: 'REJECTED', rejectedAt: new Date(), acceptedAt: null },
      }),
      this.prisma.directMessage.updateMany({
        where: { conversationId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'DELETED' },
      }),
    ]);

    return this.getConversation(userId, conversationId);
  }

  async removeConversation(userId: string, conversationId: string) {
    const conv = await this.assertParticipant(userId, conversationId);
    const isUserA = conv.userAId === userId;
    await this.prisma.directConversation.update({
      where: { id: conversationId },
      data: isUserA
        ? { userAHiddenAt: new Date() }
        : { userBHiddenAt: new Date() },
    });
    return { ok: true };
  }

  async removeMessage(userId: string, conversationId: string, messageId: string) {
    const conv = await this.assertParticipant(userId, conversationId);
    const peerId = conv.userAId === userId ? conv.userBId : conv.userAId;
    await this.assertNotBlocked(userId, peerId);

    const message = await this.prisma.directMessage.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
      select: { id: true, authorId: true },
    });

    if (!message) throw new NotFoundException();
    if (message.authorId === userId) {
      await this.prisma.directMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), status: 'DELETED' },
      });
    } else {
      await this.prisma.directMessageHidden.upsert({
        where: { messageId_userId: { messageId, userId } },
        create: { messageId, userId },
        update: {},
      });
    }

    return { ok: true };
  }

  private async assertParticipant(userId: string, conversationId: string) {
    const conv = await this.prisma.directConversation.findUnique({ where: { id: conversationId } });
    if (!conv || (conv.userAId !== userId && conv.userBId !== userId)) {
      throw new ForbiddenException();
    }
    return conv;
  }
}
