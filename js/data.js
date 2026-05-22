/**
 * Reference data for CLA analysis
 */

const CLA_DATA = {
  // WoW class IDs to names
  classNames: {
    1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue',
    5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 8: 'Mage',
    9: 'Warlock', 11: 'Druid'
  },

  classCssClass: {
    1: 'class-warrior', 2: 'class-paladin', 3: 'class-hunter', 4: 'class-rogue',
    5: 'class-priest', 6: 'class-death-knight', 7: 'class-shaman', 8: 'class-mage',
    9: 'class-warlock', 11: 'class-druid'
  },

  // Gear slot IDs mapping
  gearSlots: {
    0: 'Head', 1: 'Neck', 2: 'Shoulders', 3: 'Shirt', 4: 'Chest',
    5: 'Waist', 6: 'Legs', 7: 'Feet', 8: 'Wrists', 9: 'Hands',
    10: 'Ring 1', 11: 'Ring 2', 12: 'Trinket 1', 13: 'Trinket 2',
    14: 'Back', 15: 'Main Hand', 16: 'Off Hand', 17: 'Ranged/Relic'
  },

  // Zone IDs — covers both TBC Classic and Fresh/Anniversary
  zones: {
    // TBC Classic
    1007: { name: 'Serpentshrine Cavern', short: 'SSC', size: 25, tier: 5, color: '#2196F3', tbc: true },
    1008: { name: "Tempest Keep: The Eye", short: 'TK', size: 25, tier: 5, color: '#9C27B0', tbc: true },
    1009: { name: 'Hyjal Summit', short: 'MH', size: 25, tier: 6, color: '#4CAF50', tbc: true },
    1010: { name: 'Black Temple', short: 'BT', size: 25, tier: 6, color: '#607D8B', tbc: true },
    1011: { name: 'Sunwell Plateau', short: 'SW', size: 25, tier: 6.5, color: '#FF9800', tbc: true },
    1002: { name: "Gruul's Lair", short: 'Gruul', size: 25, tier: 4, color: '#795548', tbc: true },
    1003: { name: "Magtheridon's Lair", short: 'Mag', size: 25, tier: 4, color: '#F44336', tbc: true },
    1001: { name: 'Karazhan', short: 'Kara', size: 10, tier: 4, color: '#3F51B5', tbc: true },
    1004: { name: "Zul'Aman", short: 'ZA', size: 10, tier: 5.5, color: '#FF5722', tbc: true },
    // Fresh / Anniversary — TBC content
    1047: { name: 'Karazhan', short: 'Kara', size: 10, tier: 4, color: '#3F51B5', tbc: true },
    1048: { name: "Gruul's Lair / Magtheridon's Lair", short: 'Gruul/Mag', size: 25, tier: 4, color: '#795548', tbc: true },
    1056: { name: 'Serpentshrine Cavern / Tempest Keep', short: 'SSC/TK', size: 25, tier: 5, color: '#2196F3', tbc: true },
    // Classic content (not shown in TBC dashboard)
    1028: { name: 'Molten Core', short: 'MC', size: 40, tier: 1, color: '#FF5722' },
    1029: { name: 'Onyxia\'s Lair', short: 'Ony', size: 40, tier: 1, color: '#9E9E9E' },
    1030: { name: "Zul'Gurub", short: 'ZG', size: 20, tier: 1.5, color: '#4CAF50' },
    1031: { name: 'Ruins of Ahn\'Qiraj', short: 'AQ20', size: 20, tier: 2, color: '#FF9800' },
    1034: { name: 'Blackwing Lair', short: 'BWL', size: 40, tier: 2, color: '#673AB7' },
    1035: { name: "Temple of Ahn'Qiraj", short: 'AQ40', size: 40, tier: 2.5, color: '#FF9800' },
    1036: { name: 'Naxxramas', short: 'Naxx', size: 40, tier: 3, color: '#607D8B' },
  },

  // Raid size classification helpers
  is25Man(zoneId) {
    const z = this.zones[zoneId];
    return z ? z.size === 25 : false;
  },
  is10Man(zoneId) {
    const z = this.zones[zoneId];
    return z ? z.size === 10 : false;
  },

  // Format time duration
  formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    return `${minutes}:${String(seconds).padStart(2,'0')}`;
  },

  // Format date
  formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  },

  // Format date short
  formatDateShort(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  // Get percentage CSS class
  pctClass(pct) {
    if (pct >= 100) return 'pct-100';
    if (pct >= 75) return 'pct-high';
    if (pct >= 40) return 'pct-mid';
    return 'pct-low';
  },

  // Avoidable damage spell IDs (from CLA/RPB config)
  // Maps spell ID → ability name for display
  avoidableDamage: {
    // General / Multi-Raid
    3: 'Falling',
    // Karazhan
    30004: 'Flame Wreath', 30859: 'Hellfire', 30852: 'Shadow Nova',
    33061: 'Blast Wave',
    // Gruul's Lair
    33671: 'Shatter', 36240: 'Cave In',
    // Magtheridon's Lair
    30631: 'Debris', 36449: 'Debris', 30129: 'Charred Earth',
    // SSC
    37433: 'Spout', 37284: 'Scalding Water', 360327: 'Toxic Spores',
    // TK
    34190: 'Arcane Orb', 36731: 'Flame Strike', 36721: 'Burn',
    36970: 'Arcane Burst', 38572: 'Mortal Cleave', 38653: 'Spore Cloud',
    // TK - Flame Quills (Al'ar — many sub-spell IDs)
    34229: 'Flame Quills', 34269: 'Flame Quills', 34270: 'Flame Quills',
    34271: 'Flame Quills', 34272: 'Flame Quills', 34273: 'Flame Quills',
    34274: 'Flame Quills', 34275: 'Flame Quills', 34276: 'Flame Quills',
    34277: 'Flame Quills', 34278: 'Flame Quills', 34279: 'Flame Quills',
    34280: 'Flame Quills', 34281: 'Flame Quills', 34282: 'Flame Quills',
    34283: 'Flame Quills', 34284: 'Flame Quills', 34285: 'Flame Quills',
    34286: 'Flame Quills', 34287: 'Flame Quills', 34288: 'Flame Quills',
    34289: 'Flame Quills', 34314: 'Flame Quills', 34315: 'Flame Quills',
    34316: 'Flame Quills',
    // TK - Rebirth (Kael'thas)
    34342: 'Rebirth', 35383: 'Flame Patch',
    // Mount Hyjal
    31258: 'Death & Decay', 31944: 'Doomfire', 31969: 'Doomfire',
    31436: 'Malevolent Cleave',
    // Black Temple
    40948: 'Rain of Chaos', 40018: 'Eye Blast', 40832: 'Flame Crash',
    41541: 'Consecration', 41481: 'Flamestrike', 40265: 'Molten Flame',
    40276: 'Volcanic Eruption',
    // Sunwell
    42052: 'Volcanic Eruption', 46931: 'Demonic Vapor',
    46264: 'Void Zone', 45915: 'Armageddon', 45996: 'Darkness',
    45885: 'Shadow Spike',
    // Generic trash abilities (common across raids)
    28863: 'Void Zone', 28865: 'Void Zone',
  },

  // Avoidable debuff spell IDs
  avoidableDebuffs: {
    35859: 'Nether Vapor', 37749: 'Consuming Madness',
    27243: 'Seed of Corruption', 31302: 'Inferno',
    31341: 'Unquenchable Flames', 41410: 'Deaden',
    41032: 'Shear', 45717: 'Fog of Corruption',
  },
};

window.CLA_DATA = CLA_DATA;
