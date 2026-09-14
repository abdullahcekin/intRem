# intRem uygulama sözleşmesi

Kullanıcının devam talebiyle alan adı + passkey girişi ve konuşmayı koruyan kontrollü devir esas alınır. Aktif kaynak süreç kendiliğinden kapatılmaz; ilk sürümde canlı süreç izlenir, kaynak süreç çıktıktan sonra aynı konuşma kimliği intRem tarafından sürdürülür. Gateway hesapları hazırlanmadığında Claude mevcut kendi yapılandırmasını kullanır; gerçek hesap/model bilinmiyor gösterilir. DeepSeek için bütçe ve hesap kurulumu tamamlanana kadar ücretli fallback kapalıdır.

## Dosya sorumlulukları

- `src/shared/types.ts`: istemci/sunucu ortak veri sözleşmesi.
- `src/server/store.ts`: node:sqlite ile kalıcılık, atomik karar ve kuyruk işlemleri; `tests/store.test.ts`.
- `src/server/auth.ts`: passkey, kısa ömürlü challenge, cookie ve cihaz iptali; `tests/auth.test.ts`.
- `src/server/app.ts`: Fastify API, Origin/CSRF kontrolü, SSE ve statik PWA; `tests/api.test.ts`.
- `src/runtime/discovery.ts`: izinli dizinlerde mevcut Claude süreç kaydı keşfi; `tests/discovery.test.ts`.
- `src/runtime/runner.ts` ve `main.ts`: HTTP servisinden ayrı, Claude Agent SDK oturum süreçleri, kuyruk ve callback'ler; `tests/runner.test.ts`.
- `src/web/`: React arayüzü; `public/`: manifest, güvenli uygulama kabuğu ve ikonlar.
- `deploy/`: Ubuntu systemd birimleri ve Caddy örneği; `README.md`: kurulum ve gerçek entegrasyon sınırları.

## API

Tüm `/api` uçları, `/api/auth/*` dışında giriş gerektirir. Yazma istekleri JSON ve same-origin gerektirir; `X-CSRF-Token` login snapshot'ından alınır. Yanıt hatası `{error: string, code: string}` biçimindedir.

- `GET /api/auth/status` → `{authenticated, setupRequired, csrfToken?, device?}`.
- `POST /api/auth/register/options` `{bootstrapToken?, name}` → WebAuthn creation options.
- `POST /api/auth/register/verify` `{response, name}` → giriş oturumu ve CSRF token.
- `POST /api/auth/login/options` `{}` → WebAuthn request options.
- `POST /api/auth/login/verify` `{response, name?}` → giriş oturumu ve CSRF token.
- `POST /api/auth/logout` `{}`.
- `GET /api/snapshot` → `AppSnapshot`.
- `POST /api/projects` `{name,cwd,mode?}` → `Project`; cwd sunucudaki izinli köklerden biri altında olmalı.
- `POST /api/sessions` `{projectId,title?}` → `Session`.
- `GET /api/discovery` → `{sessions: DiscoveredSession[]}`.
- `POST /api/sessions/import` `{claudeSessionId,pid,projectId}` → `Session`; keşif ve proje cwd eşleşmesi yeniden doğrulanır.
- `POST /api/sessions/:id/takeover` `{generation}` → `Session`; kaynak süreç canlıysa 409.
- `GET /api/sessions/:id/messages` → `{messages: Message[]}`.
- `POST /api/sessions/:id/messages` `{clientId,text,generation}` → `Message`; aynı anahtar/farklı içerik 409.
- `POST /api/messages/:id/cancel` `{}` → `Message`; sadece queued.
- `POST /api/interactions/:id/decision` `{generation,contentHash,behavior,answers?,reason?}` → `Interaction`.
- `POST /api/sessions/:id/stop` `{generation,confirm:true}` → stop isteği; çalışan işi durdurma ayrı insan eylemi.
- `POST /api/control` `{enabled:boolean}` → uzaktan yeni komut kabulü.
- `GET /api/events/stream?after=integer` → SSE `update` olayları; kesintide snapshot yeniden alınır.
- `GET /api/health` → `HealthReport`; `GET /health` yalnız temel liveness.
- `GET /api/devices` → `{devices: Device[]}`.
- `POST /api/devices/:id/revoke` `{}`.
- `GET /api/push/key` → `{publicKey}`.
- `POST /api/devices/push` `{subscription}`; `POST /api/push/test` `{}`.

