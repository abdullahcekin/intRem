import { useEffect } from 'react';
import { ArrowRight, Bell, BookOpen, Check, Fingerprint, FolderOpen, MessageSquare, ShieldCheck, Smartphone } from 'lucide-react';
import './info.css';

const features = [
  { icon: FolderOpen, title: 'Projeler ve oturumlar', text: 'Sunucunuzdaki izin verilen proje klasörlerini ekleyin. Claude oturumu başlatın, konuşmayı izleyin ve mesaj gönderin.' },
  { icon: MessageSquare, title: 'Sorular, izinler ve planlar', text: 'Bekleyenler ekranından soruları yanıtlayın. Araç izinlerini ve içeriğini okuyabildiğiniz planları ayrı ayrı onaylayın veya reddedin.' },
  { icon: ShieldCheck, title: 'Kontrollü devir ve inceleme', text: 'Mevcut konuşmaları izleyin; uygun duruma geldiklerinde yönetimi devralın. Codex ile kod incelemesi isteyin ve sonucu okuyun.' },
  { icon: Bell, title: 'Bildirimler ve bağlantı durumu', text: 'Cihaz ve proje bazında bildirim tercihlerini yönetin. Sistem ekranından çalıştırıcının ve bağlı servislerin durumunu izleyin.' },
  { icon: Fingerprint, title: 'Passkey ile erişim', text: 'Cihazınızın desteklediği parmak izi, yüz tanıma veya ekran kilidiyle giriş yapın. Ayarlar’dan anahtar ekleyin veya erişimini iptal edin.' },
  { icon: Smartphone, title: 'Mobil kullanım ve taslaklar', text: 'Telefon, tablet ve bilgisayardan çalışın. Çevrimdışıyken mesaj taslağınız bu tarayıcıda kalır; bağlantı gelince gönderimi siz başlatırsınız.' },
];

