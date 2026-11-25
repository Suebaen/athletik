# Athletik – Sprungplan

Offline-Web-App (PWA) für den persönlichen Athletikplan im Ultimate Frisbee: höher springen, Luftkämpfe gewinnen.
Läuft komplett auf dem iPhone, ohne Server, ohne Login. Alle Daten bleiben auf dem Gerät.

**Funktionen**

- **Heute:** Phase, „Woche X von Y“, Deload-Hinweis, Testtag-Banner und die Einheit des Tages.
- **Sätze protokollieren:** Wiederholungen bzw. Sekunden, Gewicht und Haken. Alles wird sofort gespeichert. Das Gewicht wird mit dem zuletzt eingetragenen Wert vorausgefüllt.
- **Pausentimer:** startet nach jedem abgehakten Satz und läuft auch korrekt weiter, wenn die App im Hintergrund war. Der Bildschirm bleibt während der Pause an.
- **Plan:** Phasen → Wochen → Tage. Vergangene Tage lassen sich nachtragen.
- **Tests:** CMJ, Anlauf-Reichhöhe und Standweitsprung (bester von 3 Versuchen), mit Verlaufsdiagramm und 75-cm-Ziellinie.
- **Messen (Testversion):** prüft, mit welcher Bildrate die App deine Zeitlupen-Videos bekommt – Vorbereitung für die Sprunghöhenmessung per Video.
- **Verlauf:** bester Satz pro Einheit für jede Übung.
- **Mehr:** Sicherung exportieren und importieren, neuen Trainingsplan importieren.

---

## 1. Lokal testen (Mac)

```bash
cd ~/Desktop/fitness_app
python3 -m http.server 8000
```

Dann im Browser <http://localhost:8000> öffnen.
In Safari zeigt **Entwickler → Responsive Design-Modus** die iPhone-Ansicht. (Das Menü „Entwickler“ ggf. unter Safari → Einstellungen → Erweitert einschalten.)

> **Achtung, Offline-Cache:** Der Service Worker liefert die App aus seinem Cache.
> Nach Änderungen an den Dateien siehst du deshalb weiter die alte Version, bis du eines davon machst:
>
> - In `sw.js` die `VERSION` erhöhen und die Seite neu laden. Dann erscheint das Banner „Update verfügbar – neu laden“.
> - In Chrome: Entwicklertools → Application → Service Workers → „Update on reload“ anhaken.
> - In Safari: Entwickler → Cache-Speicher leeren und Website-Daten löschen.

**Unit-Tests** (Planlogik, Validierung, Timer, Diagramme). Einmalig Node.js installieren, dann die Tests starten:

```bash
brew install node
node --test
```

Node wird nur für die Tests gebraucht, nicht für die App selbst.

---

## 2. Veröffentlichen mit GitHub Pages (kostenlos)

1. Auf <https://github.com/new> ein neues Repository anlegen, z. B. `athletik`.
   Für kostenloses GitHub Pages muss es **öffentlich** sein. Der Code ist dann sichtbar, deine Trainingsdaten aber nicht, denn die liegen nur auf dem iPhone.
2. Den Projektordner hochladen (im Terminal):

   ```bash
   cd ~/Desktop/fitness_app
   git init
   git add .
   git commit -m "Initial version of the training PWA"
   git branch -M main
   git remote add origin https://github.com/<DEIN-NAME>/athletik.git
   git push -u origin main
   ```

3. Im Repository auf GitHub: **Settings → Pages**.
   - *Source:* **Deploy from a branch**
   - *Branch:* **main**, Ordner **/ (root)** → **Save**
4. Nach 1–2 Minuten ist die App erreichbar unter
   `https://<DEIN-NAME>.github.io/athletik/`
   (der Fortschritt ist unter dem Reiter **Actions** zu sehen).

