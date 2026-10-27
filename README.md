# estate-tracker

Monitor ogłoszeń nieruchomości z alertami na Telegram. Obsługuje **Otodom, OLX, Gratka, Morizon i Nieruchomosci-online**.

Kryteria ustawiasz w panelu WWW — **nie podajesz URL-i**. Program sam rozpoznaje miejscowości przez wewnętrzne API portali, buduje adresy wyszukiwania (sortowane od najnowszych), co kilka minut sprawdza nowe oferty i wysyła je na Telegram ze zdjęciem.

---

## Szybki start

Wymagany Node.js **18.17+** (zalecany 20 lub 22).

```bash
cd estate-tracker
npm ci            # lub: npm install
npm start
```

Przy pierwszym uruchomieniu w konsoli pojawi się wygenerowane hasło do panelu:

```
 Panel: utworzono hasło. Login: admin  Hasło: xxxxxxxxxxxx
```

Panel: **http://localhost:3100** (basic auth). Hasło zmienisz w *Ustawieniach* albo zmienną `PANEL_PASSWORD`.

1. **Ustawienia → Telegram**: token bota, Chat ID, Thread ID → *Wyślij wiadomość testową*.
2. **+ Nowe wyszukiwanie**: wybierasz typ kafelkiem, dodajesz miejscowości z podpowiedzi, ustawiasz suwaki i szczegóły → *Sprawdź, ile ofert pasuje* → *Zapisz*.
3. Na karcie wyszukiwania: liczba pasujących ofert, ostatnie sprawdzenie, kropki statusu portali i (w „Linki do portali”) wygenerowane URL-e. Miejscowości, których portal nie rozpoznał, są oznaczone na czerwono.
4. Zakładki **Oferty** (galeria) i **Mapa** pokazują wszystko, co znaleziono.

Panel działa w jasnym i ciemnym motywie (przycisk 🌙 w prawym górnym rogu) oraz na telefonie.

---

## Aplikacja desktopowa (Windows / macOS)

Ten sam kod (silnik, parsery, panel, mapa, rysowanie obszarów) działa też jako aplikacja **Estate Tracker** (Electron) — dla osób, które mają szukać z własnego komputera. Wersja serwerowa (VPS) działa bez zmian.

| | Serwer (VPS) | Aplikacja |
|---|---|---|
| Start | `node src/index.js` (systemd) | `electron/main.js` |
| Panel | port 3100 (zmienna `PORT`), basic auth | `127.0.0.1`, losowy wolny port, bez logowania (losowy token w ciasteczku `SameSite=Strict` + kontrola nagłówka `Host`) |
| Dane | `data/` | folder danych aplikacji: macOS `~/Library/Application Support/Estate Tracker/data`, Windows `%APPDATA%\Estate Tracker\data` |
| Alerty | Telegram | **powiadomienia systemowe** (kliknięcie otwiera ofertę w aplikacji); Telegram domyślnie wyłączony, można włączyć w Ustawieniach (z ostrzeżeniem) |
| Sprawdzanie | stale | gdy aplikacja działa; opcje „Działaj w tle” (ikona w zasobniku / pasku menu) i „Uruchamiaj po zalogowaniu” (domyślnie wyłączone) |

Dodatkowo w obu wersjach: **eksport/import wyszukiwań** do pliku `.json` (przyciski na stronie *Wyszukiwania* i na kartach) — do wysyłania gotowych kryteriów.
Aplikacja przy starcie sprawdza najnowsze wydanie na GitHubie (`package.json` → `estateTracker.updateRepo`) i pokazuje komunikat z linkiem do pobrania.
Dziennik aplikacji: menu *Pomoc → Otwórz plik dziennika*.

```bash
npm install            # także Electron i electron-builder (devDependencies)
npm run app            # uruchomienie aplikacji z kodu
npm run dist:mac       # dist/Estate-Tracker-<wersja>-mac.dmg (universal: Apple Silicon + Intel)
npm run dist:win       # dist/…-instalator-Windows.exe (NSIS) + …-portable-Windows.exe
```

