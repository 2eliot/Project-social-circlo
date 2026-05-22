import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ModerationResult {
  blocked: boolean;
  reason?: string;
  scores?: Record<string, number>;
}

/**
 * Pluggable image NSFW classifier. Replace `analyze()` with a call to your
 * provider (AWS Rekognition, Google Vision, Hive, Sightengine, etc.).
 * The interface is intentionally provider-agnostic.
 */
@Injectable()
export class NsfwImageAdapter {
  constructor(private readonly config: ConfigService) {}

  async analyze(fileUrl: string): Promise<ModerationResult> {
    const endpoint = this.config.get<string>('MODERATION_PROVIDER_URL');
    const apiKey = this.config.get<string>('MODERATION_PROVIDER_KEY');
    if (!endpoint || !apiKey) {
      // Dev fallback: allow everything but tag dev-mode result.
      return { blocked: false, scores: { _dev: 1 } };
    }
    const res = await fetch(`${endpoint}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: fileUrl }),
    });
    if (!res.ok) return { blocked: false, reason: 'provider_unavailable' };
    const data = (await res.json()) as { explicit?: number; violence?: number };
    const explicit = data.explicit ?? 0;
    const violence = data.violence ?? 0;
    const blocked = explicit > 0.85 || violence > 0.9;
    return {
      blocked,
      reason: blocked ? (explicit > 0.85 ? 'explicit' : 'violence') : undefined,
      scores: { explicit, violence },
    };
  }
}