## Store arayüzü

`Store(path)` nesnesi `db: DatabaseSync` sağlar. Diğer modüller için aşağıdaki yöntemler sabittir; eşzamanlı karar ve kuyruk güncellemeleri transaction içinde olur.

`listProjects()`, `getProject(id)`, `createProject({name,cwd,host,mode?})`, `listSessions()`, `getSession(id)`, `createSession({projectId,title?,source?,claudeSessionId?,sourcePid?,sourceStart?,tmuxPane?})`, `updateSession(id,patch)`, `listMessages(sessionId)`, `enqueueMessage(sessionId,{clientId,text,generation})`, `cancelMessage(id)`, `claimNextMessage(sessionId)`, `updateMessage(id,patch)`, `appendMessage(sessionId,role,text)`, `createInteraction({sessionId,generation,requestId,kind,toolName,input,expiresAt})`, `getInteraction(id)`, `listInteractions(sessionId?)`, `decideInteraction(id,{generation,contentHash,decision,deviceId})`, `expireInteractions()`, `event(type,sessionId,data)`, `eventsAfter(cursor,limit?)`, `cursor()`, `getSetting(key,fallback?)`, `setSetting(key,value)`, `recoverDeliveries()`, `close()`.

Store, kendi şemasını kurar; auth modülü kendi tablolarını aynı bağlantıda kurar. `updateSession` ve `updateMessage` yalnız ortak tip alanlarını kabul eder. `get*` bulunamadığında `undefined`; alan/koşul hatalarında `.statusCode`/`.code` taşıyan `AppError` kullanılır (`src/server/errors.ts`, root oluşturur).

## Plan içeriğinin onaya taşınması

