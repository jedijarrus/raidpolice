# Release Notes

## 2026-06-03

### Consumables-Tab: Filter Boss/Trash/Beides
Statt der separaten „Komplettübersicht"-Sektion gibt's jetzt im Consumables-Tab eines Reports oben drei Buttons **Boss · Trash · Beides**. Je nach Auswahl wird die Übersichtstabelle mit den entsprechenden Daten gerendert:
- **Boss** (Default): nur Boss-Fights, per-Fight expandable wie bisher.
- **Trash**: aggregiert über alle Trash-Fights pro Spieler — kein Per-Fight-Detail (wäre bei 70+ Trash-Fights zu teuer).
- **Beides**: Boss + Trash Items zusammengefasst pro Spieler. Threshold/Slacker-Logik gilt auf die Gesamtsumme.

Sektion wurde umbenannt auf einfach „Übersicht" (vorher „Slacker-Wertung"). Threshold-Marker als „Unter X% vom Primus" Divider weiterhin sichtbar.

Backend: neue Analyse-Type `consumablesTrash` ersetzt das alte `consumablesAll` (Raid-weite Aggregation), liefert per-Spieler aggregierte Items aus Trash-Fights. Backfill auf alle Reports erfolgt beim nächsten Pre-Analyzer-Cycle.

### Consumes-Slacker-Wertung admin-konfigurierbar + neue Defaults + zwei Analysen
Auf GM-Anforderung umstrukturiert: die Slacker-Wertung ist jetzt voll konfigurierbar **und** wird in zwei separate Analysen aufgeteilt.

**Konfiguration** (**Admin → Consumes / Edikt → Consumes — Slacker-Wertung**):
- Checkbox-Liste aller getrackten Consumes (Combat-Pots, Mana, Health/Mana-Gems, Runen, Engineering, Sonstige). Häkchen = zählt in Σ Bezahlt; abgewählt = wird angezeigt aber nicht mitgerechnet.
- Neue **Slacker-Schwelle**-Eingabe (% vom Primus). Default: **35%** (vorher hartcodiert 25%).
- Erweiterte Default-Ausschlüsse: zusätzlich zu Healthstones / Mana-Gems jetzt auch **Engineering-Items** (Profession-gebunden) und **class-exclusive Items** (Demonic Rune = Lock, Thistle Tea = Rogue). Dark Rune bleibt drin (anyone caster).

**Zwei Analysen** im Statistik-Tab:
- **A) Slacker-Wertung** — nur Bossfights, gefiltert auf die slacker-relevanten Items. Liefert die „Σ Bezahlt"-Summen und die 25%/35%-Slacker-Schwelle.
- **B) Komplettübersicht** — **alle** Fights inkl. Trash, **alle** Items inkl. Engineering/Healthstones/Mana-Gems. Zeigt was im Raid wirklich an Material verbraten wurde, ohne Slacker-Filter.

**Backend**: Neue Analyse-Type `consumablesAll` im Pre-Analyzer aggregiert Cast-Events + Buff-Apply-Bands über alle Fights (Boss + Trash). Wird beim nächsten Pre-Analyzer-Lauf automatisch für alle Reports nachgezogen.

## 2026-06-02

### Dashboard: Mitternachts-Raids landen wieder im richtigen Slot
Reports deren WCL-Logging erst nach Mitternacht startete (z.B. ein Donnerstag-Raid der überzog und im Log als Freitag 00:00 erscheint) wurden bisher dem falschen Wochentag zugeordnet und fielen so durch alle Schedule-Buckets durch — silent dropped.
- `getRaidDayKey` zählt Start-Zeiten zwischen 00:00 und 06:00 jetzt zum **Vortag**.
- Zusätzlich gibt's eine „Sonstige"-Sektion als Fallback für Reports, die in keinen Schedule-Slot passen und auch nicht 10-Mann sind — damit nichts mehr verschwindet.

## 2026-06-01

