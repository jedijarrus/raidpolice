/* Schutz-Tests für die Boss-Knowledge-Base: jede ID muss aus der
   verifizierten Menge stammen (Wowhead-Abgleich + eigene Logs). */
const { test } = require('node:test');
const assert = require('node:assert');

const { bossKB, BLAME } = require('../kb/bossKB.js');

// Verifizierte Menge vom Abnahme-Lauf 2026-06-11 (165 geprüft via Wowhead, 23 verworfen, + 18 Log-IDs)
const VERIFIED = new Set(require('./fixtures/verified-spell-ids.json'));

test('jede Spell-ID in der KB ist verifiziert', () => {
    const unverified = [];
    for (const [boss, data] of Object.entries(bossKB)) {
        for (const mech of (data.mechanics || [])) {
            for (const id of [...(mech.spellIds || []), ...(mech.altIds || [])]) {
                // IDs <= 10 sind WCL-Environmental-Konstanten (1=Melee, 3=Falling), keine Spells
                if (id > 10 && !VERIFIED.has(id)) unverified.push(`${boss} / ${mech.name}: ${id}`);
            }
        }
        for (const mi of (data.mustInterrupt || [])) {
            for (const id of (mi.spellIds || [])) {
                if (!VERIFIED.has(id)) unverified.push(`${boss} / interrupt ${mi.name}: ${id}`);
            }
        }
    }
    assert.deepEqual(unverified, [], 'unverifizierte IDs gefunden');
});

test('keine ID ist zwei verschiedenen Mechaniken zugeordnet', () => {
    const seen = new Map();
    const conflicts = [];
    for (const [boss, data] of Object.entries(bossKB)) {
        for (const mech of (data.mechanics || [])) {
            for (const id of (mech.spellIds || [])) {
                const key = `${boss}|${id}`;
                if (seen.has(key) && seen.get(key) !== mech.name) {
                    conflicts.push(`${boss}: ${id} → ${seen.get(key)} UND ${mech.name}`);
                }
                seen.set(key, mech.name);
            }
        }
    }
    assert.deepEqual(conflicts, []);
});

test('jede Mechanik hat Diagnose und Blame-Kategorie', () => {
    const broken = [];
    const validBlame = new Set(Object.values(BLAME));
    for (const [boss, data] of Object.entries(bossKB)) {
        for (const mech of (data.mechanics || [])) {
            if (!mech.diagnosis || mech.diagnosis.length < 10) broken.push(`${boss}/${mech.name}: keine Diagnose`);
            if (!Array.isArray(mech.blame) || !mech.blame.length) broken.push(`${boss}/${mech.name}: kein blame`);
            else for (const b of mech.blame) if (!validBlame.has(b)) broken.push(`${boss}/${mech.name}: blame '${b}' unbekannt`);
        }
    }
    assert.deepEqual(broken, []);
});

test('alle SSC/TK-Bosse abgedeckt', () => {
    for (const b of ['Hydross the Unstable', 'The Lurker Below', 'Leotheras the Blind',
                     'Fathom-Lord Karathress', 'Morogrim Tidewalker', 'Lady Vashj',
                     "Al'ar", 'Void Reaver', 'High Astromancer Solarian', "Kael'thas Sunstrider"]) {
        assert.ok(bossKB[b], `${b} fehlt`);
        assert.ok(bossKB[b].mechanics.length >= 2, `${b}: zu wenige Mechaniken`);
    }
});
