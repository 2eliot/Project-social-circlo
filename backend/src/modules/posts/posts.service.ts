import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';
import { NotificationsService } from '../notifications/notifications.service';

const POST_CONTENT_MAX_LENGTH = 120;
const POST_COMMENT_MAX_LENGTH = 80;

type PostAttachment = {
  kind: 'image' | 'voice';
  url: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
};

type StoredFeedComment = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
};

type FeedPostRow = {
  id: string;
  authorId: string;
  content: string | null;
  attachments: unknown;
  likeUserIds: unknown;
  comments: unknown;
  createdAt: Date;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  authorGlobalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
  authorIsVerifiedModerator: boolean;
};

@Injectable()
export class PostsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeEvents: RealtimeEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS feed_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content VARCHAR(${POST_CONTENT_MAX_LENGTH}),
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        like_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        comments JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT feed_posts_content_or_attachments CHECK (
          COALESCE(char_length(content), 0) > 0 OR jsonb_array_length(attachments) > 0
        )
      )
    `);
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_feed_posts_created_at ON feed_posts (created_at DESC)',
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_feed_posts_author_id ON feed_posts (author_id)',
    );
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE feed_posts ALTER COLUMN content TYPE VARCHAR(${POST_CONTENT_MAX_LENGTH})`,
    );
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS like_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async list(viewerId: string, limit = 40, authorId?: string) {
    const rows = await this.prisma.$queryRawUnsafe<FeedPostRow[]>(
      `
        SELECT
          p.id,
          p.author_id AS "authorId",
          p.content,
          p.attachments,
          p.like_user_ids AS "likeUserIds",
          p.comments,
          p.created_at AS "createdAt",
          u.display_name AS "authorDisplayName",
          u.avatar_url AS "authorAvatarUrl",
          u.global_role AS "authorGlobalRole",
          u.is_verified_moderator AS "authorIsVerifiedModerator"
        FROM feed_posts p
        INNER JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND ($2::uuid IS NULL OR p.author_id = $2::uuid)
        ORDER BY p.created_at DESC
        LIMIT $1
      `,
      Math.max(1, Math.min(limit, 80)),
      authorId ?? null,
    );

    return rows.map((row) => this.serialize(row, viewerId));
  }

  async create(authorId: string, body: { content?: string; attachments?: Array<Record<string, unknown>> }) {
    const content = body.content?.trim() ?? '';
    if (content.length > POST_CONTENT_MAX_LENGTH) {
      throw new BadRequestException(`El texto no puede superar ${POST_CONTENT_MAX_LENGTH} caracteres.`);
    }

    const attachments = this.normalizeAttachments(body.attachments);
    if (!content && attachments.length === 0) {
      throw new BadRequestException('La publicacion necesita texto o archivo.');
    }

    const rows = await this.prisma.$queryRawUnsafe<FeedPostRow[]>(
      `
        INSERT INTO feed_posts (author_id, content, attachments)
        VALUES ($1::uuid, $2, $3::jsonb)
        RETURNING id, author_id AS "authorId", content, attachments, like_user_ids AS "likeUserIds", comments, created_at AS "createdAt"
      `,
      authorId,
      content || null,
      JSON.stringify(attachments),
    );

    const inserted = rows[0];
    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { displayName: true, avatarUrl: true, globalRole: true, isVerifiedModerator: true },
    });

    const post = this.serialize({
      ...inserted,
      authorDisplayName: author?.displayName ?? 'Usuario',
      authorAvatarUrl: author?.avatarUrl ?? null,
      authorGlobalRole: author?.globalRole ?? 'USER',
      authorIsVerifiedModerator: author?.isVerifiedModerator ?? false,
    }, authorId);

    this.realtimeEvents.emitFeedPostCreated(post);
    return post;
  }

  async toggleLike(postId: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<FeedPostRow[]>(
        `
          SELECT
            p.id,
            p.author_id AS "authorId",
            p.content,
            p.attachments,
            p.like_user_ids AS "likeUserIds",
            p.comments,
            p.created_at AS "createdAt",
            u.display_name AS "authorDisplayName",
            u.avatar_url AS "authorAvatarUrl",
            u.global_role AS "authorGlobalRole",
            u.is_verified_moderator AS "authorIsVerifiedModerator"
          FROM feed_posts p
          INNER JOIN users u ON u.id = p.author_id
          WHERE p.id = $1::uuid AND p.deleted_at IS NULL
          LIMIT 1
        `,
        postId,
      );

      const row = rows[0];
      if (!row) {
        throw new NotFoundException('La publicacion no existe.');
      }

      const nextLikes = this.normalizeLikeUserIds(row.likeUserIds);
      const existingIndex = nextLikes.indexOf(userId);
      const likedNow = existingIndex < 0;
      if (existingIndex >= 0) {
        nextLikes.splice(existingIndex, 1);
      } else {
        nextLikes.push(userId);
      }

      await tx.$executeRawUnsafe(
        `UPDATE feed_posts SET like_user_ids = $2::jsonb WHERE id = $1::uuid`,
        postId,
        JSON.stringify(nextLikes),
      );

      return {
        post: this.serialize({ ...row, likeUserIds: nextLikes }, userId),
        notify: likedNow,
        ownerUserId: row.authorId,
      };
    });

    this.realtimeEvents.emitFeedPostUpdated(result.post);

    if (result.notify && result.ownerUserId !== userId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });
      await this.notifications.createInteraction({
        userId: result.ownerUserId,
        actorUserId: userId,
        kind: 'POST_LIKED',
        postId,
        title: 'Nuevo like',
        body: `${actor?.displayName ?? 'Alguien'} le dio like a tu publicación.`,
      });
    }

    return result.post;
  }

  async addComment(postId: string, userId: string, rawBody: string) {
    const body = rawBody.trim();
    if (!body) {
      throw new BadRequestException('El comentario no puede estar vacio.');
    }
    if (body.length > POST_COMMENT_MAX_LENGTH) {
      throw new BadRequestException(`El comentario no puede superar ${POST_COMMENT_MAX_LENGTH} caracteres.`);
    }

    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    const post = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<FeedPostRow[]>(
        `
          SELECT
            p.id,
            p.author_id AS "authorId",
            p.content,
            p.attachments,
            p.like_user_ids AS "likeUserIds",
            p.comments,
            p.created_at AS "createdAt",
            u.display_name AS "authorDisplayName",
            u.avatar_url AS "authorAvatarUrl",
            u.global_role AS "authorGlobalRole",
            u.is_verified_moderator AS "authorIsVerifiedModerator"
          FROM feed_posts p
          INNER JOIN users u ON u.id = p.author_id
          WHERE p.id = $1::uuid AND p.deleted_at IS NULL
          LIMIT 1
        `,
        postId,
      );

      const row = rows[0];
      if (!row) {
        throw new NotFoundException('La publicacion no existe.');
      }

      const nextComments = this.normalizeComments(row.comments);
      nextComments.push({
        id: crypto.randomUUID(),
        body,
        authorId: userId,
        authorName: author?.displayName ?? 'Usuario',
        createdAt: new Date().toISOString(),
      });

      await tx.$executeRawUnsafe(
        `UPDATE feed_posts SET comments = $2::jsonb WHERE id = $1::uuid`,
        postId,
        JSON.stringify(nextComments),
      );

      return this.serialize({ ...row, comments: nextComments }, userId);
    });

    this.realtimeEvents.emitFeedPostUpdated(post);

    if (post.authorId !== userId) {
      await this.notifications.createInteraction({
        userId: post.authorId,
        actorUserId: userId,
        kind: 'POST_COMMENTED',
        postId,
        title: 'Nuevo comentario',
        body: `${author?.displayName ?? 'Alguien'} comentó tu publicación.`,
      });
    }

    return post;
  }

  async report(postId: string, actorId: string, rawReason: string) {
    const reason = rawReason.trim();
    if (!reason) {
      throw new BadRequestException('Reason is required');
    }

    const row = await this.prisma.$queryRawUnsafe<Array<Pick<FeedPostRow, 'id' | 'authorId'>>>(
      `
        SELECT id, author_id AS "authorId"
        FROM feed_posts
        WHERE id = $1::uuid AND deleted_at IS NULL
        LIMIT 1
      `,
      postId,
    );

    const post = row[0];
    if (!post) {
      throw new NotFoundException('La publicacion no existe.');
    }
    if (post.authorId === actorId) {
      throw new BadRequestException("You can't report your own post");
    }

    await this.prisma.moderationLog.create({
      data: {
        actorId,
        targetType: 'MESSAGE',
        targetId: postId,
        action: 'REPORT',
        reason,
        metadata: { source: 'feed_post_menu', postAuthorId: post.authorId, kind: 'feed_post' },
      },
    });

    return { ok: true };
  }

  async remove(postId: string, actorId: string) {
    const row = await this.prisma.$queryRawUnsafe<Array<Pick<FeedPostRow, 'id' | 'authorId'>>>(
      `
        SELECT id, author_id AS "authorId"
        FROM feed_posts
        WHERE id = $1::uuid AND deleted_at IS NULL
        LIMIT 1
      `,
      postId,
    );

    const post = row[0];
    if (!post) {
      throw new NotFoundException('La publicacion no existe.');
    }
    if (post.authorId !== actorId) {
      throw new ForbiddenException('No puedes eliminar esta publicacion.');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE feed_posts SET deleted_at = now() WHERE id = $1::uuid`,
      postId,
    );

    await this.prisma.moderationLog.create({
      data: {
        actorId,
        targetType: 'MESSAGE',
        targetId: postId,
        action: 'SOFT_DELETE',
        metadata: { source: 'feed_post_menu', kind: 'feed_post' },
      },
    });

    this.realtimeEvents.emitFeedPostDeleted({ id: postId });
    return { ok: true };
  }

  private normalizeAttachments(input?: Array<Record<string, unknown>>): PostAttachment[] {
    if (!Array.isArray(input)) return [];
    return input.slice(0, 4).flatMap((item) => {
      const kind = item.kind === 'image' || item.kind === 'voice' ? item.kind : null;
      const url = typeof item.url === 'string' ? item.url : null;
      if (!kind || !url) return [];
      return [{
        kind,
        url,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
        size: typeof item.size === 'number' ? item.size : undefined,
      }];
    });
  }

  private normalizeLikeUserIds(input: unknown) {
    if (!Array.isArray(input)) return [] as string[];
    return input.filter((value): value is string => typeof value === 'string');
  }

  private normalizeComments(input: unknown): StoredFeedComment[] {
    if (!Array.isArray(input)) return [];
    return input.flatMap((item) => {
      const body = typeof item?.body === 'string' ? item.body : null;
      const authorId = typeof item?.authorId === 'string' ? item.authorId : null;
      const authorName = typeof item?.authorName === 'string' ? item.authorName : 'Usuario';
      const createdAt = typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString();
      const id = typeof item?.id === 'string' ? item.id : crypto.randomUUID();
      if (!body || !authorId) return [];
      return [{ id, body, authorId, authorName, createdAt }];
    });
  }

  private serialize(row: FeedPostRow, viewerId: string) {
    const rawAttachments = Array.isArray(row.attachments) ? row.attachments : [];
    const likeUserIds = this.normalizeLikeUserIds(row.likeUserIds);
    const comments = this.normalizeComments(row.comments);
    return {
      id: row.id,
      authorId: row.authorId,
      content: row.content,
      attachments: this.normalizeAttachments(rawAttachments as Array<Record<string, unknown>>),
      likedByMe: likeUserIds.includes(viewerId),
      likeCount: likeUserIds.length,
      comments,
      createdAt: row.createdAt,
      author: {
        id: row.authorId,
        displayName: row.authorDisplayName,
        avatarUrl: row.authorAvatarUrl,
        globalRole: row.authorGlobalRole,
        isVerifiedModerator: row.authorIsVerifiedModerator,
      },
    };
  }
}