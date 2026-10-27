# Estate Tracker — instrukcja instalacji

Estate Tracker sam przegląda ogłoszenia z Otodomu, OLX, Gratki, Morizonu i Nieruchomosci-online
i daje znać powiadomieniem na komputerze, gdy pojawi się nowa oferta pasująca do Twoich kryteriów.

Pobierz plik dla swojego komputera:

| Komputer | Plik |
|---|---|
| Windows | `Estate-Tracker-…-instalator-Windows.exe` (zalecany) |
| Windows bez instalowania (np. komputer firmowy) | `Estate-Tracker-…-portable-Windows.exe` |
| Mac (każdy, także z procesorem M1/M2/M3/M4) | `Estate-Tracker-…-mac.dmg` |

---

## Windows

1. Kliknij dwukrotnie pobrany plik `…-instalator-Windows.exe`.
2. Może pojawić się niebieskie okno **„System Windows ochronił ten komputer”**. To normalne — program nie ma płatnego certyfikatu Microsoftu.
   Kliknij **„Więcej informacji”**, a potem **„Uruchom mimo to”**.
3. W instalatorze klikaj **„Dalej”**, na końcu **„Zakończ”**.
4. Program uruchomisz ikoną **Estate Tracker** na pulpicie albo z menu Start.

Wersja *portable*: nic nie instalujesz — po prostu uruchamiasz plik `…-portable-Windows.exe` (krok 2 też może się pojawić). Trzymaj go w stałym miejscu, np. w folderze Dokumenty.

## Mac

1. Kliknij dwukrotnie pobrany plik `…-mac.dmg`.
2. W okienku, które się otworzy, **przeciągnij ikonę Estate Tracker na folder „Aplikacje”**. Zamknij okienko.
3. Otwórz **Aplikacje** (Finder → Aplikacje) i kliknij dwukrotnie **Estate Tracker**.
4. Za pierwszym razem Mac pokaże komunikat, że **nie może sprawdzić programu** („Apple nie może zweryfikować…”). Kliknij **„Gotowe”** (nie „Przenieś do kosza”).
5. Otwórz **menu  (jabłko) → Ustawienia systemowe → Prywatność i ochrona**. Przewiń w dół — przy napisie o Estate Tracker kliknij **„Otwórz mimo to”**, potwierdź hasłem lub Touch ID i jeszcze raz **„Otwórz mimo to”**.
   Robisz to tylko raz.
6. Gdy Mac zapyta, czy Estate Tracker może **wysyłać powiadomienia** — kliknij **„Zezwól”**.

---

## Pierwsze kroki (Windows i Mac)

1. Po uruchomieniu od razu widzisz panel — nie trzeba się logować.
2. **Dostałeś plik z wyszukiwaniami** (np. `estate-tracker-Dzialki….json`)? Kliknij **„Importuj”** na stronie *Wyszukiwania* i wybierz ten plik. Gotowe.
   Możesz też dodać własne wyszukiwanie przyciskiem **„+ Nowe wyszukiwanie”**. Miejscowość wybierz z listy podpowiedzi — przy każdej widać gminę i powiat, bo wiele nazw powtarza się w Polsce.
3. **Pierwsze sprawdzenie tylko zapamiętuje oferty, które już są** — powiadomienia przyjdą dopiero o ogłoszeniach dodanych później. To celowe, żeby nie zasypać Cię starymi ofertami.
4. Sprawdź, czy powiadomienia działają: **Ustawienia → „Wyślij testowe powiadomienie”**. W rogu ekranu powinien pojawić się dymek.
5. Kliknięcie powiadomienia otwiera ofertę w programie (zdjęcie, cena, mapa, przycisk „Otwórz na …” prowadzi do ogłoszenia).

### Żeby program sprawdzał oferty cały czas

Program sprawdza ogłoszenia co ok. 10 minut, **dopóki jest uruchomiony**. W **Ustawieniach → Aplikacja**:

- **„Działaj w tle”** — po zamknięciu okna program dalej działa; jego ikonka jest obok zegara (Windows) albo na górnym pasku ekranu (Mac). Stamtąd go otworzysz lub zakończysz.
- **„Uruchamiaj automatycznie po zalogowaniu”** — program sam startuje po włączeniu komputera.

Gdy komputer jest wyłączony lub uśpiony, program nie sprawdza ofert — nadrobi przy następnym sprawdzeniu.

### Udostępnianie wyszukiwań

Na karcie wyszukiwania kliknij **„Eksportuj”** — zapiszesz plik `.json`, który możesz wysłać mailem lub komunikatorem. Odbiorca wczytuje go przyciskiem **„Importuj”**.

### Telegram

Domyślnie jest **wyłączony** i najlepiej tak zostawić — wystarczą powiadomienia na komputerze. Nie wpisuj tam danych bota, chyba że ktoś Ci to wyraźnie przygotował.

### Nowa wersja

Gdy wyjdzie nowsza wersja, program pokaże komunikat z przyciskiem **„Pobierz”**. Pobierz plik i zainstaluj go tak samo jak pierwszy raz — Twoje wyszukiwania i ustawienia zostaną.

---

## Gdy coś nie działa

- **Nie widzę powiadomień** — na stronie *Wyszukiwania* pojawi się żółta ramka z instrukcją. W skrócie:
  - Mac: menu  → Ustawienia systemowe → **Powiadomienia** → Estate Tracker → włącz „Zezwalaj na powiadomienia”.
  - Windows: Start → Ustawienia → System → **Powiadomienia** → włącz dla Estate Tracker; wyłącz tryb „Nie przeszkadzać”.
- **Któryś portal ma czerwoną kropkę** — portal chwilowo blokuje lub nie odpowiada. Program sam spróbuje ponownie.
- **Program nie chce się uruchomić** — uruchom komputer ponownie i spróbuj jeszcze raz. Jeśli dalej nic: w programie menu **Pomoc → Otwórz plik dziennika** i wyślij ten plik osobie, od której masz program.

Twoje dane (wyszukiwania, znalezione oferty) są tylko na Twoim komputerze:
Windows — `%APPDATA%\Estate Tracker`, Mac — `~/Library/Application Support/Estate Tracker`.
Odinstalowanie: Windows — *Ustawienia → Aplikacje → Estate Tracker → Odinstaluj*; Mac — przeciągnij Estate Tracker z *Aplikacji* do kosza.
