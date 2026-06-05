import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ReputationService } from './reputation.service';
import { PresenceService } from '../../infrastructure/redis/redis.module';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reputationService: ReputationService,
    private readonly presence: PresenceService,
  ) {}

  private buildProfilePath(displayName: string) {
    return `/app/profile/${encodeURIComponent(displayName)}`;
  }

  private normalizeHandle(raw: string) {
    return raw.trim().replace(/^@+/, '').trim();
  }

  private buildBadges(user: { globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER'; isVerifiedModerator: boolean }) {
    const badges: string[] = [];
    if (user.globalRole === 'SUPER_ADMIN') badges.push('Admin');
    if (user.globalRole === 'GLOBAL_MODERATOR' || user.isVerifiedModerator) badges.push('Moderador');
    return badges;
  }

  private mapRelationshipUser(user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    globalRole: 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER';
    isVerifiedModerator: boolean;
  }) {
    return {
      id: user.id,
      displayName: user.displayName,
      profilePath: this.buildProfilePath(user.displayName),
      avatarUrl: user.avatarUrl,
      badges: this.buildBadges(user),
    };
  }

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

    const [isFollowing, followsYou, hasBlocked, blockedYou, reputationData, userVote] = await Promise.all([
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
      this.reputationService.getReputation(userId),
      viewerId === userId ? Promise.resolve(null) : this.reputationService.getUserVoteOnProfile(viewerId, userId),
    ]);

    if (u.isAnonymousProfile) {
      return {
        id: u.id,
        displayName: 'Anonymous',
        profilePath: this.buildProfilePath('Anonymous'),
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
        badges: this.buildBadges(u),
        reputationScore: reputationData.score,
        reputationLikes: reputationData.likes,
        reputationDislikes: reputationData.dislikes,
        userVoteType: userVote,
      };
    }
    return {
      ...u,
      profilePath: this.buildProfilePath(u.displayName),
      followersCount: u._count.followsReceived,
      followingCount: u._count.followsAuthored,
      isFollowing: Boolean(isFollowing),
      followsYou: Boolean(followsYou),
      hasBlocked: Boolean(hasBlocked),
      blockedYou: Boolean(blockedYou),
      badges: this.buildBadges(u),
      reputationScore: reputationData.score,
      reputationLikes: reputationData.likes,
      reputationDislikes: reputationData.dislikes,
      userVoteType: userVote,
    };
  }

  async getPublicProfileByHandle(viewerId: string, handle: string) {
    const normalizedHandle = this.normalizeHandle(handle);
    if (!normalizedHandle) throw new NotFoundException();
    const user = await this.prisma.user.findFirst({
      where: {
        displayName: { equals: normalizedHandle, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!user) throw new NotFoundException();
    return this.getPublicProfile(viewerId, user.id);
  }

  async listFollowers(viewerId: string, userId: string) {
    await this.assertVisibleToViewer(viewerId, userId);
    const rows = await this.prisma.userFollow.findMany({
      where: {
        followingId: userId,
        follower: {
          deletedAt: null,
          isBanned: false,
          isAnonymousProfile: false,
        },
      },
      select: {
        follower: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            globalRole: true,
            isVerifiedModerator: true,
          },
        },
      },
    });

    return rows
      .map((row) => row.follower)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((candidate) => this.mapRelationshipUser(candidate));
  }

  async listFollowing(viewerId: string, userId: string) {
    await this.assertVisibleToViewer(viewerId, userId);
    const rows = await this.prisma.userFollow.findMany({
      where: {
        followerId: userId,
        following: {
          deletedAt: null,
          isBanned: false,
          isAnonymousProfile: false,
        },
      },
      select: {
        following: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            globalRole: true,
            isVerifiedModerator: true,
          },
        },
      },
    });

    return rows
      .map((row) => row.following)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((candidate) => this.mapRelationshipUser(candidate));
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
  async topByReputation(meId: string) {
    const blockedIds = await this.getBlockedIds(meId);
    const excludeIds = [meId, ...blockedIds];
    const placeholders = excludeIds.map((_, i) => `$${i + 1}::uuid`).join(', ');
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; display_name: string; avatar_url: string | null; global_role: string; is_verified_moderator: boolean; score: bigint | number }>
    >(
      `SELECT u.id, u.display_name, u.avatar_url, u.global_role, u.is_verified_moderator,
              COALESCE(SUM(ur.vote_type), 0) AS score
       FROM users u
       LEFT JOIN user_reputation ur ON ur.target_id = u.id
       WHERE u.id NOT IN (${placeholders})
         AND u.is_banned = false
         AND u.is_anonymous_profile = false
         AND u.deleted_at IS NULL
       GROUP BY u.id, u.display_name, u.avatar_url, u.global_role, u.is_verified_moderator
       ORDER BY score DESC
       LIMIT 5`,
      ...excludeIds,
    );
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      profilePath: this.buildProfilePath(r.display_name),
      avatarUrl: r.avatar_url,
      reputationScore: Number(r.score),
      badges: this.buildBadges({
        globalRole: r.global_role as 'SUPER_ADMIN' | 'GLOBAL_MODERATOR' | 'USER',
        isVerifiedModerator: r.is_verified_moderator,
      }),
    }));
  }

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
        globalRole: true,
        isVerifiedModerator: true,
        _count: { select: { followsReceived: true } },
      },
      orderBy: { displayName: 'asc' },
      take: 10,
    });
    return Promise.all(
      users.map(async (candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        profilePath: this.buildProfilePath(candidate.displayName),
        avatarUrl: candidate.avatarUrl,
        followersCount: candidate._count.followsReceived,
        badges: this.buildBadges(candidate),
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

  /**
   * Returns mutual friends (users who follow me AND I follow) that are
   * currently online according to the PresenceService (Redis).
   */
  async onlineFriends(meId: string) {
    const blockedIds = await this.getBlockedIds(meId);

    // 1. Get my followers
    const followers = await this.prisma.userFollow.findMany({
      where: {
        followingId: meId,
        follower: {
          deletedAt: null,
          isBanned: false,
          isAnonymousProfile: false,
          id: { notIn: blockedIds },
        },
      },
      select: {
        follower: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            globalRole: true,
            isVerifiedModerator: true,
          },
        },
      },
    });

    const followerIds = followers.map((r) => r.follower.id);

    // 2. Filter to only those I also follow (mutual)
    const mutual = await this.prisma.userFollow.findMany({
      where: {
        followerId: meId,
        followingId: { in: followerIds },
      },
      select: { followingId: true },
    });

    const mutualIds = new Set(mutual.map((r) => r.followingId));

    // 3. Check online status via Redis
    const onlineFriends = await Promise.all(
      followers
        .filter((r) => mutualIds.has(r.follower.id))
        .map(async (r) => ({
          ...this.mapRelationshipUser(r.follower),
          online: await this.presence.isOnline(r.follower.id),
        })),
    );

    return onlineFriends.filter((f) => f.online);
  }

  async getUserGroups(viewerId: string, targetUserId: string) {
    const blockedIds = await this.getBlockedIds(viewerId);
    const groups = await this.prisma.group.findMany({
      where: {
        ownerId: targetUserId,
        isDeleted: false,
        members: targetUserId === viewerId
          ? undefined
          : { none: { userId: viewerId, isBanned: true } },
      },
      include: {
        owner: { select: { id: true, displayName: true, avatarUrl: true } },
        channels: { select: { type: true, isEnabled: true } },
        members: { select: { userId: true, role: true, isBanned: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((group) => {
      const activeMembers = group.members.filter((m) => !m.isBanned);
      const currentMembership = group.members.find((m) => m.userId === viewerId && !m.isBanned);
      const enabledChannels = group.channels.filter((c) => c.isEnabled);
      return {
        id: group.id,
        ownerId: group.ownerId,
        name: group.name,
        slug: group.slug,
        description: group.description,
        iconUrl: group.iconUrl,
        privacy: group.privacy,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        owner: group.owner,
        memberCount: activeMembers.length,
        moderatorsCount: activeMembers.filter((m) => m.role !== 'GROUP_MEMBER').length,
        currentUserRole: currentMembership?.role ?? null,
        channelSummary: {
          total: enabledChannels.length,
          text: enabledChannels.filter((c) => c.type === 'TEXT').length,
          voice: enabledChannels.filter((c) => c.type === 'VOICE').length,
          video: enabledChannels.filter((c) => c.type === 'VIDEO').length,
        },
      };
    });
  }
}
