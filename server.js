/**
 * CLA Web App - Node.js server with SQLite caching
 * Run: node server.js
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cache = require('./db');

const PORT = 3000;
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
const TMB_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// TMB URLs aus den Settings konstruieren (tmbGuildId + tmbGuildSlug)
function getTmbUrls() {
  const guildId = cache.getSetting('tmbGuildId');
  const guildSlug = cache.getSetting('tmbGuildSlug');
  if (!guildId || !guildSlug) {
    return { configured: false, attendance: null, loot: null, raidgroups: null };
  }
  const base = `https://thatsmybis.com/${encodeURIComponent(guildId)}/${encodeURIComponent(guildSlug)}/export`;
  return {
    configured: true,
    attendance: `${base}/attendance/csv`,
    loot: `${base}/loot/csv/received`,
    raidgroups: `${base}/raid-groups/csv`,
  };
}
// Support both classic and fresh WCL endpoints
const WCL_API_BASES = {
  classic: 'https://classic.warcraftlogs.com/v1',
  fresh: 'https://fresh.warcraftlogs.com/v1',
};
const DEFAULT_API_BASE = WCL_API_BASES.fresh;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ─── Security: allowed static file directories and extensions ───
const STATIC_DIRS = new Set(['css', 'js', 'img']);
const ALLOWED_STATIC = new Set(['/index.html', '/favicon.ico', '/claudiamarie-preview.html']);

// ─── Security: allowed WCL API path prefixes ───
const WCL_ALLOWED_PATHS = [
  '/report/fights/',
  '/report/tables/',
  '/report/events/',
  '/reports/guild/',
];

// ─── Security: rate limiting for admin login ───
const loginAttempts = new Map(); // IP -> { count, lastAttempt }
const LOGIN_RATE_LIMIT = 5;      // max attempts
const LOGIN_RATE_WINDOW = 60000; // per minute

function isLoginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.lastAttempt > LOGIN_RATE_WINDOW) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }
  entry.count++;
  entry.lastAttempt = now;
  return entry.count > LOGIN_RATE_LIMIT;
}

// ─── Security: server-side sessions ───
const sessions = new Map(); // sessionToken -> { createdAt, username, role }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_COOKIE_NAME = 'cla_session';

function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now(), username, role });
  return token;
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([a-f0-9]+)`));
  if (!match) return null;
  const token = match[1];
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function validateSession(req) {
  return !!getSession(req);
}

function isSuperAdmin(req) {
  const s = getSession(req);
  return s && s.role === 'superadmin';
}

function logAction(req, action, details) {
  const s = getSession(req);
  const username = s ? s.username : 'unknown';
  cache.addChangelogEntry(username, action, details);
}

function sessionCookieHeader(token) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

// Prune expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
  }
}, 60 * 60 * 1000);

// Track running re-analysis jobs
const reanalyzeJobs = new Map(); // reportCode -> { status, startedAt, error? }

// Live-Ticker Simulation Child Process Handle
let simProc = null;

// ─── Pre-analyze pipeline state (set by preanalyze.js progress reporter) ───
const pipelineState = {
  phase: 'idle',                 // 'idle' | 'fetch-reports' | 'analyzing'
  total: 0, done: 0,             // reports queued / completed in current run
  currentReport: null,           // { code, title, zone, start }
  currentStep: null,             // 'init' | 'fetch-fights' | 'fetch-players' | 'gear' | 'buffs' | ...
  startedAt: null, lastUpdateAt: null, lastCompletedAt: null,
  error: null,
};
function pipelineUpdate(partial) {
  const now = Date.now();
  if (partial.phase && partial.phase !== pipelineState.phase) {
    if (partial.phase === 'idle') {
      pipelineState.lastCompletedAt = now;
      pipelineState.currentReport = null;
      pipelineState.currentStep = null;
    } else if (pipelineState.phase === 'idle') {
      pipelineState.startedAt = now;
      pipelineState.error = null;
    }
  }
  if (partial.phase != null) pipelineState.phase = partial.phase;
  if (partial.total != null) pipelineState.total = partial.total;
  if (partial.done != null) pipelineState.done = partial.done;
  if ('currentReport' in partial) pipelineState.currentReport = partial.currentReport;
  if (partial.reportCode != null) {
    if (!pipelineState.currentReport || pipelineState.currentReport.code !== partial.reportCode) {
      pipelineState.currentReport = { code: partial.reportCode };
    }
  }
  if (partial.step != null) pipelineState.currentStep = partial.step;
  if (partial.error != null) pipelineState.error = partial.error;
  pipelineState.lastUpdateAt = now;
}

// ─── TMB background refresh tracking ───
let tmbLastBgRunAt = null;

// ─── Manual live-ticker trigger (Admin button) ───
let manualLiveUntil = 0;
function setManualLiveUntil(ts) { manualLiveUntil = ts || 0; }

// ─── Live Ticker State ───
const liveState = {
  active: false,
  raidActive: false,
  reportCode: null,
  zone: null,
  raidStart: null,
  lastActivity: null,
  fights: [],        // analyzed fights, newest first
  gearIssues: [],    // gear issues (from latest fight, fight-independent)
  totalPlayers: 0,
  lastPollAt: null,
  lastFightKey: null,
  analyzing: false,
  error: null,
};

// ─── Security: password hashing ───
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  // Support migration: if stored doesn't contain ':', it's plaintext — hash and update it
  if (!stored.includes(':')) {
    return password === stored;
  }
  const [salt, hash] = stored.split(':');
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

// ─── Security: common response headers ───
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function wclFetch(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`WCL API ${res.statusCode}: ${body}`));
        } else {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function tmbFetch(urlStr, cookieStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'Cookie': cookieStr },
    };
    https.get(options, (res) => {
      // Follow redirects (TMB redirects to login if cookie expired)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        reject(new Error('TMB cookie expired (redirect to login)'));
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`TMB ${res.statusCode}: ${body.substring(0, 200)}`));
        } else {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

function parseTmbCsv(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { raids: [] };

  // Parse header
  const header = parseCSVLine(lines[0]);
  const dateIdx = header.indexOf('raid_date');
  const nameIdx = header.indexOf('raid_name');
  const charIdx = header.indexOf('character_name');
  const classIdx = header.indexOf('class');
  const creditIdx = header.indexOf('credit');
  const altIdx = header.indexOf('is_alt');
  const remarkIdx = header.indexOf('remark');

  // Group by raid (date + name)
  const raidMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[dateIdx]) continue;
    const raidKey = cols[dateIdx] + '|' + cols[nameIdx];
    if (!raidMap.has(raidKey)) {
      raidMap.set(raidKey, {
        date: cols[dateIdx],
        name: cols[nameIdx],
        characters: [],
      });
    }
    const remark = remarkIdx >= 0 ? (cols[remarkIdx] || '').trim() : '';
    raidMap.get(raidKey).characters.push({
      name: cols[charIdx],
      class: cols[classIdx],
      credit: parseFloat(cols[creditIdx] || '1'),
      isAlt: cols[altIdx] === '1',
      benched: /benched/i.test(remark),
    });
  }

  return { raids: [...raidMap.values()] };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseTmbLootCsv(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { loot: [] };

  const header = parseCSVLine(lines[0]);
  const idx = {};
  for (const field of ['character_name', 'character_class', 'item_name', 'item_id', 'is_offspec', 'received_at', 'instance_name', 'source_name', 'raid_group_name', 'import_id']) {
    idx[field] = header.indexOf(field);
  }

  const loot = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[idx.character_name] || !cols[idx.item_name]) continue;
    const importId = (cols[idx.import_id] || '').trim();
    const receivedAt = cols[idx.received_at] || '';
    // Skip manual entries (no import_id) unless from 2026-03-09 (Pofax batch nachtrag)
    if (!importId && !receivedAt.startsWith('2026-03-09')) continue;
    loot.push({
      character: cols[idx.character_name],
      class: cols[idx.character_class],
      item: cols[idx.item_name],
      itemId: parseInt(cols[idx.item_id]) || 0,
      offspec: cols[idx.is_offspec] === '1',
      receivedAt,
      instance: cols[idx.instance_name],
      source: cols[idx.source_name],
      raidGroup: cols[idx.raid_group_name],
    });
  }

  return { loot };
}

function parseTmbRaidGroupsCsv(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { members: {} };

  const header = parseCSVLine(lines[0]);
  const memberIdx = header.indexOf('member_name');
  const charIdx = header.indexOf('character_name');
  const classIdx = header.indexOf('character_class');

  // Deduplicate: member -> unique chars
  const memberMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const member = cols[memberIdx];
    const char = cols[charIdx];
    const cls = cols[classIdx];
    if (!member || !char) continue;
    if (!memberMap.has(member)) memberMap.set(member, new Map());
    memberMap.get(member).set(char, cls);
  }

  // Build result: { memberName: [{ name, class }] }
  const members = {};
  for (const [member, chars] of memberMap) {
    if (chars.size > 1) {
      members[member] = [...chars.entries()].map(([name, cls]) => ({ name, class: cls }));
    }
  }
  // Also build char->member reverse lookup
  const charToMember = {};
  for (const [member, chars] of memberMap) {
    for (const [name] of chars) {
      charToMember[name] = member;
    }
  }

  return { members, charToMember };
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[UNHANDLED]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

async function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  // ─── Public Branding endpoint (vor CSRF, vor Auth — wird beim Pageload geholt) ───
  if (parsed.pathname === '/api/branding' && req.method === 'GET') {
    const appName = cache.getSetting('appName') || 'Raidpolice';
    const guildName = cache.getSetting('guildName') || '';
    const serverName = cache.getSetting('serverName') || '';
    const region = cache.getSetting('region') || '';
    const faction = cache.getSetting('faction') || '';
    let easterEggs = [];
    try { easterEggs = JSON.parse(cache.getSetting('easterEggs') || '[]'); } catch (_) {}
    let raidSchedule = [];
    try { raidSchedule = JSON.parse(cache.getSetting('raidSchedule') || '[]'); } catch (_) {}
    let ediktTexts = {};
    try { ediktTexts = JSON.parse(cache.getSetting('ediktTexts') || '{}'); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ appName, guildName, serverName, region, faction, easterEggs, raidSchedule, ediktTexts }));
    return;
  }

  // ─── Live ticker endpoint (no CSRF needed, read-only) ───
  if (parsed.pathname === '/api/live/status' && req.method === 'GET') {
    const simPath = path.join(__dirname, 'data', 'live-sim-state.json');
    let state = liveState;
    try {
      if (fs.existsSync(simPath)) {
        state = JSON.parse(fs.readFileSync(simPath, 'utf8'));
      }
    } catch (e) {}
    // Wipe-Analyse für den aktuellen Live-Report mit anreichern (falls schon im Cache)
    if (state && state.reportCode) {
      try {
        const d = cache.getDb();
        const row = d.prepare("SELECT result_json FROM report_analysis WHERE report_code = ? AND analysis_type = 'wipes' AND settings_hash = 'all'").get(state.reportCode);
        if (row) state = { ...state, wipesAnalysis: JSON.parse(row.result_json) };
      } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(state));
    return;
  }

  // ─── CSRF token check for all /api/ requests ───
  if (parsed.pathname.startsWith('/api/')) {
    const token = req.headers['x-csrf-token'];
    if (token !== CSRF_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
  }

  // ─── Settings endpoints ───
  if (parsed.pathname === '/api/settings' && req.method === 'GET') {
    const all = cache.getAllSettings();
    // FIX #1: Only return safe, non-sensitive settings
    const SAFE_KEYS = ['guildName', 'serverName', 'region', 'faction', 'appName', 'tmbGuildId', 'tmbGuildSlug',
      'raidSchedule', 'easterEggs', 'currentZones', 'legacyZones', 'ediktTexts',
      'vanillaEnchants', 'rareGems', 'epicGems', 'foodRequired', 'flaskRequired', 'weaponEnhRequired',
      'analysisSettings'];
    // Secrets — separat behandelt (gemaskt zurückgegeben, niemals im Klartext)
    const SECRET_KEYS = ['apiKey', 'wclV2ClientId', 'wclV2ClientSecret', 'tmbCookie'];
    const safe = {};
    for (const k of SAFE_KEYS) {
      if (all[k] !== undefined) safe[k] = all[k];
    }
    // Secrets: nur „gesetzt"-Indikator, niemals den Wert
    for (const k of SECRET_KEYS) {
      if (all[k]) safe[`${k}_set`] = true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(safe));
    return;
  }

  if (parsed.pathname === '/api/settings' && req.method === 'POST') {
    const ALLOWED_SETTINGS = ['apiKey', 'wclV2ClientId', 'wclV2ClientSecret', 'guildName', 'serverName', 'region', 'faction', 'appName', 'tmbGuildId', 'tmbGuildSlug', 'tmbCookie',
      'raidSchedule', 'easterEggs', 'currentZones', 'legacyZones', 'ediktTexts',
      'vanillaEnchants', 'rareGems', 'epicGems', 'foodRequired', 'flaskRequired', 'weaponEnhRequired',
      'analysisSettings'];
    try {
      const body = JSON.parse(await readBody(req));
      for (const [k, v] of Object.entries(body)) {
        if (!ALLOWED_SETTINGS.includes(k)) continue;
        cache.putSetting(k, String(v));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Admin endpoints ───

  // Migrate: create default superadmin from old password if no admin_users exist
  function ensureDefaultAdmin() {
    const users = cache.getAdminUsers();
    if (users.length) return;
    const oldPw = cache.getSetting('adminPassword');
    if (oldPw) {
      const pwHash = oldPw.includes(':') ? oldPw : hashPassword(oldPw);
      cache.createAdminUser('admin', pwHash, 'superadmin');
      console.log('[AUTH] Migrated old password to superadmin user "admin"');
    }
  }
  ensureDefaultAdmin();

  // Login: username + password, server creates session cookie
  if (parsed.pathname === '/api/admin/login' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isLoginRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Zu viele Versuche. Bitte warten.' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Benutzername und Passwort erforderlich' }));
        return;
      }
      const user = cache.getAdminUser(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Falscher Benutzername oder Passwort' }));
        return;
      }
      const token = createSession(user.username, user.role);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookieHeader(token),
        ...SECURITY_HEADERS,
      });
      res.end(JSON.stringify({ ok: true, username: user.username, role: user.role }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // Check session validity
  if (parsed.pathname === '/api/admin/session' && req.method === 'GET') {
    const session = getSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ authenticated: !!session, username: session?.username, role: session?.role }));
    return;
  }

  // Change own password
  if (parsed.pathname === '/api/admin/change-password' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const oldPw = body.oldPassword || '';
      const newPw = body.newPassword || '';
      if (!oldPw || !newPw) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Altes und neues Passwort erforderlich' })); return; }
      if (newPw.length < 6) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' })); return; }
      const user = cache.getAdminUser(session.username);
      if (!user || !verifyPassword(oldPw, user.password_hash)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Altes Passwort falsch' })); return; }
      cache.updateAdminPassword(session.username, hashPassword(newPw));
      logAction(req, 'password_changed', '');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // Superadmin: manage users
  if (parsed.pathname === '/api/admin/users' && req.method === 'GET') {
    if (!isSuperAdmin(req)) { res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nur fuer Superadmins' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ users: cache.getAdminUsers() }));
    return;
  }

  if (parsed.pathname === '/api/admin/users' && req.method === 'POST') {
    if (!isSuperAdmin(req)) { res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nur fuer Superadmins' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const username = (body.username || '').trim();
      if (!username) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Benutzername fehlt' })); return; }

      if (body.remove) {
        // Can't delete yourself or the primary superadmin
        const session = getSession(req);
        if (session.username === username) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Eigenen Account kann man nicht loeschen' })); return; }
        if (username === 'admin') { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Primaerer Superadmin kann nicht geloescht werden' })); return; }
        cache.deleteAdminUser(username);
        logAction(req, 'user_deleted', username);
      } else if (body.resetPassword) {
        const newPw = body.newPassword || '';
        if (newPw.length < 6) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Passwort muss mindestens 6 Zeichen haben' })); return; }
        cache.updateAdminPassword(username, hashPassword(newPw));
        logAction(req, 'password_reset', username);
      } else if (body.changeRole) {
        const role = body.role === 'superadmin' ? 'superadmin' : 'admin';
        const session = getSession(req);
        if (session.username === username) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Eigene Rolle kann man nicht aendern' })); return; }
        if (username === 'admin') { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Rolle des primaeren Superadmins kann nicht geaendert werden' })); return; }
        cache.updateAdminRole(username, role);
        logAction(req, 'role_changed', username + ' → ' + role);
      } else {
        // Create new user
        const password = body.password || '';
        if (password.length < 6) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Passwort muss mindestens 6 Zeichen haben' })); return; }
        const existing = cache.getAdminUser(username);
        if (existing) { res.writeHead(409, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Benutzer existiert bereits' })); return; }
        const role = body.role === 'superadmin' ? 'superadmin' : 'admin';
        cache.createAdminUser(username, hashPassword(password), role);
        logAction(req, 'user_created', username + ' (' + role + ')');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, users: cache.getAdminUsers() }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // ─── Admin: system info ───
  if (parsed.pathname === '/api/admin/sysinfo' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const stats = cache.getCacheStats();
    const d = cache.getDb();
    const reportCount = d.prepare('SELECT COUNT(*) as cnt FROM report_data').get().cnt;
    const analysisCount = d.prepare('SELECT COUNT(*) as cnt FROM report_analysis').get().cnt;
    const penaltyCount = d.prepare('SELECT COUNT(*) as cnt FROM attendance_penalties').get().cnt;
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ cacheEntries: stats.entries, oldestCache: stats.oldestTs, reportCount, analysisCount, penaltyCount }));
    return;
  }

  // ─── Admin: Live-Ticker Simulation (Start/Stop/Status) ───
  if (parsed.pathname === '/api/admin/sim/status' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({
      running: simProc ? !simProc.killed && simProc.exitCode == null : false,
      reportCode: simProc ? simProc._reportCode : null,
      startedAt: simProc ? simProc._startedAt : null,
    }));
    return;
  }
  if (parsed.pathname === '/api/admin/sim/start' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      let reportCode = (body.reportCode || '').trim();
      // Fallback: neuester Report aus dem Cache
      if (!reportCode) {
        const row = cache.getDb().prepare(`SELECT report_code FROM report_data ORDER BY json_extract(meta_json, '$.start') DESC LIMIT 1`).get();
        reportCode = row ? row.report_code : null;
      }
      if (!reportCode) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Keine Reports im Cache' })); return; }
      // Bestehende Sim killen falls vorhanden
      if (simProc && simProc.exitCode == null) {
        try { simProc.kill('SIGTERM'); } catch (_) {}
      }
      const { spawn } = require('child_process');
      simProc = spawn('node', [path.join(__dirname, 'simulate-live.js'), reportCode], {
        cwd: __dirname,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      simProc._reportCode = reportCode;
      simProc._startedAt = Date.now();
      simProc.stdout.on('data', d => console.log('[SIM]', d.toString().trim()));
      simProc.stderr.on('data', d => console.error('[SIM]', d.toString().trim()));
      simProc.on('exit', (code) => { console.log(`[SIM] Process exited with code ${code}`); });
      logAction(req, 'sim_start', { reportCode });
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, reportCode, pid: simProc.pid }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (parsed.pathname === '/api/admin/sim/stop' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      if (simProc && simProc.exitCode == null) {
        simProc.kill('SIGTERM');
      }
      // State-File wegräumen
      const stateFile = path.join(__dirname, 'data', 'live-sim-state.json');
      try { fs.unlinkSync(stateFile); } catch (_) {}
      simProc = null;
      logAction(req, 'sim_stop', {});
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (parsed.pathname === '/api/admin/sim/recent-reports' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const rows = cache.getDb().prepare(`SELECT report_code, meta_json FROM report_data ORDER BY json_extract(meta_json, '$.start') DESC LIMIT 20`).all();
      const out = rows.map(r => {
        const m = JSON.parse(r.meta_json || '{}');
        return { code: r.report_code, title: m.title, start: m.start, zone: m.zone };
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: Manuelle Reports (für Logs, die nicht unter der Gilde laufen) ───
  if (parsed.pathname === '/api/admin/manual-reports' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ reports: cache.getManualReports() }));
    return;
  }
  if (parsed.pathname === '/api/admin/manual-reports' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const raw = String(body.input || '').trim();
      if (!raw) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Kein Report-Code/URL angegeben' })); return; }
      // Code aus URL extrahieren oder direkt verwenden
      let code = raw;
      const m = raw.match(/reports\/(?:a:)?([a-zA-Z0-9]+)/);
      if (m) code = m[1];
      if (!/^[a-zA-Z0-9]{8,32}$/.test(code)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Ungültiger Report-Code (erwartet 8-32 Zeichen alphanumerisch)' }));
        return;
      }
      // Report-Metadaten von WCL holen
      const preanalyze = require('./preanalyze');
      let fightData;
      try {
        fightData = await preanalyze.wclApi(`/report/fights/${code}`, {}, { nocache: true });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'WCL konnte Report nicht laden: ' + e.message }));
        return;
      }
      const fights = fightData.fights || [];
      const lastFight = fights.length ? fights[fights.length - 1] : null;
      const startTs = fightData.start || (fights.length ? fights[0].start_time : 0);
      const endTs = fightData.end || (lastFight ? (startTs + (lastFight.end_time || 0)) : 0);
      const session = getSession(req);
      cache.addManualReport({
        report_code: code,
        title: fightData.title || raw,
        owner: fightData.owner || null,
        zone_id: fightData.zone || (fights[0] && fights[0].zoneID) || null,
        start_ts: startTs,
        end_ts: endTs,
        added_by: session ? session.username : null,
        note: body.note || null,
      });
      // Spiegel-Eintrag in den guild_reports_cache mergen, damit das Frontend ihn sofort sieht
      try {
        const guildName = cache.getSetting('guildName');
        const serverName = cache.getSetting('serverName');
        const region = cache.getSetting('region') || cache.getSetting('serverRegion');
        if (guildName && serverName && region) {
          const guildKey = `${guildName}/${serverName}/${region}`;
          const cached = cache.getGuildReportsCache(guildKey);
          const list = cached ? JSON.parse(cached.reports_json) : [];
          if (!list.some(r => r.id === code)) {
            list.unshift({
              id: code,
              title: fightData.title || raw,
              owner: fightData.owner || null,
              zone: fightData.zone || (fights[0] && fights[0].zoneID) || 0,
              start: startTs,
              end: endTs,
              manual: true,
            });
            cache.putGuildReportsCache(guildKey, JSON.stringify(list));
          }
        }
      } catch (_) {}
      logAction(req, 'manual_report_add', code);
      // Pre-Analyse anstoßen (async, blockt die Response nicht)
      preanalyze.processReport(code).catch(e => console.error('[MANUAL] preanalyze error:', e.message));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, code, title: fightData.title, zone: fightData.zone, start: startTs }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (parsed.pathname.startsWith('/api/admin/manual-reports/') && req.method === 'DELETE') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const code = parsed.pathname.substring('/api/admin/manual-reports/'.length);
    if (!/^[a-zA-Z0-9]{8,32}$/.test(code)) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Ungültiger Code' }));
      return;
    }
    cache.removeManualReport(code);
    // Auch aus dem gespiegelten guild_reports_cache entfernen
    try {
      const guildName = cache.getSetting('guildName');
      const serverName = cache.getSetting('serverName');
      const region = cache.getSetting('region') || cache.getSetting('serverRegion');
      if (guildName && serverName && region) {
        const guildKey = `${guildName}/${serverName}/${region}`;
        const cached = cache.getGuildReportsCache(guildKey);
        if (cached) {
          const list = JSON.parse(cached.reports_json).filter(r => !(r.id === code && r.manual));
          cache.putGuildReportsCache(guildKey, JSON.stringify(list));
        }
      }
    } catch (_) {}
    logAction(req, 'manual_report_remove', code);
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ─── Admin: Tracking-Config (welche Spells/Items werden aktuell getrackt) ───
  if (parsed.pathname === '/api/admin/tracking-config' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const preanalyze = require('./preanalyze');
      const cfg = preanalyze.getTrackingConfig ? preanalyze.getTrackingConfig() : {};
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify(cfg));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: Wipe-Analyse (Tier 1+2+3) ───
  if (parsed.pathname === '/api/admin/wipes' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const d = cache.getDb();
      const rows = d.prepare("SELECT ra.report_code, ra.result_json, rd.meta_json FROM report_analysis ra JOIN report_data rd ON ra.report_code = rd.report_code WHERE ra.analysis_type='wipes' AND ra.settings_hash='all'").all();
      const reports = rows.map(r => {
        const meta = JSON.parse(r.meta_json || '{}');
        const wipes = JSON.parse(r.result_json || '[]');
        return {
          reportCode: r.report_code,
          title: meta.title,
          start: meta.start,
          zone: meta.zone,
          wipeCount: wipes.length,
          wipes,
        };
      }).filter(r => r.wipeCount > 0).sort((a, b) => (b.start || 0) - (a.start || 0));
      // Nur den NEUESTEN Report — Boss-Grouping würde sonst Fights aus verschiedenen Reports mischen
      const limited = reports.slice(0, 1);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ reports: limited }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: TMB + progression cache freshness ───
  if (parsed.pathname === '/api/admin/data-status' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const now = Date.now();
    const tmbKeys = [
      { key: 'tmb_attendance', label: 'TMB Attendance' },
      { key: 'tmb_loot', label: 'TMB Loot' },
      { key: 'tmb_raidgroups', label: 'TMB Raidgroups' },
    ];
    const tmb = tmbKeys.map(k => {
      const row = cache.getCached(k.key);
      return {
        key: k.key, label: k.label,
        fetchedAt: row ? row.fetched_at : null,
        ageMs: row ? now - row.fetched_at : null,
      };
    });
    const progRow = cache.getComputedView('progression');
    const progression = {
      computedAt: progRow ? progRow.computed_at : null,
      ageMs: progRow ? now - progRow.computed_at : null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({
      tmb, tmbTtlMs: TMB_CACHE_TTL,
      tmbLastBgRunAt,
      tmbNextAutoRefreshAt: tmbLastBgRunAt ? tmbLastBgRunAt + TMB_CACHE_TTL : null,
      progression,
    }));
    return;
  }

  // ─── Admin: manual live-ticker trigger ───
  if (parsed.pathname === '/api/admin/live/start' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const until = Date.now() + 30 * 60 * 1000;
    setManualLiveUntil(until);
    logAction(req, 'live_manual_start', new Date(until).toISOString());
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, until }));
    return;
  }
  if (parsed.pathname === '/api/admin/live/stop' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    setManualLiveUntil(0);
    logAction(req, 'live_manual_stop', '');
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (parsed.pathname === '/api/admin/live/status' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ manualUntil: manualLiveUntil || null, active: manualLiveUntil > Date.now() }));
    return;
  }
  if (parsed.pathname === '/api/admin/live/reanalyze' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const count = liveState.fights.length;
    liveState.fights = [];
    logAction(req, 'live_reanalyze', count + ' fights cleared');
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, cleared: count, message: 'Liveticker-Fights geleert — nächster Poll (binnen 60s) analysiert neu' }));
    return;
  }

  // ─── Admin: pre-analyze pipeline status ───
  if (parsed.pathname === '/api/admin/pipeline-status' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(pipelineState));
    return;
  }

  // ─── Admin: rebuild progression cache ───
  if (parsed.pathname === '/api/admin/progression/rebuild' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const progression = require('./progression');
      progression.invalidate();
      const result = progression.getOrBuild();
      logAction(req, 'progression_rebuild', '');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, computedAt: result.computed_at }));
    } catch (e) {
      console.error('[ADMIN] progression rebuild failed:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: report start date ───
  if (parsed.pathname === '/api/admin/start-date' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ startDate: cache.getSetting('reportStartDate') || '' }));
    return;
  }
  if (parsed.pathname === '/api/admin/start-date' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const startDate = body.startDate || '';
      cache.putSetting('reportStartDate', startDate);
      let purged = 0;
      if (body.purge && startDate) {
        const d = cache.getDb();
        const startTs = new Date(startDate + 'T00:00:00').getTime();
        // Find old reports
        const oldReports = d.prepare('SELECT report_code, meta_json FROM report_data').all().filter(r => {
          try { return JSON.parse(r.meta_json).start < startTs; } catch (e) { return false; }
        });
        for (const r of oldReports) {
          d.prepare('DELETE FROM report_data WHERE report_code = ?').run(r.report_code);
          d.prepare('DELETE FROM report_analysis WHERE report_code = ?').run(r.report_code);
          d.prepare("DELETE FROM api_cache WHERE cache_key LIKE ?").run(`%${r.report_code}%`);
          purged++;
        }
        console.log(`[ADMIN] Purged ${purged} reports before ${startDate}`);
      }
      logAction(req, 'start_date_changed', startDate + (purged ? ', ' + purged + ' Reports geloescht' : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, purged }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // ─── Admin: clear WCL cache ───
  if (parsed.pathname === '/api/admin/clear-cache' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const d = cache.getDb();
    const result = d.prepare('DELETE FROM api_cache').run();
    logAction(req, 'cache_cleared', result.changes + ' Eintraege geloescht');
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, deleted: result.changes }));
    return;
  }

  // ─── Admin: changelog ───
  if (parsed.pathname === '/api/admin/changelog' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ entries: cache.getChangelog(200) }));
    return;
  }

  // All other admin endpoints require valid session
  if (parsed.pathname === '/api/admin/excluded' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      if (body.exclude) {
        cache.excludeReport(body.reportCode);
      } else {
        cache.includeReport(body.reportCode);
      }
      try { require('./progression').invalidate(); } catch (_) {}
      logAction(req, body.exclude ? 'report_excluded' : 'report_included', body.reportCode);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // Admin: list all reports with analysis status
  if (parsed.pathname === '/api/admin/reports' && req.method === 'GET') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const guildName = cache.getSetting('guildName');
      const serverName = cache.getSetting('serverName');
      const region = cache.getSetting('region') || cache.getSetting('serverRegion');
      if (!guildName || !serverName || !region) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Guild not configured' }));
        return;
      }
      const guildKey = `${guildName}/${serverName}/${region}`;
      const cached = cache.getGuildReportsCache(guildKey);
      const reports = cached ? JSON.parse(cached.reports_json) : [];
      const excluded = new Set(cache.getExcludedReports());
      const trackOverrides = cache.getAllReportTracks();
      const progression = require('./progression');

      const d = cache.getDb();
      const result = reports.map(r => {
        // Check which analyses exist for this report
        const analysisStatus = {};
        for (const type of ['gear', 'buffs', 'consumables', 'spellranks']) {
          const row = d.prepare('SELECT analyzed_at FROM report_analysis WHERE report_code = ? AND analysis_type = ? AND settings_hash = ?')
            .get(r.id, type, 'all');
          analysisStatus[type] = row ? row.analyzed_at : null;
        }
        // Check if report data exists
        const rd = d.prepare('SELECT fetched_at FROM report_data WHERE report_code = ?').get(r.id);

        // Check re-analyze job status
        const job = reanalyzeJobs.get(r.id);

        return {
          id: r.id,
          title: r.title,
          zone: r.zone,
          start: r.start,
          end: r.end,
          owner: r.owner,
          excluded: excluded.has(r.id),
          dataFetched: rd ? rd.fetched_at : null,
          analysis: analysisStatus,
          reanalyzeStatus: job || null,
          track: trackOverrides[r.id] || progression.getDefaultTrackForReport(r),
          trackOverride: !!trackOverrides[r.id],
          manual: !!r.manual,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ reports: result, guildName, serverName, region }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Admin: trigger re-analysis for a report
  if (parsed.pathname === '/api/admin/reanalyze' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const code = body.reportCode;
      if (!code || !/^[A-Za-z0-9]+$/.test(code)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Invalid report code' }));
        return;
      }

      // Check if already running
      const existing = reanalyzeJobs.get(code);
      if (existing && existing.status === 'running') {
        res.writeHead(409, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Analyse laeuft bereits', startedAt: existing.startedAt }));
        return;
      }

      // Clear existing analysis data to force re-analysis
      cache.invalidateReport(code);
      // Also remove report_data so it re-fetches from WCL
      const d = cache.getDb();
      d.prepare('DELETE FROM report_data WHERE report_code = ?').run(code);

      reanalyzeJobs.set(code, { status: 'running', startedAt: Date.now(), logs: [] });

      // Run in background, capturing console output
      const preanalyze = require('./preanalyze');
      const origLog = console.log;
      const origErr = console.error;
      const job = reanalyzeJobs.get(code);
      const capture = (...args) => { const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '); if (line.includes(code) || line.includes('[PRE]')) job.logs.push({ ts: Date.now(), msg: line }); };
      console.log = (...args) => { capture(...args); origLog(...args); };
      console.error = (...args) => { capture(...args); origErr(...args); };
      preanalyze.processReport(code).then(() => {
        job.status = 'done'; job.finishedAt = Date.now();
        job.logs.push({ ts: Date.now(), msg: 'Analyse abgeschlossen.' });
      }).catch(e => {
        job.status = 'error'; job.error = e.message;
        job.logs.push({ ts: Date.now(), msg: 'FEHLER: ' + e.message });
      }).finally(() => { console.log = origLog; console.error = origErr; });

      logAction(req, 'report_reanalyze', code);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, status: 'running' }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // Admin: get reanalyze logs
  if (parsed.pathname.match(/^\/api\/admin\/reanalyze-log\/[A-Za-z0-9]+$/) && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const code = parsed.pathname.split('/')[4];
    const job = reanalyzeJobs.get(code);
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ status: job?.status || 'unknown', logs: job?.logs || [] }));
    return;
  }

  // Admin: trigger full guild refresh (re-fetch reports + analyze all)
  if (parsed.pathname === '/api/admin/refresh-all' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const preanalyze = require('./preanalyze');
      preanalyze.checkAndAnalyzeNewReports().catch(e => console.error('[ADMIN] Refresh error:', e.message));
      logAction(req, 'refresh_all', '');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, status: 'started' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/excluded-reports' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ excluded: cache.getExcludedReports() }));
    return;
  }

  // TBC 25-man zone IDs
  const TBC_25_ZONES = new Set([1007, 1008, 1009, 1010, 1011, 1002, 1003, 1048]);
  function isTbc25Report(metaJson, fightsJson) {
    try {
      const meta = JSON.parse(metaJson);
      if (TBC_25_ZONES.has(meta.zone)) return true;
      const fights = JSON.parse(fightsJson);
      return fights.some(f => f.size >= 25);
    } catch (e) { return false; }
  }

  // ─── Player detail endpoint ───
  if (parsed.pathname.match(/^\/api\/player\/[^/]+$/) && req.method === 'GET') {
    const playerName = decodeURIComponent(parsed.pathname.split('/')[3]);
    const d = cache.getDb();
    const startDateStr = cache.getSetting('reportStartDate');
    const startTs = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;

    // Get all report data
    const allReports = d.prepare('SELECT report_code, fights_json, players_json, meta_json FROM report_data').all();
    const excludedReports = new Set(cache.getExcludedReports());

    // Filter to TBC 25-man, non-excluded, after start date
    const reports = allReports.filter(r => {
      if (excludedReports.has(r.report_code)) return false;
      if (!isTbc25Report(r.meta_json, r.fights_json)) return false;
      try { const m = JSON.parse(r.meta_json); return !startTs || m.start >= startTs; } catch (e) { return false; }
    }).map(r => {
      const meta = JSON.parse(r.meta_json);
      const players = JSON.parse(r.players_json);
      return { code: r.report_code, meta, players, present: players.some(p => p.name === playerName) };
    }).sort((a, b) => (a.meta.start || 0) - (b.meta.start || 0));

    // Player class (from most recent appearance)
    let playerClass = '';
    for (const r of reports) {
      const p = r.players.find(p => p.name === playerName);
      if (p) { const pre = require('./preanalyze'); playerClass = pre.classNameFromType(p.type) || playerClass; }
    }

    // Attendance — deduplicate by date and include TMB bench data
    const dateMap = new Map();
    for (const r of reports) {
      const ds = new Date(r.meta.start).toISOString().slice(0, 10);
      if (!dateMap.has(ds)) {
        dateMap.set(ds, { date: ds, zone: r.meta.zone, title: r.meta.title, present: false });
      }
      if (r.present) dateMap.get(ds).present = true;
    }
    // Merge TMB attendance (includes bench players not in WCL logs)
    try {
      const tmbCached = cache.getCached('tmb_attendance');
      if (tmbCached) {
        const tmb = JSON.parse(tmbCached.response_json);
        for (const raid of (tmb.raids || [])) {
          const tmbChar = raid.characters.find(c => c.name === playerName);
          if (!tmbChar) continue;
          const tmbDate = raid.date.slice(0, 10);  // normalize "2026-03-05 18:30:20" → "2026-03-05"
          const isBenched = !!tmbChar.benched;
          if (dateMap.has(tmbDate)) {
            if (!dateMap.get(tmbDate).present) dateMap.get(tmbDate).present = true;
            if (isBenched) dateMap.get(tmbDate).benched = true;
          }
          // TMB-only dates (no WCL log) — only add if after start date
          if (!dateMap.has(tmbDate) && (!startTs || new Date(tmbDate + 'T19:00:00').getTime() >= startTs)) {
            dateMap.set(tmbDate, { date: tmbDate, zone: null, title: raid.name, present: true, benched: isBenched });
          }
        }
      }
    } catch (e) {}
    const attendance = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Buff rates per report (policy-aware: re-counts flask from fightDetails)
    const progression = require('./progression');
    const policy = (() => { try { return JSON.parse(cache.getSetting('elixirPolicy') || '{}') || {}; } catch (_) { return {}; } })();
    const nameToId = progression.buildNameToId ? progression.buildNameToId(d) : {};
    const buffRates = [];
    for (const r of reports) {
      if (!r.present) continue;
      const row = d.prepare("SELECT result_json FROM report_analysis WHERE report_code = ? AND analysis_type = 'buffs' AND settings_hash = 'all'").get(r.code);
      if (!row) continue;
      const buffs = JSON.parse(row.result_json);
      const pb = (Array.isArray(buffs) ? buffs : buffs.results || []).find(b => b.name === playerName);
      if (!pb) continue;
      const fc = pb.playerFightCount || 1;
      let flaskOk = 0;
      if (progression.isFlaskOrElixirOk && Array.isArray(pb.fightDetails)) {
        for (const fd of pb.fightDetails) if (progression.isFlaskOrElixirOk(fd, policy, nameToId)) flaskOk++;
      } else {
        flaskOk = pb.flaskOrElixir || 0;
      }
      buffRates.push({
        date: new Date(r.meta.start).toISOString().slice(0, 10),
        flask: Math.round(flaskOk / fc * 100),
        food: Math.round((pb.foodBuff || 0) / fc * 100),
        weapon: Math.round((pb.weaponEnhancement || 0) / fc * 100),
      });
    }

    // DPS/HPS per report
    const performance = [];
    for (const r of reports) {
      if (!r.present) continue;
      const row = d.prepare("SELECT result_json FROM report_analysis WHERE report_code = ? AND analysis_type = 'dmgheal' AND settings_hash = 'all'").get(r.code);
      if (!row) continue;
      const dh = JSON.parse(row.result_json);
      const fights = [];
      for (const fight of (Array.isArray(dh) ? dh : [])) {
        const dmgEntry = (fight.damage || []).find(d => d.name === playerName);
        const healEntry = (fight.healing || []).find(h => h.name === playerName);
        if (dmgEntry || healEntry) {
          fights.push({ boss: fight.fightName, dps: dmgEntry?.dps || 0, hps: healEntry?.hps || 0, duration: fight.duration });
        }
      }
      if (fights.length) performance.push({ date: new Date(r.meta.start).toISOString().slice(0, 10), fights });
    }

    // Deaths per report
    const deaths = [];
    for (const r of reports) {
      if (!r.present) continue;
      const row = d.prepare("SELECT result_json FROM report_analysis WHERE report_code = ? AND analysis_type = 'deaths' AND settings_hash = 'all'").get(r.code);
      if (!row) continue;
      const deathData = JSON.parse(row.result_json);
      let count = 0;
      for (const fight of (Array.isArray(deathData) ? deathData : [])) {
        const pd = (fight.deaths || []).find(d => d.name === playerName);
        if (pd) count += pd.deaths;
      }
      if (count > 0) deaths.push({ date: new Date(r.meta.start).toISOString().slice(0, 10), count });
    }

    // Gear changes
    const snapshots = cache.getGearSnapshots(playerName);
    const gearHistory = [];
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const gear = JSON.parse(snap.gear_json);
      const date = new Date(snap.report_date).toISOString().slice(0, 10);
      if (i === 0) {
        gearHistory.push({ date, reportCode: snap.report_code, type: 'initial', items: gear.filter(g => g.id && g.slot !== 3) });
        continue;
      }
      const prevGear = JSON.parse(snapshots[i - 1].gear_json);
      const changes = [];
      for (const item of gear) {
        if (!item.id || item.slot === 3) continue; // skip empty/shirt
        const prev = prevGear.find(p => p.slot === item.slot);
        if (!prev || prev.id !== item.id) {
          changes.push({ slot: item.slot, oldItem: prev || null, newItem: item });
        } else if (prev.permanentEnchant !== item.permanentEnchant && (prev.permanentEnchant || item.permanentEnchant)) {
          changes.push({ slot: item.slot, oldItem: prev, newItem: item, enchantChange: true });
        } else {
          // Check gem changes on same item
          const prevGems = (prev.gems || []).map(g => g.id).sort().join(',');
          const newGems = (item.gems || []).map(g => g.id).sort().join(',');
          if (prevGems !== newGems && newGems) {
            changes.push({ slot: item.slot, oldItem: prev, newItem: item, gemChange: true });
          }
        }
      }
      if (changes.length) gearHistory.push({ date, reportCode: snap.report_code, type: 'changes', changes });
    }

    // Loot (from TMB)
    let loot = [];
    try {
      const tmbCookie = cache.getSetting('tmbCookie');
      if (tmbCookie) {
        const cacheKey = 'tmb_loot';
        const cached2 = cache.getCached(cacheKey);
        if (cached2) {
          const lootData = JSON.parse(cached2.response_json);
          loot = (lootData.loot || []).filter(l => l.character === playerName);
        }
      }
    } catch (e) {}

    // Penalties/excused/revoked
    const penalty = cache.getPenalties().find(p => p.player_name === playerName) || null;
    const excused = cache.getExcusedPlayers().filter(e => e.player_name === playerName);
    const revoked = cache.getRevokedAttendance().filter(r => r.player_name === playerName);

    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ name: playerName, class: playerClass, attendance, buffRates, performance, deaths, gearHistory, loot, penalty, excused, revoked }));
    return;
  }

  // ─── Raid dates (25-man, for dropdowns) ───
  if (parsed.pathname === '/api/raid-dates' && req.method === 'GET') {
    const d = cache.getDb();
    const rows = d.prepare('SELECT report_code, meta_json, fights_json FROM report_data').all();
    const excludedDates = new Set(cache.getExcused().map(e => e.raid_date));
    const dateMap = new Map();
    for (const r of rows) {
      try {
        const meta = JSON.parse(r.meta_json);
        const fights = JSON.parse(r.fights_json);
        if (!isTbc25Report(r.meta_json, r.fights_json)) continue;
        const ds = new Date(meta.start).toISOString().slice(0, 10);
        if (!dateMap.has(ds)) dateMap.set(ds, { date: ds, title: meta.title, zone: meta.zone, excluded: excludedDates.has(ds) });
      } catch (e) {}
    }
    const dates = [...dateMap.values()].sort((a, b) => b.date.localeCompare(a.date));
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ dates }));
    return;
  }

  // ─── Player raids (which player was in which raid) ───
  if (parsed.pathname === '/api/player-raids' && req.method === 'GET') {
    const d = cache.getDb();
    const rows = d.prepare('SELECT report_code, meta_json, fights_json, players_json FROM report_data').all();
    const playerRaids = {}; // playerName → [{ date, title }]
    for (const r of rows) {
      try {
        const meta = JSON.parse(r.meta_json);
        const fights = JSON.parse(r.fights_json);
        const players = JSON.parse(r.players_json);
        if (!isTbc25Report(r.meta_json, r.fights_json)) continue;
        const ds = new Date(meta.start).toISOString().slice(0, 10);
        for (const p of players) {
          if (!playerRaids[p.name]) playerRaids[p.name] = [];
          if (!playerRaids[p.name].some(r => r.date === ds)) {
            playerRaids[p.name].push({ date: ds, title: meta.title });
          }
        }
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ playerRaids }));
    return;
  }

  // ─── Player names (for autocomplete) ───
  if (parsed.pathname === '/api/players' && req.method === 'GET') {
    const d = cache.getDb();
    const rows = d.prepare('SELECT report_code, players_json, fights_json, meta_json FROM report_data').all();
    const excludedReports = new Set(cache.getExcludedReports());
    const excludedPlayers = new Set(cache.getExcludedPlayers2().map(e => e.player_name));
    const names = new Set();
    for (const r of rows) {
      try {
        if (excludedReports.has(r.report_code)) continue;
        if (!isTbc25Report(r.meta_json, r.fights_json)) continue;
        for (const p of JSON.parse(r.players_json)) {
          if (!excludedPlayers.has(p.name)) names.add(p.name);
        }
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ players: [...names].sort() }));
    return;
  }

  // ─── Penalties & Excused (public read) ───
  if (parsed.pathname === '/api/penalties' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ penalties: cache.getPenalties(), excused: cache.getExcused(), excusedPlayers: cache.getExcusedPlayers(), revoked: cache.getRevokedAttendance(), excludedPlayers: cache.getExcludedPlayers2(), joinDates: cache.getJoinDates(), playerRoles: cache.getPlayerRoles() }));
    return;
  }

  // ─── Admin: manage penalties ───
  if (parsed.pathname === '/api/admin/penalties' && req.method === 'GET') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ penalties: cache.getPenalties() }));
    return;
  }

  // ─── Admin: manage excused absences ───
  if (parsed.pathname === '/api/admin/excused' && req.method === 'GET') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ excused: cache.getExcused() }));
    return;
  }

  if (parsed.pathname === '/api/admin/excused' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const date = (body.raidDate || '').trim();
      if (!date) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Datum fehlt' }));
        return;
      }
      if (body.remove) {
        cache.removeExcused(date);
      } else {
        cache.setExcused(date, body.reason || '', getSession(req)?.username);
      }
      logAction(req, body.remove ? 'raid_unexcluded' : 'raid_excluded', date + (body.reason ? ': ' + body.reason : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, excused: cache.getExcused() }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Admin: excluded players ───
  if (parsed.pathname === '/api/admin/excluded-players' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      if (!name) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Spielername fehlt' })); return; }
      if (body.remove) cache.removeExcludedPlayer2(name);
      else cache.setExcludedPlayer2(name, body.reason || '', getSession(req)?.username);
      logAction(req, body.remove ? 'player_unexcluded' : 'player_excluded', name + (body.reason ? ': ' + body.reason : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // ─── Admin: player roles ───
  if (parsed.pathname === '/api/admin/player-roles' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      if (!name) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Spielername fehlt' })); return; }
      if (body.remove) cache.removePlayerRole(name);
      else {
        const role = (body.role || '').trim();
        if (!['tank', 'healer', 'dps'].includes(role)) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Ungueltige Rolle (tank/healer/dps)' })); return; }
        cache.setPlayerRole(name, role, getSession(req)?.username);
      }
      logAction(req, body.remove ? 'player_role_removed' : 'player_role_set', name + (body.role ? ' → ' + body.role : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // ─── Admin: join dates ───
  if (parsed.pathname === '/api/admin/join-dates' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      if (!name) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Spielername fehlt' })); return; }
      if (body.remove) cache.removeJoinDate(name);
      else {
        const date = (body.joinDate || '').trim();
        if (!date) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Datum fehlt' })); return; }
        cache.setJoinDate(name, date, getSession(req)?.username);
      }
      logAction(req, body.remove ? 'joindate_removed' : 'joindate_set', name + ' → ' + (body.joinDate || ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  // ─── Admin: revoked attendance ───
  if (parsed.pathname === '/api/admin/revoked' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      const date = (body.raidDate || '').trim();
      if (!name || !date) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Spielername und Datum fehlen' }));
        return;
      }
      if (body.remove) {
        cache.removeRevokedAttendance(name, date);
      } else {
        cache.setRevokedAttendance(name, date, body.reason || '', getSession(req)?.username);
      }
      logAction(req, body.remove ? 'revoked_removed' : 'revoked_added', name + ' @ ' + date + (body.reason ? ': ' + body.reason : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Admin: player-specific excused ───
  if (parsed.pathname === '/api/admin/excused-player' && req.method === 'GET') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ excusedPlayers: cache.getExcusedPlayers() }));
    return;
  }

  if (parsed.pathname === '/api/admin/excused-player' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      const date = (body.raidDate || '').trim();
      if (!name || !date) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Spielername und Datum fehlen' }));
        return;
      }
      if (body.remove) {
        cache.removeExcusedPlayer(name, date);
      } else {
        cache.setExcusedPlayer(name, date, body.reason || '', getSession(req)?.username);
      }
      logAction(req, body.remove ? 'excused_player_removed' : 'excused_player_added', name + ' @ ' + date + (body.reason ? ': ' + body.reason : ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  if (parsed.pathname === '/api/admin/penalties' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const name = (body.playerName || '').trim();
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Spielername fehlt' }));
        return;
      }
      if (body.remove) {
        cache.removePenalty(name);
      } else {
        const pct = parseInt(body.penaltyPct);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'Strafe muss zwischen 0 und 100 liegen' }));
          return;
        }
        cache.setPenalty(name, pct, body.reason || '', getSession(req)?.username);
      }
      logAction(req, body.remove ? 'penalty_removed' : 'penalty_set', name + ': ' + (body.penaltyPct || 0) + '% ' + (body.reason || ''));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, penalties: cache.getPenalties() }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Cache invalidation endpoint ───
  if (parsed.pathname === '/api/cache/invalidate' && req.method === 'POST') {
    if (!validateSession(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Nicht autorisiert' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      if (body.reportCode) cache.invalidateReport(body.reportCode);
      if (body.guildKey) cache.invalidateGuild(body.guildKey);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Cache stats endpoint ───
  if (parsed.pathname === '/api/cache/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(cache.getCacheStats()));
    return;
  }

  // ─── Analysis storage endpoints ───
  if (parsed.pathname.startsWith('/api/analysis/') && req.method === 'GET') {
    const parts = parsed.pathname.split('/');
    // /api/analysis/:reportCode/:type?settingsHash=...
    const reportCode = parts[3];
    const type = parts[4];
    const settingsHash = parsed.searchParams.get('sh') || '';
    if (reportCode && type) {
      const row = cache.getAnalysis(reportCode, type, settingsHash);
      if (row) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(row.result_json);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'missing params' }));
    }
    return;
  }

  if (parsed.pathname === '/api/analysis' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      cache.putAnalysis(body.reportCode, body.type, body.settingsHash, JSON.stringify(body.result));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── TMB attendance endpoint ───
  if (parsed.pathname === '/api/tmb/attendance' && req.method === 'GET') {
    const tmbCookie = cache.getSetting('tmbCookie');
    if (!tmbCookie) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'TMB cookie not configured' }));
      return;
    }

    // Check cache (skip if ?refresh=1)
    const cacheKey = 'tmb_attendance';
    const forceRefresh = parsed.query && parsed.query.includes('refresh=1');
    const cached = cache.getCached(cacheKey);
    let attendance;
    if (!forceRefresh && cached && (Date.now() - cached.fetched_at < TMB_CACHE_TTL)) {
      attendance = JSON.parse(cached.response_json);
    } else {
      try {
        const tmbUrls = getTmbUrls();
        if (!tmbUrls.configured) {
          res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'TMB guild not configured' }));
          return;
        }
        const csvData = await tmbFetch(tmbUrls.attendance, tmbCookie);
        attendance = parseTmbCsv(csvData);
        cache.putCache(cacheKey, JSON.stringify(attendance));
      } catch (err) {
        console.error('[TMB]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'TMB fetch failed' }));
        return;
      }
    }
    // Date-Overrides on-the-fly anwenden — Admin korrigiert fehl-datierte TMB-Raids
    try {
      const overrides = cache.getTmbRaidOverrides();
      if (overrides.length) {
        const lookup = new Map(overrides.map(o => [o.orig_date + '|' + o.raid_name, o.new_date]));
        for (const r of (attendance.raids || [])) {
          const key = r.date + '|' + r.name;
          if (lookup.has(key)) r.date = lookup.get(key);
        }
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(attendance));
    return;
  }

  // ─── Admin: TMB-Raid-Datum-Overrides ───
  if (parsed.pathname === '/api/admin/tmb-raid-overrides' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ overrides: cache.getTmbRaidOverrides() }));
    return;
  }
  if (parsed.pathname === '/api/admin/tmb-raid-overrides' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const origDate = String(body.origDate || '').trim();
      const raidName = String(body.raidName || '').trim();
      const newDate = String(body.newDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}/.test(origDate) || !raidName || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'origDate / raidName / newDate ungültig (newDate: YYYY-MM-DD)' }));
        return;
      }
      const session = getSession(req);
      cache.setTmbRaidOverride(origDate, raidName, newDate, session ? session.username : null);
      logAction(req, 'tmb_override_set', `${origDate} "${raidName}" → ${newDate}`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (parsed.pathname === '/api/admin/tmb-raid-overrides' && req.method === 'DELETE') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const origDate = String(body.origDate || '').trim();
      const raidName = String(body.raidName || '').trim();
      if (!origDate || !raidName) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'origDate + raidName erforderlich' }));
        return;
      }
      cache.removeTmbRaidOverride(origDate, raidName);
      logAction(req, 'tmb_override_remove', `${origDate} "${raidName}"`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── TMB Loot endpoint ───
  if (parsed.pathname === '/api/tmb/loot' && req.method === 'GET') {
    const tmbCookie = cache.getSetting('tmbCookie');
    if (!tmbCookie) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'TMB cookie not configured' }));
      return;
    }

    const cacheKey = 'tmb_loot';
    const forceRefresh = parsed.query && parsed.query.includes('refresh=1');
    const cached = cache.getCached(cacheKey);
    if (!forceRefresh && cached && (Date.now() - cached.fetched_at < TMB_CACHE_TTL)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...SECURITY_HEADERS });
      res.end(cached.response_json);
      return;
    }

    try {
      const tmbUrls = getTmbUrls();
      if (!tmbUrls.configured) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'TMB guild not configured' }));
        return;
      }
      const csvData = await tmbFetch(tmbUrls.loot, tmbCookie);
      const lootData = parseTmbLootCsv(csvData);
      const json = JSON.stringify(lootData);
      cache.putCache(cacheKey, json);
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS', ...SECURITY_HEADERS });
      res.end(json);
    } catch (err) {
      console.error('[TMB Loot]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'TMB loot fetch failed' }));
    }
    return;
  }

  // ─── TMB Raid Groups (member→chars mapping) endpoint ───
  if (parsed.pathname === '/api/tmb/raidgroups' && req.method === 'GET') {
    const tmbCookie = cache.getSetting('tmbCookie');
    if (!tmbCookie) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'TMB cookie not configured' }));
      return;
    }

    const cacheKey = 'tmb_raidgroups';
    const forceRefresh = parsed.query && parsed.query.includes('refresh=1');
    const cached = cache.getCached(cacheKey);
    if (!forceRefresh && cached && (Date.now() - cached.fetched_at < TMB_CACHE_TTL)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...SECURITY_HEADERS });
      res.end(cached.response_json);
      return;
    }

    try {
      const tmbUrls = getTmbUrls();
      if (!tmbUrls.configured) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'TMB guild not configured' }));
        return;
      }
      const csvData = await tmbFetch(tmbUrls.raidgroups, tmbCookie);
      const rgData = parseTmbRaidGroupsCsv(csvData);
      const json = JSON.stringify(rgData);
      cache.putCache(cacheKey, json);
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS', ...SECURITY_HEADERS });
      res.end(json);
    } catch (err) {
      console.error('[TMB RaidGroups]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'TMB raidgroups fetch failed' }));
    }
    return;
  }

  // ─── Guild reports endpoint (pre-computed) ───
  if (parsed.pathname === '/api/guild/reports' && req.method === 'GET') {
    const guildName = cache.getSetting('guildName');
    const serverName = cache.getSetting('serverName');
    const region = cache.getSetting('region') || cache.getSetting('serverRegion');
    if (!guildName || !serverName || !region) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Guild not configured' }));
      return;
    }
    const guildKey = `${guildName}/${serverName}/${region}`;

    // Force refresh from WCL if ?refresh=1
    if (parsed.query && parsed.query.includes('refresh=1')) {
      try {
        const preanalyze = require('./preanalyze');
        const encodedGuild = encodeURIComponent(guildName);
        const encodedServer = encodeURIComponent(serverName);
        const reportsRaw = await preanalyze.wclApi(`/reports/guild/${encodedGuild}/${encodedServer}/${region}`, {}, { nocache: true });
        if (Array.isArray(reportsRaw)) {
          cache.putGuildReportsCache(guildKey, JSON.stringify(reportsRaw));
        }
      } catch (e) {
        console.error('[REFRESH] Guild reports:', e.message);
      }
    }

    const cached = cache.getGuildReportsCache(guildKey);
    if (!cached) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'No guild data yet. Pre-analyzer has not run.' }));
      return;
    }
    const reports = JSON.parse(cached.reports_json);
    const excluded = new Set(cache.getExcludedReports());
    const startDate = cache.getSetting('reportStartDate');
    const startTs = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
    const filtered = reports.filter(r => !excluded.has(r.id) && (!startTs || r.start >= startTs));

    // Enrich each report with pre-computed fight data (if available)
    const d = cache.getDb();
    for (const r of filtered) {
      const rd = cache.getReportData(r.id);
      if (rd) {
        r.fights = JSON.parse(rd.fights_json);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ reports: filtered, guildName, serverName, region, fetchedAt: cached.fetched_at }));
    return;
  }

  // ─── Progression endpoint (pre-aggregated, cached) ───
  if (parsed.pathname === '/api/progression' && req.method === 'GET') {
    try {
      const track = parsed.searchParams.get('track') === 'legacy' ? 'legacy' : 'current';
      const progression = require('./progression');
      const { data, computed_at, fresh } = progression.getOrBuild(track);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ...data, track, cached_at: computed_at, fresh }));
    } catch (e) {
      console.error('[PROGRESSION]', e.message, e.stack);
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Public: Elixier-Policy lesen (für Buff-Filter im Frontend) ───
  // ─── Scroll-Anforderungen pro Class:Spec ───
  if (parsed.pathname === '/api/scroll-requirements' && req.method === 'GET') {
    let overrides = null;
    const raw = cache.getSetting('scrollRequirements');
    if (raw) { try { overrides = JSON.parse(raw); } catch (_) {} }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ overrides: overrides && typeof overrides === 'object' ? overrides : null }));
    return;
  }
  if (parsed.pathname === '/api/admin/scroll-requirements' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'overrides muss ein Objekt sein' }));
        return;
      }
      const ALLOWED_STATS = ['Agility','Strength','Intellect','Protection','Spirit','Stamina'];
      const sanitized = {};
      for (const [role, list] of Object.entries(body.overrides)) {
        if (typeof role !== 'string' || !role.includes(':')) continue;
        if (!Array.isArray(list)) continue;
        sanitized[role] = list.filter(s => ALLOWED_STATS.includes(s));
      }
      cache.putSetting('scrollRequirements', JSON.stringify(sanitized));
      logAction(req, 'scroll_requirements_save', Object.keys(sanitized).length + ' roles');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, roleCount: Object.keys(sanitized).length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── CD-Role-Erwartungen ───
  if (parsed.pathname === '/api/cd-expectations' && req.method === 'GET') {
    let overrides = null;
    const raw = cache.getSetting('cdRoleExpectations');
    if (raw) { try { overrides = JSON.parse(raw); } catch (_) {} }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ overrides: overrides && typeof overrides === 'object' ? overrides : null }));
    return;
  }
  if (parsed.pathname === '/api/admin/cd-expectations' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'overrides muss ein Objekt sein' }));
        return;
      }
      // Schema-Validation: jede Rolle muss ein string[] sein
      const sanitized = {};
      for (const [role, list] of Object.entries(body.overrides)) {
        if (typeof role !== 'string' || !role.includes(':')) continue;
        if (!Array.isArray(list)) continue;
        sanitized[role] = list.filter(x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(x));
      }
      cache.putSetting('cdRoleExpectations', JSON.stringify(sanitized));
      logAction(req, 'cd_expectations_save', Object.keys(sanitized).length + ' roles');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, roleCount: Object.keys(sanitized).length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Public: consumes scoring (welche Consumes zählen in die Slacker-Bezahlt-Summe) ───
  if (parsed.pathname === '/api/consumes-scoring' && req.method === 'GET') {
    let excluded = null;
    const raw = cache.getSetting('consumesExcludedIds');
    if (raw) { try { excluded = JSON.parse(raw); } catch (_) {} }
    const tRaw = cache.getSetting('consumesSlackerThresholdPct');
    const thresholdPct = tRaw != null ? parseInt(tRaw, 10) : null;
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({
      excludedIds: Array.isArray(excluded) ? excluded : null,
      thresholdPct: Number.isFinite(thresholdPct) ? thresholdPct : null,
    }));
    return;
  }
  if (parsed.pathname === '/api/admin/consumes-scoring' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!Array.isArray(body.excludedIds)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'excludedIds muss ein Array sein' }));
        return;
      }
      const excluded = body.excludedIds.filter(n => Number.isFinite(n) && n > 0 && n < 1e9);
      cache.putSetting('consumesExcludedIds', JSON.stringify(excluded));
      let savedThreshold = null;
      if (body.thresholdPct != null) {
        const t = parseInt(body.thresholdPct, 10);
        if (!Number.isFinite(t) || t < 0 || t > 100) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'thresholdPct muss zwischen 0 und 100 liegen' }));
          return;
        }
        cache.putSetting('consumesSlackerThresholdPct', String(t));
        savedThreshold = t;
      }
      logAction(req, 'consumes_scoring_save', `${excluded.length} excluded, threshold=${savedThreshold ?? 'unchanged'}`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, excludedCount: excluded.length, thresholdPct: savedThreshold }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/release-notes' && req.method === 'GET') {
    try {
      const md = fs.readFileSync(path.join(__dirname, 'RELEASE_NOTES.md'), 'utf8');
      let priv = '';
      try { priv = fs.readFileSync(path.join(__dirname, 'RELEASE_NOTES-private.md'), 'utf8') + '\n\n---\n\n'; } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', ...SECURITY_HEADERS });
      res.end(priv + md);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Release notes not found' }));
    }
    return;
  }
  if (parsed.pathname === '/api/elixir-policy' && req.method === 'GET') {
    const raw = cache.getSetting('elixirPolicy');
    let policy = {};
    if (raw) { try { policy = JSON.parse(raw); } catch (_) {} }
    const bossRaw = cache.getSetting('bossPolicy');
    let bossPolicy = {};
    if (bossRaw) { try { bossPolicy = JSON.parse(bossRaw); } catch (_) {} }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ policy, bossPolicy }));
    return;
  }
  if (parsed.pathname === '/api/admin/boss-policy' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const bp = body.bossPolicy || {};
      cache.putSetting('bossPolicy', JSON.stringify(bp));
      logAction(req, 'boss_policy_save', Object.keys(bp).join(','));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  // ─── Public: Elixier-Namen aus gecachten Buff-Analysen (ohne Admin-Auth) ───
  if (parsed.pathname === '/api/elixir-names' && req.method === 'GET') {
    try {
      const d = cache.getDb();
      const rows = d.prepare("SELECT result_json FROM report_analysis WHERE analysis_type = 'buffs'").all();
      const flaskById = new Map(), battleById = new Map(), guardianById = new Map();
      function track(entry, byId) {
        if (!entry || typeof entry !== 'object' || entry.id == null) return;
        if (!byId.has(entry.id)) byId.set(entry.id, { id: entry.id, name: entry.name, count: 0 });
        byId.get(entry.id).count++;
      }
      for (const row of rows) {
        try {
          const result = JSON.parse(row.result_json);
          for (const p of (result || [])) for (const fd of (p.fightDetails || [])) {
            if (!fd) continue;
            track(fd.flask, flaskById);
            track(fd.battleElixir, battleById);
            track(fd.guardianElixir, guardianById);
          }
        } catch (_) {}
      }
      const toArr = m => [...m.values()].sort((a,b) => b.count - a.count);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({
        flasks: toArr(flaskById),
        battleElixirs: toArr(battleById),
        guardianElixirs: toArr(guardianById),
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: Elixier-Policy (welche Class:Spec dürfen welche Combos) ───
  if (parsed.pathname === '/api/admin/elixir-policy' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const raw = cache.getSetting('elixirPolicy');
    let policy = {};
    if (raw) { try { policy = JSON.parse(raw); } catch (_) {} }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ policy }));
    return;
  }
  if (parsed.pathname === '/api/admin/elixir-policy' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const policy = body.policy && typeof body.policy === 'object' ? body.policy : {};
      cache.putSetting('elixirPolicy', JSON.stringify(policy));
      logAction(req, 'elixir_policy_set', Object.keys(policy).length + ' Einträge');
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Admin: bisher beobachtete Elixier (aus gecachten Buff-Analysen) ───
  if (parsed.pathname === '/api/admin/observed-elixirs' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const d = cache.getDb();
      const rows = d.prepare("SELECT result_json FROM report_analysis WHERE analysis_type = 'buffs'").all();
      // Aggregate per ID (preferred). For old string-only data, key by name with id=null.
      const flaskById = new Map(), battleById = new Map(), guardianById = new Map();
      const flaskByName = new Map(), battleByName = new Map(), guardianByName = new Map();
      const rolesSet = new Set();
      function track(entry, byId, byName) {
        if (!entry) return;
        if (typeof entry === 'string') {
          byName.set(entry, (byName.get(entry) || { id: null, name: entry, count: 0 }));
          byName.get(entry).count++;
        } else if (entry && typeof entry === 'object' && entry.id != null) {
          const key = entry.id;
          if (!byId.has(key)) byId.set(key, { id: entry.id, name: entry.name, count: 0 });
          byId.get(key).count++;
          // Also track by name as alias for backward compat
          byName.set(entry.name, byId.get(key));
        }
      }
      for (const row of rows) {
        try {
          const result = JSON.parse(row.result_json);
          for (const p of (result || [])) {
            for (const fd of (p.fightDetails || [])) {
              if (!fd) continue;
              track(fd.flask, flaskById, flaskByName);
              track(fd.battleElixir, battleById, battleByName);
              track(fd.guardianElixir, guardianById, guardianByName);
              if (fd.roleKey) rolesSet.add(fd.roleKey);
            }
          }
        } catch (_) {}
      }
      // Merge: prefer id-keyed entries; fold name-only entries that don't have an id-match
      function mergeAndSort(byId, byName) {
        const out = [...byId.values()];
        const knownNames = new Set(out.map(e => e.name));
        for (const [name, entry] of byName) {
          if (entry.id == null && !knownNames.has(name)) out.push({ id: null, name, count: entry.count });
        }
        return out.sort((a,b) => b.count - a.count);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({
        flasks: mergeAndSort(flaskById, flaskByName),
        battleElixirs: mergeAndSort(battleById, battleByName),
        guardianElixirs: mergeAndSort(guardianById, guardianByName),
        roles: [...rolesSet].sort(),
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Admin: report track (current vs legacy content) ───
  if (parsed.pathname === '/api/admin/report-track' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const code = body.reportCode;
      const track = body.track;
      if (!code || !/^[A-Za-z0-9]+$/.test(code)) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Invalid report code' })); return; }
      if (track === 'auto' || track === null || track === '') {
        cache.clearReportTrack(code);
      } else if (track === 'current' || track === 'legacy') {
        cache.setReportTrack(code, track, req._username);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Invalid track' })); return;
      }
      try { require('./progression').invalidate(); } catch (_) {}
      logAction(req, 'report_track_set', code + ' → ' + (track || 'auto'));
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // ─── Report bundle endpoint (pre-computed) ───
  if (parsed.pathname.match(/^\/api\/report\/[A-Za-z0-9]+$/) && req.method === 'GET') {
    const code = parsed.pathname.split('/')[3];
    const bundle = cache.getReportBundle(code);
    if (!bundle) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Report not yet analyzed' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify(bundle));
    return;
  }

  // ─── Bug Tracker API (admin-only) ───
  if (parsed.pathname === '/api/bugs' && req.method === 'GET') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    const showClosed = parsed.query && parsed.query.includes('all=1');
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ tickets: cache.getBugTickets(showClosed) }));
    return;
  }

  if (parsed.pathname === '/api/bugs' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const title = (body.title || '').trim();
      if (!title) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Titel fehlt' })); return; }
      const s = getSession(req);
      const id = cache.createBugTicket(title, (body.description || '').trim(), s ? s.username : null);
      logAction(req, 'bug_create', `#${id}: ${title}`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, id, tickets: cache.getBugTickets(false) }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  if (parsed.pathname === '/api/bugs/status' && req.method === 'POST') {
    if (!validateSession(req)) { res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nicht autorisiert' })); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const id = parseInt(body.id, 10);
      const status = ['open', 'closed', 'wontfix'].includes(body.status) ? body.status : 'open';
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Ticket-ID fehlt' })); return; }
      cache.updateBugTicketStatus(id, status);
      logAction(req, 'bug_status', `#${id} → ${status}`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: true, tickets: cache.getBugTickets(false) }));
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Bad request' })); }
    return;
  }

  if (parsed.pathname.match(/^\/api\/bugs\/\d+$/) && req.method === 'DELETE') {
    if (!isSuperAdmin(req)) { res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: 'Nur Superadmin' })); return; }
    const id = parseInt(parsed.pathname.split('/')[3], 10);
    cache.deleteBugTicket(id);
    logAction(req, 'bug_delete', `#${id}`);
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, tickets: cache.getBugTickets(false) }));
    return;
  }

  // ─── WCL API proxy with caching (legacy, used by pre-analyzer internally) ───
  if (parsed.pathname.startsWith('/api/')) {
    const apiPath = parsed.pathname.replace('/api', '');

    // FIX #12: Validate API path against allowlist
    if (!WCL_ALLOWED_PATHS.some(p => apiPath.startsWith(p))) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Invalid API path' }));
      return;
    }

    // Allow frontend to specify base via ?wclbase= param
    const baseParam = parsed.searchParams.get('wclbase');
    const apiBase = baseParam ? (WCL_API_BASES[baseParam] || DEFAULT_API_BASE) : DEFAULT_API_BASE;
    parsed.searchParams.delete('wclbase');
    const nocache = parsed.searchParams.get('nocache') === '1';
    parsed.searchParams.delete('nocache');

    // Inject stored API key server-side if not provided by frontend
    if (!parsed.searchParams.get('api_key')) {
      const storedKey = cache.getSetting('apiKey');
      if (storedKey) parsed.searchParams.set('api_key', storedKey);
    }

    const cleanQs = parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '';
    const wclUrl = `${apiBase}${apiPath}${cleanQs}`;
    const key = cache.cacheKey(apiPath, cleanQs.replace('?', ''));

    // Check cache
    if (!nocache) {
      const cached = cache.getCached(key);
      if (cached) {
        const ttl = cache.getTTL(apiPath);
        const age = Date.now() - cached.fetched_at;
        if (age < ttl) {
          console.log(`[CACHE HIT] ${apiPath} (age: ${Math.round(age / 1000)}s)`);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'X-Cache-Age': String(Math.round(age / 1000)),
            ...SECURITY_HEADERS,
          });
          res.end(cached.response_json);
          return;
        }
      }
    }

    console.log(`[API] ${apiPath}`);

    try {
      const body = await wclFetch(wclUrl);
      // Store in cache
      cache.putCache(key, body);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        ...SECURITY_HEADERS,
      });
      res.end(body);
    } catch (err) {
      const status = err.message.includes('401') ? 401 : err.message.includes('429') ? 429 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'API request failed' }));
    }
    return;
  }

  // ─── Static file serving (FIX #2/#8/#9: restrict to safe files only) ───
  let filePath = parsed.pathname;
  if (filePath === '/') filePath = '/index.html';

  // Only serve files from allowed directories or explicitly allowed paths
  const topDir = filePath.split('/')[1];
  if (!ALLOWED_STATIC.has(filePath) && !STATIC_DIRS.has(topDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not Found');
    return;
  }

  const fullPath = path.resolve(path.join(__dirname, filePath));
  // Prevent path traversal — resolved path must stay within __dirname
  if (!fullPath.startsWith(__dirname + path.sep) && fullPath !== __dirname) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(fullPath);

  // Block serving database files, dotfiles, backups
  if (ext === '.db' || ext === '.db-wal' || ext === '.db-shm' || ext === '.bak' ||
      path.basename(fullPath).startsWith('.')) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not Found');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Not Found');
      return;
    }
    let content = data;
    // Inject CSRF token into HTML pages
    if (ext === '.html') {
      content = data.toString().replace('</head>', `<script>window.__csrfToken="${CSRF_TOKEN}";</script>\n</head>`);
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'text/plain',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(content);
  });
}

// FIX #10: Crash handlers
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

server.listen(PORT, () => {
  console.log(`CLA Web App running at http://localhost:${PORT}`);
  console.log('API proxy with SQLite cache active');

  // Pre-analyze new reports every 30 minutes
  const preanalyze = require('./preanalyze');
  if (preanalyze.setProgressReporter) preanalyze.setProgressReporter(pipelineUpdate);
  const PRE_INTERVAL = 30 * 60 * 1000;
  setTimeout(() => {
    preanalyze.checkAndAnalyzeNewReports().catch(e => console.error('[PRE] Error:', e.message));
    setInterval(() => {
      preanalyze.checkAndAnalyzeNewReports().catch(e => console.error('[PRE] Error:', e.message));
    }, PRE_INTERVAL);
  }, 60 * 1000);
  console.log('Pre-analyzer scheduled (every 30 min)');

  // ─── TMB Background Fetch (every 30 min) ───
  async function tmbBackgroundRefresh() {
    const tmbCookie = cache.getSetting('tmbCookie');
    if (!tmbCookie) return;
    const tmbUrls = getTmbUrls();
    if (!tmbUrls.configured) return;
    const jobs = [
      { url: tmbUrls.attendance, key: 'tmb_attendance', parse: parseTmbCsv, label: 'attendance' },
      { url: tmbUrls.loot, key: 'tmb_loot', parse: parseTmbLootCsv, label: 'loot' },
      { url: tmbUrls.raidgroups, key: 'tmb_raidgroups', parse: parseTmbRaidGroupsCsv, label: 'raidgroups' },
    ];
    for (const job of jobs) {
      try {
        const csv = await tmbFetch(job.url, tmbCookie);
        const data = job.parse(csv);
        cache.putCache(job.key, JSON.stringify(data));
        console.log(`[TMB BG] ${job.label} refreshed`);
      } catch (err) {
        console.error(`[TMB BG] ${job.label} failed:`, err.message);
      }
    }
    tmbLastBgRunAt = Date.now();
  }
  setTimeout(() => {
    tmbBackgroundRefresh();
    setInterval(tmbBackgroundRefresh, TMB_CACHE_TTL);
  }, 10 * 1000);
  console.log('TMB background refresh scheduled (every 30 min)');

  // ─── Live Ticker Polling ───
  const LIVE_POLL_MS = 60 * 1000;
  const LIVE_RAID_TIMEOUT = 30 * 60 * 1000;

  function isLiveWindow() {
    // Manueller Trigger aus dem Admin-Bereich
    if (manualLiveUntil > Date.now()) return true;

    // Schedule aus den Settings lesen
    let schedule = [];
    try { schedule = JSON.parse(cache.getSetting('raidSchedule') || '[]'); } catch (_) {}
    if (!Array.isArray(schedule) || !schedule.length) return false;

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const day = now.getDay() === 0 ? 7 : now.getDay(); // ISO 1=Mo..7=So
    const h = now.getHours(), m = now.getMinutes();
    const minutesNow = h * 60 + m;

    // Match: heute oder gestern (Overflow) — wenn aktuelle Uhrzeit innerhalb
    // [startTime, startTime + 5.5h] des Eintrags liegt.
    const WINDOW_MIN = 5 * 60 + 30; // 5h 30min (19:30 → 01:00)
    for (const s of schedule) {
      const [sh, sm] = (s.startTime || '19:30').split(':').map(Number);
      const startMin = sh * 60 + (sm || 0);
      // Heute, vor Mitternacht
      if (s.dayOfWeek === day && minutesNow >= startMin && minutesNow < startMin + WINDOW_MIN) return true;
      // Gestern, nach Mitternacht (Overflow) — heute ist day, also gestern war (day-1) bzw. 7 wenn day=1
      const prevDay = day === 1 ? 7 : day - 1;
      if (s.dayOfWeek === prevDay && (minutesNow + 24 * 60) >= startMin && (minutesNow + 24 * 60) < startMin + WINDOW_MIN) return true;
    }
    return false;
  }

  async function pollLiveRaid() {
    if (!isLiveWindow()) {
      if (liveState.active) console.log('[LIVE] Leaving live window');
      liveState.active = false;
      liveState.raidActive = false;
      return;
    }
    liveState.active = true;
    liveState.lastPollAt = Date.now();

    try {
      const guildName = cache.getSetting('guildName');
      const serverName = cache.getSetting('serverName');
      const region = cache.getSetting('region') || cache.getSetting('serverRegion');
      if (!guildName || !serverName || !region) return;

      // Fetch guild reports (bypass cache for freshness)
      const reportsRaw = await preanalyze.wclApi(`/reports/guild/${encodeURIComponent(guildName)}/${encodeURIComponent(serverName)}/${region}`, {}, { nocache: true });
      const reports = Array.isArray(reportsRaw) ? reportsRaw.slice() : [];

      // Manuelle Reports als Kandidaten mit aufnehmen — frischen Stand von WCL holen
      try {
        const manuals = cache.getManualReports();
        const known = new Set(reports.map(r => r.id));
        for (const m of manuals) {
          if (known.has(m.report_code)) continue;
          try {
            const fd = await preanalyze.wclApi(`/report/fights/${m.report_code}`, {}, { nocache: true });
            const fights = fd.fights || [];
            const last = fights.length ? fights[fights.length - 1] : null;
            const startTs = fd.start || (fights.length ? fights[0].start_time : m.start_ts);
            const endTs = fd.end || (last ? (startTs + (last.end_time || 0)) : m.end_ts);
            reports.push({ id: m.report_code, title: fd.title || m.title, zone: fd.zone || m.zone_id, start: startTs, end: endTs, manual: true });
          } catch (_) {
            // Fallback: gespeicherte Metadaten
            reports.push({ id: m.report_code, title: m.title, zone: m.zone_id, start: m.start_ts, end: m.end_ts, manual: true });
          }
        }
      } catch (_) {}

      const now = Date.now();
      const sixHoursAgo = now - 6 * 60 * 60 * 1000;

      // Aus raidSchedule die erwarteten Raid-Größen ableiten (Default: 25)
      let expectedSizes = new Set();
      try {
        const sched = JSON.parse(cache.getSetting('raidSchedule') || '[]');
        for (const s of (sched || [])) if (s.raidSize) expectedSizes.add(Number(s.raidSize));
      } catch (_) {}
      if (!expectedSizes.size) expectedSizes.add(25);

      const live25 = reports.filter(r => {
        if (r.start < sixHoursAgo) return false;
        const zone = preanalyze.CLA_DATA?.zones?.[r.zone];
        return zone && expectedSizes.has(zone.size);
      });

      if (!live25.length) {
        liveState.raidActive = false;
        liveState.reportCode = null;
        liveState.fights = [];
        liveState.gearIssues = [];
        return;
      }

      // Sort by start time, newest first
      live25.sort((a, b) => (b.start || 0) - (a.start || 0));
      const report = live25[0];

      // Fetch fights (bypass cache for live ticker)
      const fightData = await preanalyze.wclApi(`/report/fights/${report.id}`, {}, { nocache: true });
      const allFights = fightData.fights || [];
      const bossFights = allFights.filter(f => f.boss && f.boss > 0 && (f.size || 0) >= 25);

      // Check if raid is still active
      const lastEvent = allFights.length ? allFights[allFights.length - 1] : null;
      const lastEventEnd = lastEvent ? (report.start + (lastEvent.end_time || lastEvent.start_time)) : report.start;
      const raidEnded = (now - lastEventEnd) > LIVE_RAID_TIMEOUT;

      liveState.raidActive = !raidEnded;
      liveState.reportCode = report.id;
      liveState.zone = report.zone;
      liveState.raidStart = report.start;
      liveState.lastActivity = lastEventEnd;

      // Manuelles Live-Window verlängern: 30 min nach letzter Log-Aktivität
      if (manualLiveUntil > 0 && lastEventEnd) {
        const newUntil = lastEventEnd + 30 * 60 * 1000;
        if (newUntil > manualLiveUntil) manualLiveUntil = newUntil;
      }

      // Detect new fights
      const existingFightIds = new Set(liveState.fights.map(f => f.id));
      const newFights = bossFights.filter(f => !existingFightIds.has(f.id));

      if (newFights.length) {
        console.log(`[LIVE] ${newFights.length} new fight(s) detected: ${newFights.map(f => f.name).join(', ')}`);
        liveState.analyzing = true;

        for (const fight of newFights) {
          try {
            const result = await preanalyze.analyzeLiveFight(report.id, fight, report.start);
            const fightTime = new Date(report.start + fight.start_time);
            const timeStr = `${String(fightTime.getHours()).padStart(2, '0')}:${String(fightTime.getMinutes()).padStart(2, '0')}`;

            liveState.fights.unshift({
              id: fight.id,
              name: fight.name,
              kill: fight.kill,
              duration: fight.end_time - fight.start_time,
              fightTime: timeStr,
              startTime: fight.start_time,
              endTime: fight.end_time,
              slackers: result.slackers,
              consumables: result.consumables,
              trinketUsage: result.trinketUsage || [],
              trinketSlackers: result.trinketSlackers || [],
              cdUsage: result.cdUsage || [],
              cdSlackers: result.cdSlackers || [],
              totalPlayers: result.totalPlayers,
              analyzedAt: Date.now(),
            });

            // Update gear issues from latest fight (most recent gear state)
            liveState.gearIssues = result.gearIssues;
            liveState.totalPlayers = result.totalPlayers;

            console.log(`[LIVE] Analyzed ${fight.name}: ${result.slackers.buffs.length} buff slackers, ${result.slackers.spellranks.length} spellrank issues, ${result.gearIssues.length} gear issues`);
          } catch (e) {
            console.error(`[LIVE] Analysis failed for ${fight.name}:`, e.message);
          }
        }

        liveState.analyzing = false;

        // Also trigger preanalyzer for persistent storage
        preanalyze.processReport(report.id).catch(e => console.error('[LIVE] Background preanalyze error:', e.message));
      }

    } catch (e) {
      liveState.error = e.message;
      console.error('[LIVE] Poll error:', e.message);
    }
  }

  // Poll every 60s
  setInterval(pollLiveRaid, LIVE_POLL_MS);
  // Initial poll after 5s
  setTimeout(pollLiveRaid, 5000);
  console.log('Live ticker polling active (every 60s, schedule from raidSchedule setting)');
});
