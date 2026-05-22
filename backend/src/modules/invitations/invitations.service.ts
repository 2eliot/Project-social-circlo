import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: string) {
    const code = await this.prisma.invitationCode.findUnique({
      where: { ownerUserId: userId },
      include: { redemptions: { select: { redeemedAt: true } } },
    });
    if (!code) throw new NotFoundException();
    return {
      code: code.code,
      usesCount: code.usesCount,
      maxUses: code.maxUses,
      isRevoked: code.isRevoked,
      redemptions: code.redemptions,
    };
  }
}
