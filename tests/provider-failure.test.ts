import { describe, expect, it } from 'vitest';
import type { SDKAssistantMessageError, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { providerFailureText } from '../src/runtime/provider-failure.js';

describe('Güvenli sağlayıcı hata açıklamaları', () => {
  it.each([
    ['authentication_failed', 'Kimlik doğrulaması'], ['cloud_credential_error', 'Kimlik doğrulaması'],
    ['oauth_org_not_allowed', 'erişim kısıtlı'], ['account_on_hold', 'erişim kısıtlı'], ['verification_required', 'erişim kısıtlı'],
    ['billing_error', 'faturalandırma'], ['overloaded', 'yoğunluk'], ['server_error', 'hizmet hatası'],
    ['model_not_found', 'model bulunamadı'], ['invalid_request', 'isteği geçersiz'], ['max_output_tokens', 'Yanıt uzunluğu'],
    ['rate_limit', 'hız sınırı mı yoksa kullanım kotası mı'], ['unknown', 'Hata nedeni belirlenemedi'],
  ] as const)('%s yalnız doğrulanmış hata türüyle açıklanır', (error, expected) => {
    expect(providerFailureText('success', error)).toContain(expected);
  });

  it.each(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'] as const)('%s reddedilmiş pencereyi kota olarak açıklar', rateLimitType => {
    const text = providerFailureText('success', 'rate_limit', { status: 'rejected', rateLimitType, resetsAt: 1789459200 });
    expect(text).toContain('Kullanım kotası doldu');
    expect(text).toContain('2026-09-15 08:00:00 UTC');
    expect(text).toContain('erişim garantisi değildir');
  });

  it.each([undefined, NaN, Infinity, -1, 0, 1.5, 1789459200000, 'PRIVATE_TIME'])('geçersiz zaman %s yorumlanmaz', resetsAt => {
    const text = providerFailureText('success', 'rate_limit', { status: 'rejected', rateLimitType: 'seven_day', resetsAt: resetsAt as number });
    expect(text).toContain('Yenilenme zamanı bildirilmedi');
    expect(text).not.toContain('PRIVATE_');
    expect(text).not.toContain('UTC');
  });

  it('ham metin, bilinmeyen enum veya yalnız uyarıdan kota türetmez', () => {
    const allowed = { status: 'allowed_warning', rateLimitType: 'seven_day', resetsAt: 1789459200 } as const;
    expect(providerFailureText('success', 'rate_limit', allowed)).not.toContain('Kullanım kotası doldu');
    expect(providerFailureText('success', 'rate_limit', { ...allowed, status: 'rejected', rateLimitType: 'PRIVATE_WINDOW' as SDKRateLimitInfo['rateLimitType'] })).not.toContain('PRIVATE_');
    expect(providerFailureText('success', 'PRIVATE_ERROR' as SDKAssistantMessageError)).toContain('Hata nedeni belirlenemedi');
    expect(providerFailureText('success', 'PRIVATE_ERROR' as SDKAssistantMessageError)).not.toContain('PRIVATE_');
    expect(providerFailureText('error_during_execution')).toContain('Hata nedeni belirlenemedi');
  });

  it('bütçe/adım sınırı ile sağlayıcı kotasını karıştırmaz; kredi gereksinimine zaman eklemez', () => {
    const quota = { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1789459200 } as const;
    expect(providerFailureText('error_max_budget_usd', 'rate_limit', quota)).toContain('Çalışma bütçesi');
    expect(providerFailureText('error_max_turns', 'rate_limit', quota)).toContain('Çalışma adımı');
    expect(providerFailureText('error_max_structured_output_retries')).toContain('Yanıt biçimi');
    const credit = providerFailureText('success', 'rate_limit', { ...quota, errorCode: 'credits_required' });
    expect(credit).toContain('kullanım kredisi');
    expect(credit).not.toContain('UTC');
    expect(providerFailureText('success', 'authentication_failed', quota)).toContain('Kimlik doğrulaması');
    expect(providerFailureText('success', undefined, quota)).toContain('Kullanım kotası');
  });
});