Alle Pfade in der App sind relativ, deshalb funktioniert sie im Unterordner `/athletik/` ohne Anpassung.
Die leere Datei `.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert ausliefert.

---

## 3. Auf dem iPhone installieren

1. Die Adresse `https://<DEIN-NAME>.github.io/athletik/` in **Safari** öffnen.
2. Unten auf **Teilen** (Quadrat mit Pfeil) tippen → **Zum Home-Bildschirm** → **Hinzufügen**.
   (Steht es nicht direkt im Menü: im Teilen-Menü nach unten scrollen bzw. „Aktionen bearbeiten“.)
3. Die App **einmal vom Home-Bildschirm aus öffnen, solange du Internet hast**. Dabei werden alle Dateien für den Offline-Betrieb gespeichert.
   Danach funktioniert die App auch im Flugmodus.

**Wichtig zu den Daten:**

- **Nur in der installierten App protokollieren.** Die App auf dem Home-Bildschirm hat einen *eigenen* Speicher, getrennt von Safari. Was du in einem Safari-Tab einträgst, siehst du in der installierten App nicht.
- **Wer das Icon vom Home-Bildschirm löscht, löscht auch alle Einträge.** Vorher eine Sicherung exportieren.
- iOS kann Daten von Web-Apps löschen, die sehr lange nicht benutzt wurden. Deshalb regelmäßig sichern (siehe unten). Unter **Mehr** steht, ob iOS den Speicher als „dauerhaft“ bestätigt hat. Ab 14 Tagen ohne Sicherung erinnert die App daran.

### Pausentimer auf dem iPhone

- Während einer Pause bleibt der Bildschirm an (Screen Wake Lock). Falls das bei deiner iOS-Version nicht klappt, unter *Einstellungen → Anzeige & Helligkeit → Automatische Sperre* einen längeren Wert wählen.
- Der Piepton kommt nur, wenn die App im Vordergrund ist und der Stummschalter aus ist. Web-Apps dürfen im Hintergrund keinen Ton abspielen, und das iPhone vibriert bei Web-Apps nicht.
- Die Restzeit wird aus Zeitstempeln berechnet. Wechselst du kurz in eine andere App, stimmt der Countdown beim Zurückkommen trotzdem.
- Timer-Bedienung: **Minimieren** oder Tippen neben das Fenster macht ihn zu einer kleinen Blase, damit du den nächsten Satz eintragen kannst.

---

## 4. Datensicherung

**Exportieren:** *Mehr → Sicherung exportieren.* Auf dem iPhone öffnet sich das Teilen-Menü.
Dort **„In Dateien sichern“** wählen (z. B. iCloud Drive) oder die Datei per AirDrop/Mail verschicken.
Am Mac wird die Datei stattdessen heruntergeladen. Die Sicherung enthält alle Sätze und Testergebnisse als JSON.

**Importieren:** *Mehr → Sicherung importieren* → Datei in der Dateien-App auswählen.
Die Datei wird zuerst geprüft. Danach wählst du:

- **Zusammenführen:** Vorhandene Einträge bleiben. Gibt es denselben Eintrag (gleiches Datum, gleiche Übung, gleicher Satz) doppelt, gewinnt der neuere.
- **Ersetzen:** Alles Vorhandene wird gelöscht und durch die Sicherung ersetzt (mit Rückfrage).

---

## 5. Trainingsplan ändern

### a) Ohne neue Veröffentlichung (direkt auf dem iPhone)

1. `TrainingPlan.json` bearbeiten (am Mac) und z. B. in iCloud Drive speichern.
2. In der App: *Mehr → Neuen Plan importieren* → Datei auswählen.
3. Die App prüft den Plan. Bei Fehlern zeigt sie, was nicht stimmt, z. B. „startDate … ist kein Montag“ oder „sessionId … gibt es in dieser Phase nicht“.
4. **Plan übernehmen.** Alle bisherigen Einträge bleiben erhalten, denn sie hängen an Übungs-ID und Datum, nicht an der Position im Plan.
   Behalte deshalb die `id` einer Übung bei (z. B. `back-squat`), damit der Verlauf weiterläuft.

Der importierte Plan bleibt aktiv, bis du *Mehr → Mitgelieferten Plan verwenden* tippst, auch nach App-Updates.
Kommt mit einem Update ein geänderter mitgelieferter Plan, zeigt *Mehr* einen Hinweis.