`dist:win` wymaga uruchamiania programów x86 (na Macu z Apple Silicon — Rosetta 2). Najprościej budować przez **GitHub Actions** (`.github/workflows/build-desktop.yml`): ręcznie (*Actions → Zbuduj aplikację desktopową → Run workflow*, pliki w *Artifacts*) albo tagiem `v*` (np. `v1.0.1`) — wtedy powstaje też *Release* z plikami, który widzi sprawdzanie aktualizacji. Przed nowym wydaniem podnieś `version` w `package.json`.

Aplikacje nie są podpisane certyfikatem (Windows SmartScreen i macOS Gatekeeper pokażą ostrzeżenie przy pierwszym uruchomieniu) — instrukcja dla użytkowników: [INSTRUKCJA-DLA-WSPOLNIKOW.md](INSTRUKCJA-DLA-WSPOLNIKOW.md).

---

## Panel

### Wyszukiwania
Karty z: nazwą, typem, miejscowościami, zakresem ceny i najważniejszymi filtrami, przełącznikiem wł./wył., liczbą pasujących i ulubionych ofert, czasem ostatniego sprawdzenia i kropkami portali:
🟢 działa, 🟡 0 ofert / nierozpoznana miejscowość / częściowy błąd, 🔴 błąd, ⚪ jeszcze nie sprawdzano. Najechanie na kropkę pokazuje szczegóły.
Pod kartą widać też, których filtrów nie da się sprawdzić na danym portalu („nie sprawdzane na: …”) albo tylko z opisu.

### Formularz (jedna strona z sekcjami)
1. **Typ** — kafelki Działka / Dom / Mieszkanie; sprzedaż / wynajem.
2. **Lokalizacja** — pole z podpowiedziami (miejscowość wybrana z listy = chip z dokładnym położeniem), mapa z wybranymi miejscowościami i promieniem (suwak 0–30 km), przycisk **Dodaj sąsiednie miejscowości** (lista z OpenStreetMap w promieniu, z odległościami — zaznaczasz, które dodać).
   Zamiast miejscowości (albo dodatkowo) możesz **narysować obszar na mapie** — patrz niżej.
3. **Cena** — suwak zakresu + pola liczbowe, cena za m² maks.
4. **Powierzchnia** — suwak zakresu; dla domów osobno dom i działka.
5. **Szczegóły** (pokazują się tylko pasujące do typu):
   - Działka: rodzaj (budowlana, rolno-budowlana, rolna, siedliskowa, rekreacyjna, inwestycyjna, leśna), wymagane media (prąd, woda, kanalizacja, gaz) z opcją „akceptuj media w drodze”, dojazd (asfalt / utwardzony), MPZP lub WZ, ogrodzona, minimalna szerokość.
   - Dom: typ zabudowy (wolnostojący, bliźniak, szeregowiec), stan (do zamieszkania, do wykończenia, surowy, do remontu), pokoje, rok budowy od, garaż.
   - Mieszkanie: pokoje, piętro, rynek, winda, balkon, ogród, miejsce parkingowe.
6. **Dodatkowe** — tylko oferty prywatne, słowa wymagane/wykluczone jako chipsy (`a|b` = jedno z nich), portale.
7. **Podgląd na żywo** — przed zapisem pobiera wyniki z portali i pokazuje, ile ofert pasuje na każdym (ile potwierdzonych, ile „do sprawdzenia”) z przykładami. Obok tabela, jak każdy filtr jest sprawdzany na każdym portalu.

### Obszar narysowany na mapie
Na mapie w sekcji Lokalizacja (narzędzia po lewej stronie): **wielokąt, prostokąt, okrąg**, edycja wierzchołków, przesuwanie, usuwanie. Można narysować kilka obszarów; działa też palcem (wielokąt: kolejne stuknięcia, zakończenie stuknięciem w pierwszy punkt; okrąg: środek, potem brzeg; prostokąt: dwa przeciwległe rogi).

