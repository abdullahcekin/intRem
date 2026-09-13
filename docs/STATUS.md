# Durum ve devam rehberi

Son güncelleme: **2026-09-13**. Bu bir durum kaydıdır; yeni oturumda Git, CI ve sunucu durumunu tekrar doğrulayın.

## Son doğrulanmış çalışma

- Çalışma dalı: `fix/resume-lifecycle-validation`; temel HEAD/origin/main: **`fa1f5428417a265178641c683439499055ed282b`**. Bu oturumdaki kaynak değişiklikleri henüz commit edilmedi, push veya normal servislere dağıtım yapılmadı.
- Temel commit için [GitHub Actions başarılı](https://github.com/abdullahcekin/intRem/actions/runs/34763928605). Bu CI sonucu yeni çalışma ağacının kanıtı değildir.
- **2026-09-13, son kaynakla ayrı Ubuntu doğrulaması:** tip kontrolü, **59/59 test**, üretim derlemesi ve **13 Chromium akışı** başarılı. İki gerçek Linux alt süreç testi bu sayıya dahildir.
- Sonraki bağımsız kaynak incelemesi plan/kapanış değişikliklerini uygun buldu; yeni somut hata yok. Plan kartında metnin aynen gösterilmesi, açık kullanıcı teyidi ve eksik planın reddi eklendi; yerel Chromium kontrolü **15 akışla** geçti.
- Gerçek Sonnet/SDK plan pilotunda `PreToolUse` planı `ask + updatedInput` ile mevcut karar callback'ine taşındı. Ayrı veri deposundaki gerçek Runner + Store pilotu: `completed`, bir plan, bir uygulanmış karar; onay sonrası plan metni ve beklenen yanıt eşleşti. Normal systemd runner ve fiziksel telefon üzerinden yeni plan kabulü henüz yapılmadı.
- Yedekten ayrı API açılışında SQLite bütünlüğü ve 14 tablonun kayıt sayıları eşleşti; sağlık 200, girişsiz snapshot 401, prova API kapanışı başarılı. Normal API/runner PID'leri değişmedi, ikinci runner başlatılmadı. Yedekte cihaz/passkey kaydı yoktu; gerçek cihazla geri yükleme kabulü bu kanıta dahil değildir.

## Normal servislere son dağıtım

- Repo: [abdullahcekin/intRem](https://github.com/abdullahcekin/intRem)
- Uygulama commit'i: **`623d575db0612da4cb085ddfbb6f97f65fbfd13d`**.
- [GitHub Actions başarılı](https://github.com/abdullahcekin/intRem/actions/runs/34763293046): Node.js 22, tip kontrolü, **49 birim/entegrasyon testi**, üretim derlemesi ve Chromium akışları.
- Aynı uygulama sürümü Ubuntu pilotuna aktarıldı. Bu kontrol sırasında yerel ve VDS çalışma ağaçları temizdi.
- API ve runner ayrı systemd kullanıcı servisleri olarak çalışıyor. Sağlık isteği 200, girişsiz API isteği 401. API yeniden başlatılırken runner süreci korundu.
- Ürün henüz tüm kabul koşullarıyla tamamlanmış değildir. Aşağıdaki açık işler geçerlidir.

## Uygulanmış ve doğrulanmış işler

| Alan | Kanıt ve kapsam | Takip |
| --- | --- | --- |
| Kalıcı proje/oturum/kuyruk/karar | SQLite, bağımsız süreç yarışı, nesil/içerik doğrulama, kesintide otomatik tekrar yok | [#1 kapalı](https://github.com/abdullahcekin/intRem/issues/1) |
| Kimlik ve cihaz erişimi | Passkey/WebAuthn, Origin/CSRF, cihaz iptalinde API ve açık SSE kesilmesi | [#2 kapalı](https://github.com/abdullahcekin/intRem/issues/2) |
| Mobil PWA | 320–1440 px, soru yanıtı, çevrimdışı taslak, aynı kimlikle tekrar, klavye odağı ve bildirim tercihi | [#4 kapalı](https://github.com/abdullahcekin/intRem/issues/4) |
| Codex incelemesi | Kalıcı kuyruk, salt okunur çalıştırma, iptal/kesinti/değişmiş kod durumları; ayrı VDS Git pilotunda gerçek CLI tamamlandı | [#7 kapalı](https://github.com/abdullahcekin/intRem/issues/7) |
| Claude konuşma akışı | Gerçek mesaj, SDK geçmiş okuma ve restart sonrası aynı konuşmadan devam; kurulu runner üzerinde Sonnet soru callback'i tek kez uygulandı | [#3 kısmi](https://github.com/abdullahcekin/intRem/issues/3) |

Tarayıcı testi sanal WebAuthn cihazı kullanır. Gerçek telefon/passkey/push teslimi henüz doğrulanmadı. Codex özelliğinin pilotu, intRem kaynak kodunun bağımsız son incelemesi anlamına gelmez.

## Açık işler ve sıradaki adımlar

1. **[#3: Plan onayının dağıtım kabulü](https://github.com/abdullahcekin/intRem/issues/3).** Hook üzerinden somut plan aktarımı ve Runner + Store canlı pilotu doğrulandı. Eksik/değişmiş plan, eski nesil, iptal ve tek kullanımlık karar testleri geçti. Bağımsız kaynak incelemesi tamamlandı; yayın CI'sı ve normal systemd runner üzerinden kabulü açık. Plan dosyası tahmin edilmez; CLI'nin hook'a eklediği snapshot kullanılır.
2. **[#8: Kapanış/kuyruk düzeltmelerinin yayını](https://github.com/abdullahcekin/intRem/issues/8).** Tüketicisiz karar iptali, SDK tüketicisini bekleyen kapanış ve Codex süreç grubu iptali düzeltildi; regresyonlar RED/GREEN ile doğrulandı. Bağımsız review'da bulunan `unref` kaynaklı erken süreç çıkışı da standalone Linux testiyle düzeltildi. Son değişiklikler henüz GitHub CI veya normal servis dağıtımı görmedi. **[#6: Yedekten API açılışı](https://github.com/abdullahcekin/intRem/issues/6)** ayrı dizinde geçti; gerçek cihazla geri yükleme ve uzun pilot açık.
3. **[#5: OmniRoute yönlendirmesi](https://github.com/abdullahcekin/intRem/issues/5).** Sağlık görünümü var; üç hesap zinciri, ayrı model havuzları, güvenilir hesap telemetrisi ve bütçeli fallback henüz tamamlanmadı. 2026-09-13 yeniden sayımında hesap/combo/eşleme sayıları sıfır. Kurulu 3.8.50 bütçe kontrolü atomik harcama rezervasyonu yapmıyor ve sıfır limit sınırsız anlamına geliyor; sert bütçe garantisi olarak kullanmayın, ücretli fallback kapalı kalmalı.
4. **[#6: Alan adı ve telefon kabulü](https://github.com/abdullahcekin/intRem/issues/6).** DNS kaydı, HTTPS proxy aktivasyonu, fiziksel telefonda ilk passkey/PWA/push ve uzun pilot açık.

Kullanıcıdan gereken kurulum bilgileri: alan adı DNS kaydı, OmniRoute içinde hesapların bağlanması ve günlük azami fallback bütçesi. Kimlik bilgilerini sohbet veya issue üzerinden istemeyin. Bütçe henüz verilmedi; ücretli fallback kapalı.

## Son inceleme ve sonraki somut adım

Bağımsız inceleme kapanış değişikliklerinde ek bir bulgu buldu: `force.unref()` nedeniyle ana süreç ve stdio kapandığında runner SIGKILL aşamasını beklemeyebiliyordu. Zamanlayıcı ref bırakıldı; ayrı Linux süreç testinde önce beklenen başarısızlık, sonra başarı görüldü. Son hook aktarımı ve bu düzeltmenin yeniden bağımsız incelemesi tamamlandı; spec ve kod kalitesi uygun bulundu. Bu sonuç yayın CI'sı veya fiziksel telefon kabulünün yerine geçmez.

Sıradaki somut iş: commit/yayın CI kanıtını kaydedin ve etkin iş olmadığını doğrulayarak normal runner'a aktarın. Fiziksel telefon kabulü ile OmniRoute hesap/bütçe kurulumu ayrı kalır. Yerel `tasks/` altındaki test raporları ve pilot betikleri Git'e eklenmez; önceki tamamlanmış pilotları otomatik tekrarlamayın.

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
