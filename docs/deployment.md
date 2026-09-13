# Ubuntu kurulumu

Claude Code ile giriş yapılmış normal kullanıcı hesabını kullanın. API ve runner ayrı kullanıcı servisleridir.

1. Repoyu `~/apps/intrem` altına alın. Node.js 22.13+ ile `npm ci && npm run build` çalıştırın.
2. `~/.config/intrem` ve `~/.local/share/intrem` dizinlerini 700 izinleriyle oluşturun. `deploy/env.example` dosyasını `~/.config/intrem/env` konumuna kopyalayın; gerçek kullanıcı, kök dizin ve HTTPS origin değerlerini girin. Dosya izni 600 olmalıdır. Proje kökleri JSON listesidir.
3. `deploy/intrem-api.service` ve `deploy/intrem-runner.service` dosyalarını `~/.config/systemd/user/` altına kopyalayın.
4. Aynı ortam değişkenlerini yükleyip `node dist/server/setup.js` çalıştırın. İlk cihaz için üretilen `bootstrap-token` dosyasını yalnız siz okuyun. Kod başarılı ilk kayıt sonrasında geçersizleşir.
5. `systemctl --user daemon-reload` ve `systemctl --user enable --now intrem-api intrem-runner` çalıştırın. SSH oturumu kapandıktan sonra devam etmeleri için yönetici `loginctl enable-linger KULLANICI` çalıştırmalıdır.
6. DNS A kaydını sunucuya yönlendirin. Caddy örneğini mevcut yapılandırmaya yeni site olarak ekleyin; önce doğrulayın, sonra reload edin. Caddy Docker içindeyse `127.0.0.1` konteynerin kendisidir: API'yi yalnız özel Docker köprü adresine bağlayın ve upstream olarak aynı adresi kullanın. API portunu internete açmayın.
7. HTTPS adresinde ilk passkey kaydını yapın. Proje ekleyin, pilot mesajını gönderin, bildirimleri cihazda ve ilgili projede ayrı ayrı etkinleştirin.

## İşletim

`systemctl --user status intrem-api intrem-runner` servis durumunu; `journalctl --user -u intrem-api -u intrem-runner` servis hatalarını gösterir. Logları paylaşmadan önce özel içeriği temizleyin. `/health` genel servis sağlığıdır; ayrıntılı `/api/health` giriş gerektirir.

API güncellemesi runner'ı yeniden başlatmayı gerektirmez. Runner güncellemesinden önce etkin işi bitirin veya arayüzden kontrollü durdurun. Beklenmeyen runner kesintisinde işlenmekte olan mesajlar belirsiz kabul edilir ve tekrar gönderilmez. Aynı SQLite deposunda ikinci runner çalıştırılması kilitle engellenir.

Yedekleme: iki servisi durdurun, veri dizininin tamamını (SQLite ve varsa WAL/SHM dosyaları dahil) erişimi sınırlı yedek konumuna kopyalayın ve servisleri açın. Yedek; passkey kayıtlarını, oturumları ve push sırlarını içerir. Geri yüklemede servisler kapalı olmalıdır; eski veri dizinini geri dönüş için koruyup yedeği ayrı dizine açın, dosya sahipliği/700-600 izinlerini doğrulayın ve `INTREM_DATA_DIR` ile o dizini seçin. Eski çalışan komutların otomatik tekrarına izin vermeyin.

### Yedekten açılış provası

Canlı servisleri durdurmadan prova yedeği almak için SQLite Online Backup API kullanılabilir (`sqlite3.Connection.backup`). Açık veritabanının yalnız ana dosyasını kopyalamayın; WAL içindeki kayıtlar eksik kalabilir. İlk cihaz kodu gibi veritabanı dışındaki kurulum dosyalarını da erişimi sınırlı yedeğe alın. Yedek ve geri yükleme dizinleri 700, dosyalar 600 olmalıdır.

Yedeği ikinci, ayrı bir prova dizinine kopyalayın. API açılmadan önce `PRAGMA integrity_check` sonucunun `ok` olduğunu ve tüm tablolardaki kayıt sayılarının yedekle eşleştiğini doğrulayın. Yedeğin kendisini koruyun; yalnız prova kopyasında cihaz push aboneliklerini ve proje bildirimlerini kapatın. Böylece eski olaylar gerçek cihazlara bildirim göndermez.

Prova için yalnız API'yi `127.0.0.1` üzerinde ayrı bir portta, prova veri dizini ve boş `INTREM_ALLOWED_ROOTS` listesiyle açın. `/health` 200 ve girişsiz `/api/snapshot` 401 dönmelidir. İkinci runner başlatmayın. API'yi kapatıp normal servislerin PID değerlerinin değişmediğini doğrulayın. Bu kontrol passkey ile gerçek giriş, fiziksel telefon kabulü veya runner üzerinden konuşmayı sürdürme kanıtı değildir.

2026-09-13 Ubuntu provası: SQLite bütünlüğü ve 14 tablonun kayıt sayıları eşleşti; API 200/401 kontrolleri geçti, prova API'si temiz kapandı ve normal API/runner PID değerleri değişmedi. Yedekte passkey/cihaz kaydı bulunmadığından bunların gerçek cihazla geri yükleme kabulü açık kaldı.

Son passkey iptal edilirse sunucu üzerinden setup komutuyla yeni kod oluşturulabilir. Alan adı değişirse passkey RP kimliği de değişir ve yeniden kayıt gerekir.
