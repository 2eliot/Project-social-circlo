import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthService } from '../ws-auth.service';
import { PresenceService } from '../../infrastructure/redis/redis.module';

@WebSocketGateway({ namespace: '/presence', cors: true })
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(private readonly auth: WsAuthService, private readonly presence: PresenceService) {}

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
}
