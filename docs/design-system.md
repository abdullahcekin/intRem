# intRem tasarım sistemi

Tarih: 12 Eylül 2026. Durum: uygulama için tasarım kararı; çalışan arayüz veya tamamlanmış erişilebilirlik denetimi değildir.

## 1. Ürün ve tasarım yönü

intRem, tek kullanıcının bir VDS üzerindeki farklı projelerde çalışan kodlama ajanlarını telefondan izlemesini ve güvenle yönlendirmesini sağlar. Hem intRem tarafından başlatılan hem mevcut oturumdan devralınan çalışma biçimi desteklenir. Kullanıcı önce kendisini bekleyen işi, sonra hedef projeyi ve işlemin sonucunu anlayabilmelidir.

Mobil öncelikli, sade ve işlevsel bir kontrol arayüzü kullanılır. Geniş renk blokları, dekoratif grafikler, pazarlama başlığı, cam efektleri ve sürekli animasyon kullanılmaz. Yoğun teknik bilgi ayrıntıda açılır; proje kimliği, kritik durum ve teslimat sonucu görünür kalır. Arayüz Türkçedir; model, araç, dosya ve oturum kimlikleri kaynakta göründüğü biçimi korur.

Kaynak: `Claude_Code_Uzak_Erisim_ve_Model_Yonlendirme_Cozum_Mimarisi_Guncel.docx`, özellikle §5, §6 ve §13. Kullanıcının ek kararı: tek VDS üzerinde çok proje; yeni yönetilen oturumlar ve mevcut oturumların devralınması birlikte desteklenecek.

## 2. Gezinme ve yerleşim

Mobilde liste ve yönetim ekranlarının alt gezinmesi tam dört hedef içerir. Oturum açıldığında genel üst çubuk ve alt gezinme gizlenir; geri oku listeye ve gezinmeye döndürür. Her gezinme hedefinde SVG simgesi ve görünür Türkçe etiket bulunur.

| Hedef | İçerik | Öncelikli eylem |
| --- | --- | --- |
| Oturumlar | Projeler ve oturumlar; seçilince konuşma ve model ayrıntısı | Oturumu aç |
| Bekleyenler | Soru, araç izni ve plan kararı kartları | İlgili kartı aç |
| Sağlık | Bridge, Claude süreci, bağlantı ve son ilerleme | Sorunun ayrıntısını aç |
| Ayarlar | Cihaz kurulumu, bildirim, tema ve proje profilleri | İlgili ayarı düzenle |

- 320–767 px: tek sütun. Liste ve ayrıntı ayrı görünür; geri dönüş liste konumunu ve filtresini korur. Kenar boşluğu 16 px; 320 px genişlikte 12 px kullanılabilir.
- 768–1023 px: okunabilir genişlik korunur; kartlar bir veya iki sütun olabilir. Mesaj ve izin içeriği tek okuma sütununda kalır.
- 1024 px ve üzeri: solda 280–320 px oturum listesi, sağda seçili oturum ayrıntısı bulunan master/detail düzeni. Ana gezinme sol bölüme taşınır. Konuşma sütunu yaklaşık 760 px ile sınırlanır.
- Mobil alt çubuk yalnız liste/yönetim ekranlarında yer tutar. Konuşmada kompakt başlık, kalan yüksekliği alan mesajlar ve görünür composer kullanılır; sanal klavye için Visual Viewport izlenir, cihazın alt güvenli alanı korunur.
- Masaüstü ana gezinme ve oturum listesi bağımsız gizlenebilir. Odak modu her iki paneli, genel başlığı ve composer'ı gizler; konuşma ekranı kaplar. “Mesaj yaz” composer'ı geri açar, “Mesaj alanını gizle” tekrar kapatır. Taslak ve seçili oturum korunur; “Odaktan çık” önceki panel durumlarını geri getirir.
- Sıralama: önce cevap bekleyen işler, ardından çalışan oturumlar ve diğerleri. Durum değişince odaktaki veya dokunulmakta olan satır aniden taşınmaz; güncellenen sıralama odak kaybettirmeden uygulanır.

## 3. Güvenli oturum başlığı

Normal konuşma başlığı proje, oturum adı ve durumla sınırlıdır. Host, çalışma dizini, tam kimlikler, model/maliyet ve Codex incelemesi “Oturum bilgisi” penceresinde açılır. Uzun adlar başlıkta kısalır, pencerede tam gösterilir. Karar ve kontrollü devir pencerelerinde tam hedef bilgisi korunur ve kopyalanabilir. Odak modunda başlık gizlenir; bu, gönderim veya devir yetkilerini değiştirmez.

