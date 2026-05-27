# Release Notes

## 2026-05-27

### Boss-Sonderregeln (Consumes / Edikt)
Pro Boss + Rolle lassen sich jetzt zusätzliche Flasks/Elixiere erlauben, die von der Base-Policy abweichen. Beispiel: Tanks dürfen auf Hydross **Flask of Chromatic Resistance** verwenden, ohne als Policy-Verstoß markiert zu werden.
- Additiv zur Klassen-Policy — Base-Whitelist bleibt erhalten, Boss-spezifische IDs kommen oben drauf.
- Editor unter **Admin → Consumes / Edikt → Boss-Sonderregeln** mit Boss-Dropdown, Role-Dropdown und Checkbox-Listen für Flasks/Battle-Elixire/Guardian-Elixire.
- Live-Ticker und Pre-Analyse berücksichtigen die Sonderregeln pro Fight.

### Flask/Elixir Cancel-Mechanik korrekt erkannt
Bisher hat die Buff-Erkennung eine Flask als „aktiv" gezählt, wenn ihr Band innerhalb der letzten 2h irgendwo begonnen hat — auch wenn der Spieler die Flask zwischenzeitlich durch ein Battle/Guardian-Elixir ersetzt hat. Das hat z.B. dazu geführt, dass ein Tank mit Chromatic Resistance auf Hydross noch auf Karathress fälschlich mit Chromatic angezeigt wurde.
- Neue Logik: Konsum-Timeline pro Spieler. Der jüngste Band-Start unter Flask/Battle/Guardian gewinnt; Elixir-Trinken cancelt Flask und umgekehrt (Spielmechanik).
- Greift in Buff-Analyse und Live-Ticker.

### Hunter Raptor-Weave + Windfury Erkennung
Hunter die aktiv Melee-Weaven und Windfury-Procs bekommen, brauchen keinen Sharpening Stone — der Weapon-Enhancement-Check wird für solche Fights übersprungen.
- **Detektion** pro Fight aus der Damage-Done-Tabelle:
  - ≥3 Raptor-Strike-Hits (alle Ränge: 2973, 14260–14266, 27014)
  - **UND** mindestens ein Windfury-Attack-Proc (25584/25583)
- Erscheint im Weapon-Enh-Cell als grüner Chip **„Raptor+WF"** mit Tooltip.
- Pro Fight individuell — wer nur auf Karathress weaved und auf Solarian rein ranged shootet, wird auf Solarian wieder normal geprüft.

### Manuelle Reports
Reports die nicht unter der Gilde geloggt wurden (z.B. wenn ein Spieler privat aufnimmt) lassen sich manuell hinzufügen.
- **Admin → Aktionen → Manuelle Reports**: WCL-URL oder Code reinpasten → Metadaten werden von WCL geholt, in DB gespeichert, Pre-Analyse startet im Hintergrund.
- Tauchen automatisch in der Reports-Liste und im Live-Ticker auf.
- Beim nächsten Guild-Refresh werden sie nicht aus dem Cache verworfen (Merge-Logik).

### UI-Fix: Checkbox-Labels in Boss-Sonderregeln
Eine globale CSS-Regel hat alle `<input>`-Elemente auf 100% Breite gestreckt — auch die Checkboxen — wodurch die Labels rechts daneben aus dem sichtbaren Bereich gedrückt wurden. Checkbox-Größe ist jetzt explizit auf 14×14px gepinnt.

---

## 2026-05-26

### Raid-Deduplizierung: Back-to-Back Same-Zone-Raids
Wenn am selben Tag zwei Gruul/Magtheridon-Raids hintereinander gefahren wurden, hat das Dashboard sie zu einer Karte zusammengefasst.
- Neue Logik: Reports werden zusätzlich gesplittet wenn (a) beide einen Kill desselben Bosses haben oder (b) die Zeitlücke zwischen ihnen >90 Minuten beträgt.

### Pre-Analyzer: Trinkets + Cooldowns bei wachsenden Reports
Während eines laufenden Raids wuchs der WCL-Report mit neuen Fights, aber Trinket- und Cooldown-Analysen wurden nicht neu berechnet. Beide Analysen sind jetzt in der `PER_FIGHT_TYPES`-Liste und werden bei Report-Wachstum invalidiert.

### Live-Ticker: Pet-Scrolls entfernt
WCL-Logs sind bei Pet-Scrolls nicht zuverlässig — Pet-Scroll-Anzeigen werden komplett ausgeblendet, sowohl im Live-Ticker als auch in der Auswertung.

### Live-Ticker: Buff-Anzeige aufgeräumt
- Spieler mit fehlenden Buffs werden in Spalten dargestellt (CSS Grid Masonry), jede Spalte gehört einem Spieler, mehrzeilig wenn nötig.
- Bei Policy-Verstoß zeigt das durchgestrichene Icon nun den tatsächlich genommenen Buff statt eines generischen Flask-Symbols.

---

## 2026-05-25

### Generalisierung & Sanitization für Public-Repo
- Alle hartcodierten Gilden-/Spieler-Referenzen entfernt; Branding, Raid-Schedule, Easter Eggs, API-Credentials, TMB-Cookie und Boss-Inhalte (current/legacy Zones) sind im Admin-Bereich konfigurierbar.
- Easter-Egg-CSS-Klassen anonymisiert (`egg-wobble`, `egg-popup`, `egg-girly`, `egg-letterswap`, …) — keine Spielernamen mehr im Source.
- `seed-existing-deploy.js` für bestehende Deploys hinzugefügt, akzeptiert alle Werte über ENV-Variablen.

### Admin-UI: API-Credentials Sektion + TMB-Cookie Anleitung
- Eigene Karte in Admin → Einstellungen: WCL v1 API-Key, WCL v2 Client ID/Secret, TMB-Cookie.
- Inline-Anleitung wie der TMB-Cookie via Browser DevTools extrahiert wird.
- Secrets werden niemals an den Client zurückgegeben (nur `_set`-Indikator).

### Aktionen-Tab aufgeräumt
Vier Gruppen: **Daten aktualisieren** / **Live-Ticker** / **Konfiguration** / **Wartung & Status**. Live-Ticker Simulation startet/stoppt jetzt direkt aus dem Admin-Interface.

### Edikt-Texte editierbar
Die Konsequenzen pro Verstoßstufe können im Admin-Bereich frei formuliert werden — Defaults sind neutral (keine gilden-spezifischen Texte mehr).

### Full Documentation (DOCUMENTATION.md)
10 Sektionen: Overview, Erstkonfiguration, Dashboard, Report-Analyse-Module, Live-Ticker, Admin-Bereich, Architektur, API-Endpoints, Settings-Referenz, Game-Konstanten. TMB-Integration ist erklärt (Attendance/Loot/RaidGroups Exports).
