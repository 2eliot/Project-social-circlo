import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/database/prisma.module';
import type { AuthUser } from '../../../common/decorators/auth.decorators';

interface AccessPayload {
  sub: string;
  email: string;
  role: AuthUser['globalRole'];
  banned: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    // Authoritative ban check (DB) to invalidate stale tokens for banned users.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, globalRole: true, isBanned: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    if (user.isBanned) throw new UnauthorizedException('Account is banned');
    return {
      id: user.id,
      email: user.email,
      globalRole: user.globalRole,
      isBanned: user.isBanned,
    };
  }
}