Claude Code, [ExitPlanMode hook girdisine](https://code.claude.com/docs/en/hooks#exitplanmode) somut `plan` ve `planFilePath` alanlarını ekler; modelin doğrudan araç girdisi boş olabilir. Runner bu girdinin kopyasını `PreToolUse` üzerinden `ask + updatedInput` ile mevcut `canUseTool` karar döngüsüne taşır. Hook `allow` üretmez. Eksik plan reddedilir; kullanıcı kararı aynı oturum/nesil/istek ve içerik hash'iyle bir kez uygulanır. Onay için plan dosyası aranmaz veya diskten yeniden okunmaz; callback'in onaylanan snapshot'ı döndürülür. Plan onayı sonraki araç izinlerinin yerine geçmez.

## Sağlayıcı hata açıklamaları

Runner, başarısız turun açıklamasını ilgili kullanıcı mesajının mevcut `error` alanına yazar; veri şeması değişmez. Açıklama yalnız SDK'nın üst düzey `assistant.error` enumundan, aynı aktif mesajda gözlenen `rate_limit_event` alanlarından ve `result.subtype` değerinden üretilir. Ham hata yanıtı, `result.errors`, stderr veya exception metni teşhis olarak kaydedilmez. `success` alt türünde `is_error: true` olan sonuç da hata sayılır ve ham `result` metni konuşmaya eklenmez.

`rate_limit` tek başına geçici hız sınırı olarak yorumlanmaz. Yalnız `status: rejected` ile bilinen abonelik penceresi birlikte gözlendiğinde kota türü belirtilir. Alanlar eksikse sınırın türü veya hata nedeni bilinmiyor olarak kalır. Kimlik, hesap erişimi, faturalandırma, model/istek, yoğunluk ve servis hataları ayrı sabit açıklamalar üretir. Turun bütçe/adım/çıktı biçimi sınırları sağlayıcı kotasıyla karıştırılmaz.

Yalnız sağlayıcının bildirdiği geçerli Unix saniyesi `resetsAt`, UTC olarak gösterilir; eksik veya geçersiz zaman tahmin edilmez. Bu, mesaj sırasında gözlenen pencere zamanıdır; erişim garantisi veya otomatik yeniden gönderim talimatı değildir. Her yeni mesajda, normal üst düzey yanıt alındığında veya izin veren kota olayı geldiğinde önceki ilgili kanıt temizlenir. Başarılı sonuçta hata kalmaz. SDK bağlantısı koptuğunda veya runner yeniden başladığında mevcut `delivery_unknown` sözleşmesi korunur.

Kaynak: kurulu `@anthropic-ai/claude-agent-sdk` tip sözleşmesi; [resmi TypeScript SDK referansı](https://code.claude.com/docs/en/agent-sdk/typescript) ve [Claude kullanım pencerelerinin zaman sözleşmesi](https://code.claude.com/docs/en/statusline#rate-limit-usage). OmniRoute hesap kimliği, gerçek gateway eşliği ve ücretli fallback bu açıklamalardan doğrulanmış sayılmaz.

## OmniRoute kurulum sayımı

Yetkili `/api/health` yanıtındaki `omniroute.setup`, kontrol zamanı ile `connections`, `pools` ve `mappings` sayaçlarını taşır. Her sayaç `{state,count}` biçimindedir: `ok` durumunda sıfır veya pozitif kayıt sayısı; `auth_required`, `unavailable`, `not_configured` durumlarında `null`. Public `/health` yalnız canlılık yanıtı vermeye devam eder. Bir sayaç okunamasa da diğerlerinin doğrulanmış değeri korunur. Eşleme toplamı devre dışı kayıtları da içerir; geçerli/etkin yönlendirme sayısı değildir.

Kurulu OmniRoute 3.8.50 kaynak sözleşmesi: `src/app/api/providers/route.ts`, `src/app/api/combos/route.ts` ve `src/app/api/model-combo-mappings/route.ts`, sayfalı `{connections,total}` / `{combos,total}` / `{mappings,total}` GET yanıtları; `src/server/authz/accessScopes.ts` ve `src/lib/accessTokens/scopes.ts`, CLI erişim token'ı için `read` yetkisi. `limit=1` ile yalnız toplam kayıt sayısı doğrulanır. Hesap adı, e-posta, eşleme örüntüsü, model listesi, token veya ham hata intRem yanıtına ve Store'a aktarılmaz. İstekler süre/boyut sınırı ve yönlendirme yasağıyla yapılır; sonuçlar mevcut sağlık önbelleğini kullanır. Runner heartbeat önbellekten bağımsız okunur.

Bu alanlar kurulum envanteridir; çalışan hesap, kota, ayrı model havuzlarının doğruluğu, gerçek istek hesabı/modeli ve harcama garantisi sayılmaz. Token kurulumu için [dağıtım rehberine](deployment.md#omniroute-kurulum-görünürlüğü) bakın. Pozitif sayı simülasyonları ve canlı yetkisiz yanıt kontrolü, gerçek hesap bağlantısı kabulünden ayrı raporlanır.

## Doğrulama sırası

1. Atomik karar, generation, idempotency ve restart testleri yazılıp beklenen başarısızlık görülür; sonra store uygulanır.
2. Auth/API testleri girişsiz erişimi, Origin, tekrar challenge, cihaz iptali ve yanlış hedefi reddeder.
3. Runner/discovery testleri sahte süreç adaptörü ve geçici dosyalarla gerçek karar/teslim durumlarını sınar; simülasyon canlı Claude doğrulamasından ayrı raporlanır.
4. UI build ve Playwright kullanıcı akışları; geniş/dar ekranda görüntü incelemesi.
5. Ayrı Ubuntu pilotunda gerçek CLI gidiş/dönüşü, API restart ve kontrollü devir; mevcut çalışma oturumlarına müdahale yok.
6. `npm run test:restore`: yalnız geçici verilerle API süreci durdurulur; veri dizini ayrı konuma kopyalanır, bütün uygulama tabloları karşılaştırılır. Bozuk public key içeren kontrol yedeğinde giriş reddedilir; sağlam yedek yeni API sürecinde aynı sanal passkey ile giriş, sayaç ilerlemesi, konuşma ve tüketilmiş bootstrap korunmasıyla doğrulanır. Fiziksel cihaz kabulünün yerine geçmez.
7. Tarayıcı kontrolü service worker denetimini, shell/asset önbelleğini, API/sağlık verisinin önbelleğe alınmamasını, çevrimdışı reload/rehber açılışını ve bağlantıdan sonra yeniden doğrulamayı kapsar. Tarayıcının çevrimiçi bildirimi sunucu erişimi kanıtı sayılmaz; açılışta ağ hatası ayrıca gösterilir.
