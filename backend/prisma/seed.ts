// Bootstrap seed: creates a SUPER_ADMIN with a known invitation code so the
// closed-loop system has a starting point. Run with: `npx prisma db seed`
// (configured below) or `npx ts-node prisma/seed.ts`.

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@appchat.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const code = (process.env.SEED_INVITE_CODE ?? 'BOOT01').toUpperCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists, skipping seed.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'root',
      dateOfBirth: new Date('1990-01-01'),
      globalRole: 'SUPER_ADMIN',
      isVerifiedModerator: true,
    },
  });

  await prisma.invitationCode.create({
    data: { ownerUserId: user.id, code, maxUses: 3 },
  });

  console.log('---------------------------------------------');
  console.log(`Seeded SUPER_ADMIN`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  invite:   ${code}  (max 3 uses)`);
  console.log('---------------------------------------------');

  // silence unused import warning
  void crypto;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
