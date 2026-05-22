import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

export interface SocketUser {
  id: string;
  email: string;
  role: string;
  banned: boolean;
}

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async authenticate(socket: Socket): Promise<SocketUser> {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, '') ?? '');
    if (!token) throw new UnauthorizedException('Missing token');
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string; email: string; role: string; banned: boolean;
      }>(token, { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET') });
      if (payload.banned) throw new UnauthorizedException('Banned');
      return { id: payload.sub, email: payload.email, role: payload.role, banned: payload.banned };
    } catch (err) {
      this.logger.warn(`WS auth failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