### b) Mit neuer Veröffentlichung

`TrainingPlan.json` im Projekt ändern und wie unter „Update veröffentlichen“ ausrollen.

---

## 6. Update veröffentlichen

1. Dateien ändern.
2. **In `sw.js` die `VERSION` erhöhen**, z. B. von `'2026-11-24.1'` auf `'2026-12-01.1'`.
   Ohne diesen Schritt behalten die iPhones die alte Version im Cache.
3. Neue Dateien (z. B. eine neue `js/views/…`-Datei) zusätzlich in die Liste `ASSETS` in `sw.js` eintragen, sonst fehlen sie offline.
4. Hochladen:

   ```bash
   git add .
   git commit -m "Describe the change"
   git push
   ```

5. Nach 1–2 Minuten die App auf dem iPhone öffnen (mit Internet). Oben erscheint **„Update verfügbar – neu laden“**. Tippen, fertig.
   Kommt das Banner nicht: App ganz schließen (vom App-Umschalter wegwischen) und neu öffnen. iOS sucht beim Öffnen nach Updates.

Deine Einträge bleiben bei Updates erhalten.

---

## Projektstruktur

```
index.html              App-Gerüst, Tab-Leiste, Apple-Meta-Tags
styles.css              Layout (mobil zuerst, Dark Mode, Safe Areas)
manifest.webmanifest    PWA-Manifest
sw.js                   Service Worker (VERSION + ASSETS-Liste)
TrainingPlan.json       Der Trainingsplan (einzige Quelle)
icons/                  App-Icon (SVG + PNG 192/512, apple-touch-icon 180)
js/plan.js              Reine Planlogik: Datum, Phase, Woche, Deload, Vorgaben
js/validate.js          Prüfung von Plan und Sicherung, Zusammenführen
js/stats.js             Auswertungen (bester Satz, Testreihen)
js/svgchart.js          Selbst gezeichnete SVG-Diagramme
js/timerstate.js        Reine Timer-Berechnung (Zeitstempel)
js/timer.js             Timer-Oberfläche, Wake Lock, Ton
js/jump.js              Reine Sprung-Mathematik: Flugzeit → Höhe, Bildrate, Bildschritte
js/db.js, js/logs.js    IndexedDB-Speicher
js/views/…              Bildschirme (Heute/Tag, Plan, Tests, Messen, Verlauf, Mehr)
tests/                  Unit-Tests für node --test
package.json            Nur für node --test (keine Abhängigkeiten)
```

## Messen: Sprunghöhe per Video (in Arbeit)

Geplant ist die **Flugzeit-Methode**: Sprung in Zeitlupe filmen, Absprung- und Landebild markieren,
die App rechnet **h = g · t² / 8**. Mit 240 fps liegt die Genauigkeit bei etwa ± 1 cm, mit normalen 30 fps nur bei ± 6 cm.

**Stufe 1 (aktuell):** Der Tab *Messen* lädt ein Video, liest die exakte Bildrate und die Zeit jedes Bildes
direkt aus der Videodatei (MOV/MP4, `js/mp4.js`) und erlaubt Bild-für-Bild-Schritte.

1. Einmalig *Einstellungen → Kamera → Slo-Mo aufnehmen* auf **240 fps** stellen.
2. In der Kamera-App **Zeitlupe** wählen, ein paar Sekunden aufnehmen.
3. In *Fotos* das Video teilen → oben **Optionen → Alle Fotodaten** einschalten → **In Dateien sichern**.
4. In der App: *Messen → Video auswählen → Durchsuchen* → die Datei aus *Dateien* wählen.
5. Erkannte Bildrate ablesen (Quelle „Dateiangaben (exakt)“). Mit **◀ 1 / 1 ▶** Bild für Bild springen.

> Direkt aus der **Mediathek** gewählt, wandelt iOS Zeitlupen in ein 8× verlangsamtes 30-fps-Video um.
> Über **Dateien** kommt das Original mit 240 fps.

**Stufe 2 (folgt):** Absprung/Landung markieren, Höhe berechnen, als CMJ-Versuch unter *Tests* speichern.
