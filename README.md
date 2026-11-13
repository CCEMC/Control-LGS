# Hükümdarlar Çağı

Eski harita temalı 2D strateji oyunu. Şimdilik 8 bot ülkeye karşı oynanır.
Bilgisayarda ve telefonda çalışır; telefona **uygulama (PWA)** olarak yüklenebilir.

## ▶ Hemen oyna: https://ccemc.github.io/Control-LGS/

Telefona yüklemek için kamerayla okut, açılan sayfada **Uygulamayı Yükle**'ye bas
(iPhone: Safari → Paylaş → Ana Ekrana Ekle).

<img src="telefon-qr.png" alt="Oyunun adresine giden QR kod" width="260">

**Güncelleme yayınlamak:** dosyaları değiştir, `sw.js` içindeki `VERSION` değerini arttır, sonra
`git add -A`, `git commit -m "açıklama"`, `git push`. Site 1-2 dakika içinde güncellenir; telefondaki uygulama
bir sonraki açılışta yeni sürümü alır.

## Bilgisayarda oyna

- `oyunu-baslat.bat` dosyasına çift tıkla (Python gerekir) → tarayıcıda `http://localhost:8080` açılır.
- Sunucusuz da çalışır: `index.html` dosyasını doğrudan açabilirsin (bu durumda çevrimdışı önbellek çalışmaz).

## Telefonda oyna (aynı Wi-Fi)

1. Bilgisayarda `telefonda-oyna.bat` dosyasına çift tıkla. Ekranda `http://192.168.x.x:8080` gibi bir adres yazar.
2. Windows güvenlik duvarı sorarsa **Özel ağlar** için izin ver.
3. Telefonun tarayıcısında o adresi aç, **Mobil** modu seç, Başla. Oyun tam ekrana geçer.
4. İstersen tarayıcı menüsünden **Ana ekrana ekle** ile kısayol oluşturabilirsin.

> Not: Yerel ağ adresi `http://` olduğu için tarayıcılar burada tam "uygulama yükleme" ve internetsiz çalışmaya izin vermez.
> Bunun için oyunun **https** bir adreste olması gerekir (aşağıya bak).

## Gerçek uygulama olarak yükle (ikon, tam ekran, internetsiz)

1. Oyun zaten GitHub Pages'te yayında: https://ccemc.github.io/Control-LGS/
2. Telefonda o adresi aç:
   - **Android (Chrome):** giriş ekranında çıkan **📲 Uygulamayı Yükle** butonuna bas (ya da menü → *Uygulamayı yükle*).
   - **iPhone (Safari):** **Paylaş → Ana Ekrana Ekle**.
3. Artık ana ekrandaki ikondan açılır; internet olmadan da çalışır.