export function InfoPage() {
  useEffect(() => {
    document.title = 'Kullanım rehberi · intRem';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const theme = localStorage.getItem('intrem:theme') || 'system';
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, []);

  return <div className="info-page">
    <a className="skip-link" href="#info-content">İçeriğe geç</a>
    <header className="info-header">
      <a className="info-brand" href="/" aria-label="intRem uygulamasını aç"><BookOpen size={24} aria-hidden="true" /><strong>intRem</strong><span>Rehber</span></a>
      <a className="button primary" href="/">Uygulamayı aç<ArrowRight size={18} aria-hidden="true" /></a>
    </header>
    <main id="info-content" className="info-content" tabIndex={-1}>
      <section className="info-intro" aria-labelledby="info-title">
        <p className="eyebrow">KURULUM VE KULLANIM</p>
        <h1 id="info-title">intRem kullanım rehberi</h1>
        <p>Sunucunuzdaki Claude Code çalışmalarını telefonunuzdan takip edin. Mesajlar, bekleyen sorular ve onaylar tek yerde.</p>
        <p className="hint">intRem, tek kullanıcının kendi Linux sunucusunda birden fazla projeyi yönetmesi için geliştirilir.</p>
      </section>
      <nav className="info-toc" aria-label="Rehber bölümleri">
        <a href="#kurulum">İlk kurulum</a><a href="#ozellikler">Özellikler</a><a href="#kullanim">Günlük kullanım</a><a href="#yardim">Sık sorulanlar</a>
      </nav>

      <section id="kurulum" className="info-section" aria-labelledby="setup-title">
        <p className="eyebrow">01 / İLK BAĞLANTI</p>
        <h2 id="setup-title">Kurulum anahtarı nedir?</h2>
        <p>İlk passkey’i oluşturmanıza izin veren, tek kullanımlık bir koddur. Sunucu kurulurken üretilir. İlk başarılı kayıttan sonra geçersiz olur; sonraki girişlerde passkey kullanırsınız.</p>
        <aside className="info-callout">
          <Fingerprint size={24} aria-hidden="true" />
          <div><h3>Anahtarı nereden alacağım?</h3><p>intRem sunucusunu kuran yöneticiden güvenli bir kanalla alın. Sunucuyu siz kurduysanız kurulum komutunun gösterdiği <code>bootstrap-token</code> dosyasında bulunur. Bu kodu yalnız kendi intRem adresinizin ilk kayıt ekranına girin; paylaşılabilir belgelere veya ekran görüntülerine eklemeyin.</p></div>
        </aside>
        <ol className="info-steps">
          <li><h3>Güvenli adresi açın</h3><p>intRem’in HTTPS adresini, passkey destekleyen tarayıcınızda açın. “İlk cihazınızı bağlayın” ekranında cihazınıza tanıyacağınız bir ad verin.</p></li>
          <li><h3>Anahtarı girip passkey oluşturun</h3><p>Kurulum anahtarını yapıştırın ve “Passkey oluştur ve bağlan” düğmesine dokunun. Tarayıcınızın açtığı cihaz doğrulamasını tamamlayın.</p></li>
          <li><h3>Sonraki girişlerde passkey kullanın</h3><p>“Passkey ile giriş yap” düğmesini seçin. Anahtarlarınızı giriş yaptıktan sonra Ayarlar’dan yönetebilirsiniz.</p></li>
        </ol>
      </section>

      <section id="ozellikler" className="info-section" aria-labelledby="features-title">
        <p className="eyebrow">02 / ÖZELLİKLER</p>
        <h2 id="features-title">intRem ile neler yapabilirsiniz?</h2>
        <div className="info-features">{features.map(({ icon: Icon, title, text }) => <article key={title}>
          <Icon size={23} aria-hidden="true" /><div><h3>{title}</h3><p>{text}</p></div>
        </article>)}</div>
        <div className="info-status"><h3>Geliştirme sürümünün sınırları</h3><p>Bildirimlerin fiziksel telefona teslimi ve ana ekrana ekleme deneyimi için cihaz kabulü sürüyor. OmniRoute hesap havuzu ve bütçeli model geçişi henüz hazır değil; ücretli fallback kapalı. Gösterilen model kimliği Claude yanıtından gelir, kullanılan gateway hesabını doğrulamaz.</p></div>
      </section>

      <section id="kullanim" className="info-section" aria-labelledby="usage-title">
        <p className="eyebrow">03 / GÜNLÜK KULLANIM</p>
        <h2 id="usage-title">İlk çalışmanızı başlatın</h2>
        <ol className="info-steps">
          <li><h3>Projenizi ekleyin</h3><p>Oturumlar ekranında proje ekleyin. Klasör yolu, intRem’in çalıştığı sunucuda bulunmalı ve yöneticinin izin verdiği köklerden birinin altında olmalıdır.</p></li>
          <li><h3>Bir oturum seçin veya başlatın</h3><p>Konuşmayı açın ve mesajınızı gönderin. Göndermeden önce seçili proje ve oturum adını kontrol edin. Mevcut kaynak oturum aktifse izleyin; kontrollü devir için uygun durumu bekleyin.</p></li>
          <li><h3>Bekleyen kararları yanıtlayın</h3><p>Bekleyenler ekranında soruyu, araç isteğini veya plan içeriğini okuyun. Kararınız yalnız ilgili istek için geçerlidir. Plan içeriği alınamıyorsa onay verilemez.</p></li>
          <li><h3>Tercihlerinizi düzenleyin</h3><p>Ayarlar’dan görünümü, anahtarları ve bildirim tercihlerini yönetin. Uzaktan yeni komut kabulünü duraklatabilirsiniz; çalışan ajanlar çalışmaya devam edebilir.</p></li>
        </ol>
        <p className="info-note"><Check size={20} aria-hidden="true" /><span>Bir mesajın teslimi belirsizse otomatik olarak tekrar gönderilmez. Önce oturumdaki son durumu kontrol edin.</span></p>
      </section>

      <section id="yardim" className="info-section info-faq" aria-labelledby="help-title">
        <p className="eyebrow">04 / YARDIM</p>
        <h2 id="help-title">Sık sorulanlar</h2>
        <details><summary>Maliyet tahmini neyi gösteriyor?</summary><p>Oturum bilgisi bölümünde Claude’un son başarılı sonuçta bildirdiği ABD doları tahmini ve bildirim zamanı gösterilir. Bu sayaç çalışma süresince birikir; yeniden başlatmada veya sıfırlandığında düşebilir. Sonuçlar birbirine eklenmez. Eksik ya da hatalı sonuç “Bilinmiyor” görünür; çok küçük pozitif tutarlar sıfır olarak yuvarlanmaz. Devralınan geçmiş ve süren işler dahil olmayabilir. Bu değer toplam oturum harcaması, sağlayıcı faturası veya bütçe sınırı değildir; ücretli model geçişini etkinleştirmez.</p></details>
        <details><summary>Sistemdeki OmniRoute bilgileri ne anlama geliyor?</summary><p>“Erişilebilir” yalnız gateway bağlantısının yanıt verdiğini gösterir. Kurulum bölümündeki hesap bağlantısı, model havuzu ve model-havuz eşleme sayıları kayıtlı yapılandırmayı gösterir. Eşleme toplamı devre dışı kayıtları da içerir. “0” doğrulanmış boş kayıt demektir; “Bilinmiyor” veya “Yetki gerekiyor” görünüyorsa sayı okunamamıştır. Sunucu yöneticisi salt okunur erişimi kontrol etmelidir. Son kontrol zamanını dikkate alın; kayıt sayıları kullanılabilir kota, doğru yönlendirme veya bir istekte gerçekten kullanılan hesabın kanıtı değildir.</p></details>
        <details><summary>Bir çalışma hatayla durursa ne yapmalıyım?</summary><p>İlgili mesajın altındaki açıklamayı okuyun. Sağlayıcının bildirdiği kimlik, hesap, faturalandırma, istek sınırı veya servis hatasına göre sonraki adım gösterilir. Kota penceresi açıkça bildirilmişse türü ve varsa UTC yenilenme zamanı yazılır; bu zaman yeniden erişim garantisi değildir. Hız sınırı ile kota ayrımı veya hata nedeni bilinmiyorsa açıkça belirtilir. Önceki işlemlerin kısmi etkileri olabilir; devam etmeden önce son durumu kontrol edin.</p></details>
        <details><summary>Kurulum anahtarı kabul edilmiyorsa ne yapmalıyım?</summary><p>Kodu eksiksiz kopyaladığınızı ve doğru sunucu adresinde olduğunuzu kontrol edin. İlk passkey daha önce oluşturulduysa giriş için o passkey’i kullanın. İlk kurulum ekranı hâlâ açıksa güncel kod için sunucu yöneticisine başvurun.</p></details>
        <details><summary>Başka bir cihazdan nasıl giriş yaparım?</summary><p>Tarayıcınız ve passkey sağlayıcınız mevcut anahtarınıza erişebiliyorsa “Passkey ile giriş yap” seçeneğini kullanın. Bağımsız bir anahtar kaydetmek için önce giriş yapın, sonra Ayarlar → Anahtar ekle yolunu izleyin. Kayıt seçeneklerini cihazınızın passkey penceresi belirler.</p></details>
        <details><summary>Passkey’ime erişimimi kaybedersem ne olur?</summary><p>Başka bir kayıtlı anahtarınız varsa onunla giriş yapabilirsiniz. Hiçbir anahtara erişemiyorsanız sunucu yöneticisiyle erişim kurtarmayı yürütün. Son anahtarı iptal etmek sunucudan yeni kurulum kodu üretilmesini gerektirir; erişebildiğiniz bir anahtarı koruyun.</p></details>
        <details><summary>Telefona uygulama olarak ekleyebilir miyim?</summary><p>Destekleyen tarayıcılarda menüden “Ana ekrana ekle” veya “Uygulamayı yükle” seçeneğini kullanabilirsiniz. Seçeneğin adı ve bildirim desteği cihazınıza göre değişir. Bildirimleri Ayarlar’dan açın; cihaz ve proje tercihlerinin de açık olması gerekir.</p></details>
        <details><summary>İnternet kesilince ne olur?</summary><p>Mesaj taslakları bu tarayıcıda saklanır. Bağlantı ve güncel oturum durumu doğrulanana kadar mesaj ve karar gönderimi kapalıdır. Yeniden bağlanınca taslağınızı kontrol edip siz gönderirsiniz.</p></details>
        <details><summary>Yalnız konuşmaya nasıl odaklanırım?</summary><p>Oturumun sağ üstündeki genişletme simgesiyle odak modunu açın. Gezinme, oturum listesi, başlık ve mesaj alanı gizlenir; yalnız konuşma kalır. “Mesaj yaz” ile taslağınızı kaybetmeden yazı alanını açabilir, tekrar gizleyebilirsiniz. “Odaktan çık” önceki yerleşimi geri getirir. Masaüstünde ana gezinmeyi ve oturum listesini ayrı ayrı da gizleyebilirsiniz. Hedef, model, maliyet ve Codex incelemesi “Oturum bilgisi” penceresindedir.</p></details>
        <details><summary>Mobil uyumluluk neyi kapsıyor?</summary><p>Telefonda bir oturum açınca üst ve alt gezinme kapanır; konuşma ve mesaj alanı ekranı paylaşır. Geri oku oturum listesine ve gezinmeye döndürür. Görünür ekran yüksekliği klavyeyle değiştiğinde yerleşim buna uyarlanır. Fiziksel cihazda klavye, passkey, PWA ve bildirim deneyimi ayrıca doğrulanmalıdır. Tarayıcıdaki ekran ölçüsü testleri bu kabulün yerini tutmaz.</p></details>
      </section>
      <footer className="info-footer"><p>Hazırsanız ilk cihazınızı bağlayın veya passkey ile giriş yapın.</p><a className="button primary" href="/">Uygulamayı aç<ArrowRight size={18} aria-hidden="true" /></a></footer>
    </main>
  </div>;
}
