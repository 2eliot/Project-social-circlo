import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard, CbacGuard } from '../../common/guards/auth.guards';
import { GroupRoles } from '../../common/decorators/auth.decorators';

@Controller('groups/:groupId/channels')
@UseGuards(JwtAuthGuard, CbacGuard)
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  @Get()
  @GroupRoles('GROUP_ADMIN', 'GROUP_MODERATOR', 'GROUP_MEMBER')
  list(@Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.service.list(groupId);
  }

  @Post()
  @GroupRoles('GROUP_ADMIN')
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() body: { name: string; type: ChannelType; bitrateKbps?: number },
  ) {
    return this.service.create(groupId, body);
  }

  @Patch(':channelId/enabled')
  @GroupRoles('GROUP_ADMIN', 'GROUP_MODERATOR')
  toggle(@Param('channelId', ParseUUIDPipe) channelId: string, @Body() body: { enabled: boolean }) {
    return this.service.setEnabled(channelId, body.enabled);
  }

  @Delete(':channelId')
  @GroupRoles('GROUP_ADMIN')
  async remove(@Param('channelId', ParseUUIDPipe) channelId: string) {
    await this.service.remove(channelId);
    return { ok: true };
  }
}