Oturumun kaynağı “intRem ile başlatıldı” veya “Mevcut oturumdan devralındı” etiketiyle gösterilir. Bu etiket kontrol yetkisinin kanıtı değildir. Doğrulanmış yetenekler ayrıca gösterilir: “Mesaj gönderebilir”, “İzin yanıtlayabilir” veya “Yalnız izleme”. Yetenek ya da süreç/pane hedefi doğrulanamıyorsa ilgili eylem kapalıdır ve nedeni yazılır.

Proje değiştirmek açık bir kullanıcı eylemidir. Taslaklar oturum kimliğine bağlıdır; başka projeye taşınmaz. Yeni olay, push veya sıralama değişikliği mesaj kutusunun hedefini değiştiremez. Derin bağlantı yetki doğrulandıktan sonra doğru oturumdaki ilgili karta açılır.

## 4. Ekran ve bileşen kararları

### Oturum listesi

Satırda proje adı, son iş özeti, okunabilir durum etiketi, son güncelleme zamanı ve bekleyen iş sayısı bulunur. İkincil satırda host ve oturum kaynağı yer alır. “Çalışıyor”, “Cevabınızı bekliyor”, “Hazır”, “Çevrimdışı” ve “Durum doğrulanamadı” durumları metin ve simgeyle ayrılır. Yeşil nokta tek başına başarı göstergesi değildir.

Boş durumda “Henüz oturum yok” açıklamasıyla “Yeni oturum başlat” ve “Mevcut oturumu bağla” ayrı seçeneklerdir. Bağlanma ekranında proje, izinli çalışma dizini ve bulunan hedef kullanıcıya gösterilir; doğrulanamayan oturum başarılı bağlanmış gibi sunulmaz.

### Konuşma ve mesaj gönderimi

Zaman çizelgesi kullanıcı mesajı, tamamlanan ajan yanıtı, soru, izin kararı, model geçişi ve Codex inceleme sonucunu ayrı türlerde gösterir. Gövde metni okunabilir genişlikte kalır; komut ve kod alanı kendi içinde kayabilir. Tüm sayfa yatay kaymaz. Yeni olay odak çalmaz; kullanıcı yukarıdaysa “Yeni olaylar” düğmesi görünür.

Mesaj kutusunun üstünde hedef proje ve oturumun giriş durumu yer alır. Gönderilen mesaj için “Sırada”, “İletildi”, “İşleniyor”, “Tamamlandı”, “Başarısız” veya “Teslimat belirsiz” açıklaması gösterilir. Sunucu yanıtı gelmeden “İletildi” denmez. Süreç/pane veya güvenli giriş durumu belirsizse metin terminale gönderilmez.

“Teslimat belirsiz” kartı hangi mesajın etkilendiğini açıklar; otomatik yeniden gönderim veya tek dokunuşla kör tekrar sunulmaz. Kullanıcı önce oturumu kontrol eder. Çevrimdışı mesaj taslakta kalır; bağlantı geri gelince otomatik gönderilmez. Yeniden eşitleme tamamlanana kadar geçerli durum bilinmiyorsa gönderim ve karar eylemleri bekletilir.

“Durum raporu iste” ajana yeni mesaj gönderir ve bu etkisi düğmenin yanında açıklanır. “Sağlığı yenile” kayıtlı durumları günceller; ajanı çalıştırmaz. Kod yazılması, test sonucu ve inceleme sonucu farklı olaylardır; biri diğerinin tamamlandığı anlamına gelmez.

### Bekleyen soru, izin ve plan kartları

Her kartta proje/host, istek türü, tam istek içeriği, araç ve hedef varsa bunlar, çalışma dizini, oluşturulma zamanı ve güncel karar durumu görünür. Soru seçenekleri soru kartında; araç yetkisi ise ayrı izin kartında sunulur. Gizli içeriğin maskelendiği alan anlaşılır biçimde işaretlenir.

Araç izninde “Bu isteği onayla” ve “Reddet” açık etiketleri kullanılır. Plan için “Planın bu sürümünü kabul et” ayrı eylemdir; araç izni verdiği izlenimi oluşturmaz. Toplu onay, varsayılan onay veya klavye odağını doğrudan onay düğmesine taşıma yoktur. Ajanı durdurma gibi etkili işlemler ayrı doğrulama ekranında hedefi ve etkiyi açıklar.

Gönderim sırasında kart “Karar gönderiliyor” olur ve tekrar basma engellenir. Başka cihazdan karar geldiğinde sunucunun sonucu gösterilir. Süresi geçmiş, araç/hedef/içerik sürümü değişmiş veya eski süreç nesline ait kart pasifleşir ve nedeni görünür olur. Arayüzdeki pasifleştirme tek başına güvenlik kontrolü değildir; kararın geçerliliği sunucuda doğrulanır.

