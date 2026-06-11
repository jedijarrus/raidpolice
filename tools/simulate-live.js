/**
 * Simulate live ticker using yesterday's raid data.
 * Feeds fights into liveState one by one, every 60 seconds.
 *
 * Usage: Set SIMULATE_LIVE=WazNJPwkfyYgxdTF when starting server,
 * or run this as a standalone injector after server is up.
 *
 * This patches server.js live state via a temporary endpoint.
 */
const cache = require('./db');
const preanalyze = require('./preanalyze');

const REPORT_CODE = process.argv[2] || 'WazNJPwkfyYgxdTF';
const INTERVAL_MS = 15 * 1000; // 15 seconds between fights (for testing)

async function simulate() {
  const rd = cache.getReportData(REPORT_CODE);
  if (!rd) { console.error('No report data for', REPORT_CODE); process.exit(1); }

  const fights = JSON.parse(rd.fights_json);
  const meta = JSON.parse(rd.meta_json);
  const players = JSON.parse(rd.players_json);

  console.log(`[SIM] Simulating live ticker for ${REPORT_CODE}`);
  console.log(`[SIM] Zone: ${meta.zone}, ${fights.length} boss fights`);
  console.log(`[SIM] Fights will appear every ${INTERVAL_MS / 1000}s`);

  // We'll build the liveState object and write it to a temp file
  // that the server can read, OR we modify server.js to accept it.
  // Simplest: we just run the analysis and output the state as JSON.

  const liveState = {
    active: true,
    raidActive: true,
    reportCode: REPORT_CODE,
    zone: meta.zone,
    raidStart: meta.start,
    lastActivity: Date.now(),
    fights: [],
    gearIssues: [],
    totalPlayers: 0,
    lastPollAt: Date.now(),
    lastFightKey: null,
    analyzing: false,
    error: null,
  };

  for (let i = 0; i < fights.length; i++) {
    const fight = fights[i];
    console.log(`\n[SIM] ── Fight ${i + 1}/${fights.length}: ${fight.name} ──`);

    liveState.analyzing = true;
    writeState(liveState);

    try {
      const result = await preanalyze.analyzeLiveFight(REPORT_CODE, fight, meta.start);
      const fightTime = new Date(meta.start + fight.start_time);
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

      liveState.gearIssues = result.gearIssues;
      liveState.totalPlayers = result.totalPlayers;
      liveState.analyzing = false;
      liveState.lastActivity = Date.now();
      liveState.lastPollAt = Date.now();

      console.log(`[SIM] Buff slackers: ${result.slackers.buffs.length}`);
      console.log(`[SIM] Spell rank issues: ${result.slackers.spellranks.length}`);
      console.log(`[SIM] Gear issues: ${result.gearIssues.length} players`);

      writeState(liveState);

    } catch (e) {
      console.error(`[SIM] Analysis failed:`, e.message);
      liveState.analyzing = false;
      liveState.error = e.message;
      writeState(liveState);
    }

    // Wait before next fight (except after last)
    if (i < fights.length - 1) {
      console.log(`[SIM] Waiting ${INTERVAL_MS / 1000}s for next fight...`);
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
  }

  // Mark raid as ended after all fights
  console.log('\n[SIM] All fights done. Marking raid as ended.');
  liveState.raidActive = false;
  writeState(liveState);

  console.log('[SIM] Simulation complete. State file preserved.');
}

const STATE_FILE = require('path').join(__dirname, 'data', 'live-sim-state.json');

function writeState(state) {
  require('fs').writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function cleanup() {
  try { require('fs').unlinkSync(STATE_FILE); } catch(e) {}
}

process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });

simulate().catch(e => { console.error('[SIM] Fatal:', e); cleanup(); process.exit(1); });
