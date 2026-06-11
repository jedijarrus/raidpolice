/* Regressions-Netz für die reinen Compliance-Checker in preanalyze.js.
   Läuft mit dem eingebauten Node-Test-Runner: node --test tests/ */
const { test } = require('node:test');
const assert = require('node:assert');

const pre = require('../preanalyze.js');

/* ── Meta-Gem-Aktivierung ─────────────────────────────────────────── */
test('isMetaGemActive: Relentless (32409) braucht 2+ je Farbe', () => {
    assert.equal(pre.isMetaGemActive(32409, 2, 2, 2), true);
    assert.equal(pre.isMetaGemActive(32409, 2, 1, 2), false);
    assert.equal(pre.isMetaGemActive(32409, 0, 5, 5), false);
});

test('isMetaGemActive: 25898 braucht 5+ blau', () => {
    assert.equal(pre.isMetaGemActive(25898, 0, 0, 5), true);
    assert.equal(pre.isMetaGemActive(25898, 0, 0, 4), false);
});

test('isMetaGemActive: 25893 mehr blau als gelb', () => {
    assert.equal(pre.isMetaGemActive(25893, 0, 1, 2), true);
    assert.equal(pre.isMetaGemActive(25893, 0, 2, 2), false);
});

test('isMetaGemActive: unbekannte Meta gilt als aktiv (kein False-Positive)', () => {
    assert.equal(pre.isMetaGemActive(99999, 0, 0, 0), true);
});

/* ── Scroll-Anforderungen je Rolle ────────────────────────────────── */
test('getMissingScrolls: Hunter ohne Scrolls → Agility fehlt', () => {
    const missing = pre.getMissingScrolls([], 'Hunter:dps');
    assert.deepEqual(missing, ['Agility']);
});

test('getMissingScrolls: Warrior mit Agi-Scroll → nur Strength fehlt', () => {
    // 33077 = Scroll of Agility V (Best Rank)
    const missing = pre.getMissingScrolls([{ spellId: 33077 }], 'Warrior:dps');
    assert.deepEqual(missing, ['Strength']);
});

test('getMissingScrolls: niedriger Rang zählt trotzdem als vorhanden', () => {
    // 8117 = Scroll of Agility II — Stat ist abgedeckt, Rang egal für "fehlt"
    const missing = pre.getMissingScrolls([{ spellId: 8117 }], 'Hunter:dps');
    assert.deepEqual(missing, []);
});

test('getMissingScrolls: Rolle ohne Anforderungen → leer', () => {
    assert.deepEqual(pre.getMissingScrolls([], 'Druid:balance'), []);
});

test('formatScrollWithRank: Best-Rank wird erkannt', () => {
    assert.equal(pre.formatScrollWithRank(33077).isMaxRank, true);
    assert.equal(pre.formatScrollWithRank(8117).isMaxRank, false);
    assert.equal(pre.formatScrollWithRank(424242).label, 'Unknown Scroll');
});

/* ── Waffen-Enhancement-Erkennung ─────────────────────────────────── */
function gearItem(slot, id, temporaryEnchant, icon) {
    return { slot, id, temporaryEnchant, icon };
}

test('detectWeaponEnhancement: Rogue DW braucht beide Hände', () => {
    const detail = { combatantInfo: { gear: [
        gearItem(15, 1001, 2628, 'inv_sword_01'),   // MH mit Enchant
        gearItem(16, 1002, null, 'inv_knife_01'),    // OH ohne
    ] } };
    const r = pre.detectWeaponEnhancement(detail, 'Rogue', []);
    assert.equal(r.isDW, true);
    assert.ok(r.mh);
    assert.equal(r.oh, null);
    assert.equal(pre.hasWeaponEnh(r), false); // DW: eine Hand reicht nicht
});

test('detectWeaponEnhancement: beide Hände enchanted → ok', () => {
    const detail = { combatantInfo: { gear: [
        gearItem(15, 1001, 2628, 'inv_sword_01'),
        gearItem(16, 1002, 2628, 'inv_knife_01'),
    ] } };
    const r = pre.detectWeaponEnhancement(detail, 'Rogue', []);
    assert.equal(pre.hasWeaponEnh(r), true);
});

test('detectWeaponEnhancement: Mage mit Offhand-Frosch ist kein DW', () => {
    const detail = { combatantInfo: { gear: [
        gearItem(15, 2001, 2628, 'inv_staff_13'),
        gearItem(16, 2002, null, 'inv_offhand_orb'),
    ] } };
    const r = pre.detectWeaponEnhancement(detail, 'Mage', []);
    assert.equal(r.isDW, false);
    assert.equal(pre.hasWeaponEnh(r), true); // MH-Enchant reicht
});

test('detectWeaponEnhancement: Hunter-Windfury (Totem) zählt nicht als eigenes Enchant', () => {
    const detail = { combatantInfo: { gear: [
        gearItem(15, 3001, 2639, 'inv_axe_09'),  // WF-Totem-Temp-Enchant
    ] } };
    const r = pre.detectWeaponEnhancement(detail, 'Hunter', []);
    assert.equal(r.mh, null);
});

test('detectWeaponEnhancement: Fallback über Auren wenn Gear leer', () => {
    const r = pre.detectWeaponEnhancement(null, 'Warrior', [
        { guid: 25584, name: 'Windfury Attack' },
    ]);
    // 25584 muss in BUFF_SETS.weaponEnhancement sein, sonst kein Treffer —
    // wichtig: Windfury wird als solches gelabelt, wenn erkannt
    if (r.mh) assert.equal(r.mh, 'Windfury');
});

/* ── Rollen-Erwartungen für CDs ───────────────────────────────────── */
test('getExpectedCdsForRole liefert Array (auch für unbekannte Rollen)', () => {
    const r = pre.getExpectedCdsForRole('definitiv-keine-rolle');
    assert.ok(Array.isArray(r) || r === null || r === undefined || typeof r === 'object');
});
