# Control-LGS

Eski harita temalı 2D strateji oyunu. Tek başına 8 bot ülkeye karşı ya da arkadaşlarınla çevrimiçi (2–9 kişi) oynanır.
Bilgisayarda ve telefonda çalışır; telefona **uygulama (PWA)** olarak yüklenebilir.

## ▶ Hemen oyna: https://ccemc.github.io/Control-LGS/

Telefona yüklemek için kamerayla okut, açılan sayfada **Uygulamayı Yükle**'ye bas
(iPhone: Safari → Paylaş → Ana Ekrana Ekle).

<img src="telefon-qr.png" alt="Oyunun adresine giden QR kod" width="260">

## 🌐 Arkadaşlarınla çevrimiçi oyna

1. Adını yaz, ideolojini seç, **Oda Kur**'a bas. 5 harfli bir oda kodu çıkar (ör. `JDBMC`).
2. **Daveti Paylaş** ile bağlantıyı gönder ya da kodu söyle. Arkadaşların adını ve ideolojisini seçip kodu yazar, **Katıl**'a basar.
3. Herkes gelince **Oyunu Başlat**. Harita **oyuncu sayısı kadar ülkeyle** (2–9) oluşturulur; bot yoktur, ülkeler rastgele dağıtılır.
4. Herkes fabrika şehrini seçince savaş saati başlar (seçmeyenlerinki 1 dk sonra başkentine kurulur).

- Sunucu yoktur: oyun **odayı kuran cihazda** çalışır, diğerleri ona bağlanır (WebRTC, bağlantı kurulumu için ücretsiz PeerJS aracısı).
  Odayı kuran kişi sekmeyi kapatırsa oyun herkes için biter; yenilse bile sekmeyi açık tutmalı.
- Bağlantısı kopan oyuncunun ülkesini bot yönetir; **aynı cihaz ve tarayıcıdan aynı odaya** yeniden katılınca kaldığı yerden devam eder.
- Çevrimiçi oyunlar kaydedilmez. Bazı mobil/kurumsal ağlarda doğrudan bağlantı kurulamayabilir (o zaman başka ağ dene).
- Oyunu kuran cihaz her oyuncuya saniyede 5 durum güncellemesi yollar (2 kişide ~30 KB/sn, 9 kişide oyuncu başına ~85 KB/sn).

**Güncelleme yayınlamak:** dosyaları değiştir, `sw.js` içindeki `VERSION` değerini ve `js/net.js` içindeki `BUILD` değerini (ikisi aynı) arttır, sonra
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
- **Uydu görünümü (yer şekilleri):** harita, haritanın tohumundan üretilen uydu fotoğrafı görünümlü arazinin üstünde çizilir:
  kıyıdan içeri yükselen arazi, sırtlı dağ sıraları ve karlı zirveler, nem haritasına göre orman / çayır / bozkır / çöl, kumsallar,
  kuzeybatıdan ışıklı kabartma gölgesi, sığdan derine renk değiştiren deniz ve dağlardan denize akan nehirler. Yakın planda
  yer şekilleri doğal renginde görünür, ülkeler sınır boyunca içeri doğru solan kendi renklerindeki şeritle ayrılır;
  uzaklaştıkça (ve minimapte) ülke renkleri belirginleşir. Sınırlar açık renkli çizgilerle görünür. Oyun menüsünden ya da
  **G** tuşuyla eski parşömen haritaya geçilebilir (orada yer şekilleri mürekkep işaretleriyle çizilir); seçim cihazda hatırlanır.
  Arazi oyun açılırken ~0,5 sn'de, dilimler hâlinde üretilir.
- **Yapı modelleri:** fabrikalar haritada testere dişli çatılı, bantlı bacasından duman tüten tuğla binalar; inşaattaki
  fabrika iskele ve vinçle, altında dolan çubukla görünür. Şehir savunması kuleli, mazgallı, ülke bayrağı dalgalanan bir
  kale; hava koruma kum torbalı uçaksavar ve dönen radar çanağıdır. Modeller yakınlaştıkça büyür.
