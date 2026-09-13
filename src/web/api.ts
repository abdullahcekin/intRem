export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | undefined;
export function setCsrfToken(value?: string) { csrfToken = value; }

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('intrem:unauthorized'));
    throw new ApiError(result?.error || `İstek tamamlanamadı (${response.status}).`, response.status, result?.code || 'HTTP_ERROR');
  }
  return result as T;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Passkey işlemi tamamlanmadı. Cihaz kilidinizi açıp yeniden deneyebilirsiniz.';
  if (error instanceof TypeError) return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin; işlem kendiliğinden tekrarlanmayacak.';
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı. Durumu yenileyip yeniden kontrol edin.';
}
