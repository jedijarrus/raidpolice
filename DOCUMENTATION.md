# raidpolice — Vollständige Dokumentation

Stand: nach dem Generalisierungs-Refactor (Branch `main`).

## Inhalt

1. [Was die App tut](#was-die-app-tut)
2. [Erstkonfiguration](#erstkonfiguration)
3. [Dashboard — Public View](#dashboard--public-view)
4. [Report-Analyse-Module](#report-analyse-module)
5. [Live-Ticker](#live-ticker)
6. [Admin-Bereich](#admin-bereich)
7. [Architektur](#architektur)
8. [API-Endpoints](#api-endpoints)
9. [Settings-Referenz](#settings-referenz)
10. [Game-Konstanten (TBC-fix)](#game-konstanten-tbc-fix)

---

## Was die App tut

Pulled Warcraftlogs-Reports einer Gilde, vergleicht jeden Boss-Fight gegen erwartete Compliance-Regeln (Buffs, Consumables, Weapon-Enchants, Scrolls, Spell-Ranks, Gear-Sockel/Enchants/Gems, Major Cooldowns, On-Use Trinkets) und reichert das mit Attendance + Loot von ThatsMyBis an.

**Drei Hauptansichten:**

- **Dashboard** — pro-Raidtag Card-Liste der gecachten Reports, Spieler-Entwicklung über Wochen, Statistik-Übersicht, öffentliches Edikt (Consumable-Policy)
- **Report-View** — alle Analyse-Module für einen einzelnen Report (Buffs, Cons, Gear, Spells, Trinkets, CDs, Wipes)
- **Live-Ticker** — pollt aktive Raids während konfigurierter Raidzeiten und zeigt Slacker/Cons/CDs in Echtzeit

**Hinter den Kulissen:**

- WCL v1 REST (`fresh.warcraftlogs.com/v1`) für die meisten Endpunkte (600 req/h pro IP)
- WCL v2 GraphQL (OAuth) für Cast-Events (9000 Punkte/h)
- ThatsMyBis CSV-Exports für Attendance, Loot, Raid-Groups
- SQLite (`/app/data/cla-cache.db`) als Cache + Settings-Store
- Pre-Analyzer im Server-Prozess alle 30 min — neue Reports werden vollständig durchanalysiert und das Ergebnis gecached, damit der Browser nichts mehr rechnen muss

---

## Erstkonfiguration

Nach `docker compose up -d`: Browser öffnen, einloggen (Default-Admin wird aus `adminPassword`-Setting migriert beim ersten Login; sonst direkt in der DB anlegen), dann **Admin → Einstellungen** öffnen.

Die Settings-Page ist als Accordion strukturiert, Reihenfolge ist relevant:

### 1. Branding & Gilde

| Feld | Zweck |
|---|---|
| App-Name | Browser-Titel + Header-Logo |
| Gildenname | Wird als WCL-Guild-Lookup verwendet (`/reports/guild/{name}/{server}/{region}`) |
| Server | WCL-Server-Slug |
| Region | EU / US |
| Fraktion | Alliance / Horde (rein informativ) |

### 2. API-Credentials & Secrets

**WCL v1 API-Key**: warcraftlogs.com → Profile → ganz unten „Web API → Public Key".

**WCL v2 OAuth-Client**: warcraftlogs.com/api/clients/ → Create Client (Name beliebig, Redirect kann leer bleiben). Notwendig für Cast-Events (Consumable-Tracking, Cooldown-Tracking, Trinket-Tracking — alles was nicht aus dem v1-Buff-Endpoint kommt).

**TMB-Cookie**: Browser-DevTools → Application/Speicher → Cookies → `thatsmybis.com` → `laravel_session`-Wert kopieren. Im UI eintragen im Format `laravel_session=DER_WERT`. Cookie läuft nach Wochen ab — wenn TMB-Endpunkte 401/403 zurückgeben, hier neu setzen.

**Verhalten**: Secrets werden **nie** an den Client zurückgegeben, auch nicht maskiert. Stattdessen ein `${key}_set: true` Indikator. Felder zeigen Placeholder „(gesetzt — leerlassen um zu behalten)", beim Speichern werden nur Felder mit Inhalt überschrieben.

### 3. ThatsMyBis Guild

[ThatsMyBis](https://thatsmybis.com) ist ein verbreitetes Tool zur Verwaltung von WoW-Gilden — Mitgliederliste, Loot-Tracking (Wishlists + Verteilung) und Raid-Attendance. raidpolice integriert sich gegen drei TMB-CSV-Exports:

| Export | Wofür raidpolice es braucht |
|---|---|
| **Attendance** | Pro Raid-Tag: wer war da, wer benched, wer entschuldigt. Wird genutzt um Wochen ohne WCL-Log trotzdem zu zählen (TMB-only-Spalte in der Spieler-Entwicklung) und um die Attendance-Prozente korrekt zu berechnen (sonst würde abwesend = abwesend in WCL auch wenn der Spieler manuell als „present" eingetragen war). |
| **Loot** | Welcher Spieler hat welches Item bekommen (mit Offspec-Markierung). Zeigt sich als Loot-Spalte in der Spieler-Entwicklung + Tooltip mit Item-Liste. Loot-Aberkennungen (Admin → Strafen) werden auf diese Daten angewendet. |
| **Raid Groups** | Member → Alt-Characters Mapping. Erlaubt den „Charaktere zusammenfassen"-Filter in der Spieler-Entwicklung, damit ein Member mit Alts nicht mehrfach in der Liste auftaucht. |

| Feld | Beispiel |
|---|---|
| Guild-ID | `12345` |
| Guild-Slug | `myguild` |

Beide kommen aus der TMB-URL: `thatsmybis.com/{id}/{slug}/dashboard`.

Wenn nicht gesetzt: TMB-Endpunkte liefern 404, Attendance/Loot/Raidgroups fehlen — die App läuft trotzdem, aber ohne TMB-Anreicherung. Reine WCL-Daten reichen für Buff/Cons/Gear-Analyse, die Spieler-Entwicklung wird ohne TMB allerdings ungenauer (z.B. ist „abwesend" und „entschuldigt" nicht unterscheidbar).

**Cache & Refresh**: TMB-Daten werden alle 30 min im Hintergrund neu geholt. Manuell triggern: Admin → Aktionen → „TMB Daten laden".

### 4. Raid-Schedule

Eine Zeile pro wöchentlichem Raid:

| Spalte | Werte |
|---|---|
| Tag | ISO-Wochentag (Montag … Sonntag) |
| Startzeit | HH:MM (Berlin TZ) |
| Größe | 10 / 25 / 40 |
| Track | `current` oder `legacy` |

**Wirkung:**

- Live-Ticker pollt aktiv im Fenster `[startTime, startTime + 5h 30min]` für jeden Eintrag, inkl. Overflow nach Mitternacht
- Live-Ticker filtert WCL-Reports nach Raid-Size aus den hier erfassten Größen
- Dashboard zeigt pro Schedule-Eintrag eine eigene Raid-Card mit Tag-Label + (Altcontent)-Markierung
- Missing-Week-Detection (gelbe „Kein Report"-Lücken) läuft pro Schedule-Eintrag
- TMB-Track-Filter (Current vs Legacy in Spieler-Entwicklung) schaut auf das `track`-Feld des passenden Tages

### 5. Content-Klassifikation

Pro Raid-Zone (TBC): Dropdown mit **Auto / Current / Legacy**.

- **Auto** = Tier-Heuristik: T5+ wird als Current behandelt, alles darunter als Legacy
- **Current/Legacy** = explizite Klassifikation (überschreibt Tier-Heuristik)

Wirkung: bestimmt welche Reports in den Current-Track vs Legacy-Track der Spieler-Entwicklung fallen. Track-Override pro einzelnem Report kann zusätzlich in der Reports-Tabelle gesetzt werden.

### 6. Edikt-Texte

Alle Strings der öffentlichen Edikt-Seite sind editierbar:

| Feld | Wirkung |
|---|---|
| Titel | `<h1>` der Edikt-Seite |
| Untertitel | Erläuterungs-Paragraph unter dem Titel (HTML erlaubt) |
| Footer | Optional, Signatur am Ende (HTML erlaubt) |
| Leer-Text | Anzeige wenn keine Policy gepflegt ist |
| Regel: Frei | Text für `mode: 'any'` (alles erlaubt) |
| Regel: Flask only | Text für `mode: 'flask-only'` |
| Whitelist-Header Flask | Überschrift der erlaubten-Flask-Liste in `mode: 'whitelist'` |
| Whitelist-Header Combo | Überschrift der Battle+Guardian-Combo-Liste |
| Battle/Guardian-Label | Spaltenüberschriften der Combo-Tabelle |
| Combo „keine erlaubt" | Platzhalter wenn Battle/Guardian-Liste leer |
| „Nur Flask zählt" | Spezialfall: Whitelist hat nur Flasks, keine Combos |
| Class-Überschrift | Template, `{className}` wird ersetzt (z.B. `An die {className}`) |
| Role-Überschrift | Template mit `{className}` / `{specLabel}` / `{flavor}` |
| Class-Flavor (JSON) | Map `{ "Warrior": "Krieger", … }` für lokalisierte Klassennamen |
| Role-Flavor (JSON) | Map `{ "Warrior:tank": "die eisernen Bastionen", … }` für RP-Etiketten |
| Role-Footnote (JSON) | Map `{ "Rogue:dps": "...", … }` für spec-spezifische Fußnoten |

Untertitel + Footer akzeptieren HTML (für `<strong>`, Emoji etc.). Alle anderen Texte werden escaped.

### 7. Easter Eggs

Pro Eintrag: Spielername + Type + Alt/Popup-Text. Wirkt sich auf `renderPlayerName()` aus — also überall wo ein Spielername in der UI als Link erscheint.

| Type | Verhalten |
|---|---|
| `wobble` | Hover swappt Name auf `alt`-Text |
| `popup` | Hover zeigt Popup mit `alt`-Text neben dem Namen |
| `girly` | Hover aktiviert „girly-mode" auf der ganzen Seite (pink particles + cursor) |
| `letterswap` | i↔a tauschen (CSS-codiert, nur visuell, kein alt-Text nötig) |
| `slacker-wobble` | Wobble-Variante mit Schlaf-/Gähn-Animation |
| `tank-death-wobble` | Großes wackelndes alt-Wort im Wipe-Analyse-Event-Log wenn dieser Tank stirbt |

Mehrfache Einträge pro Spieler möglich — z.B. ein Eintrag mit `wobble` für normales Hover plus ein `tank-death-wobble` für Wipe-Analyse.

---

## Dashboard — Public View

### Tab „Raids"

Eine Card pro Raid-Schedule-Eintrag (z.B. „25-Man — Dienstag", „25-Man — Donnerstag", „25-Man — Montag (Altcontent)"). Reports werden gebucketet nach Wochentag + Raid-Size.

Pro Card eine Tabelle mit:
- Datum, Zeit, Dauer
- Boss-Fortschritt (Kills/Wipes)
- Klick auf Datum öffnet den Report

Reports werden gruppiert: zusammengehörige Logs desselben Raidabends (z.B. Hauptlog + Reklog) zusammen angezeigt.

**Missing-Week-Indikatoren**: gelbe Zeilen für Wochen wo kein WCL-Report existiert. Wenn ein TMB-Raid für diesen Tag/Wochentag bekannt ist, wird er als „TMB-only" Eintrag angezeigt (für Attendance-Berechnung).

### Tab „Live"

Live-Ticker — separate Sektion, siehe [Live-Ticker](#live-ticker).

### Tab „Spieler-Entwicklung"

Eine Matrix-Tabelle: Spieler × Raids, Wochen werden als Header zusammengefasst.

Pro Spieler-Raid-Zelle:
- Hintergrund-Farbe codiert Status (Kill, Wipe, abwesend, entschuldigt, gebenched, aberkannt)
- Klick öffnet Tooltip mit Flask/Food/Weapon/Scrolls-Compliance-Prozenten
- Kleine farbige Dots in der Zelle: Flask✓, Food✓, Weapon✓, Scrolls✓

**Filter:**
- Mo/Di/Do-Checkboxen (zur Zeit hardcoded auf 3 Tage)
- Track-Toggle: Current Content / Altcontent
- „Charaktere zusammenfassen" — merged Alt-Charaktere desselben Members via TMB-RaidGroups-Daten
- „Offspec-Gear" — zeigt Off-Spec-Items als gelbe Issues statt rote

**Spalten neben dem Namen:**
- Anw. — Attendance % (aktive Wochen relativ zur Track-Wochenzahl)
- Trend — Verbesserung/Verschlechterung über letzte 4 vs 4 Wochen
- Cons. — Durchschnitt aus Flask/Food/Weapon/Scrolls-Quoten
- Loot — Anzahl Items von TMB (mit Offspec-Markierung in Tooltip)

**Penalty-Indikatoren** rechts vom Attendance: `(2B)` = 2× gebenched, `(1R)` = 1× aberkannt, `(3E)` = 3× entschuldigt, `-10` = manuelle Strafe.

### Tab „Statistik"

Raid-Zusammenfassung: Top-Performer (höchste Quoten), Slacker-Bottom-List, Durchschnitte über alle aktiven Member.

### Tab „📜 Edikt"

Öffentlich lesbares Dokument mit den Consumable-Policies pro Class:Spec. Wird aus den Edikt-Texten + Elixir-Policy generiert. Spec-Reihenfolge: Tank → Heal → DPS-Varianten.

Drei Policy-Modi pro Spec:
- **any** — alles erlaubt, free-for-all (Edikt-Standardregel: „Regel: Frei")
- **flask-only** — nur Flask, keine Battle+Guardian-Combo (Edikt-Standardregel: „Regel: Flask only" + Whitelist der erlaubten Flasks)
- **whitelist** — explizite Listen erlaubter Flasks UND Battle+Guardian-Combos

---

## Report-Analyse-Module

Jeder gecachte Report hat fett vorberechnete Analysen die im Report-View per Tab angezeigt werden.

### Buffs

Pro Spieler pro Fight: Flask/Elixir, Food, Weapon-Enchant (Stone/Oil), Scrolls.

- **Policy-Verstöße**: angemeldet als „Flask: Mongoose (Policy-Verstoss)" — Icon ist der **tatsächlich konsumierte** Spell mit roter Strike-Through (nicht das generische Flask-Item)
- **Weapon-Enchants**: bei Dual-Wield wird MH und OH einzeln geprüft. Caster bekommen Wizard-Oil/Mana-Oil als erwartetes Icon, Physical-DPS Sharpening-Stone
- **Scrolls**: per Class:Spec-Role definierte Pflicht-Scrolls (siehe `SCROLLS_REQUIRED` in preanalyze.js — TBC-fix). Pet-Scrolls (Hunter) wurden entfernt weil WCL-Logs unzuverlässig waren
- **Klick auf Spieler-Zeile** expandiert die per-Fight-Details

### Consumables

Pro Spieler pro Fight: Mana-/Health-Potions, Runes, Engineering-Verbrauchsgegenstände (Bomb, Net, Grenade), Andere (Drums, Bandagen). Aggregiert über Buff-Events (Aura applied) und Cast-Events (Spell cast).

Tracked Items: siehe `CONSUMABLE_BUFF_IDS` + `CONSUMABLE_CAST_IDS` in preanalyze.js. Bekannte TBC-Items inklusive Mighty Rage, Mad Alchemist's Potion, Fel Mana, Magic Resist, Sapper Charge, Goblin Sapper, Adamantite Grenade, Frostweave Net etc.

Anzeige als Wowhead-iconisierte Pills mit Count-Badge.

### Gear (Verzauberungen / Gems / Sockel)

Pro Spieler: alle Slots gegen Compliance-Regeln geprüft.

- **Disconnect Detection**: ≥14 leere Slots → ganze Fight-Iteration als „disconnect" markiert und aus der Progression-Bewertung ausgeschlossen
- **Vanilla-Enchants** — togglebare Setting: erlaube non-TBC-Enchants (manche Slots haben in TBC bessere Enchants, manchmal sind Classic-Enchants zulässig)
- **Rare Gems Pflicht / Epic Gems Pflicht** — Settings: definiert Schwelle für „akzeptable" Gem-Qualität
- **Meta-Gem Activation** — prüft die Meta-Gem-Bedingung (z.B. „2 red, 1 blue"). Wenn nicht aktiv → high-severity issue mit Counter „inaktiv in X/Y Fights"
- **Offspec-Toggle**: zeigt typische Offspec-Items (z.B. Healing-Set bei Vergeltungs-Pala) gelb statt rot

### Spell-Ranks

Pro Spieler: gecastete Spells werden gegen Klasse/Level-Max-Rank verglichen. Downranks (z.B. Heal Rank 4 statt 11) werden gemeldet — kann legit sein (Mana-Saving) oder nicht.

- **Healer-Downranks ausblenden** — togglebare Filter-Checkbox: Healer downranken bewusst, also Standard-mäßig ausgeblendet

Anzeige als Wowhead-Spell-Icons mit Cast-Count-Badge.

### Wipes (Tier 1+2+3)

Für jeden Wipe: zeitliche Event-Sequenz mit Icons. Aufgeschlüsselt nach:

- **Erster Tod**: prominent dargestellt mit „Loooooooooooooser"-Gag-Animation (Easter-Egg)
- **Tank-Tode**: 🛡 Icon, optional Easter-Egg-Wobble für getrackte Tanks
- **Healer-OOM**: 🩹 wenn Mana-Curve unter 10% fällt
- **Avoidable Damage**: pro Boss-Mechanik-Spell — wer wann von welcher Mechanik getroffen wurde
- **DPS-Slacker**: Spieler die hinter ihrer Klassen-/Spec-Median-DPS zurückbleiben
- **Stuck-Detection**: Spieler die >15s ohne Action stehen

Charts:
- HP-Verlauf des Bosses
- Spieler-DPS-Curves
- Healer-Mana-Curves

### Trinkets (On-Use)

Pro Spieler: equipped slot 12/13 wird aus `ONUSE_TRINKET_ITEM_TO_SPELL` Lookup als On-Use-Trinket erkannt. Cast-Events des Use-Spells werden gezählt.

Trinket-Slacker: equipped Trinket aber 0 Casts im Fight → wird in der Slacker-Box gelistet (mit ⚠ Equipped, nicht benutzt).

Tracked Trinkets: ~37 Stück, siehe `ONUSE_TRINKETS` in preanalyze.js (Auto-Blocker, alle JC Figurinen, Earring of Soulful Meditation, Bloodlust Brooch, Hourglass etc.). Liste im **Admin → Tracking** Tab live einsehbar.

### Cooldowns (Major CDs)

Pro Spieler: Klasse/Spec-spezifische Major Cooldowns (Cooldown ≥2 min, ≤8 min) — Recklessness, Avenging Wrath, Pain Suppression, Inner Focus, Shamanistic Rage, Elemental Mastery, etc.

CD-Slacker-Detection: bestimmte Specs haben Erwartung dass Major-CD gezündet wird. Wenn 0 Casts → in Slacker-Box.

Spec-spezifische Erwartungen (siehe `LIVE_CD_ROLE_EXPECTATIONS`):
- Priest:healer → nur `innerFocus` (Disc/Holy-Deep-Talents werden nicht angenommen)
- Priest:dps → kein PI/Pain Sup/Devouring Plague (PI ist Disc, Devouring Plague ist Undead-Racial)
- Paladin:tank → nur Avenging Wrath (Divine Shield/Protection würden Aggro verlieren)
- Shaman:enhancement → nur Shamanistic Rage (Elemental Mastery braucht Elemental-Talents)

---

## Live-Ticker

Server pollt alle 60 Sekunden ob ein Live-Raid läuft. Trigger:

1. Aktuelles Fenster matcht eine Raid-Schedule-Zeile (Wochentag + Zeit)
2. ODER manueller Live-Mode aktiv (Admin → Aktionen → „Liveticker manuell starten")
3. ODER Simulation läuft (Admin → Aktionen → „Live-Ticker Simulation")

Wenn aktiv: WCL `/reports/guild/...` ohne Cache abgefragt, Reports mit Start <6h alt UND Zone-Size aus dem konfigurierten Schedule. Letzte Aktivität >30 min → Raid wird als beendet markiert aber Daten bleiben angezeigt.

### Live-View-Komponenten

**Header-Bar (oben):**
- Zone-Badge (SSC/TK etc.)
- Live-Status (• Live / Beendet)
- Kill-/Wipe-Counter
- „Analysiere…" Indikator während ein Fight gerade verarbeitet wird

**Raid-Zusammenfassung-Card (über allen Fights):**
- Aggregierter Consumable-Verbrauch über alle Fights
- Aggregierte Trinket-Nutzung
- Pro Spalte: Primus (Top-Verbraucher) + Slacker

**Pro-Fight-Card:**
Headline mit Boss-Name, Kill/Wipe-Badge, Dauer. Body als 4-Spalten-Masonry:

1. **Missing Buffs** — pro Spieler eine Reihe, jeder fehlende Buff (Flask/Food/Weapon/Scrolls) auf eigener Zeile. Policy-Verstöße haben durchgestrichenes Icon des tatsächlich konsumierten Spells. Visuelle Trennung zwischen verschiedenen Spielern (gestrichelte Linie).
2. **Downranked Spells** — nur Icons + Cast-Count
3. **Consumables** — 2-Spalten-Split: links Verbrauchten, rechts „X ohne"
4. **Major CDs** — Spieler die CDs gezündet haben + Slacker-Liste „⚠ Kein Major-CD gepoppt"
5. **On-Use Trinkets** — Trinket-Uses + Equipped-aber-nicht-benutzt-Slacker

**Älterer Fights** in Compact-Form, klick zum Expandieren.

### Simulation

Im Admin → Aktionen → **Live-Ticker Simulation**:
- Dropdown mit den letzten 20 gecachten Reports (sortiert nach Startdatum DESC)
- Default: „— Neuester Report —"
- ▶ Starten → spawnt `simulate-live.js` als Child-Process im Server-Container
- ■ Stoppen → SIGTERM + State-File aufräumen
- Status-Zeile: „● Läuft" oder „○ Gestoppt"

Sim spielt die echten gecachten Daten ab, alle 15s ein Fight. State wird in `data/live-sim-state.json` geschrieben — der `/api/live/status` Endpoint zieht diese Datei als Override falls vorhanden.

---

## Admin-Bereich

Login-Wall: Username + Passwort. Sessions als HttpOnly-Cookies, 24h TTL. Rate-Limit auf Login-Versuche pro IP.

### Tab „Reports"

Liste aller gecachten Reports. Pro Eintrag:
- Datum, Zone, Spieleranzahl, Dauer
- Track-Override-Dropdown (Auto/Current/Legacy)
- ✕ Ausschließen (Report wird komplett aus allen Berechnungen genommen)
- 🔄 Re-Analyse erzwingen (alle Caches für diesen Report invalidieren + Pre-Analyzer triggern)

### Tab „Einstellungen"

Siehe [Erstkonfiguration](#erstkonfiguration). 6 Accordion-Sections.

### Tab „Spieler & Roster"

- **Joindates** — pro Spieler ein manuelles Beitrittsdatum. Wirkt sich auf die Wochenzählung in der Attendance-Berechnung aus (Spieler vor seinem Joindate zählt nicht als „abwesend")
- **Rollen-Override** — manuell Tank/Healer/DPS pro Spieler festlegen (overridet die automatische Mehrheitsentscheidung)
- **Excluded Players** — komplett aus allen Listen entfernen (Member die nicht mehr in der Gilde sind)
- **Entschuldigte Spieler** — pro Woche markieren, Wochenwert zählt nicht im Attendance-Nenner

### Tab „Strafen"

- **Attendance-Strafen** — manuelle Prozentpunkte-Abzüge mit Grund
- **Loot-Aberkennungen** — pro Woche bestimmten Spielern den TMB-Loot annullieren (z.B. wegen Sliding-/Bidding-Verstoß)

### Tab „Consumes / Edikt"

- **Elixir-Policy-Editor** — pro Class:Spec den Modus (any/flask-only/whitelist) + erlaubte Flask/Battle/Guardian-IDs pflegen. Wird vom Edikt-Tab + Live-Ticker + Progression-Buffs gelesen.

### Tab „Tracking"

Read-only Anzeige aller aktuell getrackten Spell-IDs / Item-IDs:
- Buffs (Flask, Battle, Guardian, Food, Scrolls, Weapon)
- Consumables (Buff-applied + Cast-based)
- Major Cooldowns (pro Klasse + Spec)
- On-Use Trinkets (Spell-ID → Item-Name)

Alle IDs sind direkte Wowhead-Links für Kontrolle.

### Tab „Aktionen"

4 Gruppen:

**Daten aktualisieren:**
- *Reports & Analysen* — alle WCL-Reports neu laden + Spieler-Entwicklung-Cache rebuilden
- *TMB Daten laden* — Attendance/Loot/Raidgroups einzeln oder gesammelt frisch holen

**Live-Ticker:**
- *Liveticker manuell starten* — 30-min-Fenster manuell öffnen (außerhalb regulärer Raidzeiten)
- *Live-Ticker Simulation* — gecachten Report als Live abspielen (siehe oben)

**Konfiguration:**
- *Report-Startdatum* — Reports vor diesem Datum werden komplett ignoriert

**Wartung & Status:**
- *System-Info* — Cache-Statistiken, Datei-Größen, WCL-API-Rate-Limit-Status
- *WCL API-Cache* — gefährlich: alle gecachten WCL-Responses löschen, beim nächsten Aufruf wird alles frisch geholt

### Tab „Benutzer" (Superadmin-only)

Admin-User verwalten: anlegen, Rolle ändern (admin/superadmin), Passwort zurücksetzen, löschen.

### Tab „Changelog"

Alle Admin-Aktionen mit Zeitstempel + User + Details. Append-only.

---

## Architektur

```
Browser (vanilla JS, Wowhead-Tooltips)
   │
   ├─ /api/branding          → public Settings (App-Name, Eggs, Schedule, ...)
   ├─ /api/live/status       → public Live-State
   ├─ /api/edikt-policy      → public Elixir-Policy
   │
   ├─ /api/admin/*           → CSRF-Token + Session-Cookie
   ├─ /api/tmb/*             → CSRF
   ├─ /api/wcl/*             → CSRF, server-side WCL-API-Key
   │
   ▼
Server (Node.js, http nativ, kein Framework)
   │
   ├─ Pre-Analyzer (im Server-Prozess, setInterval 30 min)
   ├─ Live-Poller (setInterval 60 s)
   ├─ TMB-Background-Refresh (setInterval 30 min)
   │
   ▼
SQLite (better-sqlite3, WAL-Mode, im Volume `cla-data`)
   │
   ├─ report_data            (report_code → fights/players/meta JSON)
   ├─ report_analysis        (report_code × analysis_type → result JSON)
   ├─ api_cache              (URL × params → response_json + fetched_at)
   ├─ guild_reports_cache    (guild_lookup → list of reports)
   ├─ app_settings           (key → value)
   ├─ admin_users            (username → password-hash + role)
   ├─ admin_sessions         (session-token → user + createdAt)
   ├─ admin_changelog        (timestamp, user, action, details)
   ├─ penalties              (player → percentage + reason)
   ├─ revoked_loot           (player + week → revoked flag)
   ├─ excused_weeks          (week → flag)
   ├─ excused_players        (player + week → flag)
   ├─ excluded_reports       (report_code)
   ├─ excluded_players       (player_name)
   ├─ player_join_dates      (player → date)
   ├─ player_role_overrides  (player → tank/healer/dps)
   ├─ report_track_overrides (report_code → current/legacy)
   ├─ gear_snapshots         (player × timestamp → equipped items)
   └─ bug_tickets            (id, title, description, status, comments)
```

**Pre-Analyzer-Pipeline:**

Beim Boot + alle 30 min: WCL `/reports/guild/...` für die konfigurierte Gilde. Neue Report-Codes werden in `report_data` gespeichert. Für jeden noch-nicht-analysierten Report werden sequentiell die Analyse-Typen abgearbeitet:

1. `gear` — equipped slots per Spieler per Fight
2. `buffs` — Flask/Food/Weapon/Scrolls per Spieler per Fight
3. `consumables` — Buff- + Cast-Events aggregiert pro Spieler
4. `spellranks` — Cast-Events vs Max-Rank-Tabellen
5. `deaths` — Tod-Events mit Killing-Blow-Quelle
6. `dmgheal` — DPS/HPS-Aggregate
7. `damagetaken` — Avoidable-Mechaniken-Treffer
8. `drums` — Drum-of-Battle-Casts pro Leatherworker
9. `avoidable` — Boss-Mechanik-Spells (Pre-erkannte gefährliche IDs)
10. `wipes` — Tier-1+2+3 Wipe-Analyse
11. `trinkets` — On-Use-Spell-Casts vs equipped Trinkets
12. `cooldowns` — Major-CD-Casts vs Spec-Erwartung

Ergebnis-JSON wird in `report_analysis` mit `analysis_type` + `settings_hash` gecached. Browser holt fertige Bundles per `/api/report/{code}` ohne selbst zu rechnen.

---

## API-Endpoints

### Public (kein Auth, kein CSRF)

| Pfad | Methode | Zweck |
|---|---|---|
| `/api/branding` | GET | App-Name, Guild-Info, Easter-Eggs, Raid-Schedule, Edikt-Texte |
| `/api/live/status` | GET | aktueller Live-Ticker-State (oder Sim-State falls aktiv) |
| `/api/edikt-policy` | GET | Elixir-Policy für die Edikt-Seite |

### CSRF-protected (Session benötigt für Mutationen)

| Pfad | Methode | Zweck |
|---|---|---|
| `/api/settings` | GET / POST | Allowed-Settings lesen/schreiben |
| `/api/report/{code}` | GET | Vollständiges Analyse-Bundle |
| `/api/tmb/attendance` | GET | TMB Attendance CSV → JSON |
| `/api/tmb/loot` | GET | TMB Loot CSV → JSON |
| `/api/tmb/raidgroups` | GET | TMB Member→Char Mapping |
| `/api/wcl/*` | * | WCL-Proxy (mit Server-API-Key, gecached) |

### Admin (Session erforderlich)

| Pfad | Methode | Zweck |
|---|---|---|
| `/api/admin/login` | POST | Username+Passwort → Session-Cookie |
| `/api/admin/logout` | POST | Session beenden |
| `/api/admin/session` | GET | Aktuelle Session-Info |
| `/api/admin/change-password` | POST | Eigenes Passwort ändern |
| `/api/admin/users` | GET / POST / PATCH / DELETE | Superadmin: User-Verwaltung |
| `/api/admin/reports` | GET | Liste mit Track + Excluded-Status |
| `/api/admin/report/{code}/track` | POST | Track-Override setzen |
| `/api/admin/report/{code}/exclude` | POST | Report ausschließen |
| `/api/admin/report/{code}/reanalyze` | POST | Re-Analyse triggern |
| `/api/admin/penalties` | GET / POST / DELETE | Strafen-CRUD |
| `/api/admin/revoked` | GET / POST | Loot-Aberkennungen |
| `/api/admin/excused` | GET / POST | Entschuldigte Wochen |
| `/api/admin/excused-players` | GET / POST | Entschuldigte Spieler pro Woche |
| `/api/admin/excluded-players` | GET / POST | Excluded-Player-Liste |
| `/api/admin/player-roles` | GET / POST | Role-Overrides |
| `/api/admin/join-dates` | GET / POST | Joindates |
| `/api/admin/tracking-config` | GET | Live-Tracking-Config (read-only) |
| `/api/admin/sysinfo` | GET | Cache-Statistiken |
| `/api/admin/changelog` | GET | Audit-Log |
| `/api/admin/elixir-policy` | GET / POST | Policy editieren |
| `/api/admin/refresh-reports` | POST | Alle WCL-Reports neu holen |
| `/api/admin/rebuild-progression` | POST | Progression-Cache rebuilden |
| `/api/admin/clear-cache` | POST | WCL-API-Cache leeren |
| `/api/admin/live/start` | POST | Manueller Live-Mode 30 min |
| `/api/admin/live/stop` | POST | Manuellen Live-Mode beenden |
| `/api/admin/sim/start` | POST | Simulation starten `{reportCode?}` |
| `/api/admin/sim/stop` | POST | Simulation killen |
| `/api/admin/sim/status` | GET | Sim läuft? |
| `/api/admin/sim/recent-reports` | GET | Letzte 20 Reports für Dropdown |
| `/api/admin/wipes` | GET | Alle Wipe-Analysen |
| `/api/admin/pipeline-status` | GET | Pre-Analyzer-Status |

---

## Settings-Referenz

Alle Keys sind in `app_settings` Tabelle, als Strings. JSON-Werte werden als kompakter String gespeichert.

### Branding

| Key | Typ | Wirkung |
|---|---|---|
| `appName` | string | Browser-Titel, Header-Logo |
| `guildName` | string | WCL Guild-Lookup |
| `serverName` | string | WCL Server-Slug |
| `region` | string | EU/US |
| `faction` | string | Alliance/Horde (informativ) |

### Secrets (niemals an Client zurückgegeben)

| Key | Typ | Wirkung |
|---|---|---|
| `apiKey` | string | WCL v1 Public Key |
| `wclV2ClientId` | string | WCL v2 OAuth Client-ID |
| `wclV2ClientSecret` | string | WCL v2 OAuth Client-Secret |
| `tmbCookie` | string | `laravel_session=...` |

### TMB

| Key | Typ | Wirkung |
|---|---|---|
| `tmbGuildId` | string | Numerische ID in der TMB-URL |
| `tmbGuildSlug` | string | URL-Slug der Gilde |

### Raid-Schedule (JSON-Array)

`raidSchedule` = `[{ dayOfWeek, startTime, raidSize, track }]`:

```json
[
  {"dayOfWeek": 2, "startTime": "19:30", "raidSize": 25, "track": "current"},
  {"dayOfWeek": 4, "startTime": "19:30", "raidSize": 25, "track": "current"},
  {"dayOfWeek": 1, "startTime": "19:30", "raidSize": 25, "track": "legacy"}
]
```

`dayOfWeek`: ISO 1=Montag .. 7=Sonntag. `track`: `current` oder `legacy`.

### Zone-Klassifikation (JSON-Arrays)

| Key | Beispiel |
|---|---|
| `currentZones` | `[1007, 1008, 1056]` |
| `legacyZones` | `[1001, 1002, 1003, 1047, 1048]` |

Zone-IDs aus `js/data.js` → `CLA_DATA.zones`. Wenn eine Zone in keiner Liste: Tier-Heuristik (T5+ = current).

### Easter Eggs (JSON-Array)

`easterEggs` = `[{ name, type, alt|text }]`:

```json
[
  {"name": "PlayerA", "type": "wobble", "alt": "AltName"},
  {"name": "PlayerB", "type": "popup", "text": "Popup-Text"},
  {"name": "PlayerC", "type": "girly"},
  {"name": "TankPlayer", "type": "tank-death-wobble", "alt": "DeathWord"}
]
```

### Edikt-Texte (JSON-Object)

`ediktTexts` = Object mit allen Edikt-Strings + den Maps `classFlavor` / `roleFlavor` / `roleFootnote`. Siehe Settings-UI für vollständige Feld-Liste, oder Default-Struktur in `EDIKT_DEFAULTS` (`js/app.js`).

### Analysis-Toggles

| Key | Typ | Wirkung |
|---|---|---|
| `vanillaEnchants` | bool | Classic-Era-Enchants akzeptieren |
| `rareGems` | bool | Rare-Quality Gems verpflichtend |
| `epicGems` | bool | Epic-Gems verpflichtend |
| `foodRequired` | bool | Food-Buff als Pflicht (Default true) |
| `flaskRequired` | bool | Flask-Buff als Pflicht |
| `weaponEnhRequired` | bool | Weapon-Enchant als Pflicht |

### Misc

| Key | Wirkung |
|---|---|
| `elixirPolicy` | JSON: Class:Spec → Policy-Mode + Whitelist-IDs |
| `reportStartDate` | YYYY-MM-DD: Reports davor werden ignoriert |
| `adminPassword` | Legacy — wird beim ersten Start in `admin_users` migriert |

---

## Game-Konstanten (TBC-fix)

Diese Daten liegen im Code (`preanalyze.js`, `js/data.js`) und sind nicht über die UI editierbar — sie beschreiben das Spiel selbst und ändern sich zwischen Gilden nicht.

**Buff-IDs:**

- `BUFF_IDS.flask` — Flask-of-Relentless-Assault, Mongoose, Pure-Death etc.
- `BUFF_IDS.battleElixir` / `BUFF_IDS.guardianElixir` — Battle/Guardian-Hälften
- `BUFF_IDS.foodBuff` — TBC-Food (Spicy Crawdad, Blackened Sporefish, Skullfish Soup etc.)
- `BUFF_IDS.scrolls` — Scroll-of-Stat-V Aura-IDs
- `BUFF_IDS.scrollRequired` — pro Role-Key (Class:Spec) die Liste erwarteter Stats

**Consumables:**

- `CONSUMABLE_BUFF_IDS` — Items die einen Aura-Buff auslösen (Demonic Rune, Dark Rune, Mighty Rage Potion etc.)
- `CONSUMABLE_CAST_IDS` — Items deren Use-Spell als Cast erscheint (Mana Potion, Healthstone, Sapper Charge, Adamantite Grenade, Bandagen, Conjure Mana Gem, Fear Ward etc.)

**Major Cooldowns:**

`MAJOR_COOLDOWNS` — pro Class:Spec eine Liste der relevanten ≥2-min-CDs (Recklessness, Bloodlust, Avenging Wrath, Innervate, Pain Suppression, Power Infusion, Inner Focus, Shamanistic Rage, Elemental Mastery etc.).

`LIVE_CD_KEYS` — Subset davon (2-8 min CDs, die im Live-Ticker getrackt werden).

`LIVE_CD_ROLE_EXPECTATIONS` — pro Role-Key welche CDs gepoppt werden müssen damit der Spieler nicht in der Slacker-Box landet.

**Trinkets:**

`ONUSE_TRINKETS` — Spell-ID → `{item, name}` für ~37 On-Use-Trinkets (alle JC-Figurinen, Earring of Soulful Meditation, Bloodlust Brooch, Hourglass etc.).

**Boss-Mechaniken (SSC/TK):**

In der Wipe-Analyse referenzierte Spell-IDs für „avoidable damage" pro Boss.

**Klassen-Konstanten:**

- `VALID_CLASSES` — alle 9 TBC-Klassen
- `SPEC_LABELS` — Tank/Healer/DPS-Varianten pro Klasse
- Class-CSS-Classes — für die WCL-Class-Farben

---

## Anhang: Seed-Script für bestehende Deployments

`seed-existing-deploy.js` — initialisiert leere Settings beim Migrieren von einer pre-Generalisierungs-Installation. Wird einmalig im Container ausgeführt:

```bash
docker exec \
  -e SEED_APP_NAME='My Raid Tool' \
  -e SEED_GUILD_NAME='MyGuild' \
  -e SEED_TMB_GUILD_ID='12345' \
  -e SEED_TMB_GUILD_SLUG='myguild' \
  -e SEED_RAID_SCHEDULE='[...]' \
  -e SEED_EASTER_EGGS='[...]' \
  -e SEED_CURRENT_ZONES='[1007,1008,1056]' \
  -e SEED_LEGACY_ZONES='[1001,1002,1047,1048]' \
  -e SEED_EDIKT_TEXTS='{...}' \
  raidpolice node /app/seed-existing-deploy.js
```

Idempotent — schreibt nur Keys die noch nicht (oder leer) gesetzt sind.
