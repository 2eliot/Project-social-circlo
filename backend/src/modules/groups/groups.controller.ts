import { GroupPrivacy } from '@prisma/client';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { GroupsService } from './groups.service';
import { JwtAuthGuard, CbacGuard, RbacGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser, GroupRoles, Roles } from '../../common/decorators/auth.decorators';
import { ImageService } from '../../common/pipes/image.service';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly service: GroupsService,
    private readonly imageService: ImageService,
  ) {}

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
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadIcon(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { url: null };
    }
    const result = await this.imageService.processAndSave(file, {
      subDir: 'groups',
      maxWidth: 512,
      maxHeight: 512,
      quality: 80,
    });
    return { url: result?.url ?? null };
  }

  @Post('upload-banner')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadBanner(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { url: null };
    }
    const result = await this.imageService.processAndSave(file, {
      subDir: 'groups',
      maxWidth: 1920,
      maxHeight: 480,
      quality: 80,
    });
    return { url: result?.url ?? null };
  }

  @Patch(':groupId')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN', 'GROUP_MODERATOR')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  update(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { name?: string; description?: string; iconUrl?: string | null; bannerUrl?: string | null; privacy?: GroupPrivacy },
  ) {
    return this.service.update(user.id, groupId, body);
  }

  @Get(':groupId')
  get(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.service.get(user.id, groupId);
  }

  @Get(':groupId/audit-logs')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN', 'GROUP_MODERATOR')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  auditLogs(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.service.listAuditLogs(user, groupId);
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

  @Post(':groupId/leave')
  async leave(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    await this.service.leaveGroup(user, groupId);
    return { ok: true };
  }

  @Delete(':groupId')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  async remove(@Param('groupId', ParseUUIDPipe) groupId: string) {
    await this.service.softDelete(groupId);
    return { ok: true };
  }

  @Post(':groupId/hard-delete')
  @UseGuards(CbacGuard, RbacGuard)
  @GroupRoles('GROUP_ADMIN')
  @Roles('SUPER_ADMIN', 'GLOBAL_MODERATOR', 'USER')
  async hardDelete(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { confirm: string },
  ) {
    if (body.confirm !== 'ELIMINAR PERMANENTEMENTE') {
      throw new ForbiddenException('Debes escribir "ELIMINAR PERMANENTEMENTE" para confirmar');
    }
    await this.service.hardDelete(groupId);
    return { ok: true };
  }
}
