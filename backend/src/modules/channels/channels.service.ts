import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';
import { RealtimeEventsService } from '../../realtime/realtime-events.service';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService, private readonly events: RealtimeEventsService) {}

  async create(groupId: string, dto: { name: string; type: ChannelType; bitrateKbps?: number }) {
    return this.prisma.channel.create({
      data: {
        groupId,
        name: dto.name,
        type: dto.type,
        bitrateKbps: dto.bitrateKbps,
        sfuRoomId: dto.type === 'TEXT' ? null : `${groupId}:${dto.name}`,
      },
    });
  }

  async list(groupId: string) {
    return this.prisma.channel.findMany({
      where: { groupId },
      orderBy: { position: 'asc' },
    });
  }

  async setEnabled(channelId: string, enabled: boolean) {
    const c = await this.prisma.channel.update({
      where: { id: channelId },
      data: { isEnabled: enabled },
    });
    if (!c) throw new NotFoundException();
    this.events.emitChannelUpdated(c.groupId, c);
    return c;
  }

  async remove(channelId: string) {
    await this.prisma.channel.delete({ where: { id: channelId } });
  }
}
