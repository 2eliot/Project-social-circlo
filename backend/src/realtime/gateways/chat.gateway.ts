import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthService, SocketUser } from '../ws-auth.service';
import { MessagesService } from '../../modules/messages/messages.service';
import { ModerationService } from '../../modules/moderation/moderation.service';
import { GroupsService } from '../../modules/groups/groups.service';
import { PresenceService, RateLimiterService } from '../../infrastructure/redis/redis.module';
import { RealtimeEventsService } from '../realtime-events.service';

interface AuthedSocket extends Socket {
  data: { user: SocketUser };
}

@WebSocketGateway({ namespace: '/chat', cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly auth: WsAuthService,
    private readonly messages: MessagesService,
    private readonly moderation: ModerationService,
    private readonly groups: GroupsService,
    private readonly presence: PresenceService,
    private readonly rate: RateLimiterService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  afterInit() {
    this.realtimeEvents.registerChatServer(this.server);
  }

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      (socket as AuthedSocket).data.user = user;
      await this.presence.markOnline(user.id, socket.id);
      socket.join(`user:${user.id}`);
      this.logger.log(`+ ${user.id} (${socket.id})`);
    } catch (err) {
      socket.emit('error', { message: (err as Error).message });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const user = (socket as AuthedSocket).data?.user;
    if (user) await this.presence.markOffline(user.id, socket.id);
  }

  @SubscribeMessage('join_channel')
  async joinChannel(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { channelId: string }) {
    const user = socket.data.user;
    const { isMember, groupPrivacy } = await this.groups.isChannelMember(user.id, body.channelId);

    // Allow non-members to view public groups only (spectator mode)
    if (!isMember && groupPrivacy !== 'PUBLIC_INVITE') {
      throw new WsException('Debes unirte al grupo para ver este canal.');
    }

    await socket.join(`channel:${body.channelId}`);
    // Store spectator flag on socket so sendMessage can reject writes
    (socket as any).__spectator = !isMember;
    return { ok: true, isMember };
  }

  @SubscribeMessage('leave_channel')
  async leaveChannel(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { channelId: string }) {
    await socket.leave(`channel:${body.channelId}`);
    return { ok: true };
  }

  @SubscribeMessage('join_group')
  async joinGroup(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { groupId: string }) {
    await socket.join(`group:${body.groupId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave_group')
  async leaveGroup(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { groupId: string }) {
    await socket.leave(`group:${body.groupId}`);
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { channelId: string; content: string; attachments?: any[]; parentId?: string },
  ) {
    const user = socket.data.user;

    // Block spectators from sending messages
    if ((socket as any).__spectator) {
      throw new WsException('Debes unirte al grupo para enviar mensajes.');
    }

    // Double-check membership in case spectator flag wasn't set
    const { isMember } = await this.groups.isChannelMember(user.id, body.channelId);
    if (!isMember) {
      throw new WsException('Debes unirte al grupo para enviar mensajes.');
    }

    const allowed = await this.rate.allow(`msg:${user.id}`, 30, 10); // 30/10s
    if (!allowed) throw new WsException('Rate limit exceeded');

    const msg = await this.messages.create({
      authorId: user.id,
      channelId: body.channelId,
      content: body.content,
      attachments: body.attachments,
      parentId: body.parentId,
    });

    // Async moderation; while PENDING_MODERATION, only echo to author.
    if (msg.status === 'PENDING_MODERATION') {
      await this.moderation.enqueue({
        type: 'message',
        refId: msg.id,
        content: body.content,
      });
      this.server.to(`channel:${body.channelId}`).emit('message_new', msg);
      socket.emit('message_pending', msg);
    } else {
      this.server.to(`channel:${body.channelId}`).emit('message_new', msg);
    }
    return msg;
  }

  @SubscribeMessage('edit_message')
  async editMessage(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { id: string; createdAt: string; content: string; channelId: string },
  ) {
    await this.messages.edit(body.id, new Date(body.createdAt), socket.data.user.id, body.content);
    this.server.to(`channel:${body.channelId}`).emit('message_edited', body);
    return { ok: true };
  }

  @SubscribeMessage('delete_message')
  async deleteMessage(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { id: string; createdAt: string; channelId: string },
  ) {
    const userId = socket.data.user.id;
    const createdAt = new Date(body.createdAt);

    // Get message author info
    const msg = await this.messages.getMessageAuthor(body.id, createdAt);
    if (!msg) throw new WsException('Mensaje no encontrado.');

    // Authorization: owner can delete own, admin/CoA can delete any
    if (msg.authorId !== userId) {
      // Not the author — check if user is admin or CoA of the group
      const { groupId } = await this.groups.isChannelMember(userId, body.channelId);
      if (!groupId) throw new WsException('No tienes permiso para eliminar este mensaje.');

      const role = await this.groups.getMemberRole(userId, groupId);
      if (role !== 'GROUP_ADMIN' && role !== 'GROUP_MODERATOR') {
        throw new WsException('No tienes permiso para eliminar este mensaje.');
      }
    }

    // Determine if this is a self-delete or mod-delete
    const isModDelete = msg.authorId !== userId && msg.authorId !== null;

    await this.messages.softDelete(body.id, createdAt);

    // Look up the deleter's display name & role
    const deleterName = await this.messages.getUserDisplayName(userId);
    const targetName = msg.author?.displayName ?? 'usuario';

    // Build system message text and persist to DB so it survives refreshes
    let sysContent: string;
    if (isModDelete) {
      let roleLabel = 'Mod';
      if (msg.channelId) {
        const { groupId } = await this.groups.isChannelMember(userId, msg.channelId);
        if (groupId) {
          const role = await this.groups.getMemberRole(userId, groupId);
          if (role === 'GROUP_ADMIN') roleLabel = 'Admin';
          else if (role === 'GROUP_MODERATOR') roleLabel = 'CoA';
        }
      }
      sysContent = `${deleterName} (${roleLabel}) eliminó el mensaje de ${targetName}`;
    } else {
      sysContent = `${deleterName} eliminó su mensaje`;
    }

    // Persist the system message to the database
    const sysMsg = await this.messages.createSystem(body.channelId, sysContent);

    // Emit deletion + the real system message
    this.server.to(`channel:${body.channelId}`).emit('message_deleted', { id: body.id, channelId: body.channelId });
    this.server.to(`channel:${body.channelId}`).emit('message_new', sysMsg);

    return { ok: true };
  }

  @SubscribeMessage('add_reaction')
  async addReaction(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { id: string; createdAt: string; emoji: string; channelId: string },
  ) {
    await this.messages.addReaction(body.id, new Date(body.createdAt), socket.data.user.id, body.emoji);
    this.server.to(`channel:${body.channelId}`).emit('reaction_added', {
      ...body,
      userId: socket.data.user.id,
    });
    return { ok: true };
  }

  @SubscribeMessage('pin_message')
  async pinMessage(
    @MessageBody() body: { id: string; createdAt: string; pinned: boolean; channelId: string },
  ) {
    await this.messages.pin(body.id, new Date(body.createdAt), body.pinned);
    this.server.to(`channel:${body.channelId}`).emit('message_pinned', body);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { channelId: string }) {
    socket
      .to(`channel:${body.channelId}`)
      .emit('typing', { userId: socket.data.user.id, channelId: body.channelId });
  }
}
