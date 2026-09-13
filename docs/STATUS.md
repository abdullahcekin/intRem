# Durum ve devam rehberi

Son güncelleme: **2026-09-13**. Bu bir durum kaydıdır; yeni oturumda Git, CI ve sunucu durumunu tekrar doğrulayın.

## Son doğrulanmış çalışma

- Kaynak sürümü **`3f9f45232a95f28adfbcd01f8be8c98302a95b2f`**, `main` dalına yayınlandı ve normal API'ye dağıtıldı. Bu sürüm web arayüzünü değiştirir; runner kodu ve çalışan süreci korundu. Sonraki yalnız belge commit'leri için canlı Git/CI durumunu ayrıca kontrol edin.
- Bu kaynak sürümü için [main GitHub Actions başarılı](https://github.com/abdullahcekin/intRem/actions/runs/34781762971): Node.js 22, tip kontrolü, **59/59 test**, üretim derlemesi ve **19 Chromium kontrolü**. İki gerçek Linux alt süreç testi bu sayıya dahildir.
- Giriş yapmadan açılan `/info` kullanım rehberi eklendi; giriş ekranı ve üst çubuktan erişilir. Kurulum anahtarı, passkey, özellikler, kullanım adımları ve açık kapsamlar kaynakla doğrulandı. Anahtarın kendisi veya özel sunucu bilgisi sayfaya konmadı. Canlı HTTPS giriş ekranındaki bağlantıdan rehber açıldı; dış sağlık ve `/info` 200, girişsiz snapshot 401.
- Rehber 320–1440 px, 812×375 yatay ekran, %200 büyütme, koyu tema, klavye ile SSS ve en az 44 px etkileşim hedefleriyle doğrulandı. Kısa konuşma ekranında gizli üst öğenin programatik kaydırılması gerçek bir erişim sorunu saklıyordu; konuşmaya kullanıcı kaydırması eklenerek düzeltildi. 812×375 ve 390×400 kontrolleri gizli üst öğe kaydırmasını ve gönderme düğmesinin tıklama hedefini sınar. Fiziksel ekran klavyesi/PWA/push kabulü ayrı kalır.
- Bağımsız kaynak incelemesi plan/kapanış değişikliklerini uygun buldu. Pilot incelemesindeki iki P2 de karşılandı: son yanıt tam eşleşmeyle doğrulanıyor, runner pilotunun API/telefon kabulünden ayrı olduğu açıkça belirtiliyor. Plan kartı metni, açık kullanıcı teyidi ve eksik planın reddi tarayıcı testinde geçti.
- Oturum bilgisindeki model artık **Bildirilen son model** olarak gösteriliyor; görünür açıklama bu CLI kimliğinin OmniRoute model/hesap kanıtı olmadığını belirtiyor. Bilinmeyen/bildirilen değer ve kaydırmalı açıklama 375/812/1440 px genişliklerde doğrulandı; bağımsız dar inceleme uygun.
- Gerçek Sonnet/SDK plan pilotunda `PreToolUse` planı `ask + updatedInput` ile mevcut karar callback'ine taşındı. Ayrı veri deposundaki gerçek Runner + Store pilotu: `completed`, bir plan, bir uygulanmış karar; onay sonrası plan metni ve beklenen yanıt eşleşti. Yeni sürümle kurulu systemd runner pilotu ise sağlayıcının haftalık kullanım limitinde, plan aşamasına ulaşmadan başarısız oldu; kendi oturumu kontrollü kapandı. Bu normal servis plan kabulü ve fiziksel telefon kabulü açık kalır; otomatik tekrar veya ücretli fallback açılmadı.
- Yedekten ayrı API açılışında SQLite bütünlüğü ve 14 tablonun kayıt sayıları eşleşti; sağlık 200, girişsiz snapshot 401, prova API kapanışı başarılı. Normal API/runner PID'leri değişmedi, ikinci runner başlatılmadı. Yedekte cihaz/passkey kaydı yoktu; gerçek cihazla geri yükleme kabulü bu kanıta dahil değildir.

## Normal servislere son dağıtım

- Repo: [abdullahcekin/intRem](https://github.com/abdullahcekin/intRem)
- Uygulama commit'i: **`3f9f45232a95f28adfbcd01f8be8c98302a95b2f`**; [yayın CI kanıtı](https://github.com/abdullahcekin/intRem/actions/runs/34781762971). Rehber ve kısa ekran düzeltmesinde yalnız API yeniden başlatıldı; runner PID'si ve kaynak tmux pane PID'leri değişmedi. Temiz checkout, üretim derlemesi ve canlı 200/401 denetimleri geçti.
- Kapanış/plan çalışma zamanı değişiklikleri daha önce `ba43657` ile dağıtıldı. O dağıtımda bekleyen mesaj/karar/inceleme olmadığı doğrulandı; servisler durdurularak özel veri yedeği alındı ve SQLite bütünlüğü doğrulandı. Ardından temiz checkout fast-forward edildi ve üretim derlemesi geçti.
- Önceki çalışma zamanı dağıtımında API ve runner aynı kaynak/derleme üzerinden yeniden başlatıldı. İkisi active; sağlık 200, girişsiz API 401, runner heartbeat günceldi. Sonraki arayüz dağıtımlarında runner çalışması korundu.
- Son model açıklaması dağıtımında yalnız API yeniden başlatıldı; runner kodu değişmedi ve PID'si korundu. Son kontrolde aktif mesaj ve bekleyen/uygulanmamış karar sayıları sıfır.
- DNS A kaydı ve HTTPS reverse proxy etkinleştirildi. Geçerli Let's Encrypt sertifikasıyla TLS 1.3 bağlantısı, HTTP→HTTPS 308, HTTPS sağlık 200, girişsiz snapshot 401 ve tarayıcıda ilk cihaz ekranı doğrulandı. Caddy'nin özel ağdan API'ye erişimi dar güvenlik duvarı kuralıyla sağlandı; API portu internete açılmadı. Mevcut Caddy site blokları ve API/runner süreçleri korundu.
- Kaynak Claude/tmux pane PID'leri dağıtım öncesi ve sonrası eşleşti. API'yi tek başına yeniden başlatırken runner'ın korunması önceki pilotta ayrıca doğrulanmıştı.
- Ürün henüz tüm kabul koşullarıyla tamamlanmış değildir. Aşağıdaki açık işler geçerlidir.

## Uygulanmış ve doğrulanmış işler

| Alan | Kanıt ve kapsam | Takip |
| --- | --- | --- |
| Kalıcı proje/oturum/kuyruk/karar | SQLite, bağımsız süreç yarışı, nesil/içerik doğrulama, kesintide otomatik tekrar yok | [#1 kapalı](https://github.com/abdullahcekin/intRem/issues/1) |
| Kimlik ve cihaz erişimi | Passkey/WebAuthn, Origin/CSRF, cihaz iptalinde API ve açık SSE kesilmesi | [#2 kapalı](https://github.com/abdullahcekin/intRem/issues/2) |
| Mobil PWA ve kullanım rehberi | 320–1440 px; girişsiz `/info`, %200 büyütme/koyu tema; kısa ekranda erişilebilir kaydırma; soru yanıtı, çevrimdışı taslak, aynı kimlikle tekrar, klavye odağı ve bildirim tercihi | [#4 kapalı](https://github.com/abdullahcekin/intRem/issues/4), [#6 canlı kabul açık](https://github.com/abdullahcekin/intRem/issues/6) |
| Codex incelemesi | Kalıcı kuyruk, salt okunur çalıştırma, iptal/kesinti/değişmiş kod durumları; ayrı VDS Git pilotunda gerçek CLI tamamlandı | [#7 kapalı](https://github.com/abdullahcekin/intRem/issues/7) |
| Claude konuşma akışı | Gerçek mesaj, SDK geçmiş okuma ve restart sonrası aynı konuşmadan devam; kurulu runner üzerinde Sonnet soru callback'i tek kez uygulandı | [#3 kısmi](https://github.com/abdullahcekin/intRem/issues/3) |

Tarayıcı testi sanal WebAuthn cihazı kullanır. Gerçek telefon/passkey/push teslimi henüz doğrulanmadı. Codex özelliğinin pilotu, intRem kaynak kodunun bağımsız son incelemesi anlamına gelmez.

## Açık işler ve sıradaki adımlar

1. **[#3: Plan onayının dağıtım kabulü](https://github.com/abdullahcekin/intRem/issues/3).** Hook aktarımı ve ayrı Runner + Store canlı pilotu doğrulandı; bağımsız inceleme, yayın CI ve dağıtım tamamlandı. Kurulu runner'ın yeni plan pilotu haftalık sağlayıcı kotasında durdu. Kota veya hesap kurulumu çözüldüğünde yalnız bu eksik pilotu çalıştırın. Plan dosyası tahmin edilmez; CLI'nin hook'a eklediği snapshot kullanılır.
2. **[#8: Kapanış/kuyruk düzeltmeleri](https://github.com/abdullahcekin/intRem/issues/8) kapatıldı.** Tüketicisiz karar iptali, SDK tüketicisini bekleyen kapanış ve Codex süreç grubu iptali RED/GREEN ile doğrulandı. `unref` erken süreç çıkışı standalone Linux testiyle düzeltildi; bağımsız inceleme ve yayın CI geçti. **[#6: Yedekten API açılışı](https://github.com/abdullahcekin/intRem/issues/6)** ayrı dizinde geçti; gerçek cihazla geri yükleme ve uzun pilot açık.
3. **[#5: OmniRoute yönlendirmesi](https://github.com/abdullahcekin/intRem/issues/5).** Sağlık görünümü var; üç hesap zinciri, ayrı model havuzları, güvenilir hesap telemetrisi ve bütçeli fallback henüz tamamlanmadı. 2026-09-13 yeniden sayımında hesap/combo/eşleme sayıları sıfır. Kurulu 3.8.50 bütçe kontrolü atomik harcama rezervasyonu yapmıyor ve sıfır limit sınırsız anlamına geliyor; sert bütçe garantisi olarak kullanmayın, ücretli fallback kapalı kalmalı.
4. **[#6: Telefon kabulü](https://github.com/abdullahcekin/intRem/issues/6).** DNS ve HTTPS tamamlandı; fiziksel telefonda ilk passkey/PWA/push, gerçek cihazla geri yükleme ve uzun pilot açık. İlk cihaz ekranının açılması bu kabulün yerine geçmez.

Kullanıcıdan gereken kurulum adımları: ilk fiziksel cihazı bağlama, OmniRoute içinde hesapları bağlama ve günlük azami fallback bütçesini belirleme. Kimlik bilgilerini sohbet veya issue üzerinden istemeyin. Bütçe henüz verilmedi; ücretli fallback kapalı.

## Son inceleme ve sonraki somut adım

Son rehber/kısa ekran diff'inin bağımsız kaynak incelemesinde P1/P2 bulunmadı. İnceleme; public rota ile API korumasının ayrımını, kurulum/özellik metinlerini ve kaydırma regresyonunu kapsadı; testleri bağımsız olarak tekrar çalıştırmadı. Doğrulama yukarıdaki yayın CI'sı ve canlı tarayıcı kontrolüne dayanır.

Bağımsız inceleme kapanış değişikliklerinde ek bir bulgu buldu: `force.unref()` nedeniyle ana süreç ve stdio kapandığında runner SIGKILL aşamasını beklemeyebiliyordu. Zamanlayıcı ref bırakıldı; ayrı Linux süreç testinde önce beklenen başarısızlık, sonra başarı görüldü. Son hook aktarımı ve bu düzeltmenin yeniden bağımsız incelemesi tamamlandı; spec ve kod kalitesi uygun bulundu. Bu sonuç yayın CI'sı veya fiziksel telefon kabulünün yerine geçmez.

Sıradaki somut işler: HTTPS üzerinden kullanıcının ilk fiziksel cihazını bağlayıp PWA/push kabulünü yapmak; Claude hesabında kullanılabilir kapasite sağlandığında kurulu runner plan pilotunu tamamlamak. OmniRoute hesap/bütçe kurulumu ayrı kalır. Yerel `tasks/` altındaki test raporları ve özel pilot betikleri Git'e eklenmez; önceki tamamlanmış pilotları otomatik tekrarlamayın.

## Yeni oturumda devam etme

Kullanılabilecek başlangıç mesajı:

> Bu intRem projesine kaldığımız yerden devam et. Önce AGENTS.md ve docs/STATUS.md dosyalarını, varsa tasks/handoff.md ve tasks/todo.md dosyalarını oku. Git durumunu, son CI sonucunu ve açık issue'ları doğrula. Tamamlanmış işleri tekrar yapmadan sıradaki açık kabul koşulunu uygula ve test et. Mevcut değişiklikleri koru; sırları public repoya koyma.

Yerel dizin başka bilgisayarda yoksa repoyu klonlayın. Sunucu bağlantısı ve yerel `tasks/` notları Git ile taşınmaz; bunların ayrıca mevcut olması gerekir. Kullanıcı erişim yetkisini/SSH hedefini sağlamadan başka bir sunucu varsaymayın.

## Başvuru dosyaları

- [Uygulama sözleşmesi](implementation-contract.md): kapsam, kimlik, teslimat ve devir kuralları.
- [Kurulum ve işletim](deployment.md): environment, systemd, HTTPS ve yedekleme.
- [Arayüz kararları](design-system.md): mobil ekran ve etkileşim yaklaşımı.
- [README](../README.md): geliştirme ve test komutları.
- Yerel `tasks/todo.md`: ayrıntılı iş planı ve doğrulama kayıtları.
- Yerel `tasks/handoff.md`: sunucuya özel devam bilgileri; Git'e eklenmez.