- **Yer şekilleri savaşı etkiler:** her şehrin arazisi, uydu görünümündeki yükseklik ve nemden belirlenir:

  | Arazi | Savunma | İşgal süresi |
  |---|---|---|
  | 🏔 Dağ | +%40 | %30 uzun |
  | ⛰ Tepe | +%20 | %15 uzun |
  | 🌲 Orman | +%15 | %15 uzun |
  | 🌾 Ova | — | — |
  | 🏜 Çöl | −%10 | %10 kısa |

  Komşu şehre **yüksekten saldıran +%10**, **yokuş yukarı saldıran −%10** güçle vurur (uçakla inen birliğe uygulanmaz).
  Arazi şehrin ipucu kutusunda ve seçili birliğin alt çubuğunda yazar; birlik seçiliyken saldırılabilir komşuların üzerinde
  rozet çıkar (kırmızı = zor, yeşil = kolay hedef). Botlar da hesaplarında araziyi kullanır. Arazi her cihazda birebir aynı
  hesaplanır (yalnızca toplama/çarpma ve karekök; çevrimiçi oyunda host ile istemci aynı sonucu bulur).
- **Harita tipleri** (giriş ekranında küçük önizlemeleriyle seçilir; çevrimiçide oda sahibi seçer):
  **Kıta** (klasik, körfezli ve yarımadalı), **Pangea** (yuvarlak dev kıta), **Takımadalar** (dar kara köprüleriyle bağlı adalar,
  yaklaşık ülke başına bir ada), **İç Deniz** (ortadaki denizi çevreleyen halka), **İkiz Kıtalar** (tek köprüyle bağlı iki kıta) ve **Rastgele**.
  Her tipte ülke başına ~19 şehir olacak şekilde harita boyutu kendiliğinden ayarlanır; ülkeler eşit büyüklükte ve bütündür.
- **Askeri Yönetim:** toplam/cephedeki/zayıf asker özeti ve güç çarpanları, halka göstergeli asker üretimi (+1k/+5k/+10k),
  saldırı/savunma ekipman kartları, ideoloji geliştirme kartları ve ordu kartları (taarruz/savunma anahtarı).
- **Mağaza:** hazine ve sonraki gelir çubuğu, kategoriye göre renkli simgeli ürün kartları, aktif etkiler, eksik para göstergesi.
- **Oyun menüsü** (☰ düğmesi ya da **Esc**): duraklat (tek oyunculuda), ses aç/kapat, **Nasıl Oynanır**, kaydedip ana menüye dön.
- **Diplomasi ekranı:** savaş/müttefik/barış durumuna göre sıralı ülke listesi; seçili ülkenin ilişki ölçeği, bekleyen teklifler,
  savaş hakkı geri sayımı, güç dengesi (asker, şehir, fabrika, hazine karşılaştırması) ve haritada başkentini gösterme.
- **İttifaklar ekranı:** şehir sayısına göre güç sıralaması, ittifak kartları (toplam asker/şehir), süren savaşlar.
- **Zafer / yenilgi ekranı:** taç ya da kırık kalkan amblemi, istatistikler (süre, ele geçirilen/kaybedilen şehir, yıkılan devlet,
  en çok şehir, en büyük ordu) ve son sıralama; zaferde konfeti, yenilgide kül ve griye dönen harita.
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

- **Başkent düşerse devlet yıkılır.** Topraklarının **%75'i** (başkent dahil, fatihe en yakın şehirler) **fatihe geçer**,
  fatihten **en uzak %25'i isyancılara** kalır; hazinenin yarısı fatihe ganimet olur. Fatihe geçen şehirlerin fabrikaları ve
  hava korumaları kalır, yenik askerler silah bırakır; isyancılara kalan şehirlerdeki askerlerin yarısı isyancılara katılır.
  (Başkenti isyancılar alırsa tüm şehirler isyancılara geçer.)
- Saldırıda yürüyüş yoktur: komşu düşman şehrine saldırı emri verince çatışma **hemen sınırda** başlar ve şehir, senin şehrinle ortak sınırından
  içeri doğru renk değiştirir. **İşgal hızı birliğin büyüklüğüne bağlıdır:** süre ≈ (savunma + 4k) ÷ (saldırı gücü × 0,03); 5k'lık savunmayı 30k asker ~10 sn'de,
  12k asker ~25 sn'de alır (5–45 sn). İki taraf da çatışma boyunca eriyerek kayıp verir. Savunmayı hiç geçemeyecek küçük bir kuvvetle (≤3k) saldırı başlamaz.
- **Fabrika** her 15 sn'de 1₺ verir ve **6 sn'de kurulur** (inşaat sürerken haritada soluk simge + ilerleme çubuğu görünür; bitene kadar gelir ve ikmal vermez,
  şehir el değiştirirse inşaat iptal olur).