### Statistik: Flask/Elixir/Food werden nicht mehr pro Fight gezählt
Die Consumes-Übersicht im Statistik-Tab hat eine Flask pro Spieler **pro Bossfight** als Anwendung gezählt — bei 25 Spielern × 9 Bossen wurde eine einzige Flask-Runde so als 225 Anwendungen ausgewiesen. Da Flask 2h und Battle/Guardian/Food jeweils 1h halten, deckt ein Drink den ganzen Raid ab.
- Neu: pro `(Report, Spieler, Konsum-Name)` wird nur 1× gezählt. Wechselt jemand mid-raid die Flask (z.B. Chromatic Resistance auf Hydross, danach Greater Arcane Elixir), zählen das korrekt zwei verschiedene Anwendungen.
- Single-Use-Items (Pots, Runes, Engineering-Items, Sonstiges) bleiben pro Fight gezählt — die werden ja tatsächlich mehrfach konsumiert.

### Dedup: Parallele Logger desselben Raids
Zwei Reports vom selben Tag in derselben Zone mit Kill-Konflikten wurden als „zwei Raids hintereinander" interpretiert (z.B. Manual-Report + offizieller Gildenlog desselben SSC/TK-Abends). Neue Regel: Wenn der zweite Report startet, während der erste **noch läuft** (Zeitfenster überlappen), wird er als parallelen Logger derselben Session behandelt und gemerged — egal ob Kill-Konflikt. Erst wenn ein klarer Zeit-Gap zwischen den Reports liegt, greift die Split-Logik wieder.

## 2026-05-29

### Windfury-Erkennung über Aura statt Damage-Event
Die Hunter-Weave-Erkennung hat Windfury bisher anhand des Damage-Events `Windfury Attack` geprüft. Das ist unzuverlässig — WCL trackt den Proc als kurze Aura auf dem Spieler (`totalUptime > 0`), aber liefert nicht in jedem Fall ein zugehöriges Damage-Event in der damage-done-Tabelle.
- Neu: Detection nutzt die WF-Attack-Aura aus den ohnehin geholten Per-Fight-Buffs.
- Beispiel: Lyserie auf dem 28.05-Report wurde mit der alten Logik auf 0/15 Fights als Weaver erkannt, obwohl sie auf jedem Boss zweistellig Raptor Strikes gepostet hat. Mit der neuen Logik korrekt auf 8/15 markiert.

### Gear-Analyse: Leerer-Slot-Filter über alle Fights
Boss-Mechaniken wie Kael Weapon Storm können einen Slot temporär leeren — WCL hat im Snapshot dann einen Empty-Slot stehen, der bisher als „Leerer Slot (high)" geflaggt wurde.
- Neu: Wenn ein Slot **in irgendeinem Boss-Fight** des Reports gefüllt war, werden Empty-Slot-Issues für diesen Slot bei diesem Spieler in diesem Report ignoriert.
- Greift automatisch für alle Bosse mit ähnlicher Mechanik (Vashj Tainted-Phase, Solarian Wrath of the Astromancer Death+Res, etc.).

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

---

## Foundation (vor 2026-05-22)

Davor lag das Projekt im privaten Repo. Die nachfolgenden Features waren der Stand beim Initial-Commit ins Public-Repo am 22.05.2026.

### Dashboard & Reports
- Raid-Karten pro Wochentag mit Attendance-Übersicht und „letzter Raid"-Anzeige.
- Reports-Liste mit Filter auf Tracks (current/legacy) und Auto-Dedup pro Tag+Zone.
- Report-Detail-View mit Tabs: Fights, Buffs, Consumables, Gear, Spell-Ranks, Avoidable Damage, Trinkets, CDs, Analyse.
- Spieler-Detail-Seite (`#player/<name>`) mit Historie, Gear-Snapshots, Roles, Penalties, Attendance.
- Spieler-Entwicklung (Progression) mit Track-Toggle und Alt-Charakter-Merging.
- Statistik-Tab: Aggregate über Spielerteilnahme, Kill-Quoten, Wipe-Häufigkeiten.

### Live-Ticker
- Echtzeit-Polling der WCL-Guild-Reports in konfigurierten Raid-Zeitfenstern (alle 60s).
- Pro neuem Fight: Slacker-Detection für Buffs/Consumables/Trinkets/CDs, Gear-Issue-Übersicht.
- Spalten-Layout mit Klassen-Farben, Live-Dot in der Tab-Nav wenn ein Raid läuft.
- Manueller Start/Stop für Live-Window-Verlängerung außerhalb der Schedule-Slots.
- Simulation-Modus: spielt einen gecachten Report als Live-Raid ab für Tests/Demos.

