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
import { PresenceService, RateLimiterService } from '../../infrastructure/redis/redis.module';

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
    private readonly presence: PresenceService,
    private readonly rate: RateLimiterService,
  ) {}

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
    // TODO: verify membership via service before joining; omitted for brevity.
    await socket.join(`channel:${body.channelId}`);
    return { ok: true };
  }

  @SubscribeMessage('leave_channel')
  async leaveChannel(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { channelId: string }) {
    await socket.leave(`channel:${body.channelId}`);
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { channelId: string; content: string; attachments?: any[]; parentId?: string },
  ) {
    const user = socket.data.user;
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
    await this.messages.softDelete(body.id, new Date(body.createdAt));
    this.server.to(`channel:${body.channelId}`).emit('message_deleted', body);
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
