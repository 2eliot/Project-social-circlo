import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { WsAuthService } from '../ws-auth.service';
import { RealtimeEventsService } from '../realtime-events.service';

interface SocialSocket extends Socket {
  data: {
    user?: {
      id: string;
    };
  };
}

@WebSocketGateway({ namespace: '/social', cors: true })
export class SocialGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SocialGateway.name);

  constructor(
    private readonly auth: WsAuthService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  afterInit() {
    this.realtimeEvents.registerSocialServer(this.server);
  }

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      (socket as SocialSocket).data.user = { id: user.id };
      socket.join(`user:${user.id}`);
      this.logger.log(`+ social ${user.id} (${socket.id})`);
    } catch (err) {
      socket.emit('error', { message: (err as Error).message });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(_socket: Socket) {
    return;
  }

  @SubscribeMessage('dm_typing')
  handleDmTyping(socket: SocialSocket, payload: { conversationId: string; peerId: string }) {
    const userId = socket.data.user?.id;
    if (!userId || !payload?.conversationId || !payload?.peerId) return;
    this.realtimeEvents.emitDmTyping(payload.peerId, { conversationId: payload.conversationId, userId });
  }
}