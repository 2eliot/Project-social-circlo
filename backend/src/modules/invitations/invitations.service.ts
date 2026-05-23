import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.module';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getMine(userId: string) {
    const code = await this.ensureMine(userId);
    return {
      code: code.code,
      usesCount: code.usesCount,
      maxUses: code.maxUses,
      isRevoked: code.isRevoked,
      redemptions: code.redemptions,
    };
  }

  private async ensureMine(userId: string) {
    const existing = await this.prisma.invitationCode.findUnique({
      where: { ownerUserId: userId },
      include: { redemptions: { select: { redeemedAt: true } } },
    });
    if (existing) return existing;

    for (let i = 0; i < 6; i++) {
      const candidate = this.crypto.randomAlphanumeric(6);
      try {
        return await this.prisma.invitationCode.create({
          data: { ownerUserId: userId, code: candidate, maxUses: 3 },
          include: { redemptions: { select: { redeemedAt: true } } },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }

        const current = await this.prisma.invitationCode.findUnique({
          where: { ownerUserId: userId },
          include: { redemptions: { select: { redeemedAt: true } } },
        });
        if (current) return current;
      }
    }

    throw new Error('Unable to allocate an invitation code');
  }
}
