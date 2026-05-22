import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException("You can't block yourself");
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    return { ok: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    return { ok: true };
  }

  async list(blockerId: string) {
    return this.prisma.userBlock.findMany({
      where: { blockerId },
      include: { blocked: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
  }
}
