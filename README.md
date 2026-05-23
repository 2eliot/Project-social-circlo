# Appchat — Private Invite-Only Social PWA

Monorepo:
- `backend/` — NestJS (TypeScript) + Prisma + Socket.io + Mediasoup + Redis + BullMQ.
- `frontend/` — Next.js 14 App Router PWA.
- `docker-compose.yml` — Postgres 16 + Redis 7 for local dev.

## Quick start (dev)

```powershell
# 1. Infra
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run start:dev

# 3. Frontend
cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Backend: http://localhost:4000  ·  Frontend: http://localhost:3000

## VPS deployment

This repo can also run on a plain VPS with Docker Engine and Docker Compose.

Files added for VPS deployment:
- `docker-compose.vps.yml` — frontend + backend + Postgres + Redis.
- `.env.vps.example` — variables to copy into a real `.env.vps` file.

Minimal VPS flow:

```bash
# on the server
git clone https://github.com/2eliot/Project-social-circlo.git appchat
cd appchat
cp .env.vps.example .env.vps

# edit .env.vps and replace secrets / public URLs
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Generate a production encryption key before starting:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Useful VPS commands:

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
docker compose --env-file .env.vps -f docker-compose.vps.yml pull
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Default exposed ports in the VPS compose file:
- `3001` -> frontend
- `4000` -> backend

If you later place Nginx or Caddy in front of the stack, point the public site to port `3001` and keep the backend private or proxy `/api` and Socket.IO traffic to port `4000`.

## Render deployment

This repo can be deployed to Render as a blueprint with:
- one PostgreSQL database
- one Redis instance
- one backend web service
- one frontend web service

Use the root [render.yaml](render.yaml).

Important notes:
- Frontend and backend run on different Render domains, so refresh-token cookies must use `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true` in production.
- `CORS_ORIGIN` on the backend must match the frontend Render URL.
- Uploaded files are stored on the backend filesystem right now. Render disks are ephemeral unless you attach persistent storage or move uploads to S3/R2.

Recommended backend env vars on Render:
- `NODE_ENV=production`
- `CORS_ORIGIN=https://your-frontend.onrender.com`
- `COOKIE_SAME_SITE=none`
- `COOKIE_SECURE=true`
- `COOKIE_DOMAIN=`
- `JWT_ACCESS_SECRET=<strong random value>`
- `JWT_REFRESH_SECRET=<strong random value>`
- `DATA_ENCRYPTION_KEY=<32-byte base64 key>`

Generate `DATA_ENCRYPTION_KEY` locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Recommended frontend env vars on Render:
- `NEXT_PUBLIC_API_URL=https://your-backend.onrender.com/api/v1`
- `NEXT_PUBLIC_WS_URL=https://your-backend.onrender.com`

## Highlights

- Atomic invitation redemption (SERIALIZABLE TX + conditional UPDATE) — see [backend/src/modules/invitations/use-cases/redeem-invitation.usecase.ts](backend/src/modules/invitations/use-cases/redeem-invitation.usecase.ts).
- Hybrid RBAC (global) + CBAC (per-group) — see [backend/src/common/guards](backend/src/common/guards).
- Socket.io with Redis adapter for horizontal scaling — see [backend/src/realtime](backend/src/realtime).
- Mediasoup SFU signaling skeleton for voice/video/screen-share.
- NSFW moderation queue (BullMQ) before publishing content.
