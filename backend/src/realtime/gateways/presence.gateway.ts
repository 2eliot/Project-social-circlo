import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthService } from '../ws-auth.service';
import { PresenceService } from '../../infrastructure/redis/redis.module';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ namespace: '/presence', cors: true })
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(PresenceGateway.name);

  constructor(private readonly auth: WsAuthService, private readonly presence: PresenceService) {
    // Limpiar entradas huérfanas al iniciar el servidor
    this.presence.clearAll().then((count) => {
      this.logger.log(`Presencia reiniciada — ${count} entradas huérfanas limpiadas`);
    });
  }

  async handleConnection(socket: Socket) {
    try {
      const user = await this.auth.authenticate(socket);
      socket.data.user = user;
      await this.presence.markOnline(user.id, socket.id, 90);
      this.server.emit('presence', { userId: user.id, online: true });

      // Heartbeat: refresh TTL
      const interval = setInterval(() => this.presence.markOnline(user.id, socket.id, 90), 30_000);
      socket.on('disconnect', () => clearInterval(interval));
    } catch {
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const user = socket.data?.user;
    if (!user) return;
    await this.presence.markOffline(user.id, socket.id);
    const stillOnline = await this.presence.isOnline(user.id);
    if (!stillOnline) this.server.emit('presence', { userId: user.id, online: false });
  }

  @SubscribeMessage('presence:subscribe')
  async handlePresenceSubscribe(socket: Socket) {
    const user = socket.data?.user;
    if (!user) return;
    // Return all currently online user IDs to the connecting client
    const onlineIds = await this.presence.getAllOnlineIds();
    socket.emit('presence:initial', { onlineIds });
  }
}
