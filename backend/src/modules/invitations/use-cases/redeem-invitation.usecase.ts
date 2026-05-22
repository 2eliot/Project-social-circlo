import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.module';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import { CryptoService } from '../../../common/crypto/crypto.module';

interface RedeemInput {
  email: string;
  password: string;
  displayName: string;
  legalName: string;
  dateOfBirth: Date;
  invitationCode: string;
  ip?: string;
  userAgent?: string;
}

interface CreatedUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: 'USER';
  invitationCode: string;
}

/**
 * Atomically:
 *   1. Validate inputs (incl. 18+).
 *   2. Acquire short-lived Redis lock (best-effort throttling).
 *   3. In a SERIALIZABLE transaction:
 *       a. UPDATE invitation_codes SET uses_count = uses_count + 1
 *          WHERE code = $1 AND is_revoked = false AND uses_count < max_uses
 *          RETURNING ...
 *          → 0 rows ⇒ code exhausted/invalid.
 *       b. INSERT user.
 *       c. INSERT invitation_redemptions (audit).
 *       d. INSERT a new InvitationCode for the new user (1:1).
 *   4. Release lock.
 *
 * Concurrency guarantee: the conditional UPDATE acquires a row-level lock;
 * the SERIALIZABLE isolation protects multi-row invariants. PostgreSQL aborts
 * conflicting transactions with SQLSTATE 40001 (serialization_failure).
 */
@Injectable()
export class RedeemInvitationUseCase {
  private readonly logger = new Logger(RedeemInvitationUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async execute(input: RedeemInput): Promise<CreatedUser> {
    this.assertAdult(input.dateOfBirth);

    const code = input.invitationCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      throw new BadRequestException('Invalid invitation code format');
    }

    const lockKey = `lock:invite:${code}`;
    const lockToken = crypto.randomUUID();
    const acquired = await this.redis.client.set(lockKey, lockToken, 'EX', 10, 'NX');
    if (!acquired) {
      throw new ConflictException('Invitation code is being processed, retry shortly');
    }

    try {
      const result = await this.runTransaction(code, input);
      return result;
    } catch (err) {
      if (this.isSerializationFailure(err)) {
        this.logger.warn(`Serialization failure redeeming code ${code}, asking client to retry`);
        throw new ConflictException('Concurrent registration detected, please retry');
      }
      throw err;
    } finally {
      await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  private async runTransaction(code: string, input: RedeemInput): Promise<CreatedUser> {
    return this.prisma.$transaction(
      async (tx) => {
        // (a) Atomic conditional increment.
        const updated = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE invitation_codes
             SET uses_count = uses_count + 1
           WHERE code = ${code}
             AND is_revoked = FALSE
             AND uses_count < max_uses
          RETURNING id
        `;
        if (updated.length === 0) {
          throw new ConflictException('Invitation code is invalid or fully redeemed');
        }
        const invitationCodeId = updated[0].id;

        // (b) Create user.
        const passwordHash = await this.crypto.hashPassword(input.password);
        const legalEncrypted = this.crypto.encrypt(input.legalName);

        const user = await tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            passwordHash,
            legalNameEncrypted: legalEncrypted,
            dateOfBirth: input.dateOfBirth,
            displayName: input.displayName,
            globalRole: 'USER',
          },
          select: { id: true, email: true, displayName: true },
        });

        // (c) Audit trail.
        await tx.invitationRedemption.create({
          data: {
            invitationCodeId,
            inviteeUserId: user.id,
            ipAddress: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
        });

        // (d) Provision the new user's own invitation code (1:1).
        const newCode = await this.allocateUniqueCode(tx);
        await tx.invitationCode.create({
          data: { ownerUserId: user.id, code: newCode, maxUses: 3 },
        });

        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          globalRole: 'USER',
          invitationCode: newCode,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 8_000,
      },
    );
  }

  private async allocateUniqueCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const candidate = this.crypto.randomAlphanumeric(6);
      const exists = await tx.invitationCode.findUnique({ where: { code: candidate } });
      if (!exists) return candidate;
    }
    throw new Error('Unable to allocate a unique invitation code');
  }

  private assertAdult(dob: Date): void {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Invalid date of birth');
    }
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (dob > cutoff) {
      throw new BadRequestException('User must be 18 or older');
    }
  }

  private isSerializationFailure(err: unknown): boolean {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma surfaces PG SQLSTATE in meta.code for raw queries.
      const code = (err.meta as { code?: string } | undefined)?.code;
      return code === '40001' || err.code === 'P2034';
    }
    return false;
  }
}
