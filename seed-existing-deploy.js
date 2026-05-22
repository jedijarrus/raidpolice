#!/usr/bin/env node
/**
 * One-time migration: seed new settings (appName, tmbGuildId, tmbGuildSlug,
 * easterEggs, raidSchedule, faction) for an existing deployment that pre-dates
 * the generalization refactor.
 *
 * Run inside the container:
 *   docker exec cla-webapp node seed-existing-deploy.js
 *
 * Idempotent — only writes settings that are currently unset (or empty).
 */
const cache = require('./db');

const SEEDS = {
  appName: process.env.SEED_APP_NAME || 'Raidpolice',
  guildName: process.env.SEED_GUILD_NAME || '',
  serverName: process.env.SEED_SERVER_NAME || '',
  region: process.env.SEED_REGION || '',
  faction: process.env.SEED_FACTION || '',
  tmbGuildId: process.env.SEED_TMB_GUILD_ID || '',
  tmbGuildSlug: process.env.SEED_TMB_GUILD_SLUG || '',
  // Default raidSchedule = empty; configure via Admin UI
  raidSchedule: process.env.SEED_RAID_SCHEDULE || '[]',
  // Default easterEggs = empty; configure via Admin UI
  easterEggs: process.env.SEED_EASTER_EGGS || '[]',
};

let written = 0, skipped = 0;
for (const [key, val] of Object.entries(SEEDS)) {
  const existing = cache.getSetting(key);
  if (existing != null && existing !== '') {
    console.log(`[SEED] ${key} already set — skipping`);
    skipped++;
    continue;
  }
  if (val === '' || val == null) {
    console.log(`[SEED] ${key} has no default value provided — skipping`);
    skipped++;
    continue;
  }
  cache.putSetting(key, val);
  console.log(`[SEED] ${key} = ${val.length > 60 ? val.slice(0, 60) + '...' : val}`);
  written++;
}

console.log(`\nDone. Wrote ${written} settings, skipped ${skipped}.`);
console.log('Restart container to pick up the new settings (or just refresh the browser).');
