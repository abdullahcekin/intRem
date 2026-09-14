# Durum ve devam rehberi

Son güncelleme: **2026-09-14**. Bu bir durum kaydıdır; yeni oturumda Git, CI ve sunucu durumunu tekrar doğrulayın.

## Son doğrulanmış çalışma

- Kaynak sürümü **`d505aa76628d3a3d6f46be29f2f7de0bdb51e5a9`**, `main` dalına yayınlandı ve normal API servisine dağıtıldı; runner ve kaynak tmux süreçleri korundu. Sonraki yalnız belge commit'leri için canlı Git/CI durumunu ayrıca kontrol edin.
- Bu kaynak sürümü için [main GitHub Actions başarılı](https://github.com/abdullahcekin/intRem/actions/runs/34823725378): Node.js 22, tip kontrolü, **145/145 test**, üretim derlemesi, **22 Chromium kontrolü** ve **6 geri yükleme kontrolü**. İki gerçek Linux alt süreç testi bu sayıya dahildir; Windows'ta 143 test geçti, bu iki test atlandı.
- Sistem ekranı kayıtlı hesap bağlantısı, model havuzu ve model-havuz eşleme toplamlarını, ayrı erişim durumlarını ve son kontrol zamanını gösterir. Başarısız okuma `null/bilinmiyor`, doğrulanmış boş liste `0` olur. Eşleme toplamı devre dışı kayıtları da içerir. Sunucu token'ı yalnız sabit üç GET yoluna gönderilir; hesap ayrıntıları/ham yanıtlar taşınmaz. Süre/boyut sınırı, yönlendirme yasağı, 30 saniye önbellek ve public/private sağlık ayrımı test edildi.
- OmniRoute 3.8.50'nin kurulu CLI/API sözleşmesiyle süreli, yalnız `read` kapsamlı erişim kuruldu. Secret 600 izinli ayrı ortam dosyasıyla yalnız API servisine verildi; runner ortamına taşınmadı. Üç yönetim GET'i 200, yazma ve token yönetimi erişimi 403. Canlı dağıtımın kendi okuyucusu **0 hesap bağlantısı, 0 havuz ve 0 eşleme** doğruladı. Hesap oluşturulmadı, model isteği gönderilmedi. Sayımlar kullanılabilir kota, doğru yönlendirme veya bütçe garantisi değildir.
- Eşleme backend regresyonları ve çevrimdışı açılış kontrolü önce başarısız, uygulama sonrası başarılı oldu. 320/375 px'de yetki/bilinmiyor ve 0/pozitif durumları test edildi, screenshotlar incelendi. Canlı `/info` içindeki güncel OmniRoute açıklaması açıldı; HTTPS sağlık/rehber 200, girişsiz ayrıntılı sağlık/snapshot 401.
- Çevrimdışı yeniden yüklemede sonsuz açılış yerine bağlantı açıklaması, kullanım rehberi ve yeniden deneme yolu gösterilir. Service worker uygulama kabuğunu saklar; özel API/sağlık yanıtları önbelleğe alınmaz. Ağ geri geldiğinde mevcut oturum açılır, mesaj tekrar gönderilmez. Tarayıcının çevrimiçi işareti gerçek ağ erişimini yansıtmadığında hata ekranı ve açık yeniden deneme yolu da doğrulandı.
- Yeni `npm run test:restore` ayrı API süreçleri ve sanal WebAuthn cihazıyla çalışır: 12 uygulama tablosu ve SQLite bütünlüğü eşleşir; bozuk cihaz anahtarı girişi reddeder; sağlam yedekte aynı passkey giriş yapar, imza sayacı ilerler, tüketilmiş kurulum kodu geçersiz kalır ve konuşma tekrar gönderilmeden açılır. CI'a eklendi. Bu otomatik prova fiziksel cihaz kabulü değildir.
- Sağlayıcı hataları SDK'nın açık enum alanlarından Türkçe neden/sonraki adım açıklamasına çevrilir ve mesajın mevcut hata kaydında korunur. Bilinen reddedilmiş kota penceresi ile türü belirsiz rate-limit ayrılır; yalnız bildirilen geçerli UTC yenilenme zamanı gösterilir. Ham SDK hata mesajı/result/errors içeriği teşhis veya normal yanıt olarak saklanmaz. Yeni mesaj, normal yanıt ve izin veren kota olayı eski kanıtı temizler; bağlantı kopmasındaki belirsiz teslimat sözleşmesi korunur.
- İlk genel hata regresyonları ve aynı turda eski hatanın kalması önce başarısız, düzeltme sonrası başarılı oldu. Ayrı Store bağlantısında kalıcılık/idempotency, sır işaretçilerinin mesaja/olaya sızmaması, mobil görünüm ve reload sonrası tekrar gönderilmemesi doğrulandı. Rehbere hata yardım maddesi eklendi ve canlı tarayıcıda açıldı. Bu teslimde gerçek sağlayıcı çağrısı yapılmadı; OmniRoute gateway hata eşliği ayrıca doğrulanmalıdır.
- Giriş yapmadan açılan `/info` kullanım rehberi eklendi; giriş ekranı ve üst çubuktan erişilir. Kurulum anahtarı, passkey, özellikler, kullanım adımları ve açık kapsamlar kaynakla doğrulandı. Anahtarın kendisi veya özel sunucu bilgisi sayfaya konmadı. Canlı HTTPS giriş ekranındaki bağlantıdan rehber açıldı; dış sağlık ve `/info` 200, girişsiz snapshot 401.
- Rehber 320–1440 px, 812×375 yatay ekran, %200 büyütme, koyu tema, klavye ile SSS ve en az 44 px etkileşim hedefleriyle doğrulandı. Kısa konuşma ekranında gizli üst öğenin programatik kaydırılması gerçek bir erişim sorunu saklıyordu; konuşmaya kullanıcı kaydırması eklenerek düzeltildi. 812×375 ve 390×400 kontrolleri gizli üst öğe kaydırmasını ve gönderme düğmesinin tıklama hedefini sınar. Fiziksel ekran klavyesi/PWA/push kabulü ayrı kalır.
- Bağımsız kaynak incelemesi plan/kapanış değişikliklerini uygun buldu. Pilot incelemesindeki iki P2 de karşılandı: son yanıt tam eşleşmeyle doğrulanıyor, runner pilotunun API/telefon kabulünden ayrı olduğu açıkça belirtiliyor. Plan kartı metni, açık kullanıcı teyidi ve eksik planın reddi tarayıcı testinde geçti.
- Oturum bilgisindeki model artık **Bildirilen son model** olarak gösteriliyor; görünür açıklama bu CLI kimliğinin OmniRoute model/hesap kanıtı olmadığını belirtiyor. Bilinmeyen/bildirilen değer ve kaydırmalı açıklama 375/812/1440 px genişliklerde doğrulandı; bağımsız dar inceleme uygun.
- Gerçek Sonnet/SDK plan pilotunda `PreToolUse` planı `ask + updatedInput` ile mevcut karar callback'ine taşındı. Ayrı veri deposundaki gerçek Runner + Store pilotu: `completed`, bir plan, bir uygulanmış karar; onay sonrası plan metni ve beklenen yanıt eşleşti. Önceki systemd runner pilotu haftalık limitte plan aşamasına ulaşmadan durdu ve kendi oturumu kapandı. Son salt okunur sağlayıcı kapasite kontrolünde güncel engel **beş saatlik kullanım penceresi**; eski haftalık limit kaydı güncel durum sayılmamalı. Normal servis plan kabulü ve fiziksel telefon kabulü açık; otomatik tekrar veya ücretli fallback açılmadı.
- Yedekten ayrı API açılışında SQLite bütünlüğü ve 14 tablonun kayıt sayıları eşleşti; sağlık 200, girişsiz snapshot 401, prova API kapanışı başarılı. Normal API/runner PID'leri değişmedi, ikinci runner başlatılmadı. Yedekte cihaz/passkey kaydı yoktu; gerçek cihazla geri yükleme kabulü bu kanıta dahil değildir.

## Normal servislere son dağıtım

- Repo: [abdullahcekin/intRem](https://github.com/abdullahcekin/intRem)
- Son API dağıtımı: **`d505aa76628d3a3d6f46be29f2f7de0bdb51e5a9`**; [yayın CI kanıtı](https://github.com/abdullahcekin/intRem/actions/runs/34823725378). Aktif mesaj/karar/inceleme sayıları sıfır doğrulandı ve API durduktan sonra yeniden denetlendi. Önceki derleme yedeklendi; temiz checkout fast-forward edildi ve build geçti. API yeniden başlatıldı; runner kodu değişmediği için PID'si korundu. İki servis active; iç/dış sağlık 200, rehber 200, girişsiz API 401. Kaynak tmux pane PID'leri değişmedi. Şema değişikliği yok.
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
| Sağlayıcı hata açıklamaları | SDK enumları, güvenli sabit metin, yalnız bildirilen kota/zaman, aynı mesaja bağlı kalıcılık ve mobil/reload kontrolü; gerçek gateway eşliği açık | [#5 kısmi](https://github.com/abdullahcekin/intRem/issues/5) |
| OmniRoute kurulum görünürlüğü | API'ye özel read erişimi; hesap/havuz/eşleme sayısı ve bilinmiyor ayrımı; canlı üç sayaç 0 | [#5 kısmi](https://github.com/abdullahcekin/intRem/issues/5) |
| Çevrimdışı açılış ve geri yükleme | Özel API önbelleği yok; yeniden bağlantıda tekrar gönderim yok; ayrı süreçlerde sağlam/bozuk sanal passkey yedeği | [#6 fiziksel kabul açık](https://github.com/abdullahcekin/intRem/issues/6) |

Tarayıcı testi sanal WebAuthn cihazı kullanır. Gerçek telefon/passkey/push teslimi henüz doğrulanmadı. Codex özelliğinin pilotu, intRem kaynak kodunun bağımsız son incelemesi anlamına gelmez.

## Açık işler ve sıradaki adımlar

1. **[#3: Plan onayının dağıtım kabulü](https://github.com/abdullahcekin/intRem/issues/3).** Hook aktarımı ve ayrı Runner + Store canlı pilotu doğrulandı; bu değişikliğin bağımsız incelemesi, yayın CI ve dağıtımı tamamlandı. Normal servis pilotu için son kapasite kontrolündeki beş saatlik sağlayıcı limiti sürüyor. Kapasite açıldığı gün yeniden salt okunur kontrol yapıp yalnız bu eksik pilotu çalıştırın. Plan dosyası tahmin edilmez; CLI'nin hook'a eklediği snapshot kullanılır.
2. **[#8: Kapanış/kuyruk düzeltmeleri](https://github.com/abdullahcekin/intRem/issues/8) kapatıldı.** Tüketicisiz karar iptali, SDK tüketicisini bekleyen kapanış ve Codex süreç grubu iptali RED/GREEN ile doğrulandı. `unref` erken süreç çıkışı standalone Linux testiyle düzeltildi; bağımsız inceleme ve yayın CI geçti. **[#6: Yedekten API açılışı](https://github.com/abdullahcekin/intRem/issues/6)** ayrı dizinde geçti; gerçek cihazla geri yükleme ve uzun pilot açık.
3. **[#5: OmniRoute yönlendirmesi](https://github.com/abdullahcekin/intRem/issues/5).** Sağlık, read token kurulumu, üç kurulum sayacı ve SDK üzerinden güvenli hata/kota açıklamaları uygulandı. Güncel canlı API envanteri hesap/havuz/eşleme için sıfır. Üç hesap zinciri, ayrı model havuzları, gerçek gateway hata eşliği, güvenilir hesap telemetrisi ve bütçeli fallback henüz tamamlanmadı; gerçek hesapların sahibinin OAuth bağlantısı gerekiyor. Kurulu 3.8.50 bütçe kontrolü atomik harcama rezervasyonu yapmıyor ve sıfır limit sınırsız anlamına geliyor; sert bütçe garantisi olarak kullanmayın, ücretli fallback kapalı kalmalı.
4. **[#6: Telefon kabulü](https://github.com/abdullahcekin/intRem/issues/6).** DNS, HTTPS, otomatik çevrimdışı/yeniden bağlantı ve sanal passkey ile ayrı süreçte geri yükleme tamamlandı. Fiziksel telefonda ilk passkey/PWA/push, gerçek cihazla geri yükleme ve kapasiteye bağlı uzun sağlayıcı pilotu açık. Sanal cihaz ve ilk cihaz ekranı bu kabulün yerine geçmez.

Kullanıcıdan gereken kurulum adımları: ilk fiziksel cihazı bağlama, OmniRoute içinde hesapları bağlama ve günlük azami fallback bütçesini belirleme. Kimlik bilgilerini sohbet veya issue üzerinden istemeyin. Bütçe henüz verilmedi; ücretli fallback kapalı.

## Son inceleme ve sonraki somut adım

Son eşleme/çevrimdışı/geri yükleme tesliminin kaynak/diff incelemesi ana ajan tarafından yapıldı. Paralel ajanlar araştırma ve ilk testlerden sonra durduğundan bu teslim için bağımsız final review kanıtı yoktur. Tip kontrolü, birim testleri, tarayıcı ve ayrı süreç geri yükleme testleri yayın CI'sında geçti; normal API dağıtımı ve canlı salt okunur kontroller yukarıda kayıtlıdır.

Son rehber/kısa ekran diff'inin bağımsız kaynak incelemesinde P1/P2 bulunmadı. İnceleme; public rota ile API korumasının ayrımını, kurulum/özellik metinlerini ve kaydırma regresyonunu kapsadı; testleri bağımsız olarak tekrar çalıştırmadı. Doğrulama yukarıdaki yayın CI'sı ve canlı tarayıcı kontrolüne dayanır.

Bağımsız inceleme kapanış değişikliklerinde ek bir bulgu buldu: `force.unref()` nedeniyle ana süreç ve stdio kapandığında runner SIGKILL aşamasını beklemeyebiliyordu. Zamanlayıcı ref bırakıldı; ayrı Linux süreç testinde önce beklenen başarısızlık, sonra başarı görüldü. Son hook aktarımı ve bu düzeltmenin yeniden bağımsız incelemesi tamamlandı; spec ve kod kalitesi uygun bulundu. Bu sonuç yayın CI'sı veya fiziksel telefon kabulünün yerine geçmez.

Sonraki somut adım: sağlayıcı kapasitesi yeniden salt okunur doğrulandığında #3 normal runner plan pilotunu tamamlamak. Diğer açık kabuller gerçek hesapların OAuth bağlantısına, fiziksel cihaza veya tanımlanmış bütçe ve sert harcama sınırına bağlıdır; bu bağımlılıklar olmadan entegrasyonu tamamlandı saymayın. Read token kurulumu ve eşleme görünürlüğü tamamlandı; token'ı tekrar oluşturmayın, süre dolduğunda [kurulum rehberindeki](deployment.md#omniroute-kurulum-görünürlüğü) yöntemle yenileyin. Yerel `tasks/` altındaki raporlar ve özel pilot betikleri Git'e eklenmez; önceki tamamlanmış pilotları otomatik tekrarlamayın.

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
