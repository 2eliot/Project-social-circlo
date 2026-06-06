import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { MessagesService } from './messages.service';
import { GroupsService } from '../groups/groups.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';
import { ImageService } from '../../common/pipes/image.service';

@Controller('channels/:channelId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly imageService: ImageService,
    private readonly groupsService: GroupsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.service.listForChannel(
      user.id,
      channelId,
      limit ? Math.min(Number(limit), 100) : 50,
      before ? new Date(before) : undefined,
    );
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      return { attachment: null };
    }

    const result = await this.imageService.processAndSave(file, {
      subDir: 'channels',
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 88,
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
  async create(
    @CurrentUser() user: AuthUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() body: { content?: string; attachments?: any[]; parentId?: string },
  ) {
    const { isMember } = await this.groupsService.isChannelMember(user.id, channelId);
    if (!isMember) {
      throw new ForbiddenException('Debes unirte al grupo para enviar mensajes.');
    }
    return this.service.create({
      authorId: user.id,
      channelId,
      content: body.content,
      attachments: body.attachments,
      parentId: body.parentId,
    });
  }
}
