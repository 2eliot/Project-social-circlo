import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { GlobalRole, GroupRole } from '@prisma/client';
import { GROUP_ROLES_KEY, ROLES_KEY, AuthUser } from '../decorators/auth.decorators';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<GlobalRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException();
    if (user.isBanned) throw new ForbiddenException('Account is banned');
    if (!required.includes(user.globalRole)) {
      throw new ForbiddenException('Insufficient global role');
    }
    return true;
  }
}

/**
 * Context-Based Access Control for group-scoped routes.
 * Expects a `:groupId` route param and a JWT-authenticated user.
 * SUPER_ADMIN and GLOBAL_MODERATOR bypass the group role check.
 */
@Injectable()
export class CbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<GroupRole[] | undefined>(GROUP_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException();
    if (user.isBanned) throw new ForbiddenException('Account is banned');

    if (user.globalRole === 'SUPER_ADMIN' || user.globalRole === 'GLOBAL_MODERATOR') {
      return true;
    }

    const groupId: string | undefined = req.params?.groupId ?? req.body?.groupId;
    if (!groupId) throw new ForbiddenException('Missing group context');

    // Owners always bypass the group role check (they own the group).
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, isDeleted: false },
      select: { ownerId: true },
    });
    if (group && group.ownerId === user.id) return true;

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
      select: { role: true, isBanned: true },
    });

    if (!membership || membership.isBanned) {
      throw new ForbiddenException('Not a member of this group');
    }
    if (!required.includes(membership.role)) {
      throw new ForbiddenException('Insufficient group role');
    }
    return true;
  }
}
