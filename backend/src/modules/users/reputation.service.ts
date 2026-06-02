import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.module';

@Injectable()
export class ReputationService {
  constructor(private readonly prisma: PrismaService) {}

  async voteOnUser(voterId: string, targetId: string, voteType: 1 | -1) {
    if (voterId === targetId) {
      throw new BadRequestException('No puedes votar por ti mismo.');
    }

    // Upsert using raw SQL to avoid Prisma client regeneration issues
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO user_reputation (voter_id, target_id, vote_type, created_at, updated_at)





       VALUES ($1::uuid, $2::uuid, $3, NOW(), NOW())
        ON CONFLICT (voter_id, target_id) DO UPDATE SET vote_type = $3, updated_at = NOW()`,
       voterId,
       targetId,
       voteType,
    );
  }

  async removeVote(voterId: string, targetId: string) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM user_reputation WHERE voter_id = $1::uuid AND target_id = $2::uuid`,
      voterId,
      targetId,
    );
  }

  async getReputation(userId: string) {
    const votes = await this.prisma.$queryRawUnsafe(
      `SELECT vote_type FROM user_reputation WHERE target_id = $1::uuid`,
      userId,
    ) as Array<{ vote_type: number }>;

    const likes = votes.filter((v) => v.vote_type === 1).length;
    const dislikes = votes.filter((v) => v.vote_type === -1).length;
    const score = likes - dislikes;
    return { score, likes, dislikes };
  }

  async getUserVoteOnProfile(voterId: string, targetId: string) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT vote_type FROM user_reputation WHERE voter_id = $1::uuid AND target_id = $2::uuid`,
      voterId,
      targetId,
    ) as Array<{ vote_type: number }>;

    return result[0]?.vote_type ?? null;
  }
}
