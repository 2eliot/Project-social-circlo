import { GroupPrivacy } from '@prisma/client';
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { Request } from 'express';
import { GroupsService } from './groups.service';
import { JwtAuthGuard, CbacGuard, RbacGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser, GroupRoles, Roles } from '../../common/decorators/auth.decorators';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly service: GroupsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; slug: string; description?: string; iconUrl?: string; privacy?: GroupPrivacy },
  ) {
    return this.service.create(user.id, body);
  }

  @Post('upload-icon')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/groups',
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || '.png'}`),
      }),
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadIcon(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { url: null };
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    return { url: `${origin}/uploads/groups/${file.filename}` };
  }

  @Patch(':groupId')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  update(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { name?: string; description?: string; iconUrl?: string | null; privacy?: GroupPrivacy },
  ) {
    return this.service.update(user.id, groupId, body);
  }

  @Get(':groupId')
  get(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.service.get(user.id, groupId);
  }

  @Post(':groupId/members/:memberUserId/moderate')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN', 'GROUP_MODERATOR')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  moderateMember(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberUserId', ParseUUIDPipe) memberUserId: string,
    @Body() body: { action: 'BAN' | 'UNBAN' | 'KICK' | 'PERMABAN'; reason?: string },
  ) {
    return this.service.moderateMember(user, groupId, memberUserId, body);
  }

  @Patch(':groupId/members/:memberUserId/role')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  setMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberUserId', ParseUUIDPipe) memberUserId: string,
    @Body() body: { role: 'GROUP_ADMIN' | 'GROUP_MODERATOR' | 'GROUP_MEMBER' },
  ) {
    return this.service.setMemberRole(user, groupId, memberUserId, body);
  }

  @Post(':groupId/join')
  join(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.service.join(user.id, groupId);
  }

  @Delete(':groupId')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  async remove(@Param('groupId', ParseUUIDPipe) groupId: string) {
    await this.service.softDelete(groupId);
    return { ok: true };
  }
}
