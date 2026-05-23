import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';

export type NotificationKind = 'POST_LIKED' | 'POST_COMMENTED';

export type NotificationPayload = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  postId: string | null;
  isRead: boolean;
  createdAt: Date;
  actor: {
    id: string | null;
    displayName: string;
    avatarUrl: string | null;
    globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
    isVerifiedModerator: boolean;
  } | null;
};

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  postId: string | null;
  isRead: boolean;
  createdAt: Date;
  actorId: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  actorGlobalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER' | null;
  actorIsVerifiedModerator: boolean | null;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        kind VARCHAR(32) NOT NULL,
        title VARCHAR(160) NOT NULL,
        body VARCHAR(240) NOT NULL,
        post_id UUID,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications (user_id, created_at DESC)',
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON user_notifications (user_id, is_read)',
    );
  }

  async createInteraction(input: {
    userId: string;
    actorUserId: string;
    kind: NotificationKind;
    postId: string;
    title: string;
    body: string;
  }) {
    if (input.userId === input.actorUserId) return null;

    const rows = await this.prisma.$queryRawUnsafe<NotificationRow[]>(
      `
        INSERT INTO user_notifications (user_id, actor_user_id, kind, title, body, post_id)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
        RETURNING id, kind, title, body, post_id AS "postId", is_read AS "isRead", created_at AS "createdAt", actor_user_id AS "actorId"
      `,
      input.userId,
      input.actorUserId,
      input.kind,
      input.title,
      input.body,
      input.postId,
    );

    const notification = await this.hydrateRow(rows[0]);
    this.realtimeEvents.emitNotification(input.userId, notification);
    return notification;
  }

  async list(userId: string, limit = 30) {
    const rows = await this.prisma.$queryRawUnsafe<NotificationRow[]>(
      `
        SELECT
          n.id,
          n.kind,
          n.title,
          n.body,
          n.post_id AS "postId",
          n.is_read AS "isRead",
          n.created_at AS "createdAt",
          n.actor_user_id AS "actorId",
          u.display_name AS "actorDisplayName",
          u.avatar_url AS "actorAvatarUrl",
          u.global_role AS "actorGlobalRole",
          u.is_verified_moderator AS "actorIsVerifiedModerator"
        FROM user_notifications n
        LEFT JOIN users u ON u.id = n.actor_user_id
        WHERE n.user_id = $1::uuid
        ORDER BY n.created_at DESC
        LIMIT $2
      `,
      userId,
      Math.max(1, Math.min(limit, 50)),
    );

    return rows.map((row) => this.serialize(row));
  }

  async unreadCount(userId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM user_notifications WHERE user_id = $1::uuid AND is_read = false`,
      userId,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  }

  async markRead(userId: string, notificationId: string) {
    const rows = await this.prisma.$queryRawUnsafe<NotificationRow[]>(
      `
        UPDATE user_notifications
        SET is_read = true
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING id, kind, title, body, post_id AS "postId", is_read AS "isRead", created_at AS "createdAt", actor_user_id AS "actorId"
      `,
      notificationId,
      userId,
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Notification not found');
    return this.hydrateRow(row);
  }

  async markAllRead(userId: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE user_notifications SET is_read = true WHERE user_id = $1::uuid AND is_read = false`,
      userId,
    );
    return { ok: true };
  }

  private async hydrateRow(row?: NotificationRow) {
    if (!row) throw new NotFoundException('Notification not found');
    if (row.actorDisplayName !== undefined) {
      return this.serialize(row);
    }

    const actor = row.actorId
      ? await this.prisma.user.findUnique({
          where: { id: row.actorId },
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            globalRole: true,
            isVerifiedModerator: true,
          },
        })
      : null;

    return this.serialize({
      ...row,
      actorDisplayName: actor?.displayName ?? null,
      actorAvatarUrl: actor?.avatarUrl ?? null,
      actorGlobalRole: actor?.globalRole ?? null,
      actorIsVerifiedModerator: actor?.isVerifiedModerator ?? null,
    });
  }

  private serialize(row: NotificationRow): NotificationPayload {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      postId: row.postId,
      isRead: row.isRead,
      createdAt: row.createdAt,
      actor: row.actorId
        ? {
            id: row.actorId,
            displayName: row.actorDisplayName ?? 'Usuario',
            avatarUrl: row.actorAvatarUrl ?? null,
            globalRole: row.actorGlobalRole ?? 'USER',
            isVerifiedModerator: Boolean(row.actorIsVerifiedModerator),
          }
        : null,
    };
  }
}
