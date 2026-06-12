/**
 * SQLite cache module for CLA Web App
 */
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'cla-cache.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function safeAddColumn(table, column, type) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch (e) { /* column exists */ }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guild_reports (
      guild_key TEXT NOT NULL,
      report_code TEXT NOT NULL,
      title TEXT,
      owner TEXT,
      zone_id INTEGER,
      start_ts INTEGER,
      end_ts INTEGER,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (guild_key, report_code)
    );
    CREATE TABLE IF NOT EXISTS report_analysis (
      report_code TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      settings_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      analyzed_at INTEGER NOT NULL,
      PRIMARY KEY (report_code, analysis_type, settings_hash)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS excluded_reports (
      report_code TEXT PRIMARY KEY,
      excluded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_data (
      report_code TEXT PRIMARY KEY,
      fights_json TEXT NOT NULL,
      players_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guild_reports_cache (
      guild_key TEXT PRIMARY KEY,
      reports_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance_excused (
      raid_date TEXT PRIMARY KEY,
      reason TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_gear_snapshots (
      report_code TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_class TEXT,
      gear_json TEXT NOT NULL,
      report_date INTEGER,
      captured_at INTEGER NOT NULL,
      PRIMARY KEY (report_code, player_name)
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS excluded_players (
      player_name TEXT PRIMARY KEY,
      reason TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_join_dates (
      player_name TEXT PRIMARY KEY,
      join_date TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance_revoked (
      player_name TEXT NOT NULL,
      raid_date TEXT NOT NULL,
      reason TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_name, raid_date)
    );
    CREATE TABLE IF NOT EXISTS attendance_excused_player (
      player_name TEXT NOT NULL,
      raid_date TEXT NOT NULL,
      reason TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_name, raid_date)
    );
    CREATE TABLE IF NOT EXISTS attendance_penalties (
      player_name TEXT PRIMARY KEY,
      penalty_pct INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      created_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      csrf TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bug_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS computed_views (
      view_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      computed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_roles (
      player_name TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      created_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_tracks (
      report_code TEXT PRIMARY KEY,
      track TEXT NOT NULL,
      set_by TEXT,
      set_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tmb_raid_overrides (
      orig_date TEXT NOT NULL,
      raid_name TEXT NOT NULL,
      new_date TEXT NOT NULL,
      set_by TEXT,
      set_at INTEGER NOT NULL,
      PRIMARY KEY (orig_date, raid_name)
    );
    CREATE TABLE IF NOT EXISTS manual_reports (
      report_code TEXT PRIMARY KEY,
      title TEXT,
      owner TEXT,
      zone_id INTEGER,
      start_ts INTEGER,
      end_ts INTEGER,
      added_by TEXT,
      added_at INTEGER NOT NULL,
      note TEXT
    );
  `);
  // Migrations: add created_by columns to tables that were created without them
  safeAddColumn('attendance_penalties', 'created_by', 'TEXT');
  safeAddColumn('attendance_revoked', 'created_by', 'TEXT');
  safeAddColumn('attendance_excused', 'created_by', 'TEXT');
  safeAddColumn('attendance_excused_player', 'created_by', 'TEXT');
  safeAddColumn('excluded_players', 'created_by', 'TEXT');
  safeAddColumn('player_join_dates', 'created_by', 'TEXT');
}

function getAnalysis(reportCode, type, settingsHash) {
  const d = getDb();
  const row = d.prepare('SELECT result_json, analyzed_at FROM report_analysis WHERE report_code = ? AND analysis_type = ? AND settings_hash = ?')
    .get(reportCode, type, settingsHash);
  return row || null;
}

function putAnalysis(reportCode, type, settingsHash, resultJson) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO report_analysis (report_code, analysis_type, settings_hash, result_json, analyzed_at) VALUES (?, ?, ?, ?, ?)')
    .run(reportCode, type, settingsHash, resultJson, Date.now());
}

// TTLs in milliseconds
const TTL = {
  guildReports: 1 * 60 * 60 * 1000,        // 1 hour
  reportFights: 7 * 24 * 60 * 60 * 1000,    // 7 days
  tables:       30 * 24 * 60 * 60 * 1000,   // 30 days
};

function cacheKey(apiPath, queryString) {
  // Strip api_key from query for cache key
  const params = new URLSearchParams(queryString);
  params.delete('api_key');
  params.sort();
  return `${apiPath}?${params.toString()}`;
}

function getTTL(apiPath) {
  if (apiPath.includes('/reports/guild/')) return TTL.guildReports;
  if (apiPath.includes('/report/fights/')) return TTL.reportFights;
  return TTL.tables;
}

function getCached(key) {
  const d = getDb();
  const row = d.prepare('SELECT response_json, fetched_at FROM api_cache WHERE cache_key = ?').get(key);
  return row || null;
}

function putCache(key, json) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO api_cache (cache_key, response_json, fetched_at) VALUES (?, ?, ?)').run(key, json, Date.now());
}

function invalidateReport(reportCode) {
  const d = getDb();
  d.prepare("DELETE FROM api_cache WHERE cache_key LIKE ?").run(`%${reportCode}%`);
  d.prepare("DELETE FROM report_analysis WHERE report_code = ?").run(reportCode);
}

function invalidateGuild(guildKey) {
  const d = getDb();
  d.prepare("DELETE FROM guild_reports WHERE guild_key = ?").run(guildKey);
  d.prepare("DELETE FROM api_cache WHERE cache_key LIKE ?").run(`%/reports/guild/%`);
}

function getCacheStats() {
  const d = getDb();
  const count = d.prepare('SELECT COUNT(*) as cnt FROM api_cache').get();
  const oldest = d.prepare('SELECT MIN(fetched_at) as oldest FROM api_cache').get();
  return { entries: count.cnt, oldestTs: oldest.oldest };
}

function getSetting(key) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function putSetting(key, value) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const d = getDb();
  const rows = d.prepare('SELECT key, value FROM app_settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

function getExcludedReports() {
  const d = getDb();
  return d.prepare('SELECT report_code FROM excluded_reports').all().map(r => r.report_code);
}

function excludeReport(reportCode) {
  const d = getDb();
  d.prepare('INSERT OR IGNORE INTO excluded_reports (report_code, excluded_at) VALUES (?, ?)').run(reportCode, Date.now());
}

function includeReport(reportCode) {
  const d = getDb();
  d.prepare('DELETE FROM excluded_reports WHERE report_code = ?').run(reportCode);
}

function getReportData(reportCode) {
  const d = getDb();
  return d.prepare('SELECT fights_json, players_json, meta_json, fetched_at FROM report_data WHERE report_code = ?').get(reportCode) || null;
}

function putReportData(reportCode, fightsJson, playersJson, metaJson) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO report_data (report_code, fights_json, players_json, meta_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
    .run(reportCode, fightsJson, playersJson, metaJson, Date.now());
}

function getGuildReportsCache(guildKey) {
  const d = getDb();
  return d.prepare('SELECT reports_json, fetched_at FROM guild_reports_cache WHERE guild_key = ?').get(guildKey) || null;
}

function putGuildReportsCache(guildKey, reportsJson) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO guild_reports_cache (guild_key, reports_json, fetched_at) VALUES (?, ?, ?)')
    .run(guildKey, reportsJson, Date.now());
}

function getExcused() {
  const d = getDb();
  return d.prepare('SELECT raid_date, reason, created_by, updated_at FROM attendance_excused ORDER BY raid_date DESC').all();
}

function setExcused(raidDate, reason, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO attendance_excused (raid_date, reason, created_by, updated_at) VALUES (?, ?, ?, ?)')
    .run(raidDate, reason || null, createdBy || null, Date.now());
}

function removeExcused(raidDate) {
  const d = getDb();
  d.prepare('DELETE FROM attendance_excused WHERE raid_date = ?').run(raidDate);
}

function putGearSnapshot(reportCode, playerName, playerClass, gearJson, reportDate) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO player_gear_snapshots (report_code, player_name, player_class, gear_json, report_date, captured_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reportCode, playerName, playerClass, gearJson, reportDate || 0, Date.now());
}

function getGearSnapshots(playerName) {
  const d = getDb();
  return d.prepare('SELECT report_code, player_class, gear_json, report_date FROM player_gear_snapshots WHERE player_name = ? ORDER BY report_date ASC').all(playerName);
}

function getAdminUsers() {
  const d = getDb();
  return d.prepare('SELECT username, role, created_at, updated_at FROM admin_users ORDER BY role, username').all();
}
function getAdminUser(username) {
  const d = getDb();
  return d.prepare('SELECT username, password_hash, role, created_at, updated_at FROM admin_users WHERE username = ?').get(username) || null;
}
function createAdminUser(username, passwordHash, role) {
  const d = getDb();
  const now = Date.now();
  d.prepare('INSERT INTO admin_users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(username, passwordHash, role, now, now);
}
function updateAdminPassword(username, passwordHash) {
  const d = getDb();
  d.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE username = ?').run(passwordHash, Date.now(), username);
}
function updateAdminRole(username, role) {
  const d = getDb();
  d.prepare('UPDATE admin_users SET role = ?, updated_at = ? WHERE username = ?').run(role, Date.now(), username);
}
function deleteAdminUser(username) {
  const d = getDb();
  d.prepare('DELETE FROM admin_users WHERE username = ?').run(username);
}

function addChangelogEntry(username, action, details) {
  const d = getDb();
  d.prepare('INSERT INTO admin_changelog (username, action, details, created_at) VALUES (?, ?, ?, ?)').run(username, action, details || null, Date.now());
}

function getChangelog(limit = 100) {
  const d = getDb();
  return d.prepare('SELECT id, username, action, details, created_at FROM admin_changelog ORDER BY created_at DESC LIMIT ?').all(limit);
}

function getExcludedPlayers2() {
  const d = getDb();
  return d.prepare('SELECT player_name, reason, created_by, updated_at FROM excluded_players ORDER BY player_name').all();
}
function setExcludedPlayer2(playerName, reason, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO excluded_players (player_name, reason, created_by, updated_at) VALUES (?, ?, ?, ?)').run(playerName, reason || null, createdBy || null, Date.now());
}
function removeExcludedPlayer2(playerName) {
  const d = getDb();
  d.prepare('DELETE FROM excluded_players WHERE player_name = ?').run(playerName);
}

function getPlayerRoles() {
  const d = getDb();
  return d.prepare('SELECT player_name, role, created_by, updated_at FROM player_roles ORDER BY player_name').all();
}
function setPlayerRole(playerName, role, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO player_roles (player_name, role, created_by, updated_at) VALUES (?, ?, ?, ?)').run(playerName, role, createdBy || null, Date.now());
}
function removePlayerRole(playerName) {
  const d = getDb();
  d.prepare('DELETE FROM player_roles WHERE player_name = ?').run(playerName);
}

function getJoinDates() {
  const d = getDb();
  return d.prepare('SELECT player_name, join_date, created_by, updated_at FROM player_join_dates ORDER BY player_name').all();
}
function setJoinDate(playerName, joinDate, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO player_join_dates (player_name, join_date, created_by, updated_at) VALUES (?, ?, ?, ?)').run(playerName, joinDate, createdBy || null, Date.now());
}
function removeJoinDate(playerName) {
  const d = getDb();
  d.prepare('DELETE FROM player_join_dates WHERE player_name = ?').run(playerName);
}

function getRevokedAttendance() {
  const d = getDb();
  return d.prepare('SELECT player_name, raid_date, reason, created_by, updated_at FROM attendance_revoked ORDER BY player_name, raid_date DESC').all();
}

function setRevokedAttendance(playerName, raidDate, reason, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO attendance_revoked (player_name, raid_date, reason, created_by, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(playerName, raidDate, reason || null, createdBy || null, Date.now());
}

function removeRevokedAttendance(playerName, raidDate) {
  const d = getDb();
  d.prepare('DELETE FROM attendance_revoked WHERE player_name = ? AND raid_date = ?').run(playerName, raidDate);
}

function getExcusedPlayers() {
  const d = getDb();
  return d.prepare('SELECT player_name, raid_date, reason, created_by, updated_at FROM attendance_excused_player ORDER BY player_name, raid_date DESC').all();
}

function setExcusedPlayer(playerName, raidDate, reason, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO attendance_excused_player (player_name, raid_date, reason, created_by, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(playerName, raidDate, reason || null, createdBy || null, Date.now());
}

function removeExcusedPlayer(playerName, raidDate) {
  const d = getDb();
  d.prepare('DELETE FROM attendance_excused_player WHERE player_name = ? AND raid_date = ?').run(playerName, raidDate);
}

function getPenalties() {
  const d = getDb();
  return d.prepare('SELECT player_name, penalty_pct, reason, created_by, updated_at FROM attendance_penalties ORDER BY player_name').all();
}

function setPenalty(playerName, penaltyPct, reason, createdBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO attendance_penalties (player_name, penalty_pct, reason, created_by, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(playerName, penaltyPct, reason || null, createdBy || null, Date.now());
}

function removePenalty(playerName) {
  const d = getDb();
  d.prepare('DELETE FROM attendance_penalties WHERE player_name = ?').run(playerName);
}

/** Get full report bundle: metadata + fights + players + all analyses */
function getReportBundle(reportCode) {
  const d = getDb();
  const rd = getReportData(reportCode);
  if (!rd) return null;
  const analyses = {};
  for (const type of ['gear', 'buffs', 'consumables', 'consumablesTrash', 'spellranks', 'deaths', 'parries', 'dmgheal', 'damagetaken', 'drums', 'avoidable', 'wipes', 'trinkets', 'cooldowns']) {
    const row = d.prepare('SELECT result_json, analyzed_at FROM report_analysis WHERE report_code = ? AND analysis_type = ? AND settings_hash = ?')
      .get(reportCode, type, 'all');
    analyses[type] = row ? JSON.parse(row.result_json) : null;
  }
  return {
    meta: JSON.parse(rd.meta_json),
    fights: JSON.parse(rd.fights_json),
    players: JSON.parse(rd.players_json),
    analysis: analyses,
    fetchedAt: rd.fetched_at,
  };
}

// ─── Bug Tickets ───
function getBugTickets(includesClosed) {
  const d = getDb();
  if (includesClosed) return d.prepare('SELECT * FROM bug_tickets ORDER BY created_at DESC').all();
  return d.prepare("SELECT * FROM bug_tickets WHERE status != 'closed' ORDER BY created_at DESC").all();
}

function createBugTicket(title, description, createdBy) {
  const d = getDb();
  const now = Date.now();
  const r = d.prepare('INSERT INTO bug_tickets (title, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, description || null, createdBy || null, now, now);
  return r.lastInsertRowid;
}

function updateBugTicketStatus(id, status) {
  const d = getDb();
  d.prepare('UPDATE bug_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

function deleteBugTicket(id) {
  const d = getDb();
  d.prepare('DELETE FROM bug_tickets WHERE id = ?').run(id);
}

// ─── Computed Views (cached aggregations, invalidated on data change) ───
function getComputedView(viewKey) {
  const d = getDb();
  return d.prepare('SELECT data_json, computed_at FROM computed_views WHERE view_key = ?').get(viewKey) || null;
}

function putComputedView(viewKey, dataJson) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO computed_views (view_key, data_json, computed_at) VALUES (?, ?, ?)')
    .run(viewKey, dataJson, Date.now());
}

function invalidateComputedView(viewKey) {
  const d = getDb();
  if (viewKey) d.prepare('DELETE FROM computed_views WHERE view_key = ?').run(viewKey);
  else d.prepare('DELETE FROM computed_views').run();
}

// ─── Report Tracks (current vs legacy content) ───
function getReportTrackOverride(reportCode) {
  const d = getDb();
  const row = d.prepare('SELECT track FROM report_tracks WHERE report_code = ?').get(reportCode);
  return row ? row.track : null;
}
function getAllReportTracks() {
  const d = getDb();
  const rows = d.prepare('SELECT report_code, track FROM report_tracks').all();
  const map = {};
  for (const r of rows) map[r.report_code] = r.track;
  return map;
}
function setReportTrack(reportCode, track, setBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO report_tracks (report_code, track, set_by, set_at) VALUES (?, ?, ?, ?)')
    .run(reportCode, track, setBy || null, Date.now());
}
function clearReportTrack(reportCode) {
  const d = getDb();
  d.prepare('DELETE FROM report_tracks WHERE report_code = ?').run(reportCode);
}

// ─── TMB Raid Date Overrides ───
function getTmbRaidOverrides() {
  const d = getDb();
  return d.prepare('SELECT orig_date, raid_name, new_date, set_by, set_at FROM tmb_raid_overrides').all();
}
function setTmbRaidOverride(origDate, raidName, newDate, setBy) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO tmb_raid_overrides (orig_date, raid_name, new_date, set_by, set_at) VALUES (?, ?, ?, ?, ?)')
    .run(origDate, raidName, newDate, setBy || null, Date.now());
}
function removeTmbRaidOverride(origDate, raidName) {
  const d = getDb();
  d.prepare('DELETE FROM tmb_raid_overrides WHERE orig_date = ? AND raid_name = ?').run(origDate, raidName);
}

// ─── Manual reports (admin-added codes for non-guild logs) ───
function getManualReports() {
  const d = getDb();
  return d.prepare('SELECT report_code, title, owner, zone_id, start_ts, end_ts, added_by, added_at, note FROM manual_reports ORDER BY start_ts DESC').all();
}
function getManualReport(reportCode) {
  const d = getDb();
  return d.prepare('SELECT report_code, title, owner, zone_id, start_ts, end_ts, added_by, added_at, note FROM manual_reports WHERE report_code = ?').get(reportCode) || null;
}
function addManualReport(rec) {
  const d = getDb();
  d.prepare(`INSERT OR REPLACE INTO manual_reports
    (report_code, title, owner, zone_id, start_ts, end_ts, added_by, added_at, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rec.report_code, rec.title || null, rec.owner || null, rec.zone_id || null,
         rec.start_ts || 0, rec.end_ts || 0, rec.added_by || null, Date.now(), rec.note || null);
}
function removeManualReport(reportCode) {
  const d = getDb();
  d.prepare('DELETE FROM manual_reports WHERE report_code = ?').run(reportCode);
}


// ─── Sessions (persistent, überleben Deploys) ───
function createSessionRow(token, username, role, csrf) {
  getDb().prepare('INSERT INTO sessions (token, username, role, csrf, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(token, username, role, csrf, Date.now());
}
function getSessionRow(token) {
  return getDb().prepare('SELECT * FROM sessions WHERE token = ?').get(token);
}
function deleteSessionRow(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
function pruneSessions(ttlMs) {
  getDb().prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - ttlMs);
}

module.exports = {
  createSessionRow, getSessionRow, deleteSessionRow, pruneSessions,
  getDb, cacheKey, getTTL, getCached, putCache,
  invalidateReport, invalidateGuild, getCacheStats,
  getAnalysis, putAnalysis,
  getSetting, putSetting, getAllSettings,
  getExcludedReports, excludeReport, includeReport,
  getReportData, putReportData,
  getGuildReportsCache, putGuildReportsCache,
  getReportBundle,
  getPenalties, setPenalty, removePenalty,
  getExcused, setExcused, removeExcused,
  putGearSnapshot, getGearSnapshots,
  getAdminUsers, getAdminUser, createAdminUser, updateAdminPassword, updateAdminRole, deleteAdminUser,
  addChangelogEntry, getChangelog,
  getExcludedPlayers2, setExcludedPlayer2, removeExcludedPlayer2,
  getPlayerRoles, setPlayerRole, removePlayerRole,
  getJoinDates, setJoinDate, removeJoinDate,
  getRevokedAttendance, setRevokedAttendance, removeRevokedAttendance,
  getExcusedPlayers, setExcusedPlayer, removeExcusedPlayer,
  getBugTickets, createBugTicket, updateBugTicketStatus, deleteBugTicket,
  getComputedView, putComputedView, invalidateComputedView,
  getReportTrackOverride, getAllReportTracks, setReportTrack, clearReportTrack,
  getManualReports, getManualReport, addManualReport, removeManualReport,
  getTmbRaidOverrides, setTmbRaidOverride, removeTmbRaidOverride,
};
