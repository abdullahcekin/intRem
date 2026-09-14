import type { SDKAssistantMessageError, SDKRateLimitInfo, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

function quotaWindow(type: SDKRateLimitInfo['rateLimitType']): string | undefined {
  switch (type) {
    case 'five_hour': return '5 saatlik';
    case 'seven_day': return '7 günlük';
    case 'seven_day_opus': return 'Opus için 7 günlük';
    case 'seven_day_sonnet': return 'Sonnet için 7 günlük';
    case 'seven_day_overage_included': return 'ek kullanım dahil 7 günlük';
    case 'overage': return 'ek kullanım';
    default: return undefined;
  }
}

function resetText(seconds: number | undefined): string {
  // The CLI emits Unix seconds. Reject malformed values and millisecond timestamps.
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 253402300799) return 'Yenilenme zamanı bildirilmedi.';
  const utc = new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  return `Sağlayıcının bu mesaj sırasında bildirdiği pencere yenilenmesi: ${utc}. Bu zaman yeniden erişim garantisi değildir.`;
}

/** Only allowlisted SDK metadata becomes a diagnostic; never interpolate raw error text. */
export function providerFailureText(subtype: SDKResultMessage['subtype'], error?: SDKAssistantMessageError, limit?: SDKRateLimitInfo): string {
  switch (subtype) {
    case 'error_max_budget_usd': return 'Çalışma bütçesi sınırına ulaşıldı. Bu tur için tanımlanan bütçeyi sunucu yöneticisiyle kontrol edin. Önceki işlemlerin kısmi etkileri olabilir.';
    case 'error_max_turns': return 'Çalışma adımı sınırına ulaşıldı. Son çıktıyı inceleyip kalan işi daha küçük adımlarla sürdürün. Önceki işlemler geri alınmadı.';
    case 'error_max_structured_output_retries': return 'Yanıt biçimi doğrulanamadı. İstenen çıktı biçimini gözden geçirin; önceki işlemlerin kısmi etkileri olabilir.';
  }

  if ((error === 'rate_limit' || !error) && limit?.status === 'rejected') {
    if (limit.errorCode === 'credits_required') return 'Sağlayıcı kullanım kredisi istiyor. Hesap ve kredi durumunu sunucu yöneticisiyle kontrol edin; burada ödeme veya hesap geçişi başlatılmaz.';
    const window = quotaWindow(limit.rateLimitType);
    if (window) return `Kullanım kotası doldu (${window} pencere). Sağlayıcı hesabındaki limitleri kontrol edin. ${resetText(limit.resetsAt)}`;
  }

  switch (error) {
    case 'authentication_failed':
    case 'cloud_credential_error':
      return 'Kimlik doğrulaması başarısız. Sunucudaki model sağlayıcısının oturumunu veya kimlik yapılandırmasını kontrol edin. intRem passkey’inizi değiştirmeniz gerekmez.';
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
      return 'Sağlayıcı hesabına erişim kısıtlı. Hesabın kuruluş iznini ve doğrulama durumunu sağlayıcı panelinden kontrol edin.';
    case 'billing_error':
      return 'Sağlayıcı faturalandırma hatası bildirdi. Hesabın ödeme ve kredi durumunu sunucu yöneticisiyle kontrol edin.';
    case 'rate_limit':
      return 'İstek sınırına ulaşıldı. SDK bunun geçici hız sınırı mı yoksa kullanım kotası mı olduğunu bildirmedi. Bir süre bekleyip sağlayıcı limitlerini kontrol edin. Yenilenme zamanı bildirilmedi.';
    case 'overloaded':
      return 'Sağlayıcı yoğunluk hatası bildirdi. Servis durumunu kontrol edip daha sonra devam edin; yeni mesaj göndermeden önce önceki işlemlerin sonucunu inceleyin.';
    case 'server_error':
      return 'Sağlayıcı hizmet hatası bildirdi. Servis durumunu kontrol edin; yeniden devam etmeden önce önceki işlemlerin sonucunu inceleyin.';
    case 'model_not_found':
      return 'İstenen model bulunamadı veya bu hesapla kullanılamıyor. Model adını ve hesabın model erişimini kontrol edin.';
    case 'invalid_request':
      return 'Sağlayıcı isteği geçersiz buldu. Mesajı ve oturumun model yapılandırmasını gözden geçirin.';
    case 'max_output_tokens':
      return 'Yanıt uzunluğu sınırına ulaşıldı. Son çıktıyı inceleyin ve gerekirse kalan yanıtı daha küçük bölümler hâlinde isteyin.';
    default:
      return 'Hata nedeni belirlenemedi. SDK güvenilir bir hata türü bildirmedi. Sistem ekranındaki bağlantıları ve sağlayıcı hesabını kontrol edin; önceki işlemlerin kısmi etkileri olabilir.';
  }
}
