import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ChannelType, GroupPrivacy, GroupRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ModerationService } from '../moderation/moderation.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { MessagesService } from '../messages/messages.service';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';

type GroupAuditLogRow = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: Date;
  actorId: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  targetId: string | null;
  targetDisplayName: string | null;
  targetAvatarUrl: string | null;
};

@Injectable()
export class GroupsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly messages: MessagesService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS group_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        actor_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        target_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        action text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS idx_group_audit_logs_group_created ON group_audit_logs(group_id, created_at DESC)');
  }

  private getRoleRank(role?: GroupRole | null) {
    if (role === 'GROUP_ADMIN') return 3;
    if (role === 'GROUP_MODERATOR') return 2;
    if (role === 'GROUP_MEMBER') return 1;
    return 0;
  }

  private canManageGroupSettings(input: {
    actorId: string;
    ownerId: string;
    actorMembership?: { role: GroupRole; isBanned: boolean } | null;
    actorGlobalRole?: string | null;
  }) {
    if (input.actorGlobalRole === 'SUPER_ADMIN' || input.actorGlobalRole === 'GLOBAL_MODERATOR') return true;
    if (input.actorId === input.ownerId) return true;
    if (!input.actorMembership || input.actorMembership.isBanned) return false;
    return input.actorMembership.role === 'GROUP_ADMIN' || input.actorMembership.role === 'GROUP_MODERATOR';
  }

  private async logAudit(input: {
    groupId: string;
    actorUserId?: string | null;
    targetUserId?: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO group_audit_logs (group_id, actor_user_id, target_user_id, action, metadata)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)
      `,
      input.groupId,
      input.actorUserId ?? null,
      input.targetUserId ?? null,
      input.action,
      JSON.stringify(input.metadata ?? {}),
    );
  }

  private async createSystemMessage(groupId: string, content: string) {
    const textChannel = await this.prisma.channel.findFirst({
      where: { groupId, type: 'TEXT', isEnabled: true },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!textChannel) {
      console.warn(`[createSystemMessage] No text channel found for group ${groupId}`);
      return;
    }
    const message = await this.messages.createSystem(textChannel.id, content);
    console.log(`[createSystemMessage] Created system message in channel ${textChannel.id}:`, content);
    this.realtimeEvents.emitChannelMessage(textChannel.id, message);
  }

  private summarizeGroup(
    group: {
      id: string;
      ownerId: string;
      name: string;
      slug: string;
      description: string | null;
      iconUrl: string | null;
      bannerUrl?: string | null;
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
      bannerUrl: group.bannerUrl ?? null,
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
      bannerUrl?: string | null;
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
    dto: { name: string; slug: string; description?: string; iconUrl?: string; bannerUrl?: string; privacy?: GroupPrivacy },
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
            bannerUrl: dto.bannerUrl,
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
    patch: { name?: string; description?: string; iconUrl?: string | null; bannerUrl?: string | null; privacy?: GroupPrivacy },
  ) {
    const [group, actorMembership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { ownerId: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { role: true, isBanned: true },
      }),
    ]);
    if (!group) throw new NotFoundException();
    if (!this.canManageGroupSettings({ actorId: userId, ownerId: group.ownerId, actorMembership })) {
      throw new ForbiddenException('Only admins or CoA can edit this group');
    }

    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data: patch,
    });

    await this.logAudit({
      groupId,
      actorUserId: userId,
      action: 'GROUP_UPDATED',
      metadata: patch,
    });

    return updated;
  }

  async listAuditLogs(user: AuthUser, groupId: string) {
    const [group, actorMembership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { ownerId: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: user.id } },
        select: { role: true, isBanned: true },
      }),
    ]);
    if (!group) throw new NotFoundException();
    if (!this.canManageGroupSettings({ actorId: user.id, ownerId: group.ownerId, actorMembership, actorGlobalRole: user.globalRole })) {
      throw new ForbiddenException('Only admins or CoA can read these logs');
    }

    const rows = await this.prisma.$queryRawUnsafe<GroupAuditLogRow[]>(`
      SELECT
        l.id,
        l.action,
        l.metadata,
        l.created_at AS "createdAt",
        actor.id AS "actorId",
        actor.display_name AS "actorDisplayName",
        actor.avatar_url AS "actorAvatarUrl",
        target.id AS "targetId",
        target.display_name AS "targetDisplayName",
        target.avatar_url AS "targetAvatarUrl"
      FROM group_audit_logs l
      LEFT JOIN users actor ON actor.id = l.actor_user_id
      LEFT JOIN users target ON target.id = l.target_user_id
      WHERE l.group_id = $1::uuid
      ORDER BY l.created_at DESC
      LIMIT 50
    `, groupId);

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
      actor: row.actorId ? { id: row.actorId, displayName: row.actorDisplayName ?? 'Staff', avatarUrl: row.actorAvatarUrl } : null,
      target: row.targetId ? { id: row.targetId, displayName: row.targetDisplayName ?? 'Usuario', avatarUrl: row.targetAvatarUrl } : null,
    }));
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
    const [group, user] = await Promise.all([
      this.prisma.group.findFirst({ where: { id: groupId, isDeleted: false }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);
    if (!group) throw new NotFoundException();

    // Check for permanent ban
    const permanentBan = await this.prisma.moderationLog.findFirst({
      where: {
        targetType: 'USER',
        targetId: userId,
        groupId: groupId,
        action: 'BAN',
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true, action: true },
    });

    if (permanentBan && (permanentBan.metadata as any)?.permanent === true) {
      throw new ForbiddenException('Este usuario tiene un ban permanente de este grupo.');
    }

    const membership = await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, role: 'GROUP_MEMBER' },
      update: { isBanned: false, role: 'GROUP_MEMBER', joinedAt: new Date() },
    });

    await this.logAudit({
      groupId,
      actorUserId: userId,
      targetUserId: userId,
      action: 'MEMBER_JOINED',
    });
    await this.createSystemMessage(groupId, `${user?.displayName ?? 'Alguien'} se ha unido al grupo.`);

    return membership;
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
        data: { isBanned: false, role: 'GROUP_MEMBER', joinedAt: new Date() },
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

    const targetUser = await this.prisma.user.findUnique({
      where: { id: memberUserId },
      select: { displayName: true },
    });

    await this.logAudit({
      groupId,
      actorUserId: actor.id,
      targetUserId: memberUserId,
      action: `MEMBER_${input.action}`,
      metadata: { reason: input.reason ?? null, permanent: input.action === 'PERMABAN' },
    });

    // Create appropriate system message
    if (input.action === 'KICK') {
      await this.createSystemMessage(groupId, `${targetUser?.displayName ?? 'Un usuario'} ha sido expulsado del grupo.`);
    } else if (input.action === 'PERMABAN') {
      await this.createSystemMessage(groupId, `${targetUser?.displayName ?? 'Un usuario'} ha sido baneado permanentemente del grupo.`);
    } else if (input.action === 'BAN') {
      await this.createSystemMessage(groupId, `${targetUser?.displayName ?? 'Un usuario'} ha sido baneado temporalmente del grupo.`);
    } else if (input.action === 'UNBAN') {
      await this.createSystemMessage(groupId, `${targetUser?.displayName ?? 'Un usuario'} puede volver a entrar al grupo.`);
    }

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

    const targetUser = await this.prisma.user.findUnique({
      where: { id: memberUserId },
      select: { displayName: true },
    });

    await this.logAudit({
      groupId,
      actorUserId: actor.id,
      targetUserId: memberUserId,
      action: 'MEMBER_ROLE_CHANGED',
      metadata: { role: input.role },
    });

    await this.createSystemMessage(
      groupId,
      input.role === 'GROUP_MODERATOR'
        ? `${targetUser?.displayName ?? 'Un usuario'} ahora es CoA del grupo.`
        : `${targetUser?.displayName ?? 'Un usuario'} ahora es miembro del grupo.`,
    );

    return { ok: true };
  }

  async softDelete(groupId: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { isDeleted: true } });
  }
}