- Po narysowaniu program ustala miejscowości **w obszarze** (włączone) i **dotykające go / przy granicy** (↔, domyślnie wyłączone) — dane z OpenStreetMap. Pokazuje je jako chipsy; kliknięcie włącza/wyłącza.
- **Otodom, Gratka i Morizon** szukają bezpośrednio w narysowanym wielokącie (Otodom: parametr `geometry`, Gratka/Morizon: obszar zapisany na portalu, `custom_area`) — jeden URL na obszar. Okrąg jest zamieniany na 48-kąt.
- **OLX i Nieruchomosci-online** nie mają wyszukiwania po obszarze — szukają we **włączonych** miejscowościach z obszaru.
- Miejscowości wpisane ręcznie działają jak dotąd i **nie są** ograniczane obszarem.
- Sprawdzanie ofert:
  - oferta z **dokładnym położeniem** musi mieć pinezkę w obszarze (inaczej: „poza narysowanym obszarem”),
  - oferta **bez dokładnego położenia** przechodzi, jeśli portal sam szukał w obszarze albo jej miejscowość jest w obszarze — z dopiskiem „❔ nie potwierdzono: dokładne położenie (…)”,
  - z miejscowości tylko **przy granicy** przechodzi warunkowo — dla nowych ofert o wyniku decyduje pinezka ze strony ogłoszenia,
  - położenie przybliżone podawane przez portal (OLX) musi leżeć w obszarze lub do 2 km od niego.
- Na stronie **Mapa** obszary wybranego wyszukiwania są pokazane przerywaną linią.

### Oferty
Galeria wszystkich znalezionych ofert: zdjęcie, cena, m², zł/m², miejscowość, portal (plus odnośniki do tej samej oferty na innych portalach), kiedy dodana, wykryte cechy. Filtrowanie (wyszukiwanie, portal, tekst, tylko pasujące, duplikaty), sortowanie (najnowsze, cena, zł/m², powierzchnia), oznaczanie ★ **ulubione** i **odrzuć** (znika z aktywnych).

### Mapa
Leaflet + OpenStreetMap. Pinezka = dokładne położenie (z portalu albo ze strony ogłoszenia), kółko przerywane = położenie przybliżone (środek miejscowości), złota = ulubiona. Kliknięcie pokazuje zdjęcie, cenę i link.

### Miejscowości: gmina, powiat (TERYT) i kontrola odległości

Wiele nazw powtarza się w Polsce — np. jest kilka miejscowości „Witkowice” czy „Podłęże”. Dlatego:

1. Miejscowość **wybierasz z listy podpowiedzi**, która pokazuje gminę, powiat i województwo. Program nie zgaduje: gdy nazwa (wpisana i zatwierdzona Enterem) pasuje do kilku miejscowości, pokazuje listę do wyboru. Nazwa z jedną pasującą miejscowością dodaje się od razu.
2. Wybrana miejscowość jest przypisana do gminy i powiatu z kodami TERYT (TERC gminy, SIMC miejscowości — z OpenStreetMap/Nominatim). Chip pokazuje np. `Podłęże (gm. Niepołomice, pow. wielicki)`; kody są w podpowiedzi chipa. Całą gminę wybierasz pozycją „gmina …” z listy.
3. Na każdym portalu użyta zostaje tylko ta miejscowość (dopasowanie dalej niż 15 km od wybranej jest odrzucane i pokazane na czerwono).
4. **Kontrola odległości:** każda oferta musi leżeć najwyżej **promień + 5 km** od granicy wybranej miejscowości (albo od narysowanego obszaru). Oferta bez współrzędnych jest umiejscawiana w miejscowości podanej w ogłoszeniu (z jej gminą/powiatem). Oferty dalej są odrzucane z powodem „poza obszarem: … km od …” i nie trafiają do alertów — także wtedy, gdy portal zignoruje lokalizację i zwróci oferty z całej Polski (zdarzyło się to Gratce i Morizonowi).
5. Stare wyszukiwania (zapisane przed tą zmianą) są uzupełniane automatycznie przy starcie; nazwy, których nie da się przypisać jednoznacznie, są oznaczone w panelu „wybierz z listy” i do tego czasu nie są sprawdzane. Zapisane oferty są przy tym przeliczane — bez wysyłania alertów.

Wyniki rozpoznawania są keszowane (30 dni) w `data/geocache.json`; przycisk *Odśwież lokalizacje* wymusza ponowne sprawdzenie.

---

## Jak działa sprawdzanie

