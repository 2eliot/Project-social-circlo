import { Global, Module, Inject, Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy() {
    await this.client.quit();
  }

  /**
   * Release a distributed lock only if we still hold it.
   * Uses a CAS-style Lua script to avoid releasing someone else's lock.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    const result = (await this.client.eval(script, 1, key, token)) as number;
    return result === 1;
  }
}

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string) {
    return `presence:user:${userId}`;
  }

  async markOnline(userId: string, socketId: string, ttlSec = 60) {
    await this.redis.client.sadd(this.key(userId), socketId);
    await this.redis.client.expire(this.key(userId), ttlSec);
  }

  async markOffline(userId: string, socketId: string) {
    await this.redis.client.srem(this.key(userId), socketId);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.client.scard(this.key(userId))) > 0;
  }

  async getAllOnlineIds(): Promise<string[]> {
    const keys = await this.redis.client.keys('presence:user:*');
    if (keys.length === 0) return [];
    const results = await Promise.allSettled(
      keys.map(async (k) => {
        const userId = k.replace('presence:user:', '');
        const count = await this.redis.client.scard(k);
        return count > 0 ? userId : null;
      }),
    );
    return results
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => (r as PromiseFulfilledResult<string>).value);
  }
}

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  /** Returns true if request is allowed. Sliding window using INCR + EXPIRE. */
  async allow(scope: string, limit: number, windowSec: number): Promise<boolean> {
    const key = `rl:${scope}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSec);
    return count <= limit;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
    },
    RedisService,
    PresenceService,
    RateLimiterService,
  ],
  exports: [REDIS_CLIENT, RedisService, PresenceService, RateLimiterService],
})
export class RedisModule {}
