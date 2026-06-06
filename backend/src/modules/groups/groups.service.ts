import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ChannelType, GroupPrivacy, GroupRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { ModerationService } from '../moderation/moderation.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { MessagesService } from '../messages/messages.service';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';

type GroupOwner = { id: string; displayName: string; avatarUrl: string | null; reputationLikes?: number; reputationDislikes?: number };

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
      owner?: GroupOwner;
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
      owner: GroupOwner;
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

    const summarized = groups.map((group) => this.summarizeGroup(group, userId));
    return this.attachOwnerReputation(summarized);
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

    const publicSummarized = publicGroups.map((group) => this.summarizeGroup(group, userId));
    return {
      mine,
      public: await this.attachOwnerReputation(publicSummarized),
    };
  }

  /** Batch-fetch reputation for all owner IDs and merge into each group's owner */
  private async attachOwnerReputation<T extends { owner?: { id: string } | null }>(groups: T[]): Promise<T[]> {
    const ownerIds = [...new Set(groups.map((g) => g.owner?.id).filter(Boolean))] as string[];
    if (ownerIds.length === 0) return groups;

    const reputationMap = new Map<string, { likes: number; dislikes: number }>();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        const votes = await this.prisma.$queryRawUnsafe(
          `SELECT vote_type FROM user_reputation WHERE target_id = $1::uuid`,
          ownerId,
        ) as Array<{ vote_type: number }>;
        const likes = votes.filter((v) => v.vote_type === 1).length;
        const dislikes = votes.filter((v) => v.vote_type === -1).length;
        reputationMap.set(ownerId, { likes, dislikes });
      }),
    );

    return groups.map((g) => {
      if (!g.owner) return g;
      const rep = reputationMap.get(g.owner.id);
      if (!rep) return g;
      return { ...g, owner: { ...g.owner, reputationLikes: rep.likes, reputationDislikes: rep.dislikes } };
    });
  }

  async update(
    userId: string,
    groupId: string,
    patch: { name?: string; description?: string; iconUrl?: string | null; bannerUrl?: string | null; privacy?: GroupPrivacy },
  ) {
    const [group, actorMembership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { ownerId: true, name: true, description: true, iconUrl: true, bannerUrl: true, privacy: true },
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

    const oldGroup = { name: group.name, description: group.description, iconUrl: group.iconUrl, bannerUrl: group.bannerUrl, privacy: group.privacy };

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

    // System messages for visible changes
    const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    const actorName = actor?.displayName ?? 'Un admin';

    if (patch.bannerUrl !== undefined && patch.bannerUrl !== oldGroup.bannerUrl) {
      if (patch.bannerUrl === null) {
        await this.createSystemMessage(groupId, `${actorName} ha eliminado la imagen de fondo del grupo.`);
      } else {
        await this.createSystemMessage(groupId, `${actorName} ha cambiado la imagen de fondo del grupo.`);
      }
    }
    if (patch.iconUrl !== undefined && patch.iconUrl !== oldGroup.iconUrl) {
      if (patch.iconUrl === null) {
        await this.createSystemMessage(groupId, `${actorName} ha eliminado el ícono del grupo.`);
      } else {
        await this.createSystemMessage(groupId, `${actorName} ha cambiado el ícono del grupo.`);
      }
    }
    if (patch.name !== undefined && patch.name !== oldGroup.name) {
      await this.createSystemMessage(groupId, `${actorName} cambió el nombre del grupo a "${patch.name}".`);
    }
    if (patch.description !== undefined && patch.description !== oldGroup.description) {
      await this.createSystemMessage(groupId, `${actorName} ha actualizado la descripción del grupo.`);
    }
    if (patch.privacy !== undefined && patch.privacy !== oldGroup.privacy) {
      const labels: Record<string, string> = { PUBLIC_INVITE: 'público', PRIVATE: 'privado', SECRET: 'secreto' };
      await this.createSystemMessage(groupId, `${actorName} cambió la privacidad del grupo a ${labels[patch.privacy] ?? patch.privacy}.`);
    }

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
      update: { isBanned: false, joinedAt: new Date() },
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

  async leaveGroup(actor: AuthUser, groupId: string) {
    const [group, membership] = await Promise.all([
      this.prisma.group.findFirst({
        where: { id: groupId, isDeleted: false },
        select: { id: true, ownerId: true },
      }),
      this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: actor.id } },
        select: { role: true },
      }),
    ]);

    if (!group) throw new NotFoundException();
    if (group.ownerId === actor.id) {
      throw new ForbiddenException('El dueño del grupo no puede abandonarlo. Elimina el grupo o transfiere la propiedad.');
    }
    if (!membership) throw new NotFoundException('No eres miembro de este grupo');

    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { displayName: true },
    });

    await this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId: actor.id } },
    });

    await this.logAudit({
      groupId,
      actorUserId: actor.id,
      targetUserId: actor.id,
      action: 'MEMBER_LEFT',
      metadata: {},
    });

    await this.createSystemMessage(groupId, `${user?.displayName ?? 'Alguien'} ha abandonado el grupo.`);

    return { ok: true };
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

    const isOwner = group.ownerId === actor.id;
    const isGlobalModerator = actor.globalRole === 'SUPER_ADMIN' || actor.globalRole === 'GLOBAL_MODERATOR';

    if (!isOwner && !isGlobalModerator) {
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
      if (memberUserId === group.ownerId) {
        throw new ForbiddenException('Cannot ban the group owner');
      }

      // Delete membership completely — no "ghost" members
      await this.prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: memberUserId } },
      });
    }

    if (input.action === 'UNBAN') {
      // Re-insert membership on unban (since BAN now deletes it)
      await this.prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: memberUserId } },
        create: { groupId, userId: memberUserId, role: 'GROUP_MEMBER', isBanned: false },
        update: { isBanned: false, role: 'GROUP_MEMBER', joinedAt: new Date() },
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

    const isOwner = group.ownerId === actor.id;
    if (!isOwner && (!actorMembership || actorMembership.isBanned || actorMembership.role !== 'GROUP_ADMIN')) {
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
      input.role === 'GROUP_ADMIN'
        ? `${targetUser?.displayName ?? 'Un usuario'} ahora es Admin del grupo.`
        : input.role === 'GROUP_MODERATOR'
        ? `${targetUser?.displayName ?? 'Un usuario'} ahora es CoA del grupo.`
        : `${targetUser?.displayName ?? 'Un usuario'} ahora es miembro del grupo.`,
    );

    return { ok: true };
  }

  async softDelete(groupId: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { isDeleted: true } });
  }

  /** Permanently delete a group and all its data:
   *  - ModerationLog entries referencing this group
   *  - Group itself (cascades to GroupMember, Channel, Message via Channel, group_audit_logs)
   *  - Uploaded files (icon, banner) are left on disk for simplicity; can be cleaned by a cron later.
   */
  async hardDelete(groupId: string) {
    // Clean up ModerationLog rows that reference this group (no cascade)
    await this.prisma.moderationLog.deleteMany({ where: { groupId } });

    // Delete the group — cascades to channels → messages, members, audit_logs
    await this.prisma.group.delete({ where: { id: groupId } });
  }

  /** Returns whether a user is a member of the group that owns a given channel. */
  async isChannelMember(userId: string, channelId: string): Promise<{ isMember: boolean; groupPrivacy: GroupPrivacy | null; groupId: string | null }> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        groupId: true,
        group: { select: { privacy: true } },
      },
    });
    if (!channel) return { isMember: false, groupPrivacy: null, groupId: null };

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: channel.groupId, userId } },
      select: { isBanned: true },
    });

    return {
      isMember: !!membership && !membership.isBanned,
      groupPrivacy: channel.group.privacy,
      groupId: channel.groupId,
    };
  }

  async getMemberRole(userId: string, groupId: string): Promise<GroupRole | null> {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true, isBanned: true },
    });
    if (!membership || membership.isBanned) return null;
    return membership.role;
  }
}
