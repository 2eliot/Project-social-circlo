import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return c;
  }

  async remove(channelId: string) {
    await this.prisma.channel.delete({ where: { id: channelId } });
  }
}
