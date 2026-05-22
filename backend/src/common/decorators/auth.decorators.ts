import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { GlobalRole, GroupRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  globalRole: GlobalRole;
  isBanned: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user;
  },
);

export const ROLES_KEY = 'global_roles';
export const Roles = (...roles: GlobalRole[]) => SetMetadata(ROLES_KEY, roles);

export const GROUP_ROLES_KEY = 'group_roles';
export const GroupRoles = (...roles: GroupRole[]) => SetMetadata(GROUP_ROLES_KEY, roles);
