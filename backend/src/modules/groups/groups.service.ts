import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType, GroupPrivacy, GroupRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ModerationService } from '../moderation/moderation.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  private getRoleRank(role?: GroupRole | null) {
    if (role === 'GROUP_ADMIN') return 3;
    if (role === 'GROUP_MODERATOR') return 2;
    if (role === 'GROUP_MEMBER') return 1;
    return 0;
  }

  private summarizeGroup(
    group: {
      id: string;
      ownerId: string;
      name: string;
      slug: string;
      description: string | null;
      iconUrl: string | null;
      privacy: GroupPrivacy;
      createdAt: Date;
      updatedAt: Date;
      owner?: { id: string; displayName: string; avatarUrl: string | null };
      channels?: Array<{ type: ChannelType; isEnabled: boolean }>;
      members?: Array<{ userId: string; role: GroupRole; isBanned: boolean }>;
    },
    userId: string,
  ) {
    const members = group.members ?? [];
    const activeMembers = members.filter((member) => !member.isBanned);
    const currentMembership = members.find((member) => member.userId === userId && !member.isBanned);
    const enabledChannels = (group.channels ?? []).filter((channel) => channel.isEnabled);

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
      bannedCount: members.filter((member) => member.isBanned).length,
      moderatorsCount: activeMembers.filter((member) => member.role !== 'GROUP_MEMBER').length,
      currentUserRole: currentMembership?.role ?? null,
      channelSummary: {
        total: enabledChannels.length,
        text: enabledChannels.filter((channel) => channel.type === 'TEXT').length,
        voice: enabledChannels.filter((channel) => channel.type === 'VOICE').length,
        video: enabledChannels.filter((channel) => channel.type === 'VIDEO').length,
      },
    };
  }

  private summarizeGroupDetail(
    group: {
      id: string;
      ownerId: string;
      name: string;
      slug: string;
      description: string | null;
      iconUrl: string | null;
      privacy: GroupPrivacy;
      createdAt: Date;
      updatedAt: Date;
      owner: { id: string; displayName: string; avatarUrl: string | null };
      channels: Array<{ id: string; name: string; type: ChannelType; isEnabled: boolean; position: number; sfuRoomId: string | null }>;
      members: Array<{
        userId: string;
        role: GroupRole;
        isBanned: boolean;
        joinedAt: Date;
        user: { id: string; displayName: string; avatarUrl: string | null };
      }>;
    },
    userId: string,
  ) {
    return {
      ...this.summarizeGroup(group, userId),
      channels: group.channels,
      members: group.members.map((member) => ({
        userId: member.userId,
        role: member.role,
        isBanned: member.isBanned,
        joinedAt: member.joinedAt,
        user: member.user,
      })),
    };
  }

  async create(
    ownerId: string,
    dto: { name: string; slug: string; description?: string; iconUrl?: string; privacy?: GroupPrivacy },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: {
            ownerId,
            name: dto.name,
            slug: dto.slug,
            description: dto.description,
            iconUrl: dto.iconUrl,
            privacy: dto.privacy ?? 'PRIVATE',
          },
        });
        await tx.groupMember.create({
          data: { groupId: group.id, userId: ownerId, role: 'GROUP_ADMIN' },
        });
        // Default channels
        await tx.channel.createMany({
          data: [
            { groupId: group.id, name: 'general', type: 'TEXT', position: 0 },
            { groupId: group.id, name: 'voice-lounge', type: 'VOICE', position: 1, sfuRoomId: group.id + ':voice' },
          ],
        });
        return group;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Slug already taken');
      throw e;
    }
  }

  async listMine(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: { members: { some: { userId, isBanned: false } }, isDeleted: false },
      include: {
        owner: { select: { id: true, displayName: true, avatarUrl: true } },
        channels: { select: { type: true, isEnabled: true } },
        members: { select: { userId: true, role: true, isBanned: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return groups.map((group) => this.summarizeGroup(group, userId));
  }

  async list(userId: string) {
    const [mine, publicGroups] = await Promise.all([
      this.listMine(userId),
      this.prisma.group.findMany({
        where: {
          isDeleted: false,
          privacy: 'PUBLIC_INVITE',
          members: { none: { userId, isBanned: false } },
        },
        include: {
          owner: { select: { id: true, displayName: true, avatarUrl: true } },
          channels: { select: { type: true, isEnabled: true } },
          members: { select: { userId: true, role: true, isBanned: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      mine,
      public: publicGroups.map((group) => this.summarizeGroup(group, userId)),
    };
  }

  async update(
    userId: string,
    groupId: string,
    patch: { name?: string; description?: string; iconUrl?: string | null; privacy?: GroupPrivacy },
  ) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, isDeleted: false },
      select: { ownerId: true },
    });
    if (!group) throw new NotFoundException();
    if (group.ownerId !== userId) {
      throw new ForbiddenException('Only the group owner can edit this group');
    }

    return this.prisma.group.update({
      where: { id: groupId },
      data: patch,
    });
  }

  async get(userId: string, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, isDeleted: false },
      include: {
        owner: { select: { id: true, displayName: true, avatarUrl: true } },
        channels: {
          select: { id: true, name: true, type: true, isEnabled: true, position: true, sfuRoomId: true },
          orderBy: { position: 'asc' },
        },
        members: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      },
    });
    if (!group) throw new NotFoundException();
    const isMember = group.members.some((m) => m.userId === userId && !m.isBanned);
    if (!isMember && group.privacy === 'SECRET') throw new NotFoundException();
    if (!isMember && group.privacy === 'PRIVATE') throw new ForbiddenException();
    return this.summarizeGroupDetail(group, userId);
  }

  async join(userId: string, groupId: string) {
    return this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, role: 'GROUP_MEMBER' },
      update: { isBanned: false },
    });
  }

  async moderateMember(
    actor: AuthUser,
    groupId: string,
    memberUserId: string,
    input: { action: 'BAN' | 'UNBAN' | 'KICK' | 'PERMABAN'; reason?: string },
  ) {
    const [group, actorMembership, targetMembership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { id: true, ownerId: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: actor.id } },
        select: { role: true, isBanned: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: memberUserId } },
        select: { role: true, isBanned: true },
      }),
    ]);

    if (!group) throw new NotFoundException();
    if (!targetMembership) throw new NotFoundException('Member not found');
    if (actor.id === memberUserId) throw new ForbiddenException('You cannot moderate yourself');

    const isGlobalModerator = actor.globalRole === 'SUPER_ADMIN' || actor.globalRole === 'GLOBAL_MODERATOR';

    if (!isGlobalModerator) {
      if (!actorMembership || actorMembership.isBanned) {
        throw new ForbiddenException('Not allowed to moderate members in this group');
      }

      if (memberUserId === group.ownerId) {
        throw new ForbiddenException('Cannot moderate the group owner');
      }

      if (this.getRoleRank(actorMembership.role) <= this.getRoleRank(targetMembership.role)) {
        throw new ForbiddenException('Cannot moderate a member with equal or higher role');
      }
    }

    if (input.action === 'BAN' || input.action === 'PERMABAN') {
      await this.prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: memberUserId } },
        data: { isBanned: true },
      });
    }

    if (input.action === 'UNBAN') {
      await this.prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: memberUserId } },
        data: { isBanned: false },
      });
    }

    if (input.action === 'KICK') {
      if (memberUserId === group.ownerId) {
        throw new ForbiddenException('Cannot kick the group owner');
      }

      await this.prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: memberUserId } },
      });
    }

    await this.moderation.log({
      actorId: actor.id,
      targetType: 'USER',
      targetId: memberUserId,
      groupId,
      action: input.action === 'PERMABAN' ? 'BAN' : input.action,
      reason: input.reason,
      metadata: {
        source: 'group-member-moderation',
        permanent: input.action === 'PERMABAN',
      },
    });

    return { ok: true };
  }

  async setMemberRole(
    actor: AuthUser,
    groupId: string,
    memberUserId: string,
    input: { role: GroupRole },
  ) {
    const [group, actorMembership, targetMembership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { id: true, ownerId: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: actor.id } },
        select: { role: true, isBanned: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: memberUserId } },
        select: { role: true, isBanned: true },
      }),
    ]);

    if (!group) throw new NotFoundException();
    if (!targetMembership) throw new NotFoundException('Member not found');
    if (actor.id === memberUserId) throw new ForbiddenException('You cannot change your own role');

    if (!actorMembership || actorMembership.isBanned || actorMembership.role !== 'GROUP_ADMIN') {
      throw new ForbiddenException('Only group admins can assign roles');
    }

    if (memberUserId === group.ownerId) {
      throw new ForbiddenException('Cannot change the group owner role');
    }

    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: memberUserId } },
      data: { role: input.role },
    });

    return { ok: true };
  }

  async softDelete(groupId: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { isDeleted: true } });
  }
}
