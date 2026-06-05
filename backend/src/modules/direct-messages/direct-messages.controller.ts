import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { DirectMessagesService } from './direct-messages.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';
import { ImageService } from '../../common/pipes/image.service';

@Controller('dm')
@UseGuards(JwtAuthGuard)
export class DirectMessagesController {
  constructor(
    private readonly service: DirectMessagesService,
    private readonly imageService: ImageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.listConversations(user.id);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Get(':conversationId')
  getConversation(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.service.getConversation(user.id, conversationId);
  }

  @Post('open/:peerId')
  open(@CurrentUser() user: AuthUser, @Param('peerId', ParseUUIDPipe) peerId: string) {
    return this.service.openConversation(user.id, peerId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { attachment: null };
    }

    // Si es audio, guardar RAW (no convertir, el navegador graba en formato que puede reproducir)
    if (file.mimetype.startsWith('audio/')) {
      const { writeFile, mkdir } = require('fs/promises');
      const { join } = require('path');
      const { randomUUID } = require('crypto');
      const { extname } = require('path');
      const ext = extname(file.originalname) || '.bin';
      const filename = `${randomUUID()}${ext}`;
      const dir = join(process.cwd(), 'uploads', 'dm');
      await mkdir(dir, { recursive: true });
      const fullPath = join(dir, filename);
      await writeFile(fullPath, file.buffer);

      return {
        attachment: {
          kind: 'voice',
          url: `/uploads/dm/${filename}`,
          mimeType: file.mimetype,
          fileName: filename,
          size: file.size,
        },
      };
    }

    const result = await this.imageService.processAndSave(file, {
      subDir: 'dm',
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

  @Post(':conversationId/accept')
  accept(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) cid: string) {
    return this.service.acceptConversation(user.id, cid);
  }

  @Post(':conversationId/reject')
  reject(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) cid: string) {
    return this.service.rejectConversation(user.id, cid);
  }

  @Delete(':conversationId')
  removeConversation(@CurrentUser() user: AuthUser, @Param('conversationId', ParseUUIDPipe) cid: string) {
    return this.service.removeConversation(user.id, cid);
  }

  @Get(':conversationId/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) cid: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.service.listMessages(
      user.id,
      cid,
      limit ? Math.min(Number(limit), 100) : 50,
      before ? new Date(before) : undefined,
    );
  }

  @Post(':conversationId/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) cid: string,
    @Body() body: { content?: string; attachments?: Array<Record<string, unknown>>; parentId?: string },
  ) {
    return this.service.send(user.id, cid, body.content, body.attachments, body.parentId);
  }

  @Delete(':conversationId/messages/:messageId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) cid: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.service.removeMessage(user.id, cid, messageId);
  }
}
