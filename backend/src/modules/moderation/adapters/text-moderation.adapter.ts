import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModerationResult } from './nsfw-image.adapter';

@Injectable()
export class TextModerationAdapter {
  constructor(private readonly config: ConfigService) {}

  async analyze(content: string): Promise<ModerationResult> {
    if (!content) return { blocked: false };
    const endpoint = this.config.get<string>('MODERATION_PROVIDER_URL');
    const apiKey = this.config.get<string>('MODERATION_PROVIDER_KEY');
    if (!endpoint || !apiKey) {
      // Local fallback heuristic — production must use a real provider.
      const blocked = /\b(kill yourself|child porn|cp)\b/i.test(content);
      return { blocked, reason: blocked ? 'heuristic' : undefined };
    }
    const res = await fetch(`${endpoint}/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ text: content }),
    });
    if (!res.ok) return { blocked: false, reason: 'provider_unavailable' };
    const data = (await res.json()) as { hate?: number; sexual?: number; violence?: number };
    const max = Math.max(data.hate ?? 0, data.sexual ?? 0, data.violence ?? 0);
    return {
      blocked: max > 0.85,
      reason: max > 0.85 ? 'policy_violation' : undefined,
      scores: { hate: data.hate ?? 0, sexual: data.sexual ?? 0, violence: data.violence ?? 0 },
    };
  }
}