- Co **X minut** (domyślnie 10) z losowym rozrzutem (domyślnie ±25%) program sprawdza aktywne wyszukiwania **po kolei**, z odstępem 4–9 s między zapytaniami do portali.
- **Pierwszy przebieg** każdego URL-a tylko zapisuje obecne oferty — bez alertów. Dotyczy to też URL-i zmienionych po edycji kryteriów i nowo włączonych portali, więc edycja nie zasypie Cię starymi ofertami.
- **Filtry**: wszystko, co portal obsługuje w URL-u, trafia do URL-a. Resztę program sprawdza sam — z danych listy, ze strony ogłoszenia albo z opisu (np. „MPZP”, „media w drodze”, „brak kanalizacji”, „szambo”, „rolna”).
- **Strony ogłoszeń** są pobierane **tylko dla nowych ofert** (maks. 20 na wyszukiwanie i przebieg, z tymi samymi odstępami) i zapamiętywane — każda tylko raz. Dają media, ogrodzenie, typ, stan, rok, dokładne współrzędne.
- Cecha **wyraźnie sprzeczna** z kryteriami (np. „brak wody”, działka rolna) odrzuca ofertę. Cecha, której **nie da się ustalić**, nie blokuje alertu — oferta przechodzi z dopiskiem „❔ nie potwierdzono: …”. Jeśli portal sam zastosował filtr w URL-u, przypuszczenie z opisu nie może takiej oferty odrzucić.
- **Nowa oferta spełniająca kryteria → alert** na Telegram: zdjęcie, tytuł, cena, m², zł/m², lokalizacja, wykryte cechy (media, MPZP, typ zabudowy…), portal, link.
- **Deduplikacja między portalami**: ta sama oferta = ta sama cena + ta sama powierzchnia (±1%) + zgodny tytuł, a gdy portal ma tytuł ogólnikowy („działka na sprzedaż”) — ta sama miejscowość. Wysyłany jest jeden alert z dopiskiem „także: Gratka, Morizon”.
- **Bezpieczniki**: maks. 15 alertów na przebieg (reszta w logu + jedna wiadomość zbiorcza). Jeśli na znanej liście nagle >60% ofert wygląda na nowe (np. portal zmienił identyfikatory), program zapisuje je bez alertów.
- **Zdrowie portali**: jeśli portal zwraca 0 ofert w 3 kolejnych przebiegach albo ciągle błąd — ostrzeżenie na Telegram (do osobnego wątku ostrzeżeń, jeśli ustawiony) i ponowna wiadomość, gdy wszystko wróci do normy.
- *Sprawdź teraz* w nagłówku panelu uruchamia przebieg od razu.

### Telegram