- Haritada saldırı **OpenFront gibi** izlenir: savaştaki ülkelerin ortak sınırı kırmızıya döner, saldırı yolundaki sınır kırmızı yanıp söner,
  çatışma sürerken saldıranın rengi sınırdan şehrin içine doğru yavaş yavaş yayılır (şehir üstünde %ilerleme yazar).
- Saldıran birlik, çatışma bitene kadar komuta edilemez. **Saldırı altındaki şehirdeki askerler şehri terk edemez**, savunmak zorundadır (takviye gönderilebilir).
- **Uçak çıkarması:** başkentten en fazla 15k asker, iç şehirlere **ve sınır şehirlerine** indirilebilir (kendi şehrine takviye
  ya da savaştığın ülkeye çıkarma). Başkentlere ve hava korumalı şehirlere inilemez.
- **Çıkış şehri saldırıya uğrarsa:** bir birlik komşu şehre saldırırken çıktığı şehre saldırı başlarsa birlik ikiye bölünür;
  yarısı cephede kalır, yarısı ~1 sn'de geri dönüp şehri savunur (haritada altın bir ok ve kalkan görünür). Bu kural botlar için de geçerlidir.
- **Ordular:** bir ordunun bulunduğu (ya da oradan saldırıya çıktığı) şehre gönderdiğin ordusuz askerler o orduya katılır.
- **Asker üretimi:** Askeri Yönetim'deki halka, sırada bekleyen asker sayısını gösterir (+3k gibi). Hemen altındaki
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
| Esc (iptal edilecek bir şey yokken): oyun menüsü · P: duraklat | ☰ düğmesi |
| 1–4: menüler, Boşluk: başkente dön, M: sesi aç/kapat | Alt (yatayda sağ) menü çubuğu, 🔊 düğmesi |

## Dosyalar

- `js/mapgen.js` — Voronoi + kıvrımlı sınırlarla harita; 5 harita tipi (kıta, pangea, takımadalar, iç deniz, ikiz kıtalar).
  Klasik kıta 9 ülkede petek düzeninde başkentlerle eskisiyle birebir aynıdır; diğer durumlarda harita ülke sayısına göre boyutlanır,
  başkentler eşit alanlı bölgelere yerleşir; eşit şehir dağılımı. Aynı tohum + tip + ülke sayısı her cihazda aynı haritayı verir.
- `js/net.js` — çevrimiçi oyun: oda kur / katıl (PeerJS), komutların host'a iletilmesi, durum eşitleme
- `js/game.js` — oyun kuralları, kayıt/yükleme. DOM kullanmaz; tüm eylemler `cmd*` komutlarıyla gelir
- `js/bot.js` — bot yapay zekâsı (oyuncuyla aynı komutları kullanır)
- `js/terrain.js` — uydu görünümlü arazi üretimi (yükseklik, dağlar, bitki örtüsü, deniz derinliği, nehirler) ve şehir arazisi sınıflandırması (ova/orman/tepe/dağ/çöl; savaş kuralları için)
- `js/render.js` — harita, birlikler, efektler, minimap
- `js/ui.js` — menüler, diyaloglar, gelen iletiler
- `js/main.js` — giriş ekranı, oyun döngüsü, girişler, uygulama (PWA) özellikleri
- `manifest.webmanifest`, `sw.js`, `icons/` — mobil uygulama dosyaları.
  Oyun dosyalarını değiştirirsen `sw.js` içindeki `VERSION` değerini arttır ki telefonlar yeni sürümü alsın.

## Çevrimiçi mimarisi

`Game` sınıfı arayüzden bağımsız ve komut tabanlı. Odayı kuran cihaz (host) tek doğru kopyayı çalıştırır. İstemciler aynı tohumla
haritayı kendileri üretir; `cmd*` çağrıları önce yerelde uygulanır (anında tepki, olaylar susturulur), sonra host'a gönderilir.
Host komutu kendi kopyasında, gönderenin ülkesi adına çalıştırır ve 200 ms'de bir `snapshot()` ile o oyuncuya ait olayları yollar;
istemci `applySnapshot()` ile kendi kopyasını değiştirir. İleride gerçek bir sunucuya geçmek için aynı mesajlar WebSocket üzerinden taşınabilir.
