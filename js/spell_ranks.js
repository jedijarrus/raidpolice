/**
 * TBC Classic Fresh Spell Rank Database
 * Maps lower-rank spell IDs to their spell name and max-rank ID.
 * Used by the Spell Rank Checker to flag players using non-max-rank spells.
 *
 * Format: LOWER_RANK_SPELLS[lowerRankSpellId] = { name, maxId }
 * MAX_RANK_IDS is a Set of all max-rank spell IDs (for quick "is this max rank?" checks)
 *
 * Note: "Book drop" ranks from Zul'Aman (38692 Fireball R14, 38697 Frostbolt R14,
 *        38704 Arcane Missiles R11, 30324 Heroic Strike R11) are NOT included as
 *        max ranks since ZA is not yet released in Classic Fresh.
 */
(function () {
  'use strict';

  // Define spells as: [maxRankId, "SpellName", [lowerRankId1, lowerRankId2, ...]]
  // Only combat-relevant spells for TBC raiding (level 70)
  const SPELL_DEFS = {
    Warrior: [
      [29707, 'Heroic Strike', [25286, 11567, 11566, 11565, 11564, 1608, 285, 284, 78]],
      [25236, 'Execute', [25234, 20662, 20661, 20660, 20658, 5308]],
      [25242, 'Slam', [25241, 11605, 11604, 8820, 1464]],
      [30330, 'Mortal Strike', [25248, 21553, 21552, 21551, 12294]],
      [30335, 'Bloodthirst', [25251, 23894, 23893, 23892, 23881]],
      [30356, 'Shield Slam', [25258, 23925, 23924, 23923, 23922]],
      [25225, 'Sunder Armor', [11597, 11596, 8380, 7405, 7386]],
      [30022, 'Devastate', [30016, 20243]],
      [30357, 'Revenge', [25269, 25288, 11601, 11600, 7379, 6574, 6572]],
      [25264, 'Thunder Clap', [11581, 11580, 8205, 8204, 8198, 6343]],
      [25231, 'Cleave', [20569, 11609, 11608, 7369, 845]],
      [25203, 'Demoralizing Shout', [25202, 11556, 11555, 11554, 6190, 1160]],
      [2565, 'Shield Block', []],
      [1680, 'Whirlwind', []],
    ],

    Mage: [
      [27070, 'Fireball', [25306, 10151, 10150, 10149, 10148, 8402, 8401, 8400, 3140, 145, 143, 133]],
      [27072, 'Frostbolt', [27071, 25304, 10181, 10180, 10179, 8408, 8407, 8406, 7322, 837, 205, 116]],
      [27075, 'Arcane Missiles', [25345, 10212, 10211, 8417, 8416, 5145, 5144, 5143]],
      [27074, 'Scorch', [27073, 10207, 10206, 10205, 8446, 8445, 8444, 2948]],
      [27079, 'Fire Blast', [27078, 10199, 10197, 8413, 8412, 2138, 2137, 2136]],
      [30451, 'Arcane Blast', []],
      [27087, 'Cone of Cold', [10161, 10160, 10159, 8492, 120]],
      [27085, 'Blizzard', [10187, 10186, 10185, 8427, 6141, 10]],
      [27086, 'Flamestrike', [10216, 10215, 8423, 8422, 2121, 2120]],
      [33938, 'Pyroblast', [27132, 18809, 12526, 12525, 12524, 12523, 12522, 12505, 11366]],
      [27082, 'Arcane Explosion', [27080, 10202, 10201, 8439, 8438, 8437, 1449]],
    ],

    Warlock: [
      [27209, 'Shadow Bolt', [25307, 11661, 11660, 11659, 7641, 1106, 1088, 705, 695, 686]],
      [32231, 'Incinerate', [29722]],
      [27215, 'Immolate', [25309, 11668, 11667, 11665, 2941, 1094, 707, 348]],
      [27216, 'Corruption', [25311, 11672, 11671, 7648, 6223, 6222, 172]],
      [27218, 'Curse of Agony', [11713, 11712, 11711, 6217, 1014, 980]],
      [30910, 'Curse of Doom', [603]],
      [27243, 'Seed of Corruption', []],
      [30459, 'Searing Pain', [27210, 17923, 17922, 17921, 17920, 17919, 5676]],
      [27222, 'Life Tap', [11689, 11688, 11687, 1456, 1455, 1454]],
      [27220, 'Drain Life', [27219, 11700, 11699, 7651, 709, 699, 689]],
      [30405, 'Unstable Affliction', [30404, 30108]],
      [27223, 'Death Coil', [17926, 17925, 6789]],
      [30912, 'Conflagrate', [27266, 18932, 18931, 18930, 17962]],
      [30546, 'Shadowburn', [27263, 18871, 18870, 18869, 18868, 18867, 17877]],
    ],

    Hunter: [
      [34120, 'Steady Shot', []],
      [27019, 'Arcane Shot', [14287, 14286, 14285, 14284, 14283, 14282, 14281, 3044]],
      [27021, 'Multi-Shot', [25294, 14290, 14289, 14288, 2643]],
      [27065, 'Aimed Shot', [20904, 20903, 20902, 20901, 20900, 19434]],
      [27016, 'Serpent Sting', [25295, 13555, 13554, 13553, 13552, 13551, 13550, 13549, 1978]],
      [34026, 'Kill Command', []],
      [27014, 'Raptor Strike', [14266, 14265, 14264, 14263, 14262, 14261, 14260, 2973]],
      [27025, 'Explosive Trap', [14317, 14316, 13813]],
      [27023, 'Immolation Trap', [14305, 14304, 14303, 14302, 13795]],
    ],

    Rogue: [
      [26862, 'Sinister Strike', [26861, 11294, 11293, 8621, 1760, 1759, 1758, 1757, 1752]],
      [26863, 'Backstab', [25300, 11281, 11280, 11279, 8721, 2591, 2590, 2589, 53]],
      [26865, 'Eviscerate', [31016, 11300, 11299, 8624, 8623, 6762, 6761, 6760, 2098]],
      [26867, 'Rupture', [11275, 11274, 11273, 8640, 8639, 1943]],
      [26864, 'Hemorrhage', [17348, 17347, 16511]],
      [32684, 'Envenom', [32645]],
      [6774, 'Slice and Dice', [5171]],
      [5938, 'Shiv', []],
      [26679, 'Deadly Throw', []],
      [34413, 'Mutilate', [34412, 34411, 1329]],
    ],

    Priest: [
      [25213, 'Greater Heal', [25210, 25314, 10965, 10964, 10963, 2060]],
      [25235, 'Flash Heal', [25233, 10917, 10916, 10915, 9474, 9473, 9472, 2061]],
      [25308, 'Prayer of Healing', [25316, 10961, 10960, 996, 596]],
      [25368, 'Shadow Word: Pain', [25367, 10894, 10893, 10892, 2767, 992, 970, 594, 589]],
      [25375, 'Mind Blast', [25372, 10947, 10946, 10945, 8106, 8105, 8104, 8103, 8102, 8092]],
      [25364, 'Smite', [25363, 10934, 10933, 6060, 1004, 984, 598, 591, 585]],
      [25387, 'Mind Flay', [18807, 17314, 17313, 17312, 17311, 15407]],
      [25384, 'Holy Fire', [15261, 15267, 15266, 15265, 15264, 15263, 15262, 14914]],
      [25218, 'Power Word: Shield', [25217, 10901, 10900, 10899, 10898, 6066, 6065, 3747, 600, 592, 17]],
      [25222, 'Renew', [25221, 25315, 10929, 10928, 10927, 6078, 6077, 6076, 6075, 6074, 139]],
      [33076, 'Prayer of Mending', []],
      [34917, 'Vampiric Touch', [34916, 34914]],
      [32996, 'Shadow Word: Death', [32379]],
      [34866, 'Circle of Healing', [34865, 34864, 34863, 34861]],
    ],

    Paladin: [
      [27136, 'Holy Light', [27135, 25292, 10329, 10328, 3472, 1042, 1026, 647, 639, 635]],
      [27137, 'Flash of Light', [19943, 19942, 19941, 19940, 19939, 19750]],
      [27173, 'Consecration', [20924, 20923, 20922, 20116, 26573]],
      [27179, 'Holy Shield', [20928, 20927, 20925]],
      [32700, 'Avenger\'s Shield', [32699, 31935]],
      [27138, 'Exorcism', [10314, 10313, 10312, 5615, 5614, 879]],
      [27180, 'Hammer of Wrath', [24275, 24274, 24239]],
      [27155, 'Seal of Righteousness', [21084, 20293, 20292, 20291, 20290, 20289, 20288, 20287, 20154]],
    ],

    Shaman: [
      [25449, 'Lightning Bolt', [25448, 15208, 15207, 10392, 10391, 6041, 943, 915, 548, 529, 403]],
      [25442, 'Chain Lightning', [25439, 10605, 2860, 930, 421]],
      [25423, 'Chain Heal', [25422, 10623, 10622, 1064]],
      [25396, 'Healing Wave', [25391, 25357, 10396, 10395, 8005, 959, 939, 913, 547, 332, 331]],
      [25420, 'Lesser Healing Wave', [10468, 10467, 10466, 8010, 8008, 8004]],
      [25454, 'Earth Shock', [10414, 10413, 10412, 8046, 8045, 8044, 8042]],
      [25457, 'Flame Shock', [29228, 10448, 10447, 8053, 8052, 8050]],
      [25464, 'Frost Shock', [10473, 10472, 8058, 8056]],
      [17364, 'Stormstrike', []],
    ],

    Druid: [
      [26985, 'Wrath', [26984, 9912, 8905, 6780, 5180, 5179, 5178, 5177, 5176]],
      [26986, 'Starfire', [25298, 9876, 9875, 8951, 8950, 8949, 2912]],
      [26988, 'Moonfire', [26987, 9835, 9834, 9833, 8929, 8928, 8927, 8926, 8925, 8924, 8921]],
      [27013, 'Insect Swarm', [24977, 24976, 24975, 24974, 5570]],
      [26979, 'Healing Touch', [26978, 25297, 9889, 9888, 9758, 8903, 6778, 5189, 5188, 5187, 5186, 5185]],
      [26982, 'Rejuvenation', [26981, 25299, 9841, 9840, 9839, 8910, 3627, 2091, 2090, 1430, 1058, 774]],
      [33763, 'Lifebloom', []],
      [26980, 'Regrowth', [9858, 9857, 9856, 9750, 8941, 8940, 8939, 8938, 8936]],
      [26997, 'Swipe', [9908, 9754, 769, 780, 779]],
      [26996, 'Maul', [9881, 9880, 9745, 8972, 6809, 6808, 6807]],
      [33987, 'Mangle (Bear)', [33986, 33878]],
      [33983, 'Mangle (Cat)', [33982, 33876]],
      [27002, 'Shred', [27001, 9830, 9829, 8992, 6800, 5221]],
      [33745, 'Lacerate', []],
      [27012, 'Hurricane', [17402, 17401, 16914]],
    ],
  };

  // Build lookup maps
  const LOWER_RANK_SPELLS = {};  // lowerRankId -> { name, maxId, rank, maxRank }
  const MAX_RANK_IDS = new Set();
  const MAX_RANK_BY_CLASS = {};  // className -> Set of maxRankIds

  for (const [className, spells] of Object.entries(SPELL_DEFS)) {
    MAX_RANK_BY_CLASS[className] = new Set();
    for (const [maxId, name, lowerIds] of spells) {
      MAX_RANK_IDS.add(maxId);
      MAX_RANK_BY_CLASS[className].add(maxId);
      const maxRank = lowerIds.length + 1;
      for (let i = 0; i < lowerIds.length; i++) {
        LOWER_RANK_SPELLS[lowerIds[i]] = { name, maxId, rank: maxRank - 1 - i, maxRank };
      }
    }
  }

  window.SPELL_RANKS = {
    LOWER_RANK_SPELLS,
    MAX_RANK_IDS,
    MAX_RANK_BY_CLASS,
    SPELL_DEFS,
  };
})();
