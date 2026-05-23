import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import type { Request } from 'express';
import { DirectMessagesService } from './direct-messages.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';

@Controller('dm')
@UseGuards(JwtAuthGuard)
export class DirectMessagesController {
  constructor(private readonly service: DirectMessagesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.listConversations(user.id);
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/dm',
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
    const kind = file.mimetype.startsWith('audio/') ? 'voice' : 'image';
    return {
      attachment: {
        kind,
          url: `/uploads/dm/${file.filename}`,
        mimeType: file.mimetype,
        fileName: file.originalname,
        size: file.size,
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
