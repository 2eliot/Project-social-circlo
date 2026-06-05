import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';
import { ImageService } from '../../common/pipes/image.service';
import { PostsService } from './posts.service';
import { convertAudioForPlayback } from '../../common/audio-converter';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(
    private readonly service: PostsService,
    private readonly imageService: ImageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('authorId') authorId?: string) {
    return this.service.list(user.id, limit ? Number(limit) : 40, authorId);
  }

  @Get(':postId')
  getById(@CurrentUser() user: AuthUser, @Param('postId') postId: string) {
    return this.service.findById(postId, user.id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { attachment: null };
    }

    // Si es audio, guardar raw y convertir para compatibilidad
    if (file.mimetype.startsWith('audio/')) {
      const { writeFile, mkdir } = require('fs/promises');
      const { join } = require('path');
      const { randomUUID } = require('crypto');
      const { extname } = require('path');
      const ext = extname(file.originalname) || '.bin';
      const filename = `${randomUUID()}${ext}`;
      const dir = join(process.cwd(), 'uploads', 'posts');
      await mkdir(dir, { recursive: true });
      const fullPath = join(dir, filename);
      await writeFile(fullPath, file.buffer);

      // Convertir fMP4 a WebM para compatibilidad cross-browser
      let finalFilename = filename;
      const webmFilename = filename.replace(/\.(m4a|mp4)$/i, '.webm');
      if (webmFilename !== filename) {
        await convertAudioForPlayback(fullPath);
        finalFilename = webmFilename;
      }

      return {
        attachment: {
          kind: 'voice',
          url: `/uploads/posts/${finalFilename}`,
          mimeType: 'audio/webm;codecs=opus',
          fileName: finalFilename,
          size: file.size,
        },
      };
    }

    const result = await this.imageService.processAndSave(file, {
      subDir: 'posts',
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 80,
    });

    if (!result) {
      return { attachment: null };
    }

    return {
      attachment: {
        kind: 'image',
        url: result.url,
        mimeType: result.mimeType,
        fileName: file.originalname,
        size: result.size,
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

  @Post(':postId/comments/:commentId/like')
  toggleCommentLike(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.service.toggleCommentLike(postId, commentId, user.id);
  }

  @Post(':postId/comments/:commentId/replies')
  addCommentReply(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Body() body: { body?: string },
  ) {
    return this.service.addCommentReply(postId, commentId, user.id, body.body ?? '');
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