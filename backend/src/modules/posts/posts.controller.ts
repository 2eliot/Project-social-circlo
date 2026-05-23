import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';
import { PostsService } from './posts.service';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly service: PostsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('authorId') authorId?: string) {
    return this.service.list(user.id, limit ? Number(limit) : 40, authorId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/posts',
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || '.bin'}`),
      }),
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/'));
      },
      limits: { fileSize: 12 * 1024 * 1024 },
    }),
  )
  upload(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { attachment: null };
    }
    return {
      attachment: {
        kind: file.mimetype.startsWith('audio/') ? 'voice' : 'image',
          url: `/uploads/posts/${file.filename}`,
        mimeType: file.mimetype,
        fileName: file.originalname,
        size: file.size,
      },
    };
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { content?: string; attachments?: Array<Record<string, unknown>> },
  ) {
    return this.service.create(user.id, body);
  }

  @Post(':postId/like')
  toggleLike(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.service.toggleLike(postId, user.id);
  }

  @Post(':postId/comments')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: { body?: string },
  ) {
    return this.service.addComment(postId, user.id, body.body ?? '');
  }

  @Post(':postId/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.report(postId, user.id, body.reason ?? '');
  }

  @Delete(':postId')
  remove(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.service.remove(postId, user.id);
  }
}