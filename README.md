# raidpolice

WoW TBC Classic raid-analysis webapp. Pulls reports from Warcraft Logs and ThatsMyBis,
checks raid compliance (buffs, consumables, weapon enchants, scrolls, spell ranks,
gear/gems/enchants, major CDs, on-use trinkets), and provides a live ticker for
running raids.

Generic build — guild, server, branding, raid schedule, and easter eggs are all
configurable via the Admin UI; no guild-specific data hardcoded.

## Architecture

- **Backend**: Node.js (vanilla, no framework), SQLite via `better-sqlite3`
- **Frontend**: Vanilla JS (no framework), HTML, CSS
- **Deploy**: Docker + docker-compose, Traefik reverse proxy

## Quick Start

```bash
docker compose up -d
```

The app listens on port 3000.

## First-time configuration

After the container is up, open the app in a browser and log in to Admin (default
admin user is auto-created from the `adminPassword` setting if present; otherwise
create one directly in the DB).

Configure the following in the Admin UI:

### Allgemein

- **App-Name** — appears in the browser tab and header (e.g. "My Raid Tool")
- **Gildenname / Server / Region / Fraktion** — used for WCL guild lookups
- **TMB Guild-ID + Guild-Slug** — the numeric ID and URL slug for your guild on
  thatsmybis.com (find in the URL: `thatsmybis.com/{guildId}/{slug}/...`)
- **TMB-Cookie** — `laravel_session=...` value from your browser cookies on TMB

### Raid-Schedule

Add rows for each weekly raid: day-of-week, start-time (HH:MM), raid-size (10/25/40),
track (`current` for endgame, `legacy` for catch-up alt-content).

The Live Ticker uses this to know when to poll for active raids.

### Easter Eggs

Optional player-name animations triggered on hover or specific events. Types:

| Type | Behavior |
|---|---|
| `wobble` | Hover swaps name with the alt-text |
| `popup` | Hover shows a popup with the alt-text |
| `girly` | Hover activates "girly mode" page-wide (pink particles) |
| `letterswap` | Hover swaps an `i` with an `a` in the name |
| `slacker-wobble` | Wobble variant with yawn/sleep animation |
| `tank-death-wobble` | Big wobbling alt-text in the wipe-analysis when this tank dies |

Add player name, type, and alt-text. The names are stored in the DB, not in the
code — code stays generic.

### Elixir Policy (Edikt)

Configure per-spec which flask/elixir combos are allowed (separate "Edikt" tab in
the public view). Violations show up as policy-violation icons in the buffs report.

## Required Secrets (per deployment)

These live in the SQLite DB (`/app/data/cla-cache.db`), set via the Admin UI or
direct API:

- `apiKey` — Warcraft Logs v1 public API key
- `wclV2ClientId` + `wclV2ClientSecret` — Warcraft Logs v2 OAuth credentials
- `tmbCookie` — `laravel_session=...` cookie from your TMB session

The DB file is gitignored.

## Game version

Hard-coded for **TBC Classic** (spell IDs, item IDs, class/spec layouts). The
spell/item ID tables in `preanalyze.js` are not configurable — they describe the
game itself. Adapting to a different expansion would require replacing those
tables.
