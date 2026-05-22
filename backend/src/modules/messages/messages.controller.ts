import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';

@Controller('channels/:channelId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

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

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() body: { content?: string; attachments?: any[]; parentId?: string },
  ) {
    return this.service.create({
      authorId: user.id,
      channelId,
      content: body.content,
      attachments: body.attachments,
      parentId: body.parentId,
    });
  }
}
