# intRem çalışma kılavuzu

## Yeni oturumda başlama

1. Önce `docs/STATUS.md` dosyasını oku. Bu dosya son doğrulanmış durumun ve sıradaki işlerin giriş noktasıdır.
2. `README.md` ve `docs/implementation-contract.md` üzerinden kapsamı ve güvenlik sözleşmesini doğrula.
3. Varsa yerel `tasks/handoff.md`, `tasks/todo.md` ve `tasks/lessons.md` dosyalarını oku. `tasks/` Git'e eklenmez; yeni klonda bulunmayabilir.
4. `git status`, mevcut HEAD, origin/main ve açık GitHub issue'larını kontrol et. Belgelerdeki tarihli durumu canlı durum sanma. Commit edilmemiş işi koru.
5. Kalan işi kısa, doğrulanabilir adımlara böl; önceki turda geçen testleri yeni değişikliğin kanıtı sayma.

## Çalışma sınırları

- Kullanıcıyla ve belgelerde Türkçe konuş; teknik adlar ve commit mesajları İngilizce kalabilir.
- İş takibi: https://github.com/abdullahcekin/intRem/issues
- Doğrulanmış, uygulanmış fakat canlı kabulü açık ve henüz uygulanmamış işleri ayrı belirt.
- Kaynak Claude/tmux oturumlarını kendiliğinden kapatma veya terminale girdi gönderme. Kontrollü devir sözleşmesini koru.
- Belirsiz teslimatı otomatik tekrar etme; nesil ve karar içeriği değiştiyse eski onayı uygulama.
- Sağlayıcı hesabı veya maliyet için kanıtsız bilgi üretme; bütçe garantisi yoksa ücretli fallback açma.
- Sırları, bootstrap kodunu, özel konuşmaları, gerçek sunucu adreslerini ve kullanıcıya özel kaynak belgeleri public repoya/issue'lara koyma.
- Testleri, gerçek sağlayıcı pilotunu ve fiziksel telefon kabulünü birbirinin yerine gösterme.

## Süreklilik

Her doğrulanmış teslimden ve çalışma kesilmeden önce `docs/STATUS.md` içindeki commit/CI kanıtını, kalan işleri ve sonraki somut adımı güncelle. Sunucu yolları gibi yerel ayrıntıları yalnız `tasks/handoff.md` içinde tut. Aktif ajanların henüz tamamlamadığı işi tamamlandı sayma; kesinti sonrası yaşayan çalışma ağacını incele.

Yerel yönergelerin istediği context-mode ve ilgili geliştirme/tasarım skill'lerini kullan. Dosya değişiklikleri küçük ve ilgili işe bağlı olsun.