**APK dosyası istersen:** HTTPS adresini [PWABuilder](https://www.pwabuilder.com) sitesine ver; Android paketini (APK/AAB) oluşturup indirir.

## Uygulama özellikleri

- Ana ekran ikonu, tam ekran açılış, yatay ve dikey düzen, çentikli ekran desteği
- **Otomatik kayıt:** her 10 sn'de ve uygulama arka plana geçince kaydeder; giriş ekranında **Kaldığın Yerden Devam Et**
- Oyun açıkken ekran kararmaz; saldırı/savaş bildirimlerinde titreşim
- Uygulama arka plandayken oyun duraklar
- **Ses ve müzik** (dosyasız, tamamı tarayıcıda üretilir): barışta sakin müzik, savaşta taiko davullu savaş müziği, çatışmada daha yoğun hali;
  kılıç sesleri, savaş boruları, fanfar, füze/patlama, para ve arayüz sesleri. Üst çubuktaki 🔊 düğmesi (ya da **M**) sesi açar/kapatır.
- **Animasyonlar:** yürüyen birlikler sallanır ve arkalarında toz kalkar; asker doğunca/sınıra varınca yükselen "+1k" yazısı,
  orduya katılınca ordu renginde halkalar, savunmaya dönüşte altın ok + kalkan; menüde sayılar değişince zıplar, anahtar kayarak açılır.

## İdeolojiye özel geliştirmeler

Her ideolojinin sadece kendisinin alabileceği 3 geliştirmesi var (Askeri Yönetim menüsünde). Her biri en fazla 3 seviye,
fiyatı seviye başına artar (6 → 9 → 12₺, Komünizm'de %10 ucuz). Etkiler seviye başınadır; botlar da bunları alır.

| İdeoloji | Geliştirme | Etki (seviye başına) |
|---|---|---|
| Komünizm | Beş Yıllık Plan | Asker üretimi +%25 hızlı |
| Komünizm | Halk Milisi | Ele geçirilen her şehirde +1k asker katılır |
| Komünizm | Devrim Ajitasyonu | İsyan Çıkar %20 ucuz, isyancılara +%10 saldırı |
| Demokrasi | Serbest Piyasa | Fabrika geliri +%20 |
| Demokrasi | Ulusal Muhafız | Kendi asıl (başlangıç) topraklarında +%10 savunma |
| Demokrasi | Diplomasi Ağı | Botlar tekliflerine ilişkin +15 daha iyiymiş gibi bakar |
| Monarşi | Şövalye Süvarisi | İşgal ve yürüyüş +%15 hızlı |
| Monarşi | Kraliyet Muhafızları | Başkent savunması +%25 |
| Monarşi | Haraç | Ele geçirilen her şehirden +1₺ ganimet |

## Savaş kuralları (kısaca)

- **Başkent düşerse devlet yıkılır.** Kalan şehirler isyancılara geçer, hazinenin yarısı fatihe ganimet olur.
- Saldırıda yürüyüş yoktur: komşu düşman şehrine saldırı emri verince çatışma **hemen sınırda** başlar ve şehir, senin şehrinle ortak sınırından
  içeri doğru renk değiştirir. **İşgal hızı birliğin büyüklüğüne bağlıdır:** süre ≈ (savunma + 4k) ÷ (saldırı gücü × 0,03); 5k'lık savunmayı 30k asker ~10 sn'de,
  12k asker ~25 sn'de alır (5–45 sn). İki taraf da çatışma boyunca eriyerek kayıp verir. Savunmayı hiç geçemeyecek küçük bir kuvvetle (≤3k) saldırı başlamaz.
- **Fabrika** her 15 sn'de 1₺ verir ve **6 sn'de kurulur** (inşaat sürerken haritada soluk simge + ilerleme çubuğu görünür; bitene kadar gelir ve ikmal vermez,
  şehir el değiştirirse inşaat iptal olur).
- Haritada saldırı **OpenFront gibi** izlenir: savaştaki ülkelerin ortak sınırı kırmızıya döner, saldırı yolundaki sınır kırmızı yanıp söner,
  çatışma sürerken saldıranın rengi sınırdan şehrin içine doğru yavaş yavaş yayılır (şehir üstünde %ilerleme yazar).
- Saldıran birlik, çatışma bitene kadar komuta edilemez. **Saldırı altındaki şehirdeki askerler şehri terk edemez**, savunmak zorundadır (takviye gönderilebilir).
- **Çıkış şehri saldırıya uğrarsa:** bir birlik komşu şehre saldırırken çıktığı şehre saldırı başlarsa birlik ikiye bölünür;
  yarısı cephede kalır, yarısı ~1 sn'de geri dönüp şehri savunur (haritada altın bir ok ve kalkan görünür). Bu kural botlar için de geçerlidir.
- **Ordular:** bir ordunun bulunduğu (ya da oradan saldırıya çıktığı) şehre gönderdiğin ordusuz askerler o orduya katılır.
- **Asker üretimi:** Askeri Yönetim'de "Eklenecek asker" sırada bekleyen asker sayısını gösterir (+3k gibi). Hemen altındaki
  **Sınırlara dağıt** anahtarı açıkken yeni askerler başkentte kalmaz, sınıra yürür: önce saldırı altındaki şehirler, sonra
  savaştığın ülkeye/isyancılara sınır olan şehirler, sonra diğer sınır şehirleri; aynı öncelikte en az askeri olan (yoldakiler dahil) seçilir.
  Başkent saldırı altındaysa askerler başkentte kalır.
- Her şehrin askeri, haritada toprağın üzerine yazılır (altın alt çizgi = senin birliğin).
- **Fabrika bağlantısı (ikmal):** bir şehir, kendi toprağın üzerinden hiçbir fabrikaya bağlı değilse oradaki askerler
  **%50 daha zayıf saldırır, %50 daha zayıf savunur ve %50 daha yavaş yürür**. Bu askerlerin üstünde sarı bir **❗** işareti görünür
  (üstüne gelince şehir ipucunda, Askeri Yönetim menüsünde de uyarı çıkar). Çözüm: kopuk bölgeye fabrika kur ya da toprağını fabrikalı bölgeyle birleştir.
  Sadece **kendi** toprağın sayılır (müttefik toprağı seni beslemez); isyancılar bu kurala tabi değildir.

## Kontroller

| PC | Mobil |
|---|---|
| WASD / ok tuşları: kamera | Sürükle veya D-pad |
| Tekerlek: yakınlaştır | İki parmak / + − |
| Birliğe (veya birlikli şehre) tıkla → miktar seç → hedef şehre sol tıkla | Dokun |
| Q / sağ tık / Esc: iptal | İptal butonu |
| 1–4: menüler, Boşluk: başkente dön, M: sesi aç/kapat | Alt (yatayda sağ) menü çubuğu, 🔊 düğmesi |

## Dosyalar

- `js/mapgen.js` — Voronoi + kıvrımlı sınırlarla harita, petek düzeninde eşit aralıklı 9 başkent, eşit şehir dağılımı
- `js/game.js` — oyun kuralları, kayıt/yükleme. DOM kullanmaz; tüm eylemler `cmd*` komutlarıyla gelir
- `js/bot.js` — bot yapay zekâsı (oyuncuyla aynı komutları kullanır)
- `js/render.js` — harita, birlikler, efektler, minimap
- `js/ui.js` — menüler, diyaloglar, gelen iletiler
- `js/main.js` — giriş ekranı, oyun döngüsü, girişler, uygulama (PWA) özellikleri
- `manifest.webmanifest`, `sw.js`, `icons/` — mobil uygulama dosyaları.
  Oyun dosyalarını değiştirirsen `sw.js` içindeki `VERSION` değerini arttır ki telefonlar yeni sürümü alsın.

## Çevrimiçiye geçiş notu

`Game` sınıfı arayüzden bağımsız ve komut tabanlı. Çok oyunculu için `game.js` + `mapgen.js` + `bot.js` bir Node sunucusunda
çalıştırılır; istemciler `cmdMove`, `cmdPropose`, `cmdBuy`… çağrılarını WebSocket mesajı olarak gönderir, sunucu durumu yayınlar.
