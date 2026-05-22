/**
 * Gear reference data for CLA gear issue checking
 * Extracted from CLA V1.6.0 spreadsheet
 */

const CLA_GEAR = {
  // Bad/suboptimal enchants: { enchantId: { slot (optional), name } }
  // Format from CLA: "enchantId [slot]" means only bad for that slot
  // No slot = bad for ALL slots
  badEnchants: [
    // Bracers (slot 8)
    {id:927,slot:8,name:'Bracers - 7 Str'},{id:856,slot:8,name:'Bracers - 5 Str'},
    {id:823,slot:8,name:'Bracers - 3 Str'},{id:248,slot:8,name:'Bracers - 1 Str'},
    {id:929,slot:8,name:'Bracers - 7 Sta'},{id:852,slot:8,name:'Bracers - 5 Sta'},
    {id:724,slot:8,name:'Bracers - 3 Sta'},{id:66,slot:8,name:'Bracers - 1 Sta'},
    {id:41,slot:8,name:'Bracers - 5 HP'},{id:907,slot:8,name:'Bracers - 7 Spi'},
    {id:851,slot:8,name:'Bracers - 5 Spi'},{id:255,slot:8,name:'Bracers - 3 Spi'},
    {id:905,slot:8,name:'Bracers - 5 Int'},{id:723,slot:8,name:'Bracers - 3 Int'},
    {id:923,slot:8,name:'Bracers - 3 Def'},{id:925,slot:8,name:'Bracers - 2 Def'},
    {id:924,slot:8,name:'Bracers - 1 Def'},{id:1886,slot:8,name:'Bracers - 9 Sta'},
    {id:1885,slot:8,name:'Bracers - 9 Str'},
    // Gloves (slot 9)
    {id:1887,slot:9,name:'Gloves - 7 Agi'},{id:904,slot:9,name:'Gloves - 5 Agi'},
    {id:856,slot:9,name:'Gloves - 5 Str'},{id:909,slot:9,name:'Gloves - 5 Herb'},
    {id:845,slot:9,name:'Gloves - 3 Herb'},{id:906,slot:9,name:'Gloves - 5 Mining'},
    {id:844,slot:9,name:'Gloves - 3 Mining'},{id:865,slot:9,name:'Gloves - 5 Skinn'},
    {id:846,slot:9,name:'Gloves - 2 Fishing'},{id:2934,slot:9,name:'Gloves - Blasting'},
    {id:927,slot:9,name:'Gloves - 7 Str'},{id:930,slot:9,name:'Gloves - Mount Speed'},
    // Boots (slot 7)
    {id:255,slot:7,name:'Boots - 3 Spi'},{id:904,slot:7,name:'Boots - 5 Agi'},
    {id:849,slot:7,name:'Boots - 3 Agi'},{id:247,slot:7,name:'Boots - 1 Agi'},
    {id:852,slot:7,name:'Boots - 5 Sta'},{id:724,slot:7,name:'Boots - 3 Sta'},
    {id:66,slot:7,name:'Boots - 1 Sta'},{id:1887,slot:7,name:'Boots - 7 Agi'},
    {id:929,slot:7,name:'Boots - 7 Sta'},{id:464,slot:7,name:'Boots - Mount Speed'},
    // Chest (slot 4)
    {id:908,slot:4,name:'Chest - 50 HP'},{id:850,slot:4,name:'Chest - 35 HP'},
    {id:254,slot:4,name:'Chest - 25 HP'},{id:242,slot:4,name:'Chest - 15 HP'},
    {id:41,slot:4,name:'Chest - 5 HP'},{id:913,slot:4,name:'Chest - 65 Mana'},
    {id:857,slot:4,name:'Chest - 50 Mana'},{id:843,slot:4,name:'Chest - 30 Mana'},
    {id:246,slot:4,name:'Chest - 20 Mana'},{id:24,slot:4,name:'Chest - 5 Mana'},
    {id:928,slot:4,name:'Chest - 3 Stats'},{id:866,slot:4,name:'Chest - 2 Stats'},
    {id:847,slot:4,name:'Chest - 1 Stats'},{id:63,slot:4,name:'Chest - 25 Absorb'},
    {id:44,slot:4,name:'Chest - 10 Absorb'},{id:1891,slot:4,name:'Chest - 4 Stats'},
    {id:1893,slot:4,name:'Chest - 100 Mana'},
    // Cloak (slot 14)
    {id:910,slot:14,name:'Cloak - Stealth'},{id:903,slot:14,name:'Cloak - 3 Res'},
    {id:65,slot:14,name:'Cloak - 1 Res'},{id:2463,slot:14,name:'Cloak - 7 FR'},
    {id:256,slot:14,name:'Cloak - 5 FR'},{id:1889,slot:14,name:'Cloak - 70 Armor'},
    {id:884,slot:14,name:'Cloak - 50 Armor'},{id:848,slot:14,name:'Cloak - 30 Armor'},
    {id:744,slot:14,name:'Cloak - 20 Armor'},{id:783,slot:14,name:'Cloak - 10 Armor'},
    {id:247,slot:14,name:'Cloak - 1 Agi'},{id:2938,slot:14,name:'Cloak - Spell Pen'},
    // Shield (slot 16)
    {id:852,slot:16,name:'Shield - 5 Sta'},{id:724,slot:16,name:'Shield - 3 Sta'},
    {id:66,slot:16,name:'Shield - 1 Sta'},{id:907,slot:16,name:'Shield - 7 Spi'},
    {id:851,slot:16,name:'Shield - 5 Spi'},{id:255,slot:16,name:'Shield - 3 Spi'},
    {id:848,slot:16,name:'Shield - 30 Armor'},{id:1704,slot:16,name:'Shield - Thor Spike'},
    {id:463,slot:16,name:'Shield - Mith Spike'},{id:43,slot:16,name:'Shield - Iron Spike'},
    {id:929,slot:16,name:'Shield - 7 Sta'},
    // Armor kits (any slot)
    {id:2503,name:'3 Def',tbc:true},{id:1843,name:'40 Armor'},{id:18,name:'32 Armor'},
    {id:17,name:'24 Armor'},{id:16,name:'16 Armor'},{id:15,name:'8 Armor'},
    {id:2792,name:'Knothide Kit',tbc:true},
    // Heavy Knothide Kit (slot-specific)
    {id:2841,slot:0,name:'Heavy Knothide Kit',tbc:true},{id:2841,slot:2,name:'Heavy Knothide Kit',tbc:true},
    {id:2841,slot:4,name:'Heavy Knothide Kit',tbc:true},{id:2841,slot:6,name:'Heavy Knothide Kit',tbc:true},
    {id:2841,slot:7,name:'Heavy Knothide Kit',tbc:true},
    // Weapon enchants (any weapon slot)
    {id:1903,name:'Weapon - 9 Spi'},{id:255,name:'Weapon - 3 Spi'},
    {id:1904,name:'Weapon - 9 Int'},{id:723,name:'Weapon - 3 Int'},
    {id:1896,name:'Weapon - 9 Dmg'},{id:963,name:'Weapon - 7 Dmg'},
    {id:943,name:'Weapon - 3 Dmg'},{id:241,name:'Weapon - 2 Dmg'},
    {id:2443,name:'Weapon - 7 Frost'},{id:1899,name:'Weapon - Unholy'},
    {id:1898,name:'Weapon - Lifesteal'},{id:803,name:'Weapon - Fiery'},
    {id:854,name:'Weapon - Elemental'},{id:805,name:'Weapon - 4 Dmg'},
    {id:2646,name:'Weapon - 25 Agi'},{id:2568,name:'Weapon - 22 Int'},
    {id:1900,name:'Weapon - Crusader'},{id:2669,name:'Weapon - 40SP'},
    {id:2564,slot:15,name:'Weapon - 15Agi'},
    {id:2505,name:'Weapon - Healing Power'},
    // Legs
    {id:2745,name:'Legs - Silver Thread'},{id:2747,name:'Legs - Mystic Thread'},
    {id:3010,name:'Legs - 40AP/10Crit',tbc:true},
    // Shoulder
    {id:2606,name:'Shoulder - ZG'},{id:2605,name:'Shoulder - ZG'},
    {id:2604,name:'Shoulder - ZG'},
    {id:2996,name:'Shoulder - Scryer Hon',tbc:true},{id:2990,name:'Shoulder - Scryer Hon',tbc:true},
    {id:2992,name:'Shoulder - Scryer Hon',tbc:true},{id:2994,name:'Shoulder - Scryer Hon',tbc:true},
    {id:2981,name:'Shoulder - Aldor Hon',tbc:true},{id:2979,name:'Shoulder - Aldor Hon',tbc:true},
    {id:2983,name:'Shoulder - Aldor Hon',tbc:true},{id:2977,name:'Shoulder - Aldor Hon',tbc:true},
    // Head/Legs ZG
    {id:2591,name:'Head/Legs - ZG'},{id:2586,name:'Head/Legs - ZG'},
    {id:2588,name:'Head/Legs - ZG'},{id:2584,name:'Head/Legs - ZG'},
    {id:2590,name:'Head/Legs - ZG'},{id:2585,name:'Head/Legs - ZG'},
    {id:2587,name:'Head/Legs - ZG'},{id:2589,name:'Head/Legs - ZG'},
    {id:2583,slot:6,name:'Head/Legs - ZG'},
    // Boots misc
    {id:911,name:'Boots - Minor Speed'},
  ],

  // Enchant exceptions: allowed for specific classes
  enchantExceptions: {
    2938: ['Priest', 'Mage'],   // Spell Pen on cloak — allowed for Priests/Mages
    2669: ['Paladin', 'Shaman'],  // 40SP weapon — allowed for Paladins/Shamans
    2841: ['Mage'],  // Heavy Knothide Armor Kit — Mage tankt Krosh
  },

  // Items excluded from enchant checking (self-enchanted, crafted, etc.)
  excludedEnchantItems: [
    15138,9449,19022,19970,25978,6365,12225,6367,6366,6256,38175,
    21864,21865,21868,23509,23512,21867,23511,21863,28301,31938,
    27449,29495,29489,29497,29491,21866,29496,29490,30831,
    30311,30312,30313,30314,30316,30317,30318
  ],

  // Gem color detection by gem item ID ranges
  // From GearIssues.gs: gem colors are determined by icon name
  // But more reliable: use known gem ID lists

  // Gem quality: use GEM_DB.getQuality() instead (gem_db.js)

  // Check if enchant is bad for a given slot
  isEnchantBad(enchantId, slot, className, settings) {
    for (const entry of this.badEnchants) {
      if (entry.id !== enchantId) continue;
      // Slot restriction: if entry has slot, only match that slot
      if (entry.slot !== undefined && entry.slot !== slot) continue;

      // Exception: 2938 (Spell Pen) allowed for Priests
      // Exception: 2669 (40SP) allowed for Paladins/Shamans
      const exceptions = this.enchantExceptions[enchantId];
      if (exceptions && exceptions.includes(className)) continue;

      // Vanilla enchants: if settings allow vanilla enchants, only flag TBC-era bad enchants
      if (settings && settings.vanillaEnchants && !entry.tbc) {
        continue;
      }

      return entry.name;
    }
    return null;
  },

  // Is item excluded from enchant checking
  isExcludedItem(itemId) {
    return this.excludedEnchantItems.includes(itemId);
  }
};

window.CLA_GEAR = CLA_GEAR;
