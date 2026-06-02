import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly reputationService: ReputationService,
  ) {}

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.search(user.id, q ?? '');
  }

  @Get('top')
  top(@CurrentUser() user: AuthUser) {
    return this.service.topByReputation(user.id);
  }

  @Get('handle/:handle')
  getByHandle(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.service.getPublicProfileByHandle(user.id, handle);
  }

  @Get('me/online-friends')
  onlineFriends(@CurrentUser() user: AuthUser) {
    return this.service.onlineFriends(user.id);
  }

  @Get(':id/followers')
  followers(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listFollowers(user.id, id);
  }

  @Get(':id/following')
  following(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listFollowing(user.id, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPublicProfile(user.id, id);
  }

  @Post(':id/follow')
  follow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.follow(user.id, id);
  }

  @Delete(':id/follow')
  unfollow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.unfollow(user.id, id);
  }

  @Post(':id/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.report(user.id, id, body.reason ?? '');
  }

  @Post('upload-avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/avatars',
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || '.png'}`),
      }),
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
      },
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadAvatar(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { url: null };
    }
      return { url: `/uploads/avatars/${file.filename}` };
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() body: { displayName?: string; avatarUrl?: string; isAnonymousProfile?: boolean },
  ) {
    return this.service.updateMe(user.id, body);
  }

  @Post(':id/reputation/like')
  likeUser(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reputationService.voteOnUser(user.id, id, 1);
  }

  @Post(':id/reputation/dislike')
  dislikeUser(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reputationService.voteOnUser(user.id, id, -1);
  }

  @Delete(':id/reputation')
  removeReputation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reputationService.removeVote(user.id, id);
  }

  @Get(':id/reputation')
  getReputation(@Param('id', ParseUUIDPipe) id: string) {
    return this.reputationService.getReputation(id);
  }
}
