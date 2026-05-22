import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async getBlockedIds(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });

    return rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId));
  }

  private async assertVisibleToViewer(viewerId: string, targetUserId: string) {
    if (viewerId === targetUserId) return;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: viewerId },
        ],
      },
      select: { blockerId: true },
    });

    if (blocked) throw new NotFoundException();
  }

  /**
   * Public profile view. Honors `is_anonymous_profile` flag — the legal name
   * and original avatar are never returned through this path.
   */
  async getPublicProfile(viewerId: string, userId: string) {
    await this.assertVisibleToViewer(viewerId, userId);
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        isAnonymousProfile: true,
        isVerifiedModerator: true,
        globalRole: true,
        createdAt: true,
        _count: {
          select: {
            followsReceived: true,
            followsAuthored: true,
          },
        },
      },
    });
    if (!u || u.isAnonymousProfile === undefined) throw new NotFoundException();

    const [isFollowing, followsYou, hasBlocked, blockedYou] = await Promise.all([
      viewerId === userId
        ? Promise.resolve(false)
        : this.prisma.userFollow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: userId } },
            select: { followerId: true },
          }),
      viewerId === userId
        ? Promise.resolve(false)
        : this.prisma.userFollow.findUnique({
            where: { followerId_followingId: { followerId: userId, followingId: viewerId } },
            select: { followerId: true },
          }),
      viewerId === userId
        ? Promise.resolve(false)
        : this.prisma.userBlock.findUnique({
            where: { blockerId_blockedId: { blockerId: viewerId, blockedId: userId } },
            select: { blockerId: true },
          }),
      viewerId === userId
        ? Promise.resolve(false)
        : this.prisma.userBlock.findUnique({
            where: { blockerId_blockedId: { blockerId: userId, blockedId: viewerId } },
            select: { blockerId: true },
          }),
    ]);

    if (u.isAnonymousProfile) {
      return {
        id: u.id,
        displayName: 'Anonymous',
        avatarUrl: null,
        isAnonymousProfile: true,
        isVerifiedModerator: u.isVerifiedModerator,
        globalRole: u.globalRole,
        createdAt: u.createdAt,
        followersCount: u._count.followsReceived,
        followingCount: u._count.followsAuthored,
        isFollowing: Boolean(isFollowing),
        followsYou: Boolean(followsYou),
        hasBlocked: Boolean(hasBlocked),
        blockedYou: Boolean(blockedYou),
      };
    }
    return {
      ...u,
      followersCount: u._count.followsReceived,
      followingCount: u._count.followsAuthored,
      isFollowing: Boolean(isFollowing),
      followsYou: Boolean(followsYou),
      hasBlocked: Boolean(hasBlocked),
      blockedYou: Boolean(blockedYou),
    };
  }

  async updateMe(userId: string, patch: { displayName?: string; avatarUrl?: string; isAnonymousProfile?: boolean }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: { id: true, displayName: true, avatarUrl: true, isAnonymousProfile: true },
    });
  }

  /**
   * Search users by display name (handle). Strips a leading `@`, requires at
   * least one non-whitespace character, excludes the caller, banned accounts,
   * and users with anonymous profiles enabled.
   */
  async search(meId: string, rawQuery: string) {
    const q = rawQuery.trim().replace(/^@+/, '').trim();
    if (q.length === 0) return [];
    const blockedIds = await this.getBlockedIds(meId);
    const idFilter = blockedIds.length > 0 ? { notIn: [meId, ...blockedIds] } : { not: meId };
    const users = await this.prisma.user.findMany({
      where: {
        id: idFilter,
        isBanned: false,
        isAnonymousProfile: false,
        deletedAt: null,
        displayName: { contains: q, mode: 'insensitive' },
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        _count: { select: { followsReceived: true } },
      },
      orderBy: { displayName: 'asc' },
      take: 10,
    });
    return Promise.all(
      users.map(async (candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        avatarUrl: candidate.avatarUrl,
        followersCount: candidate._count.followsReceived,
        isFollowing: Boolean(
          await this.prisma.userFollow.findUnique({
            where: { followerId_followingId: { followerId: meId, followingId: candidate.id } },
            select: { followerId: true },
          }),
        ),
      })),
    );
  }

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new BadRequestException("You can't follow yourself");
    await this.assertVisibleToViewer(followerId, followingId);
    await this.prisma.userFollow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });
    return { ok: true };
  }

  async unfollow(followerId: string, followingId: string) {
    await this.prisma.userFollow.deleteMany({ where: { followerId, followingId } });
    return { ok: true };
  }

  async report(actorId: string, targetUserId: string, reason: string) {
    if (actorId === targetUserId) throw new BadRequestException("You can't report yourself");
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException('Reason is required');
    const exists = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, deletedAt: true } });
    if (!exists || exists.deletedAt) throw new NotFoundException();
    await this.prisma.moderationLog.create({
      data: {
        actorId,
        targetType: 'USER',
        targetId: targetUserId,
        action: 'REPORT',
        reason: trimmedReason,
        metadata: { source: 'profile_menu' },
      },
    });
    return { ok: true };
  }
}
