# intRem

Claude Code oturumlarını telefondan izlemek, mesaj göndermek ve bekleyen soru/izinleri yanıtlamak için kendi sunucunuzda çalışan bir PWA.

Geliştirme sürümüdür. İlerleme ve kabul ölçütleri [GitHub Issues](https://github.com/abdullahcekin/intRem/issues) üzerinden takip edilir. Doğrulanmış özellikler ve canlı entegrasyon sınırları her teslimde güncellenir.

Yeni bir oturumdan devam etmek için önce [güncel durum ve devam rehberini](docs/STATUS.md) okuyun. [AGENTS.md](AGENTS.md), yeni ajanın hangi belgeleri ve canlı kontrolleri esas alacağını belirtir.

## Kapsam

- Tek kullanıcı, tek Linux sunucu, birden fazla proje.
- Kalıcı mesaj kuyruğu, olay geçmişi ve tek kullanımlık insan kararları.
- intRem'in yönettiği yeni Claude oturumları ve mevcut konuşmalardan kontrollü devir.
- Mobil PWA, passkey girişi, cihaz iptali ve Web Push.
- Model ve hesap görünürlüğü; doğrulanmamış bilgi için açıkça `bilinmiyor` durumu.

Terminale körlemesine metin gönderilmez. Aktif mevcut oturumlar kendiliğinden kapatılmaz. Belirsiz teslimat otomatik tekrarlanmaz. Araç izni ile plan kabulü ayrı tutulur.

## Geliştirme

Node.js 22.13 veya üzeri gerekir.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

API ve oturum çalıştırıcısı ayrı süreçlerdir. Veri SQLite'ta saklanır. Sunucuya özgü erişim bilgileri, kaynak belgeler ve kimlik bilgileri bu repoya eklenmez.

[Uygulama sözleşmesi](docs/implementation-contract.md) · [Arayüz tasarım sistemi](docs/design-system.md) · [Ubuntu kurulumu](docs/deployment.md)

## Mevcut durum

| Alan | Durum |
| --- | --- |
| Passkey, Origin/CSRF, cihaz iptali | Uygulanmış; WebAuthn tarayıcı doğrulaması var |
| Kuyruk, ilk kararın kazanması, SSE devam kimliği | Uygulanmış; süreç yarışı ve kesinti testleri var |
| Mobil konuşma, soru/izin kartları, çevrimdışı taslak | Uygulanmış; 320–1440 px tarayıcı kontrolü var |
| Claude çalıştırıcı ve kontrollü devir | Gerçek VDS mesajı, geçmiş okuma, aynı konuşmayı restart sonrası sürdürme ve servis üzerinden soru yanıtı geçti; aktif kaynak süreçler kapatılmadı |
| Web Push ve proje/cihaz tercihleri | Uygulanmış; gerçek telefon teslimi bekliyor |
| OmniRoute | Sağlık görünümü var; hesap havuzu ve bütçeli fallback açık iş |
| Codex | Kalıcı inceleme kuyruğu, salt okunur çalıştırma, iptal ve değişen kod kontrolü uygulandı; gerçek VDS CLI pilotu geçti |

Canlı kaynak süreç PID ve başlangıç kimliğiyle doğrulanır; çıktıktan sonra kayıtlı konuşma `resume` ile sürdürülür. İzleme ekranı SDK üzerinden son 200 metin mesajını yeniler; devirde bu geçmiş uygulama deposuna aktarılır. Kaynak zaman damgaları SDK tarafından verilmediğinden aktarılan mesajların zamanı aktarım anıdır. Model alanı CLI yanıtında bildirilen kimliktir; gateway hesabının kanıtı değildir. Plan içeriği elde edilemiyorsa onay kapalı kalır. Ücretli fallback etkin değildir.

## Yerel çalıştırma

Claude Code'a sunucudaki kullanıcıyla giriş yapın; API anahtarlarını arayüze veya repoya koymayın.

```sh
export INTREM_ALLOWED_ROOTS='["/home/USER/projects"]'
export INTREM_ORIGIN=http://localhost:4100
npm run setup
npm start
# Ayrı terminalde, aynı ortam değişkenleriyle:
npm run start:runner
```

Kurulum komutu ilk passkey için tek kullanımlık kod dosyası oluşturur ve yalnız dosya yolunu gösterir. Dosyayı sunucu sahibi okuyup ilk kayıt ekranında kullanır. Uzak erişimde HTTPS gerekir. `.env` otomatik yüklenmez; ortam değişkenleri veya systemd EnvironmentFile kullanılır.

Geliştirmede `npm run dev` ve `npm run dev:web` ayrı terminallerde çalışır. Üretim runner'ı Linux içindir.

## Tarayıcı ve canlı kontrol

```sh
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

Tarayıcı kontrolü geçici SQLite verisi ve sanal WebAuthn cihazı kullanır; LLM çağrısı yapmaz. Ekran görüntüleri `output/playwright/` altında oluşur. Canlı model kontrolü, yalnız ayrı bir pilot dizini açıkça verildiğinde `INTREM_PILOT_PROJECT=/path/to/pilot node scripts/live-pilot.mjs` ile yapılır.

[GitHub Actions](https://github.com/abdullahcekin/intRem/actions/workflows/check.yml), her push ve pull request için Node.js 22 üzerinde bağımlılık kurulumu, tip kontrolü, birim/entegrasyon testleri, üretim derlemesi ve Chromium tarayıcı akışlarını çalıştırır. Gerçek Claude/Codex çağrıları ve fiziksel telefon kabulü CI'dan ayrı yürütülür.

`scripts/live-review.mjs`, açıkça seçilen pilot Git projesinde gerçek Codex incelemesini doğrular. `scripts/service-pilot.mjs`, kurulu runner üzerinden gerçek `AskUserQuestion` callback'ini sınar; kayıtlar pilot oturumunda kalır. Her ikisi için `INTREM_PILOT_PROJECT` gerekir. Soru testinde yalnız beklenen pilot sorusuna yanıt verilir; diğer araç istekleri reddedilir. `INTREM_PILOT_MODEL`, yalnız bu testin oluşturduğu oturumun modelini seçer.
