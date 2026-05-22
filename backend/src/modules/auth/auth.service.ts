import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { CryptoService } from '../../common/crypto/crypto.module';
import type { Response } from 'express';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionUserPayload {
  id: string;
  email: string;
  globalRole: string;
  displayName: string;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (user.isBanned) throw new UnauthorizedException('Account is banned');

    const ok = await this.crypto.verifyPassword(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.email, user.globalRole, user.isBanned, meta);
  }

  async issueTokens(
    userId: string,
    email: string,
    globalRole: string,
    isBanned: boolean,
    meta: { ip?: string; userAgent?: string },
  ): Promise<TokenPair & { user: SessionUserPayload }> {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      email,
      role: globalRole,
      banned: isBanned,
    });

    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TTL', 2_592_000);
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: 'refresh', jti: this.crypto.randomToken(16) },
      { secret: refreshSecret, expiresIn: `${refreshTtl}s` },
    );

    await this.prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.sha256(refreshToken),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ip ?? null,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, avatarUrl: true },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email,
        globalRole,
        displayName: profile?.displayName ?? email.split('@')[0],
        avatarUrl: profile?.avatarUrl ?? null,
      },
    };
  }

  async rotateRefresh(token: string, meta: { ip?: string; userAgent?: string }) {
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Invalid token type');

    const hash = this.crypto.sha256(token);
    const session = await this.prisma.authSession.findFirst({
      where: { userId: payload.sub, refreshTokenHash: hash, revokedAt: null },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Rotate: revoke current, issue new pair.
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueTokens(user.id, user.email, user.globalRole, user.isBanned, meta);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const hash = this.crypto.sha256(token);
    await this.prisma.authSession.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  setRefreshCookie(res: Response, refreshToken: string) {
    const ttl = this.config.get<number>('JWT_REFRESH_TTL', 2_592_000);
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    const configuredSameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE');
    const configuredSecure = this.config.get<boolean>('COOKIE_SECURE');
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: configuredSecure ?? isProd,
      sameSite: configuredSameSite ?? (isProd ? 'none' : 'lax'),
      domain: cookieDomain,
      path: '/',
      maxAge: ttl * 1000,
    });
  }

  clearRefreshCookie(res: Response) {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    const configuredSameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE');
    const configuredSecure = this.config.get<boolean>('COOKIE_SECURE');
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    res.clearCookie('refresh_token', {
      path: '/',
      domain: cookieDomain,
      secure: configuredSecure ?? isProd,
      sameSite: configuredSameSite ?? (isProd ? 'none' : 'lax'),
    });
  }
}