### Model ve kullanım görünümü

Oturum ayrıntısında istenen model, doğrulanmış gerçek model/sağlayıcı ve hesap etiketi ayrı alanlardır. Ana ajan ve alt ajan bilgisi ilişkilendirildiği istekle gösterilir; tek isteğin bilgisi tüm oturumun değişmez özelliği gibi sunulmaz. Ölçüm zamanı görünürdür; kanıt yoksa “Bilinmiyor”, eski ölçüm varsa son doğrulama zamanı yazılır.

DeepSeek geçişi sarı uyarı, açık sağlayıcı adı ve geçiş nedeni içerir. Ücret, kota ve bağlam kullanımı yalnız ölçüm varsa gösterilir; ölçülmeyen değer sıfır veya sınırsız yazılmaz. Harcama limiti uygulanamıyor ya da maliyet gecikiyorsa bunun durumu görünürdür. Hesap erişim anahtarları veya token içerikleri arayüzde bulunmaz.

### Sağlık ve cihaz kurulumu

Bridge bağlantısı, Claude süreci, hedef doğrulaması, olay akışı ve son görev ilerlemesi ayrı satırlardır. Son kontrolün zamanı gösterilir. Uzun sessizlik “İlerleme bilgisi güncel değil” uyarısı üretir; otomatik restart, Ctrl+C veya bağlam temizleme eylemi oluşturmaz. “Uzaktan komut kabulünü durdur” ve “Çalışan ajanı durdur” farklı etkileri açıklanan ayrı işlemlerdir.

Cihaz kurulumu ekranında kurulum durumu, bildirim izni, test bildirimi, son bağlantı ve cihaz iptali bulunur. Desteklenmeyen tarayıcı veya reddedilmiş izin, başarısız kurulum gibi gösterilmez; uygulama içi kartlar kullanılabilir. Test bildiriminin gönderilmesi, cihaza teslim kanıtı olarak sunulmaz. Push metni varsayılan olarak kod, komut veya sır içermez. Push kararı kaydetmez; kart uygulamada kalır.

## 5. Tema ve renk değişkenleri

İlk açılışta sistem teması izlenir; kullanıcı “Sistem”, “Açık” veya “Koyu” seçebilir. Tema değişimi bekleyen kararları ve taslakları etkilemez. Renkler anlamsal değişkenler üzerinden kullanılır; başarı, uyarı ve hata renkleri marka rengi yerine geçmez.

| Değişken | Açık tema | Koyu tema |
| --- | --- | --- |
| `background` | `#F8FAFC` | `#0B1120` |
| `surface` | `#FFFFFF` | `#111827` |
| `surface-raised` | `#F1F5F9` | `#1E293B` |
| `text` | `#0F172A` | `#F8FAFC` |
| `text-muted` | `#475569` | `#CBD5E1` |
| `border-control` | `#64748B` | `#64748B` |
| `primary` / `focus` | `#1D4ED8` | `#93C5FD` |
| `on-primary` | `#FFFFFF` | `#0B1120` |
| `success-text` / `success-bg` | `#166534` / `#F0FDF4` | `#86EFAC` / `#052E16` |
| `warning-text` / `warning-bg` | `#92400E` / `#FFFBEB` | `#FDE68A` / `#451A03` |
| `danger-text` / `danger-bg` | `#B91C1C` / `#FEF2F2` | `#FCA5A5` / `#450A0A` |
| `info-text` / `info-bg` | `#1D4ED8` / `#EFF6FF` | `#93C5FD` / `#172554` |

Belirlenen opak renk çiftlerinin sRGB bağıl parlaklık hesabı: açık/koyu ana metin–yüzey 17,85:1 / 16,96:1; ikincil metin–yükseltilmiş yüzey 6,92:1 / 9,85:1; birincil düğme metni–zemini 6,70:1 / 10,44:1; kontrol sınırı–yükseltilmiş yüzey 4,34:1 / 3,07:1. Durum metni–kendi zemini çiftlerinin en düşük oranı 5,91:1'dir. Saydamlık veya farklı zeminle kullanımda bu sonuçlar geçerli kabul edilmez; yeniden ölçülür.

Hedef, normal metinde en az 4,5:1; büyük metinde ve gerekli kontrol/fokus ayrımında en az 3:1 kontrasttır. Renk hesaplarının geçmesi bütün arayüzün WCAG uyumunu kanıtlamaz; gerçek bileşenler ve etkileşimler ayrıca denetlenir.

## 6. Tipografi, boşluk ve etkileşim

