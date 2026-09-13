# Durum ve devam rehberi

Son güncelleme: **2026-09-13**. Bu bir durum kaydıdır; yeni oturumda Git, CI ve sunucu durumunu tekrar doğrulayın.

## Son doğrulanmış teslim

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

1. **[#3: Gerçek plan onayı](https://github.com/abdullahcekin/intRem/issues/3).** `ExitPlanMode` somut plan içeriğiyle onaya bağlanmalı; eksik/değişmiş plan reddedilmeli. Mevcut kod içerik yoksa kapalı kalır. Önce ayrı pilotta SDK callback'inin gerçekten verdiği alanları doğrulayın; plan dosyasını tahmin ederek seçmeyin.
2. **[#8: Kapanış/kuyruk düzeltmeleri](https://github.com/abdullahcekin/intRem/issues/8)** ve **[#6: Yedekten başlatma](https://github.com/abdullahcekin/intRem/issues/6).** Bağımsız kaynak incelemesi tamamlandı; tüketicisiz izin kaydı, SDK tüketicisini beklemeyen kapanış ve Codex alt süreç grubunun iptali için üç düzeltme açık. Yedek talimatı var; ayrı dizindeki yedekten API açma provası açık.
3. **[#5: OmniRoute yönlendirmesi](https://github.com/abdullahcekin/intRem/issues/5).** Sağlık görünümü var; üç hesap zinciri, ayrı model havuzları, güvenilir hesap telemetrisi ve bütçeli fallback henüz tamamlanmadı. 2026-09-13 yeniden sayımında hesap/combo/eşleme sayıları sıfır. Kurulu 3.8.50 bütçe kontrolü atomik harcama rezervasyonu yapmıyor ve sıfır limit sınırsız anlamına geliyor; sert bütçe garantisi olarak kullanmayın, ücretli fallback kapalı kalmalı.
4. **[#6: Alan adı ve telefon kabulü](https://github.com/abdullahcekin/intRem/issues/6).** DNS kaydı, HTTPS proxy aktivasyonu, fiziksel telefonda ilk passkey/PWA/push ve uzun pilot açık.

Kullanıcıdan gereken kurulum bilgileri: alan adı DNS kaydı, OmniRoute içinde hesapların bağlanması ve günlük azami fallback bütçesi. Kimlik bilgilerini sohbet veya issue üzerinden istemeyin. Bütçe henüz verilmedi; ücretli fallback kapalı.

## Bu güncelleme sırasında devam eden çalışma

Paralel çalışma: plan onayı ve runner/Store kapanış regresyonları bir ajanda, Codex alt süreç grubu düzeltmesi diğer ajanda. Bağımsız kaynak incelemesi tamamlandı; üç bulgu #8'de. OmniRoute sözleşme analizi hesapların kurulmadığını ve mevcut bütçe kontrolünün sert sınır sağlamadığını doğruladı. Ana ajan yedekten başlatma provasını hazırlıyor. **Düzeltmeler ve canlı kabul henüz tamamlandı sayılmıyor.** Kesinti olursa `git status` ile ajanların bıraktığı dosyaları kontrol edin; doğrudan yeniden üretmeyin veya silmeyin.

Önceki ajanlar kota hatasıyla durmuştu; sonraki kontrolde kullanım tekrar mümkündü ve yeni ajanlar başlatıldı. Yeni oturumda eski hata durumunu güncel kota bilgisi sanmayın.

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