1. Utwórz bota u [@BotFather](https://t.me/BotFather) → token.
2. Dodaj bota do grupy. Żeby alerty szły do **osobnego wątku**, włącz w grupie *Tematy* (Topics) i utwórz temat np. „Oferty”.
3. Chat ID grupy (zaczyna się od `-100…`) i ID wątku (`message_thread_id`) najprościej odczytać, wysyłając wiadomość w temacie i otwierając `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. W *Ustawieniach*: Chat ID, Thread ID (alerty), opcjonalnie Thread ID (ostrzeżenia) → *Wyślij wiadomość testową*.

---

## Portale — jak program je odczytuje

| Portal | Lokalizacje | Lista ofert (główna metoda) | Fallback |
|---|---|---|---|
| Otodom | GraphQL `autocomplete` → ID typu `wojewodztwo/powiat/gmina/miejscowosc` | `__NEXT_DATA__` | karty HTML `<article>` |
| OLX | `api/v1/geo-encoder/location-autocomplete` → `city_id`, `region_id` | API `api/v1/offers` | `window.__PRERENDERED_STATE__` → karty HTML |
| Gratka | GraphQL `getLocationSuggestions` → ID lokalizacji; URL budowany przez `encodeListingParameters` | GraphQL `searchProperties` | JSON-LD ze strony wyników |
| Morizon | jak Gratka (wspólny backend Grupy Morizon-Gratka) | GraphQL `searchProperties` | JSON-LD |
| Nieruchomosci-online | `?module=locationTip` → ID miejscowości | kafelki HTML | JSON-LD |

Jak sprawdzane są filtry (URL = filtr portalu, dane = z listy wyników, strona = ze strony ogłoszenia, opis = tylko z treści ogłoszenia). To samo panel pokazuje przy formularzu.

| Filtr | Otodom | OLX | Gratka / Morizon | Nieruchomosci-online |
|---|---|---|---|---|
| Kilka miejscowości w jednym URL | tak | nie (URL na miejscowość) | tak | nie (URL na miejscowość) |
| Cena, powierzchnia, promień | URL | URL | URL | URL |
| Działka przy domu | URL | URL | URL | URL |
| Cena za m² | URL | URL¹ | URL | program |
| Rodzaj działki | URL² | URL | URL | URL (jeden rodzaj) / dane |
| Media | strona | opis | strona³ | strona |
| Dojazd | opis | opis | opis | dane (+ URL dla asfaltu) |
| MPZP / WZ | opis | opis | opis | opis |
| Ogrodzona | strona | opis | strona | URL |
| Szerokość działki | opis | opis | strona | strona |
| Typ zabudowy domu | URL | URL | URL | opis (URL dla wolnostojącego) |
| Stan domu | strona | opis | strona | opis |
| Pokoje | URL | URL (mieszkania) / opis (domy) | URL | URL |
| Rok budowy | URL | opis | URL | opis |
| Garaż (dom) | strona | opis | strona | opis |
| Piętro, rynek | URL | URL | URL | URL |
| Winda, balkon, ogród, parking | URL | opis | URL | URL |
| Tylko prywatne | URL | URL | URL | URL |
| Narysowany obszar | URL (`geometry`) | miejscowości z obszaru + położenie | URL (`custom_area`) | miejscowości z obszaru + położenie |
| Słowa kluczowe | program | program | program | program |

¹ OLX ma filtr zł/m² tylko dla działek i sprzedaży mieszkań/domów. ² Otodom nie ma „inwestycyjnej” — gdy ją zaznaczysz, rodzaj sprawdza program. ³ Gdy wyłączysz „akceptuj media w drodze”, media trafiają do URL-a Gratki/Morizonu.

Program i tak sprawdza wszystkie kryteria liczbowe po pobraniu (jeśli portal zignoruje parametr, oferta i tak zostanie odfiltrowana).

---

## Test na prawdziwych stronach

```bash
npm run test:portals                                  # działki budowlane Wieliczka + Niepołomice do 800 tys. zł
node scripts/test-portals.js --case=media --details=2 # + media (prąd, woda, kanalizacja), MPZP/WZ; czyta 2 strony ogłoszeń na portal
node scripts/test-portals.js --case=domy              # domy, Wieliczka +5 km, 0,8–2 mln, działka ≥400 m²
node scripts/test-portals.js --case=domy2             # bliźniaki/szeregowce, 4+ pokoje, od 2005 r.
node scripts/test-portals.js --case=mieszkania        # Kraków, 2–3 pokoje, piętro 1–4, rynek wtórny, winda, balkon
node scripts/test-portals.js --case=obszar --details=2 # obszar narysowany (prostokąt wokół Niepołomic), bez listy miejscowości
node scripts/test-portals.js --case=obszar2           # dwa okręgi (Wieliczka, Niepołomice) + ręcznie wpisany Kłaj
node scripts/test-portals.js --case=wynajem otodom gratka   # mieszkania na wynajem w Krakowie, wybrane portale
```

Skrypt używa tymczasowego katalogu danych (nie rusza `data/`) i wypisuje: jak każdy filtr jest sprawdzany na każdym portalu, rozpoznane lokalizacje, URL, metodę parsowania, liczbę ofert i każdą ofertę z oznaczeniem ✓/✗, wykrytymi cechami (✨), niepotwierdzonymi (❔) i położeniem (◉ dokładne, ≈ przybliżone).

---

## Instalacja jako usługa systemd (Linux)

Ustaw katalog instalacji i użytkownika (dowolne — poniżej przykład):

```bash
INSTALL_DIR=/srv/estate-tracker
SERVICE_USER=estate

sudo useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
sudo mkdir -p "$INSTALL_DIR"
sudo cp -r . "$INSTALL_DIR/"
cd "$INSTALL_DIR" && sudo npm ci --omit=dev
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# opcjonalnie zmienne (port, hasło panelu, token…)
sudo cp deploy/estate-tracker.env.example /etc/estate-tracker.env
sudo chmod 600 /etc/estate-tracker.env && sudo nano /etc/estate-tracker.env

# plik usługi z szablonu
sed -e "s|INSTALL_DIR|$INSTALL_DIR|g" -e "s|SERVICE_USER|$SERVICE_USER|g" -e "s|NODE_BIN|$(which node)|g" \
  deploy/estate-tracker.service.example | sudo tee /etc/systemd/system/estate-tracker.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now estate-tracker

journalctl -u estate-tracker -f          # log (tu jest też wygenerowane hasło panelu)
```

Panel domyślnie nasłuchuje na `0.0.0.0:3100` (zmienne `PORT`, `HOST`). Wystawiając go do internetu, użyj reverse proxy z HTTPS (basic auth przez zwykłe HTTP przesyła hasło jawnym tekstem) albo ustaw `HOST=127.0.0.1` i łącz się przez tunel SSH: `ssh -L 3100:127.0.0.1:3100 user@twoj-serwer`.

Własne ustawienia konkretnego serwera (adres, ścieżki, kopie plików usługi) trzymaj w `deploy/private/` — ten folder jest w `.gitignore`.

---

## Pliki danych (`data/`)

| Plik | Zawartość |
|---|---|
| `settings.json` | ustawienia (Telegram, harmonogram, login panelu) |
| `searches.json` | wyszukiwania |
| `resolved.json` | rozpoznane lokalizacje i wygenerowane URL-e |
| `geocache.json` | kesz podpowiedzi lokalizacji z portali |
| `seen.json` | oferty już widziane (do wykrywania nowych i deduplikacji) |
| `alerts.json` | log ostatnich 300 alertów |
| `offers.json` | znalezione oferty dla galerii i mapy (cechy, położenie, ulubione/odrzucone, zapamiętane strony ogłoszeń) |
| `status.json` | status portali i przebiegów |

Zapisy są atomowe (plik tymczasowy + rename). Kopia zapasowa = skopiowanie katalogu `data/`.

---

## Zmienne środowiskowe

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3100` | port panelu |
| `HOST` | `0.0.0.0` | adres nasłuchu |
| `DATA_DIR` | `./data` | katalog danych |
| `PANEL_USER`, `PANEL_PASSWORD` | `admin`, generowane | logowanie do panelu |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID` | — | nadpisują ustawienia z panelu |
| `HTTP_USER_AGENT` | Chrome | nagłówek User-Agent zapytań |

---

## Znane ograniczenia

- **OLX** chroni stronę i API przez CloudFront i okresowo odpowiada `403` na zapytania automatyczne (zależnie od adresu IP i częstotliwości). Program nie obchodzi tej blokady: zapisuje błąd w statusie portalu, próbuje kolejnych metod (API → strona) i ponawia przy następnym przebiegu. Gdy blokada trwa kilka przebiegów, dostaniesz ostrzeżenie na Telegramie. Jeśli rozpoznanie miejscowości na OLX się nie uda, panel pokazuje to na czerwono i program ponawia próbę przy kolejnym przebiegu.
- **Gratka i Morizon** to w dużej mierze te same ogłoszenia — deduplikacja łączy je w jeden alert.
- **Nieruchomosci-online** dokleja pod wynikami oferty „z okolicy” — program je pomija (chyba że ustawisz promień, wtedy portal sam je zalicza do wyników).
- Program czyta pierwszą stronę wyników (posortowaną od najnowszych: 35–72 oferty zależnie od portalu). Przy sprawdzaniu co 10 minut to z dużym zapasem wystarcza.
- „Dodaj sąsiednie miejscowości” korzysta z publicznych usług OpenStreetMap (Photon, zapasowo Overpass). Gdy są przeciążone, panel pokaże błąd — wystarczy spróbować później.
- Ustalanie miejscowości w obszarze używa Photona (OpenStreetMap) — przy dużym obszarze trwa kilka–kilkanaście sekund. Miasto, którego tylko skraj leży w obszarze, trafia do „przy granicy”; włączenie go dla OLX/Nieruchomosci-online oznacza pobieranie ofert z całego miasta (odfiltrowanych potem po pinezce, gdy jest znana).
- Położenie z OLX bywa przybliżone (sprzedawca nie wskazał punktu); oferty bez współrzędnych stoją na mapie w środku miejscowości (kółko przerywane).
- Portale zmieniają swoje strony. Gdy parser przestanie działać, panel i Telegram pokażą „0 ofert ×N” albo błąd; podgląd pokazuje, którą metodą (główną czy fallback) odczytano dane.
