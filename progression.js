/**
 * Server-side progression aggregator.
 *
 * Uses pre-analyzed gear/buffs data from report_analysis to build the
 * "Player × RaidDay" matrix the frontend used to compute by firing
 * thousands of WCL fetches at page load.
 *
 * Output matches the shape the frontend's analyzeProgression() produced
 * for playerResults + reportMeta. Settings-dependent filters stay in the
 * frontend (server returns ALL issues; client filters with _filteredIssues).
 */
const fs = require('fs');
const path = require('path');
const cache = require('./db');

function loadBrowserModule(filePath) {
  const code = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
  const window = {};
  new Function('window', code)(window);
  return window;
}

const { CLA_DATA } = loadBrowserModule('js/data.js');

const SETTINGS_HASH = 'all';

// ─── Elixier-Policy (deckt sich mit Frontend-Helper) ───
function normalizeRoleKey(roleKey) {
  if (!roleKey) return roleKey;
  if (roleKey === 'Druid:dps') return 'Druid:feral';
  if (roleKey === 'Shaman:dps') return 'Shaman:enhancement';
  if (roleKey === 'Paladin:dps') return 'Paladin:retribution';
  return roleKey;
}
function elixirRef(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { id: null, name: entry };
  if (typeof entry === 'object') return { id: entry.id != null ? entry.id : null, name: entry.name || null };
  return null;
}
function whitelistMatchesServer(allowedIds, entry, nameToId) {
  const ref = elixirRef(entry);
  if (!ref) return false;
  if (!Array.isArray(allowedIds) || !allowedIds.length) return false; // strikt
  if (ref.id != null && allowedIds.includes(ref.id)) return true;
  if (ref.id == null && ref.name && nameToId && nameToId[ref.name] != null && allowedIds.includes(nameToId[ref.name])) return true;
  return false;
}
function isFlaskOrElixirOk(fd, policy, nameToId) {
  if (!fd) return false;
  const roleKey = normalizeRoleKey(fd.roleKey);
  const pol = (roleKey && policy && policy[roleKey]) || { mode: 'any' };
  if (pol.mode === 'flask-only') {
    if (!fd.flask) return false;
    return whitelistMatchesServer(pol.flaskAllowed, fd.flask, nameToId);
  }
  if (pol.mode === 'whitelist') {
    if (fd.flask && whitelistMatchesServer(pol.flaskAllowed, fd.flask, nameToId)) return true;
    const battleOk = fd.battleElixir && whitelistMatchesServer(pol.battleAllowed, fd.battleElixir, nameToId);
    const guardianOk = fd.guardianElixir && whitelistMatchesServer(pol.guardianAllowed, fd.guardianElixir, nameToId);
    return !!(battleOk && guardianOk);
  }
  // mode: 'any'
  return !!fd.flask || !!(fd.battleElixir && fd.guardianElixir);
}
function loadPolicy() {
  try { return JSON.parse(cache.getSetting('elixirPolicy') || '{}') || {}; } catch (_) { return {}; }
}
// Build name → id map from all cached buff analyses (for legacy string entries)
function buildNameToId(db) {
  const map = {};
  try {
    const rows = db.prepare("SELECT result_json FROM report_analysis WHERE analysis_type='buffs'").all();
    for (const row of rows) {
      try {
        const res = JSON.parse(row.result_json);
        for (const p of (res || [])) for (const fd of (p.fightDetails || [])) {
          if (!fd) continue;
          for (const key of ['flask', 'battleElixir', 'guardianElixir']) {
            const v = fd[key];
            if (v && typeof v === 'object' && v.id != null && v.name) map[v.name] = v.id;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return map;
}

// ─── Track classification (current vs legacy content) ───
// Konfigurierbar via Settings:
//   - currentZones: JSON-Array von Zone-IDs, die als "current" zählen
//   - legacyZones:  JSON-Array von Zone-IDs, die als "legacy" zählen
// Falls Zone in keiner Liste: Fallback auf Tier-Heuristik (T5+ = current, T≤4 = legacy).
function _trackZoneSets() {
  let current = [], legacy = [];
  try { current = JSON.parse(cache.getSetting('currentZones') || '[]'); } catch (_) {}
  try { legacy  = JSON.parse(cache.getSetting('legacyZones')  || '[]'); } catch (_) {}
  return { currentSet: new Set(current.map(Number)), legacySet: new Set(legacy.map(Number)) };
}
function getDefaultTrackForReport(report) {
  if (!report) return 'current';
  const zoneId = report.zone != null ? Number(report.zone) : null;
  const { currentSet, legacySet } = _trackZoneSets();
  if (zoneId != null) {
    if (currentSet.has(zoneId)) return 'current';
    if (legacySet.has(zoneId)) return 'legacy';
  }
  // Fallback: Tier-Heuristik (T5+ = current, sonst legacy)
  const zone = zoneId != null ? CLA_DATA.zones[zoneId] : null;
  const tier = zone ? (zone.tier || 0) : 0;
  return tier >= 5 ? 'current' : 'legacy';
}
function getTrackForReport(report) {
  if (!report || !report.id) return 'current';
  const override = cache.getReportTrackOverride(report.id);
  if (override) return override;
  return getDefaultTrackForReport(report);
}

function classNameFromType(type) {
  if (!type) return null;
  const t = String(type);
  if (t === 'DeathKnight') return 'Death Knight';
  return t;
}

function groupReportsByDate(reports) {
  const groups = new Map();
  const tierOf = (zoneId) => (CLA_DATA.zones[zoneId] && CLA_DATA.zones[zoneId].tier) || 0;
  for (const r of reports) {
    const d = new Date(r.start);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(dateKey)) groups.set(dateKey, { dateKey, reports: [], start: r.start, zone: r.zone });
    const g = groups.get(dateKey);
    g.reports.push(r);
    if (r.start < g.start) g.start = r.start;
    // Pick the highest-tier zone as the day's primary label (so Nachraid mit
    // SSC/TK überschreibt einen früheren Gruul/Mag-Raid am selben Datum).
    if (tierOf(r.zone) > tierOf(g.zone)) g.zone = r.zone;
  }
  return [...groups.values()];
}

function weaponEnhPresent(we) {
  if (!we) return false;
  // formatWeaponEnh returns either { isDW, mh, oh } for dual-wielders, a plain
  // string (the single-weapon enhancement name), or null.
  if (typeof we === 'string') return true;
  if (we.isDW) return !!(we.mh && we.oh);
  return !!(we.mh || we.oh);
}

// Build reportMeta (per raid day) + players matrix entirely from cached data.
// track: 'current' (default) oder 'legacy' — filtert Reports nach Track-Klassifikation.
function buildProgression(track) {
  track = track || 'current';
  const d = cache.getDb();
  const policy = loadPolicy();
  const nameToId = buildNameToId(d);

  // 1. Load all guild reports from guild_reports_cache (JSON array: {id, title, start, end, zone})
  const cacheRow = d.prepare('SELECT reports_json FROM guild_reports_cache LIMIT 1').get();
  const allReports = cacheRow ? JSON.parse(cacheRow.reports_json || '[]') : [];
  const excluded = new Set(cache.getExcludedReports());

  // 2. Filter: 25-man TBC reports only, exclude admin-excluded, match track, chronological
  const reports25 = allReports
    .filter(r => { const z = CLA_DATA.zones[r.zone]; return z && z.tbc && z.size >= 25; })
    .filter(r => !excluded.has(r.id))
    .filter(r => getTrackForReport(r) === track)
    .sort((a, b) => (a.start || 0) - (b.start || 0));

  if (!reports25.length) return { reportMeta: [], players: [], computed_at: Date.now() };

  // 3. Load per-report data + analyses in one pass
  const dataByCode = new Map();
  for (const r of reports25) {
    const rd = cache.getReportData(r.id);
    if (!rd) continue;
    const gearRow = cache.getAnalysis(r.id, 'gear', SETTINGS_HASH);
    const buffsRow = cache.getAnalysis(r.id, 'buffs', SETTINGS_HASH);
    if (!gearRow || !buffsRow) continue;
    const fights = JSON.parse(rd.fights_json || '[]').filter(f => f.boss && f.boss > 0 && (f.size || 0) >= 25);
    if (!fights.length) continue;
    const meta = JSON.parse(rd.meta_json || '{}');
    const gear = JSON.parse(gearRow.result_json);
    const buffs = JSON.parse(buffsRow.result_json);
    // Index players by name for O(1) access
    const gearByName = new Map();
    for (const p of (gear.results || [])) gearByName.set(p.name, p);
    const buffsByName = new Map();
    for (const p of (buffs || [])) buffsByName.set(p.name, p);
    dataByCode.set(r.id, { fights, meta, gear, buffs, gearByName, buffsByName });
  }

  // Filter reports25 down to those with full data
  const usableReports = reports25.filter(r => dataByCode.has(r.id));

  // 4. Group by raid date
  const dayGroups = groupReportsByDate(usableReports);
  dayGroups.sort((a, b) => a.start - b.start);

  // 5. Build reportMeta (one entry per raid day) + aggregate players
  const reportMeta = [];
  const playerMap = {}; // name → aggregated player

  for (let di = 0; di < dayGroups.length; di++) {
    const group = dayGroups[di];
    // Sort reports within the day (earliest first) for deterministic fight ordering
    const dayReports = [...group.reports].sort((a, b) => (a.start || 0) - (b.start || 0));

    const zone = CLA_DATA.zones[group.zone] || { name: '?', short: '?', color: '#666', size: 25, tbc: true };
    const mergedFightsPerReport = []; // [{reportId, fights: [fight, ...]}]
    let totalFightsCount = 0;
    for (const r of dayReports) {
      const d = dataByCode.get(r.id);
      mergedFightsPerReport.push({ reportId: r.id, fights: d.fights });
      totalFightsCount += d.fights.length;
    }
    if (!totalFightsCount) continue;

    // Collect all players that appear on this raid day (union across all reports of the day)
    const dayPlayerSet = new Set();
    const playerTypeByName = new Map();
    for (const { reportId } of mergedFightsPerReport) {
      const d = dataByCode.get(reportId);
      for (const p of d.gear.results || []) {
        dayPlayerSet.add(p.name);
        if (!playerTypeByName.has(p.name)) playerTypeByName.set(p.name, p.type);
      }
      for (const p of d.buffs || []) {
        dayPlayerSet.add(p.name);
        if (!playerTypeByName.has(p.name)) playerTypeByName.set(p.name, p.type);
      }
    }

    const d = new Date(group.start);
    const dayLabel = d.getDay() === 1 ? 'mon' : d.getDay() === 2 ? 'tue' : 'thu';
    const firstReport = { id: dayReports[0].id, start: dayReports[0].start, end: dayReports[0].end, title: dayReports[0].title };
    reportMeta.push({
      report: firstReport,
      reports: dayReports.map(r => ({ id: r.id, start: r.start, end: r.end, title: r.title })),
      start: group.start,
      zone: { name: zone.name, short: zone.short, color: zone.color, size: zone.size, tbc: !!zone.tbc },
      day: dayLabel,
      bossFightsCount: totalFightsCount,
    });

    for (const pName of dayPlayerSet) {
      const pType = playerTypeByName.get(pName);
      const className = classNameFromType(pType);
      if (!playerMap[pName]) {
        playerMap[pName] = {
          name: pName,
          type: pType,
          className,
          raids: [], // will be filled with per-day entries in order
          _roleCounts: { tank: 0, healer: 0, dps: 0 },
        };
      }
    }

    // Make sure every player has a slot for this day
    for (const p of Object.values(playerMap)) {
      while (p.raids.length < di) p.raids.push(null);
      // will set raids[di] below if present
    }

    // Per player: aggregate across all fights in the day (from all reports in the day)
    for (const pName of dayPlayerSet) {
      const pm = playerMap[pName];

      // Collect per-fight entries across reports (flattened sequence)
      const fightEntries = []; // [{reportId, fi, gearPF, buffsFD}]
      for (const { reportId, fights } of mergedFightsPerReport) {
        const dat = dataByCode.get(reportId);
        const gearPlayer = dat.gearByName.get(pName);
        const buffsPlayer = dat.buffsByName.get(pName);
        for (let fi = 0; fi < fights.length; fi++) {
          const pf = gearPlayer && gearPlayer.perFight
            ? gearPlayer.perFight.find(x => x.fi === fi) || null
            : null;
          const fd = buffsPlayer && Array.isArray(buffsPlayer.fightDetails)
            ? (buffsPlayer.fightDetails[fi] || null)
            : null;
          // Disconnect-Fights komplett aus Progression rausnehmen
          const isDisconnect = pf && (pf.issues || []).some(i => i.disconnect);
          if (isDisconnect) continue;
          if (pf || fd) fightEntries.push({ gearPF: pf, buffsFD: fd });
        }
      }

      if (!fightEntries.length) continue; // player not present this day

      // Determine role per fight and main-role (majority)
      const fightRoles = fightEntries.map(e => {
        const role = (e.gearPF && e.gearPF.role) || (e.buffsFD && e.buffsFD.roleKey) || '';
        if (role.includes(':tank')) return 'tank';
        if (role.includes(':healer')) return 'healer';
        return 'dps';
      });
      const rc = { tank: 0, healer: 0, dps: 0 };
      for (const r of fightRoles) rc[r]++;
      // Cumulate into global role counts (fixes old per-day overwrite bug)
      pm._roleCounts.tank += rc.tank;
      pm._roleCounts.healer += rc.healer;
      pm._roleCounts.dps += rc.dps;
      const mainRoleKey = (rc.tank >= rc.healer && rc.tank >= rc.dps && rc.tank > 0) ? 'tank'
        : (rc.healer >= rc.dps && rc.healer > 0) ? 'healer'
        : 'dps';

      // Gear issues: split main/offspec, strip Meta-Gem and count separately
      const issueMap = {};
      const offspecIssueMap = {};
      let metaInactiveCount = 0;
      for (let i = 0; i < fightEntries.length; i++) {
        const pf = fightEntries[i].gearPF;
        if (!pf) continue;
        const isOffspec = fightRoles[i] !== mainRoleKey;
        for (const iss of (pf.issues || [])) {
          if (iss.issue && iss.issue.startsWith('Meta-Gem nicht aktiviert')) {
            if (!isOffspec) metaInactiveCount++;
            continue;
          }
          const key = iss.slot + '|' + iss.issue;
          const target = isOffspec ? offspecIssueMap : issueMap;
          if (!target[key]) target[key] = { ...iss, offspec: isOffspec };
        }
      }
      const issues = Object.values(issueMap);
      if (metaInactiveCount > 0) {
        issues.push({
          slot: 'Head',
          issue: `Meta-Gem inaktiv (${metaInactiveCount}/${fightEntries.length})`,
          severity: 'high',
        });
      }
      const offspecIssues = Object.values(offspecIssueMap);

      // Buffs/scrolls/weaponEnh counts
      let fightsPresentBuff = 0;
      let flaskCount = 0, foodCount = 0, weaponEnhCount = 0;
      let scrollOkCount = 0, scrollExpectedFights = 0;
      for (const e of fightEntries) {
        const fd = e.buffsFD;
        if (!fd) continue; // player absent this fight in buffs analysis
        fightsPresentBuff++;
        if (isFlaskOrElixirOk(fd, policy, nameToId)) flaskCount++;
        if (fd.food) foodCount++;
        if (weaponEnhPresent(fd.weaponEnh)) weaponEnhCount++;
        // Scrolls
        const scrollsFound = Array.isArray(fd.scrolls) ? fd.scrolls.length : 0;
        const scrollsMissing = Array.isArray(fd.missingScrolls) ? fd.missingScrolls.length : 0;
        const totalExpected = scrollsFound + scrollsMissing;
        if (totalExpected > 0) {
          scrollExpectedFights++;
          if (scrollsMissing === 0) scrollOkCount++;
        }
      }

      const highCount = issues.filter(i => i.severity === 'high').length;
      const medCount = issues.filter(i => i.severity === 'medium').length;
      const totalFights = fightEntries.length;

      pm.raids[di] = {
        present: true,
        issueCount: issues.length,
        highCount,
        medCount,
        issues,
        offspecIssues,
        totalFights,
        fightsPresentBuff,
        flaskCount,
        foodCount,
        weaponEnhCount,
        scrollOkCount,
        scrollExpectedFights,
        flaskPct: fightsPresentBuff > 0 ? Math.round(flaskCount / fightsPresentBuff * 100) : 0,
        foodPct: fightsPresentBuff > 0 ? Math.round(foodCount / fightsPresentBuff * 100) : 0,
        weaponEnhPct: fightsPresentBuff > 0 ? Math.round(weaponEnhCount / fightsPresentBuff * 100) : 0,
        scrollPct: scrollExpectedFights > 0 ? Math.round(scrollOkCount / scrollExpectedFights * 100) : -1,
      };
    }

    // Pad raid array for players that weren't present this day
    for (const p of Object.values(playerMap)) {
      while (p.raids.length <= di) p.raids.push(null);
    }
  }

  // Drop ghost players: listed in friendlies but never actually fighting.
  // (The old client built playerMap from summary-per-fight, so these never appeared.
  // gear/buffs analysis rows include them because they're in the report's friendlies list.)
  const players = Object.values(playerMap)
    .filter(p => p.raids.some(r => r))
    .map(p => ({
      name: p.name,
      type: p.type,
      className: p.className,
      raids: p.raids,
      _roleCounts: p._roleCounts,
    }));

  return { reportMeta, players, computed_at: Date.now() };
}

function viewKeyFor(track) {
  return track === 'legacy' ? 'progression_legacy' : 'progression';
}

function getOrBuild(track) {
  track = track || 'current';
  const VIEW_KEY = viewKeyFor(track);
  const cached = cache.getComputedView(VIEW_KEY);
  if (cached) {
    return { data: JSON.parse(cached.data_json), computed_at: cached.computed_at, fresh: false };
  }
  const data = buildProgression(track);
  cache.putComputedView(VIEW_KEY, JSON.stringify(data));
  return { data, computed_at: data.computed_at, fresh: true };
}

function invalidate() {
  cache.invalidateComputedView('progression');
  cache.invalidateComputedView('progression_legacy');
}

module.exports = { buildProgression, getOrBuild, invalidate, getTrackForReport, getDefaultTrackForReport, isFlaskOrElixirOk, buildNameToId, normalizeRoleKey };