- Gövde: `system-ui`, `Segoe UI`, sans-serif; 16 px, satır yüksekliği 1,5. Başlıklar 20–24 px ve 600 ağırlık. Meta bilgiler en az 13 px; karar metni ve form girdisi küçültülmez. Türkçe karakterler iki temada kontrol edilir.
- Kod ve kimlikler: `ui-monospace`, `Cascadia Code`, `Consolas`, monospace. Uzun açıklamalar monospace yapılmaz. Başlangıç sürümü harici font indirmesine bağımlı olmaz.
- Boşluk ölçeği: 4, 8, 12, 16, 24, 32 px. Kart içi boşluk 16 px, köşe yarıçapı 10–12 px. Kontroller en az 44 × 44 CSS px; birincil mobil eylemler en az 48 px yüksekliktedir. Yakın eylemler arasında en az 8 px boşluk bulunur.
- Tek bir SVG simge ailesi kullanılır; normal simge 20 veya 24 px olabilir, dokunma alanı küçülmez. Simge düğmelerinin erişilebilir adı vardır. Tıklanabilir alan ve devre dışı durum görsel olarak anlaşılırdır.
- Klavye ile tüm eylemlere erişilir. Fokus göstergesi görünürdür; en az 2 px halka ve çevreden ayrışan aralık kullanılır. Açılır pencere odağı yönetir, kapandığında başlatan öğeye döndürür; sabit başlık veya alt çubuk odaktaki öğeyi örtmez.
- Renk/geçiş animasyonları 150–200 ms ile sınırlıdır. `prefers-reduced-motion: reduce` durumunda hareket, otomatik kaydırma ve dekoratif animasyon kaldırılır. Yeni olaylar bütün zaman çizelgesini ekran okuyucuya tekrar okutmaz; kısa durum güncellemeleri nazik canlı bölgede duyurulur.
- Hata mesajı sorunlu alanla ilişkilendirilir ve çözümü açıklar. “Bir hata oluştu” tek başına yeterli değildir. Boş, yükleniyor, çevrimdışı, yeniden eşitleniyor, erişim iptal edildi ve kısmi veri durumları ayrı tasarlanır.

## 7. Uygulama kabul listesi

- [ ] Açık ve koyu temada 320, 375, 768, 1024 ve 1440 px görünüm; yatay sayfa taşması ve içerik örtülmesi yok.
- [ ] %200 metin büyütmede ve 320 CSS px etkin görünümde hedef başlığı, kartlar, gezinme ve eylemler kullanılabilir.
- [ ] Bütün dokunma hedefleri en az 44 × 44 px; mobil klavye açıkken mesaj kutusu ve gönderim durumu erişilebilir.
- [ ] Klavye odağı, ekran okuyucu etiketleri, canlı güncellemeler ve reduced-motion davranışı gerçek tarayıcıda doğrulandı.
- [ ] İki temanın normal, hover, focus, seçili, hata ve yükleniyor durumlarında kontrast ölçüldü; bilgi yalnız renkle aktarılmıyor.
- [ ] Proje geçişi, push derin bağlantısı ve yeniden bağlanma yanlış oturuma taslak ya da karar taşımıyor.
- [ ] İki cihazdan yarışan karar, değişmiş izin ve eski süreç kartı tek sunucu sonucuyla tutarlı gösteriliyor.
- [ ] Belirsiz teslimat tekrar tetiklenmiyor; çevrimdışı taslak ve kararlar bağlantı gelince kendiliğinden gönderilmiyor.
- [ ] Ölçülmeyen model, maliyet, kota ve sağlık bilgisi başarılı veya sıfır değer olarak sunulmuyor.
- [ ] Bildirim izni kapalı cihazda bekleyen iş kartlarına erişiliyor; gönderilmiş test push'u teslim edilmiş sayılmıyor.

## 8. UI UX Pro Max uygulama kaydı

UI UX Pro Max tasarım araştırması mobil uzaktan ajan kontrolü ve sade operasyon ekranı üzerine uygulandı. Mavi vurgu, okunabilir durum ayrımları, 44 px etkileşim hedefleri, görünür fokus ve reduced-motion desteği benimsendi. Tipografi sistem yazı tiplerini kullanır; harici font isteği yapılmaz.

Öneri motorunun pazarlama odaklı hero/CTA düzeni, ilk sorgudaki canlı blok stili, tüm metinde monospace ve yoğun dashboard dolgusu ürünün kullanımına alınmadı. Mobilde öncelikli iş kartları, masaüstünde master/detail ve Türkçe sistem yazı tipi seçildi. `html-tailwind` araması yalnız yerleşim ve erişilebilirlik rehberi olarak kullanıldı; uygulamanın framework veya CSS altyapısını belirlemez. Yukarıdaki kontrast değerleri bu dosya için hesaplandı; tarayıcı veya cihaz testi henüz yapılmadı.