### Report-Analyse Pipeline (Pre-Analyzer)
12 sequentielle Module pro Report, cached pro `(report, type, settings_hash)`:
- **Gear** — Enchants, Sockel-Gems (Rare/Epic), fehlende Verzauberungen, Klassen-spezifische Validierung.
- **Buffs** — Flask/Battle-Elixir/Guardian-Elixir/Food/Weapon-Enhancement/Scrolls pro Spieler pro Fight, mit Report-wide Fallback für vor Report-Start aktivierte Buffs.
- **Consumables** — Pots, Mana-Pots, Health-Pots, Runes, Engineering-Items, Sonstiges (Nightmare Seed etc.) — gezählt pro Spieler pro Fight.
- **Spell-Ranks** — Erkennt nicht-Max-Rank-Casts (z.B. niedrige Heal-Ränge bei Healern, Flask-of-Distilled-Wisdom statt Spellpower etc.).
- **Deaths** — Aggregierte Todeszählung pro Spieler über alle Fights.
- **Damage/Healing** — Per-Fight DPS/HPS-Tabellen pro Spieler.
- **Damage Taken** — Wer kassiert wie viel Schaden in welchem Fight, mit Ability-Breakdown.
- **Drums** — Drum-of-Battle-Casts pro Leatherworker, Uptime-Berechnung.
- **Avoidable Damage** — Boden-AoE, frontale Cones, Mechanic-Damage der ausweichbar gewesen wäre (Spell-ID-Liste pro Boss).
- **Wipes (Tier 1+2+3)** — Mehrschichtige Wipe-Ursachen-Analyse: Stuck-Detection, Death-Cascade, Boss-Mechanic-Misses, Slacker-Boxen mit Headlines.
- **Trinkets (On-Use)** — Wer benutzt seine On-Use-Trinkets, wer schläft drauf.
- **Cooldowns (Major CDs)** — Erwartete Major-CDs pro Rolle (z.B. Lay on Hands für Pala-Healer, Hero/Bloodlust-Trigger), Slacker-Liste pro Fight.

### Edikt & Policy-System
- Konfigurierbare Elixier-Policy pro `Class:Spec` mit Modes `any`, `whitelist`, `flask-only`.
- Public Edikt-Seite die die Policy lesbar mit Item-Icons und mehrstufiger Konsequenz-Liste darstellt.
- Editierbare Edikt-Texte für die Konsequenz-Stufen.
- Penalty-System: pro Spieler Strafprozente mit Begründung, Attendance-Penalties.

### ThatsMyBis Integration
- CSV-Import von TMB für Attendance, Loot-History, Raidgroups.
- Cookie-basierte Auth (Cookie via Admin-UI konfigurierbar).
- Auto-Refresh alle 30 Minuten im Hintergrund.
- Track-spezifische Attendance-Filterung (current vs legacy) basierend auf Raid-Schedule-Match.

### Admin-Bereich
- Session-Login mit HttpOnly-Cookie, 24h TTL, sliding nicht aktiv.
- Rollen: `admin` und `superadmin` (User-Management nur für Super).
- Tabs: Reports, Einstellungen (Akkordeon mit 7 Sektionen), Spieler & Roster, Strafen, Consumes/Edikt, Tracking, Aktionen, Benutzer (Super-only), Changelog.
- Komplettes Audit-Log aller Admin-Aktionen.

### WoW-Classic-Fresh-Anpassungen
- TBC Classic Fresh als Zielplattform: Items via wowhead.com/tbc, dataEnv=6.
- SSC/TK + Karazhan + Gruul + Mag voll abgedeckt mit Boss-Mechanic-Spell-IDs.
- Phase-bewusste Wipe-Erkennung (Vashj P2 Adds, Hydross Phasen-Wechsel, Leotheras Demon-Form, etc.).

### Infrastruktur
- SQLite via better-sqlite3, WAL-Mode, alle Caches und Settings als Key-Value.
- WCL v1 REST (600 req/h pro IP) + v2 GraphQL OAuth (9000 Punkte/h) Rate-Limit-Queue mit Auto-Retry.
- CSRF-Token pro Page-Load, alle `/api/`-Mutationen gegen geprüft.
- Docker-Bind-Mount-Deploy ohne Rebuild für Code-Updates.
