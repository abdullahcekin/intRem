# intRem

Claude Code oturumlarını telefondan izlemek, mesaj göndermek ve bekleyen soru/izinleri yanıtlamak için kendi sunucunuzda çalışan bir PWA.

Geliştirme sürümüdür. İlerleme ve kabul ölçütleri [GitHub Issues](https://github.com/abdullahcekin/intRem/issues) üzerinden takip edilir. Doğrulanmış özellikler ve canlı entegrasyon sınırları her teslimde güncellenir.

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
| Claude çalıştırıcı ve kontrollü devir | Uygulanmış; gerçek VDS pilotu bekliyor |
| Web Push ve proje/cihaz tercihleri | Uygulanmış; gerçek telefon teslimi bekliyor |
| OmniRoute | Sağlık görünümü var; hesap havuzu ve bütçeli fallback açık iş |
| Codex | Sağlık görünümü var; bağımsız inceleme akışı açık iş |

Canlı kaynak süreç PID ve başlangıç kimliğiyle doğrulanır; çıktıktan sonra kayıtlı konuşma `resume` ile sürdürülür. Kaynak konuşmanın geçmişini arayüze aktarma ayrıca izlenmektedir. Model alanı CLI yanıtında bildirilen kimliktir; gateway hesabının kanıtı değildir. Plan içeriği elde edilemiyorsa onay kapalı kalır. Ücretli fallback etkin değildir.

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
