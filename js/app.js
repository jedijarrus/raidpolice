/**
 * raidpolice - Main Application
 * Guild dashboard + per-report analysis with SQLite caching
 */
(function () {
  'use strict';

  // Helper: add CSRF token to fetch calls
  function apiFetch(url, opts = {}) {
    opts.headers = { ...opts.headers, 'X-CSRF-Token': window.__csrfToken || '' };
    return fetch(url, opts);
  }

  // ─── CONFIG: Spell ID lists from the original config spreadsheet ───

  const BUFF_IDS = {
    battleElixir: [10667,10669,11334,11405,11406,11474,16323,16329,17038,17537,17538,17539,26276,28490,28491,28493,28497,28501,28503,33720,33721,33726,38954,45373,45374],
    guardianElixir: [10668,10692,10693,11348,11371,11374,11396,17535,24361,24363,24382,24383,24417,28502,28509,28514,30003,39625,39626,39627,39628],
    flask: [17626,17627,17628,17629,28518,28519,28520,28521,28540,40576,40577,40579,40580,40582,40586,40587,40588,40763,41604,41605,41606,41607,42735,46838,46840],
    foodBuff: [19705,19706,19708,19709,19710,19711,22730,22731,24799,24870,25660,25661,25694,25804,25941,33254,33256,33257,33259,33261,33263,33265,33268,35272,40323,42293,43730,43731,43733,43764,43771,44097,44098,44099,44100,44101,44102,44103,44104,44105,44106,45245,45619,46682,46687,46899,43722,21149],
    scrolls: [33077,33078,33079,33080,33081,33082,12174,8117,8116,8115,12176,8098,8097,8096,12175,8095,8094,8091,12177,8114,8113,8112,12178,8101,8100,8099,12179,8120,8119,8118],
    // Scroll rank details: spellId → { stat, rank, value } — TBC Classic (max = Rank V)
    scrollRanks: {
      // Agility
      33077: { stat: 'Agility', rank: 'V', value: 20 }, 12174: { stat: 'Agility', rank: 'IV', value: 17 },
      8117: { stat: 'Agility', rank: 'III', value: 13 }, 8116: { stat: 'Agility', rank: 'II', value: 9 }, 8115: { stat: 'Agility', rank: 'I', value: 5 },
      // Intellect
      33078: { stat: 'Intellect', rank: 'V', value: 20 }, 12176: { stat: 'Intellect', rank: 'IV', value: 16 },
      8098: { stat: 'Intellect', rank: 'III', value: 12 }, 8097: { stat: 'Intellect', rank: 'II', value: 8 }, 8096: { stat: 'Intellect', rank: 'I', value: 4 },
      // Protection (Armor)
      33079: { stat: 'Protection', rank: 'V', value: 300 }, 12175: { stat: 'Protection', rank: 'IV', value: 240 },
      8095: { stat: 'Protection', rank: 'III', value: 180 }, 8094: { stat: 'Protection', rank: 'II', value: 120 }, 8091: { stat: 'Protection', rank: 'I', value: 60 },
      // Spirit
      33080: { stat: 'Spirit', rank: 'V', value: 30 }, 12177: { stat: 'Spirit', rank: 'IV', value: 15 },
      8114: { stat: 'Spirit', rank: 'III', value: 11 }, 8113: { stat: 'Spirit', rank: 'II', value: 7 }, 8112: { stat: 'Spirit', rank: 'I', value: 3 },
      // Stamina
      33081: { stat: 'Stamina', rank: 'V', value: 20 }, 12178: { stat: 'Stamina', rank: 'IV', value: 16 },
      8101: { stat: 'Stamina', rank: 'III', value: 12 }, 8100: { stat: 'Stamina', rank: 'II', value: 8 }, 8099: { stat: 'Stamina', rank: 'I', value: 4 },
      // Strength
      33082: { stat: 'Strength', rank: 'V', value: 20 }, 12179: { stat: 'Strength', rank: 'IV', value: 17 },
      8120: { stat: 'Strength', rank: 'III', value: 13 }, 8119: { stat: 'Strength', rank: 'II', value: 9 }, 8118: { stat: 'Strength', rank: 'I', value: 5 },
    },
    // Best rank per stat in TBC (Rank V = max)
    scrollBestRank: { Agility: 33077, Intellect: 33078, Protection: 33079, Spirit: 33080, Stamina: 33081, Strength: 33082 },
    // Required scroll stats per role key (Class:Spec) — synchron mit preanalyze.js BUFF_IDS.scrollRequired
    scrollRequired: {
      'Warrior:dps':         ['Agility', 'Strength'],
      'Rogue:dps':           ['Agility', 'Strength'],
      'Hunter:dps':          ['Agility'],
      'Paladin:retribution': ['Agility', 'Strength'],
      'Druid:feral':         ['Agility', 'Strength'],
      'Druid:balance':       [],
      'Druid:healer':        [],
      'Shaman:enhancement':  ['Agility', 'Strength'],
      'Shaman:elemental':    [],
      'Warrior:tank':        ['Agility', 'Strength', 'Protection'],
      'Paladin:tank':        ['Agility', 'Strength', 'Protection'],
      'Druid:tank':          ['Agility', 'Strength', 'Protection'],
      'HunterPet':           ['Agility', 'Strength'],
    },
    // Weapon enhancements — oils, sharpening stones, weightstones (buff/aura spell IDs)
    weaponEnhancement: [
      // Wizard Oils
      25122, 25123, 25121, 25120,
      // Mana Oils
      28017, 28016, 25119,
      // Sharpening Stones
      29453, 29452, 22756, 16138, 12164,
      // Weightstones
      34340, 34339, 16622, 12163,
      // Rogue Poisons (as buffs on the rogue)
      27187, 27186, 26891, 26892, 26969, 27283, 27282, 26790, 26786, 26785, 26884,
      // Windfury Totem (proc aura on melee — counts as MH weapon enhancement)
      25584, 25583
    ]
  };

  // Temporary enchant ID → name mapping (SpellItemEnchantment IDs from gear data)
  const TEMP_ENCHANT_NAMES = {
    // Wizard Oils
    2628: 'Brilliant Wizard Oil', 2678: 'Superior Wizard Oil', 2627: 'Wizard Oil',
    2626: 'Lesser Wizard Oil', 2625: 'Minor Wizard Oil', 2624: 'Minor Mana Oil',
    // Mana Oils
    2629: 'Brilliant Mana Oil', 2677: 'Superior Mana Oil', 2623: 'Lesser Mana Oil',
    2685: 'Blessed Wizard Oil',
    // Sharpening Stones
    2713: 'Adamantite Sharpening Stone', 2712: 'Fel Sharpening Stone',
    2506: 'Elemental Sharpening Stone', 1643: 'Dense Sharpening Stone',
    483: 'Solid Sharpening Stone', 2684: 'Consecrated Sharpening Stone',
    // Weightstones
    2955: 'Adamantite Weightstone', 2954: 'Fel Weightstone',
    1703: 'Dense Weightstone', 484: 'Solid Weightstone',
    // Windfury Totem (applied to party members' weapons by Shaman)
    2639: 'Windfury', 2638: 'Windfury',
    // Shaman Weapon Imbues (self-cast)
    2636: 'Windfury',
    // Rogue Poisons (temporaryEnchant IDs)
    2643: 'Deadly Poison', 2630: 'Instant Poison',
    2641: 'Crippling Poison', 2640: 'Mind-Numbing Poison',
    2642: 'Wound Poison', 2644: 'Anesthetic Poison',
    // Sunwell
    3266: 'Righteous Weapon Coating', 3265: 'Blessed Weapon Coating',
    3093: 'Scourgebane',
  };

  // Pre-built Sets for O(1) buff lookups (used in progression & live ticker)
  const BUFF_SETS = {
    flask: new Set(BUFF_IDS.flask),
    battleElixir: new Set(BUFF_IDS.battleElixir),
    guardianElixir: new Set(BUFF_IDS.guardianElixir),
    foodBuff: new Set(BUFF_IDS.foodBuff),
    scrolls: new Set(BUFF_IDS.scrolls),
    weaponEnhancement: new Set(BUFF_IDS.weaponEnhancement),
  };

  const DRUM_SPELL_IDS = [35478, 35476, 35475, 351355, 351358, 351360];
  const VALID_CLASSES = ['Druid','Hunter','Mage','Priest','Paladin','Rogue','Shaman','Warlock','Warrior'];
  const EXCLUDED_WEAPON_ITEMS = [19022, 19970, 25978, 6365, 12225, 6367, 6366, 6256];
  const EXCLUDED_TEMP_ENCHANTS = [4264, 263, 264, 265, 266];
  // Windfury Totem/Weapon temp enchant IDs (not a player consumable)
  const WF_TOTEM_TEMP_ENCHANTS = [2639, 2638, 2636];
  // Windfury buff aura IDs (from BUFF_IDS.weaponEnhancement)
  const WF_BUFF_AURAS = [25584, 25583];
  // Classes that can dual-wield weapons
  const DW_CAPABLE_CLASSES = ['Warrior', 'Rogue', 'Hunter', 'Shaman'];
  // OH icon patterns that indicate a real weapon (not shield/frill/orb)
  const OH_WEAPON_ICON_RE = /^inv_(sword|mace|axe|weapon|knife|hammer|hand|staff)_/;
  const ROGUE_POISON_ABILITY = 27187;

  /**
   * Build a name→playerDetail lookup from summary.playerDetails.
   * Caches on the summary object to avoid repeated array spreads.
   */
  function getPlayerDetailMap(summary) {
    if (!summary) return {};
    if (summary._playerMap) return summary._playerMap;
    const pd = summary.playerDetails || {};
    const map = {};
    for (const arr of [pd.tanks, pd.healers, pd.dps]) {
      if (!arr) continue;
      for (const p of arr) map[p.name] = p;
    }
    summary._playerMap = map;
    return map;
  }

  /** Determine player role key for a fight using summary.playerDetails */
  function getPlayerFightRole(summary, playerName, playerType) {
    if (!summary || !summary.playerDetails) return playerType + ':dps';
    const pd = summary.playerDetails;
    if (pd.tanks && pd.tanks.some(p => p.name === playerName)) return playerType + ':tank';
    if (pd.healers && pd.healers.some(p => p.name === playerName)) return playerType + ':healer';
    // DPS — for Shaman check spec to distinguish Enh vs Ele
    if (playerType === 'Shaman') {
      const detail = getPlayerDetailMap(summary)[playerName];
      const spec = detail?.specs?.join?.(',') || detail?.icon || '';
      if (/enhancement/i.test(spec)) return 'Shaman:dps';
      // Unknown spec or Ele — no scroll requirement
      return 'Shaman:healer'; // maps to undefined in scrollRequired → []
    }
    // DPS Druid — check spec to distinguish Feral vs Balance (Eule)
    if (playerType === 'Druid') {
      const detail = getPlayerDetailMap(summary)[playerName];
      const spec = detail?.specs?.join?.(',') || detail?.icon || '';
      if (/balance|moonkin/i.test(spec)) return 'Druid:caster'; // no scroll requirement
    }
    return playerType + ':dps';
  }

  /** Compute missing required scrolls for a fight */
  function getScrollRequirementsForRole(roleKey) {
    if (window._scrollRequirementOverrides && Object.prototype.hasOwnProperty.call(window._scrollRequirementOverrides, roleKey)) {
      return Array.isArray(window._scrollRequirementOverrides[roleKey]) ? window._scrollRequirementOverrides[roleKey] : [];
    }
    return BUFF_IDS.scrollRequired[roleKey] || [];
  }
  function getMissingScrolls(scrollEntries, roleKey) {
    const required = getScrollRequirementsForRole(roleKey);
    if (!required || !required.length) return [];
    const haveStats = new Set();
    for (const s of scrollEntries) {
      const info = BUFF_IDS.scrollRanks[s.spellId];
      if (info) haveStats.add(info.stat);
    }
    return required.filter(stat => !haveStats.has(stat));
  }

  /**
   * Detect weapon enhancement from gear and auras for a single player in a single fight.
   * Returns { isDW, mh, oh } where mh/oh are enhancement name strings or null.
   * For non-DW players, only mh is set (from whichever slot has an enhancement).
   */
  function detectWeaponEnhancement(playerDetail, playerType, auras) {
    const result = { isDW: false, mh: null, oh: null };
    // Phase 1: Check gear temporaryEnchant
    if (playerDetail) {
      const ciGear = (playerDetail.combatantInfo && playerDetail.combatantInfo.gear) || playerDetail.gear || [];
      let mhEnh = null, ohEnh = null, hasMH = false, hasOH = false, ohIsWeapon = false;
      for (let gi = 0; gi < ciGear.length; gi++) {
        const item = ciGear[gi];
        if (!item || !item.id) continue;
        const slot = item.slot !== undefined ? item.slot : gi;
        if (slot !== 15 && slot !== 16) continue;
        if (EXCLUDED_WEAPON_ITEMS.includes(item.id)) continue;
        if (slot === 15) hasMH = true;
        if (slot === 16) { hasOH = true; if (item.icon && OH_WEAPON_ICON_RE.test(item.icon)) ohIsWeapon = true; }
        if (item.temporaryEnchant && !EXCLUDED_TEMP_ENCHANTS.includes(item.temporaryEnchant)) {
          const eName = TEMP_ENCHANT_NAMES[item.temporaryEnchant] || `Enchant #${item.temporaryEnchant}`;
          if (slot === 15) mhEnh = eName;
          else if (slot === 16) ohEnh = eName;
        }
      }
      // Hunter: WF Totem doesn't count as weapon enhancement
      if (playerType === 'Hunter') {
        if (mhEnh && WF_TOTEM_TEMP_ENCHANTS.some(id => mhEnh === TEMP_ENCHANT_NAMES[id])) mhEnh = null;
        if (ohEnh && WF_TOTEM_TEMP_ENCHANTS.some(id => ohEnh === TEMP_ENCHANT_NAMES[id])) ohEnh = null;
      }
      result.isDW = hasMH && hasOH && DW_CAPABLE_CLASSES.includes(playerType) && ohIsWeapon;
      result.mh = mhEnh;
      result.oh = ohEnh;
    }
    // Phase 2: Aura fallback — credit MH if missing (works for both DW and non-DW)
    if (auras && !result.mh) {
      for (const a of auras) {
        if (playerType === 'Hunter' && WF_BUFF_AURAS.includes(a.guid)) continue;
        if (BUFF_SETS.weaponEnhancement.has(a.guid)) {
          result.mh = WF_BUFF_AURAS.includes(a.guid) ? 'Windfury' : a.name;
          break;
        }
      }
    }
    return result;
  }

  /** Check if a detectWeaponEnhancement result counts as "has weapon enhancement" */
  function hasWeaponEnh(weResult) {
    if (weResult.isDW) return !!(weResult.mh && weResult.oh);
    return !!(weResult.mh || weResult.oh);
  }

  /** Format a detectWeaponEnhancement result for display in fight details.
   *  Returns string name for non-DW, or {isDW, mh, oh} object for DW. */
  function formatWeaponEnh(weResult) {
    if (weResult.isDW) return { isDW: true, mh: weResult.mh, oh: weResult.oh };
    return weResult.mh || weResult.oh || null;
  }

  const UNCUT_GEMS =[23112,23436,23077,23441,23440,23117,23438,23437,23107,23079,21929,23439,32227,32229,32228,32231,32249,32230];

  const META_GEM_IDS = new Set([
    25890,25893,25894,25895,25896,25897,25898,25899,25901,
    28556,28557,32409,32410,32640,32641,34220,35501,35503,
    41285,41307,41333,41335,41339,41376,41380,41389,41395,41396,41397,41398,41400,41401,
  ]);
  function isMetaGemActive(metaId, r, y, b) {
    switch (metaId) {
      case 25896: return b > 2;
      case 25897: return r > b;
      case 32409: case 25899: case 25901: case 25890: case 32410: return r > 1 && b > 1 && y > 1;
      case 25898: return b > 4;
      case 25893: case 32640: return b > y;
      case 34220: return b > 1;
      case 25895: return r > y;
      case 25894: case 28556: case 28557: return r > 0 && y > 1;
      case 32641: return y > 2;
      case 35503: return r > 2;
      case 35501: return b > 1 && y > 0;
      default: return true;
    }
  }
  const META_GEMS = { // legacy compat — kept for isMeta checks only
  };

  const RIDING_ITEMS = [25549,25550,28281,28282,28283,32453,32458,33000];
  const SLOWFALL_ITEMS = [36942, 38258];

  /** Build a map of hunter pets from report data: ownerName → [{petId, petName}] */
  function getHunterPetMap(rData) {
    if (!rData || !rData.friendlyPets) return {};
    const friendMap = {};
    for (const f of (rData.friendlies || [])) friendMap[f.id] = f;
    const result = {};
    for (const p of rData.friendlyPets) {
      const owner = friendMap[p.petOwner];
      if (!owner || owner.type !== 'Hunter') continue;
      if (!result[owner.name]) result[owner.name] = [];
      // Deduplicate by pet name (same pet can appear multiple times)
      if (!result[owner.name].some(x => x.petName === p.name)) {
        result[owner.name].push({ petId: p.id, petName: p.name });
      }
    }
    return result;
  }

  /** Format scroll with rank info. Returns { label, isMaxRank } */
  function formatScrollWithRank(spellId) {
    const info = BUFF_IDS.scrollRanks[spellId];
    if (!info) return { label: 'Unknown Scroll', isMaxRank: false };
    const best = BUFF_IDS.scrollBestRank[info.stat];
    const isMax = spellId === best;
    return { label: `${info.stat} ${info.rank} (+${info.value})`, isMaxRank: isMax };
  }

  const SR_BUFF_VALUES = {
    25433:70,39374:70,10958:60,27683:60,10957:45,976:30,
    27125:18,22783:15,22782:10,6117:5,
    27260:18,11735:15,11734:12,11733:9,1086:6,706:3,
    42735:35,17629:25,45619:8,1138:10,11371:10
  };
  const SR_ENCHANT_VALUES = {804:10,1888:5,2984:8,3009:20,2998:7,2664:7,1441:15,2683:10};
  const SR_GEM_VALUES = {22459:4,22460:3};

  const MELEE_CLASSES = ['Warrior', 'Rogue', 'Paladin'];
  const CASTER_CLASSES = ['Mage', 'Warlock', 'Priest'];
  const SPELL_HIT_ENCHANTS = [3002, 2935];
  const MELEE_HIT_ENCHANTS = [3003, 2658];

  // ─── STATE ───

  let api = null;
  let reportCode = null;
  let reportData = null;
  let bossFights = [];
  let playerList = [];
  let guildReports = [];
  let savedGuildName = '';
  let savedServerName = '';
  let savedRegion = 'EU';
  let _pendingHashTab = '';

  // ─── HELPERS ───

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function show(el) { if (typeof el === 'string') el = $(el); el && el.classList.remove('hidden'); }
  function hide(el) { if (typeof el === 'string') el = $(el); el && el.classList.add('hidden'); }

  function setStatus(id, msg, isError) {
    const el = $(id);
    show(el);
    el.textContent = msg;
    el.className = 'status-bar' + (isError ? ' status-error' : '');
  }

  function showLoading(msg) {
    $('#loading-text').textContent = msg || 'Laden...';
    show('#loading-overlay');
  }
  function hideLoading() { hide('#loading-overlay'); }

  function classNameFromType(type) {
    if (typeof type === 'string' && VALID_CLASSES.includes(type)) return type;
    return CLA_DATA.classNames[type] || (typeof type === 'string' ? type : 'Unknown');
  }

  function classCssFromType(type) {
    if (typeof type === 'string') return 'class-' + type.toLowerCase().replace(/ /g, '-');
    return CLA_DATA.classCssClass[type] || '';
  }

  function isValidClass(type) {
    return VALID_CLASSES.includes(classNameFromType(type));
  }

  /** Group reports by calendar date → each group = one "raid day" */
  function groupReportsByDate(reports) {
    const groups = new Map(); // dateKey → { reports: [], date, zone, ... }
    for (const r of reports) {
      const d = new Date(r.start);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!groups.has(dateKey)) {
        groups.set(dateKey, { dateKey, reports: [], start: r.start, zone: r.zone });
      }
      const g = groups.get(dateKey);
      g.reports.push(r);
      if (r.start < g.start) g.start = r.start;
    }
    return [...groups.values()];
  }

  // Settings IDs (dashboard gear dropdown)
  const SETTING_IDS = [
    'ds-setting-vanilla-enchants',
    'ds-setting-rare-gems',
    'ds-setting-epic-gems',
  ];

  // Keep SETTING_PAIRS for backward compat with loadSavedSettings
  const SETTING_PAIRS = SETTING_IDS.map(id => [id.replace('ds-', ''), id]);

  function getSettings() {
    return {
      vanillaEnchants: $('#ds-setting-vanilla-enchants').checked,
      rareGems: $('#ds-setting-rare-gems').checked,
      epicGems: $('#ds-setting-epic-gems').checked,
    };
  }

  function initSettingsSync() {
    for (const id of SETTING_IDS) {
      const el = $(`#${id}`);
      if (el) el.addEventListener('change', () => {
        // Persist to server (for remembering across sessions)
        apiFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisSettings: JSON.stringify(getSettings()) })
        }).catch(() => {});
        // Re-filter all views immediately (no reload needed — all data is pre-computed)
        filterGearByFight();
        if (currentBundle && currentBundle.analysis && currentBundle.analysis.buffs) renderBuffResults(currentBundle.analysis.buffs);
        const d = window._lastProgression;
        if (d) renderProgression(d.players, d.reportMeta, d.reportCount, d.weekCount, getSettings(), d.tmbRaidDays, d.tmbCharsByDayKey, d.tmbBenchedByDayKey, d.lootByPlayer, window._tmbRaidGroups, d.allWeeks);
        if (liveLastData) renderLiveView(liveLastData);
      });
    }
  }

  // ─── VIEW SWITCHING ───

  function switchView(viewId) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const el = $(`#${viewId}`);
    if (el) el.classList.add('active');
  }

  // ─── THEME ───

  function initTheme() {
    const saved = localStorage.getItem('cla-theme');
    if (saved === 'light') {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
      $('#theme-toggle').textContent = '\u{1F319}';
    }
    $('#theme-toggle').addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-mode');
      document.body.classList.toggle('dark-mode', !isDark);
      document.body.classList.toggle('light-mode', isDark);
      $('#theme-toggle').textContent = isDark ? '\u{1F319}' : '\u{2600}\u{FE0F}';
      localStorage.setItem('cla-theme', isDark ? 'light' : 'dark');
    });
  }

  // ─── TABS ───

  function initTabs() {
    // Report analysis tabs
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        const panel = $(`#${btn.dataset.tab}`);
        if (panel) panel.classList.add('active');
        // URL hash mit Tab synchronisieren — so dass Refresh/Share funktioniert
        if (reportCode) {
          const newHash = `#report/${reportCode}/${btn.dataset.tab}`;
          if (location.hash !== newHash) history.replaceState(null, '', newHash);
        }
      });
    });

    // Dashboard tabs
    function activateDashTab(tabId) {
      $$('.dash-tab-btn').forEach(b => b.classList.remove('active'));
      const btn = $(`.dash-tab-btn[data-dtab="${tabId}"]`);
      if (btn) btn.classList.add('active');
      $$('.dash-tab-panel').forEach(p => p.classList.remove('active'));
      const panel = $(`#${tabId}`);
      if (panel) panel.classList.add('active');
      if (tabId === 'dtab-stats' && !window._statsLoaded) loadAndRenderStats();
      if (tabId === 'dtab-edikt') loadEdikt();
      if (tabId === 'dtab-releasenotes') loadReleaseNotes();
      history.replaceState(null, '', '#' + tabId.replace('dtab-', ''));
    }
    $$('.dash-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => activateDashTab(btn.dataset.dtab));
    });
    // Hash tab activation is deferred until after loadGuild() completes
    // (skip #admin, #admin/..., #report/..., #player/... — andere Handler)
    const _hash = location.hash.replace('#', '');
    if (_hash.startsWith('admin') || _hash.startsWith('report/') || _hash.startsWith('player/')) {
      _pendingHashTab = '';
    } else {
      // Sanitize: nur einfache Tab-IDs (Buchstaben/Digits/Bindestrich), nichts mit Slash
      _pendingHashTab = /^[a-zA-Z0-9_-]+$/.test(_hash) ? _hash : '';
    }

    // Settings gear dropdown
    const gearBtn = $('#btn-settings-gear');
    const dropdown = $('#settings-dropdown');
    if (gearBtn && dropdown) {
      gearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== gearBtn) {
          dropdown.classList.add('hidden');
        }
      });
    }
  }

  // ─── SETUP ───

  function initSetup() {
    initSettingsSync();

    $('#btn-back-dashboard').addEventListener('click', () => switchView('view-dashboard'));
    $('#btn-player-back')?.addEventListener('click', () => { location.hash = ''; switchView('view-dashboard'); });
    $('#btn-bugs-back')?.addEventListener('click', () => { location.hash = ''; switchView('view-dashboard'); });
    $('#btn-bug-submit')?.addEventListener('click', submitBugTicket);
    $('#bugs-show-closed')?.addEventListener('change', loadBugTickets);
    $('#btn-refresh-guild').addEventListener('click', () => loadGuild(true));
    $('#btn-home').addEventListener('click', () => switchView('view-dashboard'));
    const btnHome2 = $('#btn-home-2');
    if (btnHome2) btnHome2.addEventListener('click', () => switchView('view-dashboard'));

    // Load saved settings and auto-load guild
    loadSavedSettings();
  }

  async function loadSavedSettings() {
    try {
      const resp = await apiFetch('/api/settings');
      if (!resp.ok) return;
      const saved = await resp.json();

      // Restore analysis settings checkboxes
      if (saved.analysisSettings) {
        const settings = JSON.parse(saved.analysisSettings);
        for (const [a, b] of SETTING_PAIRS) {
          const key = a.replace('setting-', '').replace(/-./g, m => m[1].toUpperCase());
          const val = settings[key];
          if (val !== undefined) {
            const elB = $(`#${b}`);
            if (elB) elB.checked = val;
          }
        }
      }

      // Auto-load guild
      if (saved.guildName && saved.serverName) {
        savedGuildName = saved.guildName;
        savedServerName = saved.serverName;
        savedRegion = saved.serverRegion || 'EU';
        // WCLApi still needed for legacy features (drums, SR, live ticker, progression)
        if (!api) api = new WCLApi();
        loadGuild();
        // Trigger live ticker now that guild data is available
        initLiveTicker();
      }
    } catch (e) {
      console.warn('Could not load settings:', e);
    }
  }

  // ─── GUILD LOADING ───

  async function loadGuild(forceRefresh) {
    window._statsLoaded = false;
    showLoading('Lade Gilden-Reports...');

    try {
      // Fetch pre-computed guild reports from server
      const resp = await apiFetch('/api/guild/reports' + (forceRefresh ? '?refresh=1' : ''));
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Keine Daten');
      }
      const data = await resp.json();
      guildReports = data.reports || [];
      savedGuildName = data.guildName || savedGuildName;
      savedServerName = data.serverName || savedServerName;
      savedRegion = data.region || savedRegion;

      // Sort by start date descending (newest first)
      guildReports.sort((a, b) => (b.start || 0) - (a.start || 0));

      // Render dashboard
      await renderDashboard(savedGuildName, savedServerName, savedRegion, forceRefresh);
      if (location.hash !== '#admin' && !location.hash.startsWith('#player/')) switchView('view-dashboard');
      hideLoading();

      // Kein Auto-Switch mehr auf den Live-Tab — Live-Dot in der Nav reicht als Indikator,
      // damit F5 immer die Seite zeigt auf der man gerade war.

      // Activate hash tab now that guild data is loaded
      if (_pendingHashTab && $(`#dtab-${_pendingHashTab}`)) {
        const tabBtn = $(`.dash-tab-btn[data-dtab="dtab-${_pendingHashTab}"]`);
        if (tabBtn) tabBtn.click();
      }

      // Auto-load Spieler-Entwicklung in background
      analyzeProgression(forceRefresh).catch(e => console.warn('Progression error:', e));
    } catch (err) {
      hideLoading();
      alert('Fehler beim Laden: ' + err.message);
      console.error(err);
    }
  }

  // Raid-Day-Key — basiert auf Wochentag (1=Mo .. 7=So).
  // Wird gegen raidSchedule abgeglichen.
  function getRaidDayKey(timestamp) {
    const d = new Date(timestamp);
    // Reports die zwischen 00:00 und 06:00 starten gehören logisch zum Vortag —
    // das ist ein Raid der spät startete oder dessen Logger nach Mitternacht hochkam.
    // (Niemand schedulet einen Raid um 02:00 morgens.)
    if (d.getHours() < 6) {
      const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000);
      const dow = prev.getDay();
      return dow === 0 ? 7 : dow;
    }
    const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return dow === 0 ? 7 : dow; // ISO-Weekday (1=Mo..7=So)
  }
  // Rückwärtskompatibel: Manche Code-Pfade nutzen noch 'mon'/'tue'/'thu' Strings.
  function getRaidDay(timestamp) {
    const k = getRaidDayKey(timestamp);
    return k === 1 ? 'mon' : k === 2 ? 'tue' : k === 4 ? 'thu' : k === 5 ? 'fri' : 'other';
  }
  const DAY_NAMES_DE = { 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag', 7: 'Sonntag' };


  // ─── Summary-Hero: letzter Raid auf einen Blick ───
  function renderRaidHero(tbcReports) {
    const el = $('#raid-hero');
    if (!el) return;
    if (!tbcReports.length) { el.innerHTML = ''; return; }
    // Reports des jüngsten Raid-Tags bündeln (Split-Logs)
    const sorted = tbcReports.slice().sort((a, b) => (b.start || 0) - (a.start || 0));
    const lastDay = new Date(sorted[0].start); lastDay.setHours(0,0,0,0);
    const dayReports = sorted.filter(r => { const d = new Date(r.start); d.setHours(0,0,0,0); return d.getTime() === lastDay.getTime(); });
    let kills = 0, wipes = 0, durMs = 0;
    const zones = new Set();
    for (const r of dayReports) {
      const z = CLA_DATA.zones[r.zone];
      if (z) zones.add(z.shortName || z.name || '');
      durMs += (r.end || 0) - (r.start || 0);
      for (const f of (r.fights || [])) {
        if (!f.boss || f.boss <= 0) continue;
        if (f.kill) kills++; else wipes++;
      }
    }
    // Vergleich: vorheriger Raid-Tag mit gleicher Zone
    let trendHtml = '';
    const prevDays = sorted.filter(r => { const d = new Date(r.start); d.setHours(0,0,0,0); return d.getTime() < lastDay.getTime(); });
    const prevSame = prevDays.find(r => zones.has((CLA_DATA.zones[r.zone] || {}).shortName || ''));
    if (prevSame) {
      const pd = new Date(prevSame.start); pd.setHours(0,0,0,0);
      const prevReports = prevDays.filter(r => { const d = new Date(r.start); d.setHours(0,0,0,0); return d.getTime() === pd.getTime() && zones.has((CLA_DATA.zones[r.zone] || {}).shortName || ''); });
      let pw = 0;
      for (const r of prevReports) for (const f of (r.fights || [])) { if (f.boss > 0 && !f.kill) pw++; }
      const diff = wipes - pw;
      if (diff !== 0) {
        const better = diff < 0;
        trendHtml = `<span class="hero-trend ${better ? 'up' : 'down'}">${better ? '▲' : '▼'} ${Math.abs(diff)} Wipes ${better ? 'weniger' : 'mehr'} als letztes Mal</span>`;
      } else {
        trendHtml = '<span class="hero-trend flat">— gleich viele Wipes wie letztes Mal</span>';
      }
    }
    const dur = durMs > 0 ? `${Math.floor(durMs / 3600000)}:${String(Math.floor((durMs % 3600000) / 60000)).padStart(2, '0')} h` : '–';
    const dateStr = lastDay.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    el.innerHTML = `
      <div class="raid-hero-card">
        <div class="raid-hero-label">Letzter Raid · ${escapeHtml(dateStr)} · ${escapeHtml([...zones].join(' + '))}</div>
        <div class="raid-hero-stats">
          <div class="hero-stat"><span class="hero-num kills">${kills}</span><span class="hero-cap">Kills</span></div>
          <div class="hero-stat"><span class="hero-num wipes">${wipes}</span><span class="hero-cap">Wipes</span></div>
          <div class="hero-stat"><span class="hero-num">${dur}</span><span class="hero-cap">Raidzeit</span></div>
        </div>
        ${trendHtml}
      </div>`;
  }

  async function renderDashboard(guildName, serverName, region, forceRefresh) {
    $('#guild-title').textContent = guildName;
    $('#guild-subtitle').textContent = `${serverName} (${region}) — ${guildReports.length} Reports`;

    // Raid-Schedule lesen (vom Branding-Endpoint geladen)
    const schedule = (window._branding && Array.isArray(window._branding.raidSchedule)) ? window._branding.raidSchedule : [];

    // Reports nach Day-of-Week + Size-Bucket bucketen
    const tbcReports = guildReports.filter(r => {
      const z = CLA_DATA.zones[r.zone];
      return z && z.tbc;
    });
    $('#guild-subtitle').textContent = `${serverName} (${region}) — ${tbcReports.length} TBC Reports`;
    renderRaidHero(tbcReports);

    // Schedule-Einträge → ein Bucket pro Eintrag
    const cardEntries = schedule.length ? schedule.slice() : [
      // Default falls keine Schedule konfiguriert: 25-Man-Container als Catch-All
      { dayOfWeek: 0, raidSize: 25, track: 'current' },
    ];
    // Eindeutige Größen aus Schedule (für 10er-Karte Fallback)
    const sizesInSchedule = new Set(cardEntries.map(e => e.raidSize));

    // Reports zu Schedule-Buckets matchen (Match auf dayOfWeek + raidSize)
    const bucketed = new Map(); // key: idx in cardEntries → Reports[]
    const unmatched10 = []; // 10-Mans die in keinem Bucket landen
    const unmatchedOther = []; // alle anderen Sizes ohne Schedule-Match (sonst silently dropped)
    for (const r of tbcReports) {
      const z = CLA_DATA.zones[r.zone];
      const size = z.size;
      const dow = getRaidDayKey(r.start);
      let matched = false;
      for (let i = 0; i < cardEntries.length; i++) {
        const e = cardEntries[i];
        if (e.raidSize === size && (e.dayOfWeek === dow || e.dayOfWeek === 0)) {
          if (!bucketed.has(i)) bucketed.set(i, []);
          bucketed.get(i).push(r);
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (size === 10) unmatched10.push(r);
        else unmatchedOther.push(r);
      }
    }

    // Fehlende Wochen berechnen (pro Card-Entry)
    function isoWeek(date) {
      const tmp = new Date(date.getTime());
      tmp.setHours(0,0,0,0);
      tmp.setDate(tmp.getDate() + 3 - (tmp.getDay() + 6) % 7);
      const week1 = new Date(tmp.getFullYear(), 0, 4);
      return `${tmp.getFullYear()}-W${String(Math.round(((tmp - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7) + 1).padStart(2,'0')}`;
    }
    function weekToDate(wk, dayOffset) {
      const parts = wk.match(/(\d+)-W(\d+)/);
      const yr = parseInt(parts[1]), wn = parseInt(parts[2]);
      const jan4 = new Date(yr, 0, 4);
      const mon = new Date(jan4.getTime());
      mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (wn - 1) * 7);
      const d = new Date(mon); d.setDate(mon.getDate() + dayOffset);
      return d;
    }
    const missingByCardIdx = new Map();
    for (let i = 0; i < cardEntries.length; i++) {
      const e = cardEntries[i];
      if (!e.dayOfWeek) continue; // Catch-All Bucket → keine Missing-Detection
      const reps = bucketed.get(i) || [];
      if (!reps.length) continue;
      const earliest = Math.min(...reps.map(r => r.start));
      const startDate = new Date(earliest);
      startDate.setHours(0,0,0,0);
      startDate.setDate(startDate.getDate() - (startDate.getDay() + 6) % 7);
      const now = new Date();
      const presentWeeks = new Set(reps.map(r => isoWeek(new Date(r.start))));
      const missing = [];
      const earliestDate = new Date(earliest); earliestDate.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 7)) {
        const wk = isoWeek(d);
        if (presentWeeks.has(wk)) continue;
        const dayOffset = e.dayOfWeek - 1; // ISO-Mo=0
        const expectedDate = weekToDate(wk, dayOffset);
        if (expectedDate >= earliestDate && expectedDate < today) {
          missing.push({ week: wk, date: expectedDate });
        }
      }
      missingByCardIdx.set(i, missing);
    }

    // TMB-Daten holen + mit fehlenden Wochen anreichern
    let tmbData = null;
    try {
      const tmbResp = await apiFetch('/api/tmb/attendance' + (forceRefresh ? '?refresh=1' : ''));
      if (tmbResp.ok) tmbData = await tmbResp.json();
    } catch (e) { console.warn('TMB fetch failed:', e); }
    if (tmbData && tmbData.raids) {
      const tmbByDateKey = new Map();
      for (const r of tmbData.raids) {
        const d = new Date(r.date.replace(' ', 'T') + 'Z');
        const dk = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
        tmbByDateKey.set(`${dk}|${dow}`, r);
      }
      for (const [idx, missList] of missingByCardIdx) {
        const e = cardEntries[idx];
        for (const m of missList) {
          const dk = `${m.date.getFullYear()}-${String(m.date.getMonth()+1).padStart(2,'0')}-${String(m.date.getDate()).padStart(2,'0')}`;
          const tmb = tmbByDateKey.get(`${dk}|${e.dayOfWeek}`);
          if (tmb) m.tmb = tmb;
        }
      }
    }

    // TMB Loot + Raid Groups parallel
    let tmbLoot = null, tmbRaidGroups = null;
    try {
      const [lootResp, rgResp] = await Promise.all([
        apiFetch('/api/tmb/loot' + (forceRefresh ? '?refresh=1' : '')),
        apiFetch('/api/tmb/raidgroups' + (forceRefresh ? '?refresh=1' : ''))
      ]);
      if (lootResp.ok) tmbLoot = await lootResp.json();
      if (rgResp.ok) tmbRaidGroups = await rgResp.json();
    } catch (e) { console.warn('TMB fetch failed:', e); }
    window._tmbAttendance = tmbData;
    window._tmbLoot = tmbLoot;
    window._tmbRaidGroups = tmbRaidGroups;

    // Cards-Container dynamisch befüllen
    const cardsHost = $('#raid-day-cards');
    if (cardsHost) {
      cardsHost.innerHTML = cardEntries.map((e, i) => {
        const dayName = e.dayOfWeek ? DAY_NAMES_DE[e.dayOfWeek] : 'Alle Tage';
        const trackLabel = e.track === 'legacy' ? ' <small class="text-muted">(Altcontent)</small>' : '';
        return `<div class="raid-card">
          <div class="raid-card-header">
            <span class="raid-card-icon">&#9876;</span>
            <span>${e.raidSize}-Man — ${escapeHtml(dayName)}${trackLabel}</span>
          </div>
          <div class="raid-card-body">
            <div id="reports-card-${i}"></div>
            <p id="no-reports-card-${i}" class="text-muted hidden">Keine ${escapeHtml(dayName)}-Reports gefunden.</p>
          </div>
        </div>`;
      }).join('');
    }
    for (let i = 0; i < cardEntries.length; i++) {
      await renderReportTables(`#reports-card-${i}`, bucketed.get(i) || [], `#no-reports-card-${i}`, true, missingByCardIdx.get(i));
    }

    // Übrige Raid-Sizes (die nicht in raidSchedule sind) → eigene Cards
    const otherHost = $('#raid-other-cards');
    if (otherHost) {
      // 10-Man Default-Card (immer anzeigen wenn 10er Reports existieren und 10er nicht in schedule)
      let html = '';
      if (unmatched10.length && !sizesInSchedule.has(10)) {
        html += `<div class="raid-card" style="margin-top:24px"><div class="raid-card-header"><span class="raid-card-icon">&#9876;</span><span>10-Man Raids</span></div><div class="raid-card-body"><div id="reports-other-10"></div><p id="no-reports-other-10" class="text-muted hidden">Keine 10er Reports gefunden.</p></div></div>`;
      }
      otherHost.innerHTML = html;
      if (unmatched10.length && !sizesInSchedule.has(10)) {
        await renderReportTables('#reports-other-10', unmatched10, '#no-reports-other-10');
      }
    }
    // „Sonstige"-Karte für Reports die in keinen Schedule-Slot passen und nicht 10er sind
    if (unmatchedOther.length) {
      const sec = $('#section-other');
      if (sec) sec.classList.remove('hidden');
      await renderReportTables('#reports-other', unmatchedOther, null, true);
    } else {
      hide('#section-other');
    }
  }

  function renderReportTables(containerId, reports, emptyMsgId, groupByDate, missingWeeks) {
    const container = $(containerId);
    if (!reports.length) {
      container.innerHTML = '';
      if (emptyMsgId) show(emptyMsgId);
      return;
    }
    if (emptyMsgId) hide(emptyMsgId);

    // Use pre-computed fight data from server (included in guild reports response)
    const minSize = groupByDate ? 25 : 0;
    const fightMap = new Map();
    for (const r of reports) {
      const fights = (r.fights || []).filter(f => f.boss && f.boss > 0 && (!minSize || (f.size || 0) >= minSize));
      fightMap.set(r.id, fights);
    }

    // Group by date+zone for 25-man (split logs of the SAME raid get merged,
    // aber unterschiedliche Zones am gleichen Tag bleiben separat), oder
    // keep individual for 10-man.
    // ZUSÄTZLICH: zwei Raids derselben Zone am gleichen Tag werden getrennt
    // wenn beide einen Kill des selben Bosses enthalten (z.B. 2× Gruul/Mag
    // hintereinander) ODER wenn der Zeitabstand zwischen den Reports > 90 min
    // beträgt (split-Logs sind typischerweise nur Sekunden auseinander).
    const rows = [];
    if (groupByDate) {
      const RAID_GAP_THRESHOLD_MS = 90 * 60 * 1000;
      // 1) coarse: gleicher Tag + gleiche Zone
      const coarseByKey = new Map();
      const coarseGroups = [];
      for (const r of reports) {
        const d = new Date(r.start);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const key = `${dateKey}|${r.zone}`;
        if (!coarseByKey.has(key)) {
          const g = { dateKey, reports: [], zone: r.zone };
          coarseByKey.set(key, g);
          coarseGroups.push(g);
        }
        coarseByKey.get(key).reports.push(r);
      }
      // 2) split jede coarse-Gruppe in Sub-Raids anhand Kill-Konflikten + Zeit-Gap
      const allGroups = [];
      for (const coarse of coarseGroups) {
        const sorted = coarse.reports.slice().sort((a, b) => a.start - b.start);
        let current = null;
        for (const r of sorted) {
          const fights = fightMap.get(r.id) || [];
          const killBosses = new Set(fights.filter(f => f.kill).map(f => f.boss));
          const reportEnd = r.end || (r.start + (Math.max(...fights.map(f => f.end_time || 0), 0)));
          let mustSplit = false;
          if (current) {
            // Parallel-Logs derselben Session: zweiter Report startet, während current noch läuft
            // → nicht splitten egal ob Kill-Konflikt (verschiedene Logger desselben Raids loggen
            // identische Kills, das ist KEIN zweiter Raid).
            const overlapsWithCurrent = r.start < current.endTime;
            if (!overlapsWithCurrent) {
              // Kill-Konflikt: gleicher Boss bereits gekillt in current
              for (const b of killBosses) {
                if (current.killedBosses.has(b)) { mustSplit = true; break; }
              }
              // Zeit-Gap zu groß
              if (!mustSplit && (r.start - current.endTime) > RAID_GAP_THRESHOLD_MS) {
                mustSplit = true;
              }
            }
          }
          if (!current || mustSplit) {
            current = {
              dateKey: coarse.dateKey, zone: coarse.zone,
              reports: [], start: r.start, endTime: reportEnd,
              killedBosses: new Set(),
            };
            allGroups.push(current);
          }
          current.reports.push(r);
          if (r.start < current.start) current.start = r.start;
          if (reportEnd > current.endTime) current.endTime = reportEnd;
          for (const b of killBosses) current.killedBosses.add(b);
        }
      }
      const dayGroups = allGroups;
      dayGroups.sort((a, b) => b.start - a.start);
      for (const group of dayGroups) {
        const reps = group.reports;
        let minStart = Infinity, maxEnd = 0;
        const titles = new Set();
        const loggers = new Set();
        // Deduplicate fights across split logs — Key inkl. start_time, damit
        // mehrere Wipes am gleichen Boss nicht fälschlich zu einem werden.
        const seenFights = new Set();
        let totalKills = 0, totalWipes = 0;
        for (const r of reps) {
          const fights = fightMap.get(r.id) || [];
          for (const f of fights) {
            const key = `${f.boss}_${f.kill}_${f.name}_${f.start_time}`;
            if (seenFights.has(key)) continue;
            seenFights.add(key);
            if (f.kill) totalKills++; else totalWipes++;
          }
          // Use filtered fight timestamps for duration (more accurate than report start/end)
          for (const f of fights) {
            const fStart = r.start + (f.start_time || 0);
            const fEnd = r.start + (f.end_time || 0);
            if (fStart < minStart) minStart = fStart;
            if (fEnd > maxEnd) maxEnd = fEnd;
          }
          titles.add(r.title || r.id);
          if (r.owner) loggers.add(r.owner);
        }
        rows.push({
          code: reps[0].id, zone: group.zone, start: group.start,
          kills: totalKills, wipes: totalWipes,
          dur: (minStart < Infinity && maxEnd > 0) ? CLA_DATA.formatDuration(maxEnd - minStart) : '',
          title: [...titles].join(' / '),
          loggers: [...loggers].join(', '),
          multi: reps.length > 1 ? reps.length : 0,
        });
      }
    } else {
      const sorted = [...reports].sort((a, b) => (b.start || 0) - (a.start || 0));
      for (const r of sorted) {
        const fights = fightMap.get(r.id) || [];
        // Use fight timestamps for duration (more accurate than report start/end)
        let fMin = Infinity, fMax = 0;
        for (const f of fights) {
          const fStart = r.start + (f.start_time || 0);
          const fEnd = r.start + (f.end_time || 0);
          if (fStart < fMin) fMin = fStart;
          if (fEnd > fMax) fMax = fEnd;
        }
        rows.push({
          code: r.id, zone: r.zone, start: r.start,
          kills: fights.filter(f => f.kill).length,
          wipes: fights.filter(f => !f.kill).length,
          dur: (fMin < Infinity && fMax > 0) ? CLA_DATA.formatDuration(fMax - fMin) : ((r.start && r.end) ? CLA_DATA.formatDuration(r.end - r.start) : ''),
          title: r.title || r.id,
          loggers: r.owner || '',
          multi: 0,
        });
      }
    }

    // Add missing weeks as placeholder rows
    if (missingWeeks && missingWeeks.length) {
      for (const m of missingWeeks) {
        rows.push({ missing: true, start: m.date.getTime(), week: m.week, tmb: m.tmb || null });
      }
      rows.sort((a, b) => (b.start || 0) - (a.start || 0));
    }

    const VISIBLE_LIMIT = 5;
    const expandId = 'rl-expand-' + Math.random().toString(36).slice(2, 9);
    let html = `
      <table class="report-list-table">
        <thead><tr>
          <th>Datum</th><th>Raid</th><th>Dauer</th><th>Kills</th><th>Wipes</th>
        </tr></thead>
        <tbody>`;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const hidden = ri >= VISIBLE_LIMIT ? ` report-row-extra ${expandId} hidden` : '';
      if (row.missing) {
        const date = fmtDate(row.start);
        if (row.tmb) {
          const count = row.tmb.characters.filter(c => !c.isAlt).length;
          html += `
          <tr class="report-row row-missing row-tmb${hidden}">
            <td>${date}</td>
            <td colspan="4" class="text-muted">Log fehlt — TMB: ${count} Spieler</td>
          </tr>`;
        } else {
          html += `
          <tr class="report-row row-missing${hidden}">
            <td>${date}</td>
            <td colspan="4" class="text-muted">Log fehlt</td>
          </tr>`;
        }
        continue;
      }
      const zone = CLA_DATA.zones[row.zone] || { name: 'Unbekannt', short: '?', color: '#666' };
      const date = row.start ? fmtDate(row.start) : '?';
      html += `
          <tr class="report-row${hidden}" data-code="${row.code}" style="--zone-color:${zone.color}">
            <td>${date}</td>
            <td><span class="zone-badge" style="background:${zone.color}22;color:${zone.color}">${zone.short}</span>${row.multi ? ` <small class="text-muted" title="${escapeHtml(row.loggers)}">(${row.multi})</small>` : ''}</td>
            <td>${row.dur}</td>
            <td>${row.kills > 0 ? `<span class="badge-kill">${row.kills}</span>` : '—'}</td>
            <td>${row.wipes > 0 ? `<span class="badge-wipe">${row.wipes}</span>` : '—'}</td>
          </tr>`;
    }

    html += `</tbody></table>`;
    if (rows.length > VISIBLE_LIMIT) {
      const extra = rows.length - VISIBLE_LIMIT;
      html += `<button class="btn btn-sm report-list-expand" data-expand="${expandId}" style="margin-top:6px">${extra} weitere anzeigen &#9660;</button>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.report-row[data-code]').forEach(row => {
      row.addEventListener('click', () => openReport(row.dataset.code));
    });
    const expandBtn = container.querySelector('.report-list-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        const id = expandBtn.dataset.expand;
        container.querySelectorAll('.' + id).forEach(tr => tr.classList.remove('hidden'));
        expandBtn.remove();
      });
    }
  }

  // Raid week: Wednesday to Tuesday. Shift date back 2 days so Wed→Mon, then use ISO week.
  function isoWeekOf(date) {
    const tmp = new Date(date.getTime());
    tmp.setHours(0,0,0,0);
    tmp.setDate(tmp.getDate() - 2); // shift so Wednesday = Monday (ISO week start)
    tmp.setDate(tmp.getDate() + 3 - (tmp.getDay() + 6) % 7);
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    return `${tmp.getFullYear()}-W${String(Math.round(((tmp - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7) + 1).padStart(2,'0')}`;
  }

  function fmtDate(ts) { const d = new Date(ts); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`; }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderPlayerName(name) {
    const link = `<a href="#player/${encodeURIComponent(name)}" class="player-link">`;
    const end = '</a>';
    const eggs = (window._branding && window._branding.easterEggs) || [];
    const egg = eggs.find(e => e && e.name === name);
    if (egg) {
      const safeName = escapeHtml(name);
      if (egg.type === 'wobble' && egg.alt) {
        const alt = escapeHtml(egg.alt);
        return `${link}<span class="egg-wobble" data-orig="${safeName}" data-alt="${alt}" onmouseenter="this.textContent=this.dataset.alt" onmouseleave="this.textContent=this.dataset.orig">${safeName}</span>${end}`;
      }
      if (egg.type === 'popup' && egg.text) {
        return `${link}<span class="egg-popup"><span class="egg-popup-name">${safeName}</span><span class="egg-popup-text">${escapeHtml(egg.text)}</span></span>${end}`;
      }
      if (egg.type === 'girly') {
        return `${link}<span class="egg-girly" onmouseenter="document.body.classList.add('girly-mode','girly-cursor')" onmouseleave="document.body.classList.remove('girly-mode','girly-cursor')">${safeName}</span>${end}`;
      }
      if (egg.type === 'letterswap') {
        // Letterswap → CSS-Animation, swappt einen Buchstaben per Hover
        return `${link}<span class="egg-letterswap"><span class="egg-letterswap-name">N<span class="egg-letterswap-orig">i</span><span class="egg-letterswap-alt">a</span>sali</span></span>${end}`;
      }
      if (egg.type === 'slacker-wobble' && egg.alt) {
        const alt = escapeHtml(egg.alt);
        return `${link}<span class="egg-slacker-wobble" data-orig="${safeName}" data-alt="${alt}" onmouseenter="this.firstChild.textContent=this.dataset.alt" onmouseleave="this.firstChild.textContent=this.dataset.orig"><span>${safeName}</span></span>${end}`;
      }
    }
    return `${link}${escapeHtml(name)}${end}`;
  }


  // ─── SINGLE REPORT (direct input) ───

  // ─── OPEN REPORT (analysis view) ───

  async function openReport(code, targetTab) {
    reportCode = code;
    showLoading('Lade Report...');
    // URL synchronisieren (so dass Refresh / Share funktioniert)
    const desiredHash = targetTab ? `#report/${code}/${targetTab}` : `#report/${code}`;
    if (location.hash !== desiredHash) {
      history.replaceState(null, '', desiredHash);
    }

    // Clear previous analysis results immediately
    const loadingPlaceholder = '<p class="text-muted auto-loading">Wird geladen...</p>';
    $('#buffs-results').innerHTML = loadingPlaceholder;
    $('#consumables-results').innerHTML = loadingPlaceholder;
    $('#gear-results').innerHTML = loadingPlaceholder;
    $('#spellranks-results').innerHTML = loadingPlaceholder;
    hide('#buffs-status'); hide('#consumables-status'); hide('#gear-status'); hide('#spellranks-status');

    try {
      // Fetch pre-computed report bundle from server
      const resp = await apiFetch(`/api/report/${code}`);
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Report nicht verfuegbar');
      }
      const bundle = await resp.json();
      currentBundle = bundle;

      // Set state from bundle
      reportData = bundle.meta;
      bossFights = bundle.fights || [];
      playerList = bundle.players || [];

      // Show report info
      const title = reportData.title || 'Unbekannt';
      const zone = reportData.zone ? (CLA_DATA.zones[reportData.zone] || { name: 'Unbekannte Zone' }).name : 'Unbekannte Zone';
      const start = reportData.start ? CLA_DATA.formatDate(reportData.start) : '';
      $('#report-info').innerHTML = `<strong>${escapeHtml(title)}</strong> — ${zone} — ${start} — ` +
        `<small>${bossFights.length} Boss-Fights, ${playerList.length} Spieler</small>`;

      populateFightSelectors();
      showFightsOverview();
      switchView('view-analysis');

      // Tab: targetTab oder default fights
      const tabId = targetTab && document.querySelector(`.tab-btn[data-tab="${targetTab}"]`) ? targetTab : 'tab-fights';
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      $(`#${tabId}`)?.classList.add('active');

      hideLoading();

      // Render pre-computed analysis results
      const analysis = bundle.analysis || {};

      if (analysis.gear) {
        filterGearByFight();
        setStatus('#gear-status', 'Gear-Analyse geladen.');
      } else {
        $('#gear-results').innerHTML = '<p class="text-muted">Gear-Analyse noch nicht verfuegbar.</p>';
      }

      if (analysis.buffs) {
        renderBuffResults(analysis.buffs);
        setStatus('#buffs-status', 'Buff-Analyse geladen.');
      } else {
        $('#buffs-results').innerHTML = '<p class="text-muted">Buff-Analyse noch nicht verfuegbar.</p>';
      }

      if (analysis.consumables) {
        renderConsumableResults(analysis.consumables, analysis.consumablesTrash);
        setStatus('#consumables-status', 'Consumable-Analyse geladen.');
      } else {
        $('#consumables-results').innerHTML = '<p class="text-muted">Consumable-Analyse noch nicht verfuegbar.</p>';
      }

      if (analysis.spellranks) {
        filterSpellRanksByFight();
        setStatus('#spellranks-status', 'Spell-Rank-Analyse geladen.');
      } else {
        $('#spellranks-results').innerHTML = '<p class="text-muted">Spell-Rank-Analyse noch nicht verfuegbar.</p>';
      }

      if (analysis.avoidable) {
        filterAvoidableByFight();
      } else {
        $('#avoidable-results').innerHTML = '<p class="text-muted">Avoidable-Damage-Analyse noch nicht verfuegbar.</p>';
      }

      // Trinket-Usage Tab
      if (analysis.trinkets) {
        renderTrinketResults(analysis.trinkets);
      } else {
        $('#trinkets-results').innerHTML = '<p class="text-muted">Trinket-Analyse noch nicht verfügbar.</p>';
      }

      // Cooldown-Usage Tab
      if (analysis.cooldowns) {
        renderCooldownResults(analysis.cooldowns);
      } else {
        $('#cooldowns-results').innerHTML = '<p class="text-muted">CD-Analyse noch nicht verfügbar.</p>';
      }

      // Wipe-Analyse Tab
      if (analysis.wipes && analysis.wipes.length) {
        renderReportWipes(analysis.wipes, reportData);
      } else {
        $('#wipes-results').innerHTML = '<p class="text-muted">Analyse noch nicht verfügbar. Pre-Analyzer hat sie noch nicht gerechnet.</p>';
      }

    } catch (err) {
      hideLoading();
      alert('Fehler: ' + err.message);
      console.error(err);
    }
  }

  // ─── CLIENT-SIDE FILTERING (pre-computed data only) ───

  // Shared issue filter based on current settings
  function filterIssuesBySettings(issues, settings) {
    return (issues || []).filter(iss => {
      // Vanilla enchants: if allowed, hide vanilla enchant issues
      if (settings.vanillaEnchants && iss.isVanillaEnchant) return false;
      // Gem quality: only show if matching setting
      if (iss.gemQuality) {
        if (settings.epicGems) return true; // show all non-epic gems
        if (settings.rareGems) return iss.gemQuality === 'uncommon' || iss.gemQuality === 'common';
        return false; // no gem quality setting active — hide gem quality issues
      }
      return true;
    });
  }

  function filterGearByFight() {
    if (!currentBundle || !currentBundle.analysis || !currentBundle.analysis.gear) return;
    const showAll = $('#gear-show-all').checked;
    const hideOffspec = $('#gear-hide-offspec')?.checked;
    const settings = getSettings();
    const gearData = currentBundle.analysis.gear;
    const rawResults = gearData.results || gearData;

    // Build global main-role per player: manual override > progression auto-detect
    const globalMainRole = new Map();
    if (hideOffspec && window._lastProgression) {
      for (const p of window._lastProgression.players) {
        const r = p.mainRole || 'DD';
        globalMainRole.set(p.name, r === 'Tank' ? 'tank' : r === 'Heal' ? 'healer' : 'dps');
      }
    }
    // Apply manual role overrides (from admin panel)
    const roleOverrides = window._playerRoleOverrides || {};
    for (const [name, role] of Object.entries(roleOverrides)) {
      globalMainRole.set(name, role);
    }

    const results = rawResults.map(r => {
      if (hideOffspec && r.perFight && r.perFight.length && globalMainRole.has(r.name)) {
        // Merge issues only from fights matching main role
        const mainRole = globalMainRole.get(r.name);
        const issueMap = {};
        let metaInactiveCount = 0, totalFights = 0;
        for (const pf of r.perFight) {
          const fRole = pf.role.includes(':tank') ? 'tank' : pf.role.includes(':healer') ? 'healer' : 'dps';
          if (fRole !== mainRole) continue;
          totalFights++;
          for (const iss of pf.issues) {
            const key = iss.slot + '|' + iss.issue;
            if (!issueMap[key]) issueMap[key] = iss;
          }
        }
        if (totalFights === 0) {
          // No mainspec fights in this report → hide entirely
          return { ...r, issues: [], issueCount: 0, _offspecOnly: true };
        }
        const mainIssues = filterIssuesBySettings(Object.values(issueMap), settings);
        return { ...r, issues: mainIssues, issueCount: mainIssues.length, _offspecOnly: false };
      }
      const filtered = filterIssuesBySettings(r.issues, settings);
      return { ...r, issues: filtered, issueCount: filtered.length, _offspecOnly: false };
    });

    let visible = results;
    if (!showAll) visible = visible.filter(r => r.issues && r.issues.length > 0);
    if (hideOffspec) visible = visible.filter(r => !r._offspecOnly);
    renderGearResults(visible, showAll);
  }

  function filterSpellRanksByFight() {
    if (!currentBundle || !currentBundle.analysis || !currentBundle.analysis.spellranks) return;
    const fightIdx = $('#spellranks-fight-select').value;
    const hideHealers = $('#spellranks-hide-healers').checked;
    const allData = currentBundle.analysis.spellranks;

    let data = allData;

    // Filter to specific fight
    if (fightIdx !== 'all' && fightIdx !== '') {
      const fi = parseInt(fightIdx);
      const fight = bossFights[fi];
      if (!fight) return;
      data = {};
      for (const [name, d] of Object.entries(allData)) {
        const fightIssues = d.issues.filter(iss => iss.fightName === fight.name);
        if (fightIssues.length) data[name] = { ...d, issues: fightIssues };
      }
    }

    // Filter out healers + healer spells (even from non-healer players like feral druids)
    if (hideHealers) {
      const HEALER_SPELLS = /^(Rejuvenation|Regrowth|Healing Touch|Lifebloom|Tranquility|Swiftmend|Lesser Heal|Heal|Greater Heal|Flash Heal|Prayer of Healing|Prayer of Mending|Circle of Healing|Renew|Power Word: Shield|Binding Heal|Holy Light|Flash of Light|Holy Shock|Healing Wave|Lesser Healing Wave|Chain Heal|Earth Shield)$/i;
      const filtered = {};
      for (const [name, d] of Object.entries(data)) {
        if (d.isHealer) continue; // skip full healers
        const nonHealerIssues = d.issues.filter(iss => !HEALER_SPELLS.test(iss.spell));
        if (nonHealerIssues.length) filtered[name] = { ...d, issues: nonHealerIssues };
      }
      data = filtered;
    }

    renderSpellRankResults(data, fightIdx === 'all' || fightIdx === '');
  }

  // ─── Avoidable Damage ───

  function filterAvoidableByFight() {
    if (!currentBundle || !currentBundle.analysis || !currentBundle.analysis.avoidable) return;
    const fightIdx = $('#avoidable-fight-select').value;
    const allData = currentBundle.analysis.avoidable;

    let fights = allData;
    if (fightIdx !== 'all' && fightIdx !== '') {
      const fi = parseInt(fightIdx);
      const fight = bossFights[fi];
      if (!fight) return;
      fights = allData.filter(f => f.fightId === fight.id);
    }
    renderAvoidableResults(fights, fightIdx === 'all' || fightIdx === '');
  }

  function renderAvoidableResults(fights, showFightName) {
    const container = $('#avoidable-results');
    if (!fights || !fights.length) {
      container.innerHTML = '<p class="text-muted">Keine Avoidable-Damage-Daten.</p>';
      return;
    }

    // Aggregate across fights: player → { abilities, debuffs, totalDamage }
    const agg = new Map();
    for (const f of fights) {
      for (const p of (f.players || [])) {
        if (!agg.has(p.name)) agg.set(p.name, { name: p.name, type: p.type, totalDamage: 0, abilities: {}, debuffs: {}, fights: {} });
        const a = agg.get(p.name);
        a.totalDamage += p.totalDamage || 0;
        // Merge abilities
        for (const [abilName, abil] of Object.entries(p.abilities || {})) {
          if (!a.abilities[abilName]) a.abilities[abilName] = { total: 0, hits: 0, resists: 0 };
          a.abilities[abilName].total += abil.total;
          a.abilities[abilName].hits += abil.hits;
          a.abilities[abilName].resists += abil.resists || 0;
        }
        // Merge debuffs
        for (const [debName, count] of Object.entries(p.debuffs || {})) {
          if (!a.debuffs[debName]) a.debuffs[debName] = 0;
          a.debuffs[debName] += count;
        }
        // Per-fight breakdown (with ability details)
        a.fights[f.fightName] = { totalDamage: p.totalDamage, kill: f.kill, abilities: p.abilities || {}, debuffs: p.debuffs || {} };
      }
    }

    if (!agg.size) {
      container.innerHTML = '<p class="text-muted">Kein Avoidable Damage in diesen Fights.</p>';
      return;
    }

    // Collect all unique ability names across all players
    const allAbilities = new Set();
    for (const p of agg.values()) {
      for (const abilName of Object.keys(p.abilities)) allAbilities.add(abilName);
    }
    const abilityList = [...allAbilities].sort();

    const sorted = [...agg.values()].sort((a, b) => b.totalDamage - a.totalDamage);
    const fmtNum = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString();

    // Collect debuff columns
    const allDebuffs = new Set();
    for (const p of agg.values()) for (const d of Object.keys(p.debuffs)) allDebuffs.add(d);
    const debuffList = [...allDebuffs].sort();

    let html = '<table class="results-table buff-table"><thead><tr>';
    html += '<th>Spieler</th><th>Klasse</th><th>Gesamt</th>';
    for (const abil of abilityList) html += `<th title="${escapeHtml(abil)}">${escapeHtml(abil)}</th>`;
    for (const deb of debuffList) html += `<th title="${escapeHtml(deb)} (Debuff)">${escapeHtml(deb)}</th>`;
    html += '</tr></thead><tbody>';

    for (let ri = 0; ri < sorted.length; ri++) {
      const p = sorted[ri];
      const css = classCssFromType(p.type);
      const cn = classNameFromType(p.type);
      const hasFights = showFightName && Object.keys(p.fights).length > 1;

      html += `<tr class="buff-summary-row${hasFights ? ' expandable' : ''}" data-avoid-idx="${ri}">`;
      html += `<td class="${css}">${hasFights ? '<span class="expand-arrow">&#9654;</span> ' : ''}${renderPlayerName(p.name)}</td>`;
      html += `<td class="${css}">${cn}</td>`;
      html += `<td><strong>${fmtNum(p.totalDamage)}</strong></td>`;
      for (const abil of abilityList) {
        const a = p.abilities[abil];
        if (a) {
          if (a.total === 0 && a.hits > 0) {
            html += `<td><span class="avoid-resisted" title="LUCKER!!!!">resisted</span> <small>(${a.hits}x)</small></td>`;
          } else {
            const resistTxt = a.resists ? `, ${a.resists} resisted` : '';
            html += `<td title="${a.total.toLocaleString('de-DE')} damage, ${a.hits} hits${resistTxt}"><span class="buff-miss">${fmtNum(a.total)}</span> <small>(${a.hits - (a.resists||0)}x${a.resists ? ` + <span class="avoid-resisted" title="LUCKER!!!!">${a.resists} resisted</span>` : ''})</small></td>`;
          }
        } else {
          html += '<td></td>';
        }
      }
      for (const deb of debuffList) {
        const count = p.debuffs[deb];
        if (count) {
          html += `<td><span class="buff-miss">${count}x</span></td>`;
        } else {
          html += '<td></td>';
        }
      }
      html += '</tr>';

      // Per-fight breakdown rows
      if (hasFights) {
        for (const [fName, fd] of Object.entries(p.fights)) {
          if (!fd.totalDamage) continue;
          const fCss = fd.kill ? 'kill-badge' : 'wipe-badge';
          const fResult = fd.kill ? 'Kill' : 'Wipe';
          html += `<tr class="buff-detail-row hidden" data-avoid-parent="${ri}">`;
          html += `<td class="detail-fight-name" colspan="2"><span class="text-muted">&nbsp;&nbsp;</span>${escapeHtml(fName)} <span class="${fCss}">${fResult}</span></td>`;
          html += `<td>${fmtNum(fd.totalDamage)}</td>`;
          for (const abil of abilityList) {
            const a = fd.abilities && fd.abilities[abil];
            if (!a) {
              html += '<td></td>';
            } else if (a.total === 0 && a.hits > 0) {
              html += `<td><span class="avoid-resisted" title="LUCKER!!!!">resisted</span> <small>(${a.hits}x)</small></td>`;
            } else {
              html += `<td><span class="buff-miss">${fmtNum(a.total)}</span> <small>(${a.hits}x)</small></td>`;
            }
          }
          for (const deb of debuffList) {
            const count = fd.debuffs && fd.debuffs[deb];
            html += count ? `<td><span class="buff-miss">${count}x</span></td>` : '<td></td>';
          }
          html += '</tr>';
        }
      }
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Expand/collapse
    container.querySelectorAll('.buff-summary-row.expandable').forEach(row => {
      row.addEventListener('click', () => {
        const idx = row.dataset.avoidIdx;
        const expanded = row.classList.toggle('expanded');
        const arrow = row.querySelector('.expand-arrow');
        if (arrow) arrow.innerHTML = expanded ? '&#9660;' : '&#9654;';
        container.querySelectorAll(`.buff-detail-row[data-avoid-parent="${idx}"]`).forEach(dr => {
          dr.classList.toggle('hidden', !expanded);
        });
      });
    });
  }

  function renderCooldownResults(data) {
    const container = $('#cooldowns-results');
    if (!data || !data.players || !data.players.length) {
      container.innerHTML = '<p class="text-muted">Keine CD-Daten.</p>';
      return;
    }
    const cdDefs = data.cdDefs || {};
    const fights = data.fights || [];
    const fightCount = fights.length;
    const active = data.players.filter(p => Object.values(p.total || {}).reduce((s,v) => s+v, 0) > 0);
    if (!active.length) {
      container.innerHTML = '<p class="text-muted">Niemand hat einen großen CD gepoppt.</p>';
      return;
    }
    active.sort((a, b) => {
      const ta = Object.values(a.total).reduce((s,v) => s+v, 0);
      const tb = Object.values(b.total).reduce((s,v) => s+v, 0);
      return tb - ta;
    });
    const totalCasts = active.reduce((s, p) => s + Object.values(p.total).reduce((s2, v) => s2 + v, 0), 0);
    const roleColor = { dps: '#f87171', tank: '#60a5fa', heal: '#34d399', any: '#fbbf24' };
    const roleLabel = { dps: 'DMG', tank: 'TANK', heal: 'HELP', any: 'ANY' };

    let html = `<div class="cons-summary-meta">${active.length} Spieler · ${totalCasts} CD-Casts gesamt · ${fightCount} Fights</div>`;
    html += '<table class="results-table cons-summary-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>CD</th><th>Role</th><th>Σ Casts</th><th>Casts/Fight</th></tr></thead><tbody>';
    for (const p of active) {
      const css = classCssFromType(p.type);
      const cn = classNameFromType(p.type);
      const entries = Object.entries(p.total).sort((a, b) => b[1] - a[1]);
      for (let ti = 0; ti < entries.length; ti++) {
        const [cdKey, count] = entries[ti];
        const def = cdDefs[cdKey] || { name: cdKey, role: 'any', spellId: 0 };
        const eligible = (p.eligibleFights && p.eligibleFights[cdKey]) || 0;
        const denom = eligible > 0 ? eligible : fightCount;
        const perFight = (count / denom).toFixed(2);
        const eligLabel = eligible > 0 ? `${eligible} Fights als ${def.role}` : `${fightCount} Fights gesamt`;
        const roleBadge = `<span class="cd-role-pill" style="background:${roleColor[def.role] || '#888'}22;color:${roleColor[def.role] || '#888'};border:1px solid ${roleColor[def.role] || '#888'}55">${roleLabel[def.role] || def.role.toUpperCase()}</span>`;
        const cdNameHtml = def.spellId
          ? `<a href="https://www.wowhead.com/tbc/spell=${def.spellId}" data-wowhead="spell=${def.spellId}">${escapeHtml(def.name)}</a>`
          : escapeHtml(def.name);
        html += '<tr>';
        if (ti === 0) html += `<td class="${css}" rowspan="${entries.length}">${renderPlayerName(p.name)}</td><td class="${css}" rowspan="${entries.length}">${cn}</td>`;
        html += `<td>${cdNameHtml}</td>`;
        html += `<td>${roleBadge}</td>`;
        html += `<td><span class="raid-cons-total">${count}</span></td>`;
        html += `<td title="${eligLabel}"><span class="text-muted">${perFight}</span></td>`;
        html += '</tr>';
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderTrinketResults(data) {
    const container = $('#trinkets-results');
    if (!data || !data.players || !data.players.length) {
      container.innerHTML = '<p class="text-muted">Keine On-Use Trinket-Nutzung erkannt.</p>';
      return;
    }
    const trinketDefs = data.trinketDefs || {};
    const fights = data.fights || [];
    const fightCount = fights.length;
    // Spieler die ÜBERHAUPT was gecastet haben
    const active = data.players.filter(p => Object.values(p.total || {}).reduce((s,v) => s+v, 0) > 0);
    if (!active.length) {
      container.innerHTML = '<p class="text-muted">In diesem Raid hat niemand ein On-Use Trinket benutzt.</p>';
      return;
    }
    // Sortiere nach gesamt-Casts desc
    active.sort((a, b) => {
      const ta = Object.values(a.total).reduce((s,v) => s+v, 0);
      const tb = Object.values(b.total).reduce((s,v) => s+v, 0);
      return tb - ta;
    });

    // Aggregate stats für Header
    const totalCasts = active.reduce((s, p) => s + Object.values(p.total).reduce((s2, v) => s2 + v, 0), 0);

    let html = `<div class="cons-summary-meta">${active.length} Spieler · ${totalCasts} Use-Casts gesamt · ${fightCount} Fights</div>`;
    html += '<table class="results-table cons-summary-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>Trinket</th><th>Σ Casts</th><th>Casts/Fight</th></tr></thead><tbody>';
    for (let pi = 0; pi < active.length; pi++) {
      const p = active[pi];
      const css = classCssFromType(p.type);
      const cn = classNameFromType(p.type);
      const trinketEntries = Object.entries(p.total).sort((a, b) => b[1] - a[1]);
      for (let ti = 0; ti < trinketEntries.length; ti++) {
        const [spellId, count] = trinketEntries[ti];
        const def = trinketDefs[spellId] || { item: 0, name: 'Unknown' };
        const perFight = (count / fightCount).toFixed(2);
        const itemHtml = def.item ? `<a href="https://www.wowhead.com/tbc/item=${def.item}" data-wowhead="item=${def.item}&amp;domain=tbc">${escapeHtml(def.name)}</a>` : escapeHtml(def.name);
        html += '<tr>';
        if (ti === 0) html += `<td class="${css}" rowspan="${trinketEntries.length}">${renderPlayerName(p.name)}</td><td class="${css}" rowspan="${trinketEntries.length}">${cn}</td>`;
        html += `<td>${itemHtml}</td>`;
        html += `<td><span class="raid-cons-total">${count}</span></td>`;
        html += `<td><span class="text-muted">${perFight}</span></td>`;
        html += '</tr>';
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    try { window.$WowheadPower.refreshLinks(); } catch (e) {}
  }

  function renderConsumableResults(results, consumablesTrash) {
    const container = $('#consumables-results');
    if (!results.length) { container.innerHTML = '<p class="text-muted">Keine Ergebnisse.</p>'; return; }
    // Daten in Closure stashen, damit Filter-Toggle ohne Re-Fetch funktioniert
    window._consumesBossData = results;
    window._consumesTrashData = consumablesTrash || null;
    window._consumesFilter = window._consumesFilter || 'boss';
    renderConsumesView();
  }

  function renderConsumesView() {
    const container = $('#consumables-results');
    const results = window._consumesBossData || [];
    const trashData = window._consumesTrashData;
    const filter = window._consumesFilter || 'boss';
    const trashAvailable = trashData && Array.isArray(trashData) && trashData.length > 0;

    const renderIcon = (c) => {
      const inner = c.uses > 1 ? `<span class="cons-icon-count">${c.uses}</span>` : '';
      if (c.itemId) return `<span class="cons-icon-wrap" title="${escapeHtml(c.label)} ×${c.uses}"><a href="https://www.wowhead.com/tbc/item=${c.itemId}" data-wowhead="item=${c.itemId}&amp;domain=tbc" class="cons-icon-link" rel="np">${escapeHtml(c.label)}</a>${inner}</span>`;
      if (c.spellId) return `<span class="cons-icon-wrap" title="${escapeHtml(c.label)} ×${c.uses}"><a href="https://www.wowhead.com/tbc/spell=${c.spellId}" data-wowhead="spell=${c.spellId}" class="cons-icon-link" rel="np">${escapeHtml(c.label)}</a>${inner}</span>`;
      return `<span class="cons-text-fallback" title="${escapeHtml(c.label)}">${c.uses}× ${escapeHtml(c.label)}</span>`;
    };

    const includeBoss = (filter === 'boss' || filter === 'both');
    const includeTrash = (filter === 'trash' || filter === 'both') && trashAvailable;
    const trashByName = trashAvailable ? new Map(trashData.map(t => [t.name, t])) : new Map();

    const aggregated = results.map(r => {
      const itemMap = new Map();
      if (includeBoss) {
        for (const fd of (r.fightDetails || [])) {
          if (!fd || !fd.consumables) continue;
          for (const c of fd.consumables) {
            const key = c.itemId ? `i${c.itemId}` : c.spellId ? `s${c.spellId}` : `n${c.label}`;
            const ex = itemMap.get(key);
            if (ex) ex.uses += (c.uses || 0);
            else itemMap.set(key, { ...c });
          }
        }
      }
      if (includeTrash) {
        const t = trashByName.get(r.name);
        if (t && Array.isArray(t.items)) {
          for (const c of t.items) {
            const key = c.itemId ? `i${c.itemId}` : c.spellId ? `s${c.spellId}` : `n${c.label}`;
            const ex = itemMap.get(key);
            if (ex) ex.uses += (c.uses || 0);
            else itemMap.set(key, { ...c });
          }
        }
      }
      const items = [...itemMap.values()].sort((a, b) => b.uses - a.uses);
      const countedItems = items.filter(i => !isFreeConjured(i));
      const excludedItems = items.filter(i => isFreeConjured(i));
      const totalCounted = countedItems.reduce((s, i) => s + (i.uses || 0), 0);
      return { ...r, items, countedItems, excludedItems, totalCounted };
    }).sort((a, b) => b.totalCounted - a.totalCounted);

    const primusTotal = aggregated.length ? aggregated[0].totalCounted : 0;
    const thresholdPct = Number.isFinite(window._consumesSlackerPct) ? window._consumesSlackerPct : DEFAULT_SLACKER_THRESHOLD_PCT;
    const slackerThreshold = Math.ceil(primusTotal * (thresholdPct / 100));
    const primusName = aggregated.length ? aggregated[0].name : '';

    function fbtn(val, label, disabled) {
      const active = filter === val && !disabled;
      return `<button class="cons-filter-btn${active ? ' active' : ''}" data-cons-filter="${val}"${disabled ? ' disabled' : ''}>${label}</button>`;
    }
    let html = `<div class="cons-filter-row">
      ${fbtn('boss', 'Boss')}
      ${fbtn('trash', 'Trash', !trashAvailable)}
      ${fbtn('both', 'Beides', !trashAvailable)}
      ${!trashAvailable ? '<span class="text-muted" style="margin-left:8px;font-size:0.8rem">Trash-Daten noch nicht analysiert</span>' : ''}
    </div>`;
    html += '<h3 class="section-title">Übersicht</h3>';
    if (primusTotal > 0) {
      html += `<div class="cons-summary-meta">Primus: <strong>${escapeHtml(primusName)}</strong> (${primusTotal}) · Schwelle: &lt; ${slackerThreshold} Items (${thresholdPct}%)</div>`;
    }
    html += '<table class="results-table cons-summary-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>Fights</th><th>Consumables</th><th>Σ Genommen</th></tr></thead><tbody>';
    let underThresholdShown = false;
    for (let ri = 0; ri < aggregated.length; ri++) {
      const r = aggregated[ri];
      const isUnderThreshold = primusTotal > 0 && r.totalCounted < slackerThreshold;
      if (isUnderThreshold && !underThresholdShown) {
        html += `<tr class="slacker-divider-row"><td colspan="5"><div class="slacker-divider"><span class="slacker-divider-line"></span><span class="slacker-divider-label">⚠ Unter ${thresholdPct}% vom Primus (&lt; ${slackerThreshold})</span><span class="slacker-divider-line"></span></div></td></tr>`;
        underThresholdShown = true;
      }
      const cn = classNameFromType(r.type);
      const css = classCssFromType(r.type);
      const hasDetails = filter === 'boss' && r.fightDetails && r.fightDetails.some(fd => fd && fd.consumables && fd.consumables.length);
      const iconsHtml = r.items.length ? r.items.map(renderIcon).join('') : '<span class="text-muted">—</span>';
      // Tooltip: was wird gezählt, was nicht (in title-attr — Newlines via &#10;)
      const fmtItems = arr => arr.length ? arr.map(i => `${i.label} ×${i.uses}`).join(', ') : '—';
      const tooltipLines = [
        `✓ Gezählt (${r.totalCounted}): ${fmtItems(r.countedItems)}`,
        `✗ Nicht gezählt: ${fmtItems(r.excludedItems)}`,
      ];
      // escapeHtml escaped Sonderzeichen, & wird zu &amp; → wir bauen das title-Attribut manuell mit safer raw
      const tooltip = tooltipLines.join('\n');
      html += `<tr class="buff-summary-row${hasDetails ? ' expandable' : ''}${isUnderThreshold ? ' is-slacker' : ''}" data-cons-idx="${ri}">`;
      html += `<td class="${css}">${hasDetails ? '<span class="expand-arrow">&#9654;</span> ' : ''}${renderPlayerName(r.name)}</td>`;
      html += `<td class="${css}">${cn}</td>`;
      html += `<td>${r.playerFightCount}</td>`;
      html += `<td class="cons-items-cell">${iconsHtml}</td>`;
      html += `<td><span class="raid-cons-total${isUnderThreshold ? ' raid-cons-total--low' : ''}" title="${escapeHtml(tooltip)}" style="cursor:help">${r.totalCounted}</span></td>`;
      html += `</tr>`;

      if (hasDetails) {
        for (let fi = 0; fi < r.fightDetails.length; fi++) {
          const fd = r.fightDetails[fi];
          if (!fd || !fd.consumables || !fd.consumables.length) continue;
          const fight = bossFights[fi];
          const fName = fight ? fight.name : `Fight ${fi + 1}`;
          const fResult = fight ? (fight.kill ? 'Kill' : 'Wipe') : '';
          const fCss = fight && fight.kill ? 'kill-badge' : 'wipe-badge';
          const detailIcons = fd.consumables.map(renderIcon).join('');
          html += `<tr class="buff-detail-row hidden" data-cons-parent="${ri}">`;
          html += `<td class="detail-fight-name" colspan="3"><span class="text-muted">&nbsp;&nbsp;↳</span> ${escapeHtml(fName)} <span class="${fCss}">${fResult}</span></td>`;
          html += `<td class="cons-items-cell">${detailIcons}</td>`;
          html += `<td></td>`;
          html += '</tr>';
        }
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('[data-cons-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const v = btn.getAttribute('data-cons-filter');
        if (v === window._consumesFilter) return;
        window._consumesFilter = v;
        renderConsumesView();
      });
    });

    container.querySelectorAll('.buff-summary-row.expandable').forEach(row => {
      row.addEventListener('click', () => {
        const idx = row.dataset.consIdx;
        const expanded = row.classList.toggle('expanded');
        const arrow = row.querySelector('.expand-arrow');
        if (arrow) arrow.innerHTML = expanded ? '&#9660;' : '&#9654;';
        container.querySelectorAll(`.buff-detail-row[data-cons-parent="${idx}"]`).forEach(dr => {
          dr.classList.toggle('hidden', !expanded);
        });
      });
    });
    try { window.$WowheadPower.refreshLinks(); } catch (e) {}
  }

  function populateFightSelectors() {
    ['#gear-fight-select', '#sr-fight-select', '#spellranks-fight-select', '#avoidable-fight-select'].forEach(sel => {
      const select = $(sel);
      if (!select) return;
      select.innerHTML = '';
      // Gear/SpellRanks/Avoidable get "Alle Fights" as default, SR doesn't (SR is per-fight)
      if (sel === '#gear-fight-select' || sel === '#spellranks-fight-select' || sel === '#avoidable-fight-select') {
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'Alle Fights';
        allOpt.selected = true;
        select.appendChild(allOpt);
      } else {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Fight waehlen...';
        select.appendChild(placeholder);
      }
      bossFights.forEach((f, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        const dur = CLA_DATA.formatDuration(f.end_time - f.start_time);
        const kill = f.kill ? 'Kill' : 'Wipe';
        opt.textContent = `${f.name} (${kill}, ${dur})`;
        select.appendChild(opt);
      });
    });
  }

  function showFightsOverview() {
    const container = $('#fights-results');
    if (!bossFights.length) {
      container.innerHTML = '<p class="text-muted">Keine Boss-Fights gefunden.</p>';
      return;
    }
    let html = '<table class="results-table"><thead><tr><th>#</th><th>Boss</th><th>Ergebnis</th><th>Dauer</th></tr></thead><tbody>';
    bossFights.forEach((f, i) => {
      const dur = CLA_DATA.formatDuration(f.end_time - f.start_time);
      const result = f.kill ? '<span class="tag tag-success">Kill</span>' : '<span class="tag tag-danger">Wipe</span>';
      html += `<tr><td>${i + 1}</td><td>${escapeHtml(f.name)}</td><td>${result}</td><td>${dur}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ─── BUFF CONSUMABLES ───

  // Alte Cached-Daten verwenden noch generische "*:dps"-Keys — auf neue
  // hybrid-bewusste Keys mappen, damit die Policy konsistent greift.
  function normalizeRoleKey(roleKey) {
    if (!roleKey) return roleKey;
    if (roleKey === 'Druid:dps') return 'Druid:feral';
    if (roleKey === 'Shaman:dps') return 'Shaman:enhancement';
    if (roleKey === 'Paladin:dps') return 'Paladin:retribution';
    return roleKey;
  }

  // Manuelle Namens-Overrides für Buffs, die WCL falsch/seltsam benennt
  const ELIXIR_NAME_OVERRIDES = {
    28509: 'Elixir of Major Mageblood',          // WCL zeigt fälschlich „Greater Versatility"
    28519: 'Flask of Mighty Restoration',        // WCL zeigt fälschlich „Mighty Versatility"
  };
  function elixirDisplayName(entry) {
    const ref = entry && (typeof entry === 'object' ? entry : { id: null, name: entry });
    if (ref && ref.id != null && ELIXIR_NAME_OVERRIDES[ref.id]) return ELIXIR_NAME_OVERRIDES[ref.id];
    return ref && ref.name ? ref.name : (typeof entry === 'string' ? entry : '');
  }
  // Helper: extract { id, name } aus altem String- oder neuem Objekt-Format
  function elixirRef(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: null, name: entry };
    if (typeof entry === 'object') return { id: entry.id != null ? entry.id : null, name: entry.name || null };
    return null;
  }
  // Whitelist enthält IDs (neue Form) — Match per ID. Falls die ID nicht bekannt
  // ist (alte cached Daten mit nur Name), fällt es per Name auf den Namen-Bestand
  // im window._elixirNameToId-Lookup zurück.
  // Im Whitelist-Modus: leere/fehlende Whitelist = nichts erlaubt (strikt).
  function whitelistMatches(allowedIds, entry) {
    const ref = elixirRef(entry);
    if (!ref) return false;
    if (!Array.isArray(allowedIds) || !allowedIds.length) return false; // strikt: nichts erlaubt
    if (ref.id != null && allowedIds.includes(ref.id)) return true;
    if (ref.id == null && ref.name && window._elixirNameToId) {
      const id = window._elixirNameToId[ref.name];
      if (id != null && allowedIds.includes(id)) return true;
    }
    return false;
  }
  // Merge base + boss-spezifische Sonderlocken (additiv pro Liste)
  function resolveElixirPolicy(roleKey, bossName) {
    const base = (roleKey && (window._elixirPolicy || {})[roleKey]) || { mode: 'any' };
    if (!bossName) return base;
    const extra = ((window._bossPolicy || {})[bossName] || {})[roleKey];
    if (!extra) return base;
    return {
      mode: base.mode,
      flaskAllowed: [ ...(base.flaskAllowed || []), ...(extra.flaskAllowed || []) ],
      battleAllowed: [ ...(base.battleAllowed || []), ...(extra.battleAllowed || []) ],
      guardianAllowed: [ ...(base.guardianAllowed || []), ...(extra.guardianAllowed || []) ],
    };
  }
  function isFlaskOrElixirOk(fd, bossName) {
    const roleKey = normalizeRoleKey(fd.roleKey);
    const pol = resolveElixirPolicy(roleKey, bossName);
    if (pol.mode === 'flask-only') {
      if (!fd.flask) return false;
      return whitelistMatches(pol.flaskAllowed, fd.flask);
    }
    if (pol.mode === 'whitelist') {
      if (fd.flask && whitelistMatches(pol.flaskAllowed, fd.flask)) return true;
      const battleOk = fd.battleElixir && whitelistMatches(pol.battleAllowed, fd.battleElixir);
      const guardianOk = fd.guardianElixir && whitelistMatches(pol.guardianAllowed, fd.guardianElixir);
      return !!(battleOk && guardianOk);
    }
    // mode: 'any'
    return !!fd.flask || !!(fd.battleElixir && fd.guardianElixir);
  }

  function renderBuffResults(results) {
    const container = $('#buffs-results');
    if (!results.length) { container.innerHTML = '<p class="text-muted">Keine Ergebnisse.</p>'; return; }
    const settings = getSettings();

    const categories = [
      { key: 'flaskOrElixir', label: 'Flask/Elixir' },
      { key: 'foodBuff', label: 'Food' },
      { key: 'scrolls', label: 'Scrolls' },
      { key: 'weaponEnhancement', label: 'Weapon Enh.' }
    ];

    let html = '<table class="results-table buff-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>Fights</th>';
    for (const cat of categories) html += `<th>${cat.label}</th>`;
    html += '</tr></thead><tbody>';

    results.sort((a, b) => a.name.localeCompare(b.name));

    for (let ri = 0; ri < results.length; ri++) {
      const r = results[ri];
      // Recompute flaskOrElixir per-fight nach aktueller Elixier-Policy.
      // (Auch wenn r.flaskOrElixir vom Server vorberechnet wurde — die Policy ist
      // client-seitig, also überschreiben wir den Wert.)
      if (r.fightDetails) {
        r.flaskOrElixir = 0;
        for (let fi = 0; fi < r.fightDetails.length; fi++) {
          const fd = r.fightDetails[fi];
          if (!fd) continue;
          const bn = bossFights[fi] && bossFights[fi].name;
          if (isFlaskOrElixirOk(fd, bn)) r.flaskOrElixir++;
        }
      }
      const cn = classNameFromType(r.type);
      const css = classCssFromType(r.type);
      const hasDetails = r.fightDetails && r.fightDetails.length > 0;
      // Scroll-Bilanz: NUR die erforderlichen Scrolls pro Fight zählen.
      // Bonus-Scrolls (z.B. Protection auf Feral) und Lücken (fehlende Stats) werden
      // korrekt abgebildet — `required-present` aus (required − missing).
      let scrollExpected = 0;
      let scrollHavePresent = 0;
      if (r.fightDetails) {
        for (const fd of r.fightDetails) {
          if (!fd) continue;
          const req = getScrollRequirementsForRole(fd.roleKey);
          const missing = (fd.missingScrolls || []).length;
          scrollExpected += req.length;
          scrollHavePresent += Math.max(0, req.length - missing);
        }
      }
      html += `<tr class="buff-summary-row${hasDetails ? ' expandable' : ''}" data-buff-idx="${ri}">`;
      html += `<td class="${css}">${hasDetails ? '<span class="expand-arrow">&#9654;</span> ' : ''}${renderPlayerName(r.name)}</td>`;
      html += `<td class="${css}">${cn}</td><td>${r.playerFightCount}</td>`;
      for (const cat of categories) {
        const count = r[cat.key];
        const total = r.playerFightCount;
        if (cat.key === 'scrolls') {
          // Scrolls: have/expected, wobei have = nur die erforderlichen vorhandenen Scrolls
          const hasIssue = r.hasLowRankScrolls || r.hasMissingScrolls;
          if (scrollExpected > 0) {
            const pct = Math.round(scrollHavePresent / scrollExpected * 100);
            html += `<td class="${CLA_DATA.pctClass(pct)}">${scrollHavePresent}/${scrollExpected}${hasIssue ? ' ⚠' : ''}</td>`;
          } else {
            // Keine Scroll-Pflicht — Bonus-Scrolls falls vorhanden anzeigen, sonst —
            html += `<td>${count > 0 ? count : '—'}</td>`;
          }
        } else {
          const pct = total > 0 ? Math.round(count / total * 100) : 0;
          html += `<td class="${CLA_DATA.pctClass(pct)}">${pct}% <small>(${count}/${total})</small></td>`;
        }
      }
      html += '</tr>';

      // Hidden per-fight detail rows (appear ABOVE pets when expanded)
      if (hasDetails) {
        for (let fi = 0; fi < r.fightDetails.length; fi++) {
          const fd = r.fightDetails[fi];
          const fight = bossFights[fi];
          if (!fd && fight && /^(Opera Hall|Nightbane)$/i.test(fight.name)) continue; // excluded from buff analysis
          const fName = fight ? fight.name : `Fight ${fi + 1}`;
          const fResult = fight ? (fight.kill ? 'Kill' : 'Wipe') : '';
          const fCss = fight && fight.kill ? 'kill-badge' : 'wipe-badge';

          // Hilfsfunktion für Item-Name (Objekt {id,name} oder String)
          const elixirName = (v) => elixirDisplayName(v);
          // Policy lookup für diesen Fight (inkl. Boss-Sonderregel)
          const polRole = fd && normalizeRoleKey(fd.roleKey);
          const fdPol = resolveElixirPolicy(polRole, fight && fight.name);
          function chipForItem(entry, allowedIds, kind) {
            if (!entry) return null;
            const name = elixirName(entry);
            let ok = true;
            if (fdPol.mode === 'flask-only') {
              ok = kind === 'flask' && whitelistMatches(allowedIds, entry);
            } else if (fdPol.mode === 'whitelist') {
              ok = whitelistMatches(allowedIds, entry);
            }
            const cls = ok ? 'buff-ok' : 'buff-not-allowed';
            const title = ok ? '' : ` title="Nicht von Policy erlaubt (${polRole})"`;
            return `<span class="${cls}"${title}>${escapeHtml(name)}${ok ? '' : ' ⚠'}</span>`;
          }
          // Flask/Elixir cell
          let flaskCell = '<span class="buff-miss">—</span>';
          if (fd) {
            if (fd.flask) {
              flaskCell = chipForItem(fd.flask, fdPol.flaskAllowed, 'flask');
            } else if (fd.battleElixir && fd.guardianElixir) {
              flaskCell = chipForItem(fd.battleElixir, fdPol.battleAllowed, 'battle') + ' + ' + chipForItem(fd.guardianElixir, fdPol.guardianAllowed, 'guardian');
            } else if (fd.battleElixir) {
              flaskCell = chipForItem(fd.battleElixir, fdPol.battleAllowed, 'battle') + ' <small class="buff-miss">(kein Guardian)</small>';
            } else if (fd.guardianElixir) {
              flaskCell = chipForItem(fd.guardianElixir, fdPol.guardianAllowed, 'guardian') + ' <small class="buff-miss">(kein Battle)</small>';
            }
          }

          // Food cell
          let foodCell = fd && fd.food ? `<span class="buff-ok">${escapeHtml(elixirName(fd.food))}</span>` : '<span class="buff-miss">—</span>';

          // Scroll cell with rank info + missing scroll warnings
          let scrollCell = '<span class="buff-miss">—</span>';
          if (fd) {
            const scrollArr = Array.isArray(fd.scrolls) ? fd.scrolls : (fd.scroll ? [fd.scroll] : []);
            const parts = [];
            for (const s of scrollArr) {
              if (typeof s === 'object' && s.label) {
                const cls = s.isMaxRank ? 'buff-ok' : 'buff-partial';
                parts.push(`<span class="${cls}">${escapeHtml(s.label)}${s.isMaxRank ? '' : ' ⚠'}</span>`);
              } else {
                parts.push(`<span class="buff-ok">${escapeHtml(s)}</span>`);
              }
            }
            // Show missing required scrolls
            if (fd.missingScrolls && fd.missingScrolls.length) {
              for (const stat of fd.missingScrolls) {
                parts.push(`<span class="buff-miss">${stat} V fehlt</span>`);
              }
            }
            if (parts.length) scrollCell = parts.join(', ');
          }

          // Weapon Enh - show name if available; DW shows MH/OH separately
          let weaponCell = '<span class="buff-miss">—</span>';
          if (fd && fd.weaponEnh) {
            if (fd.weaponEnh?.weave) {
              weaponCell = '<span class="buff-ok" title="Hunter melee-weaved mit Raptor Strike + Windfury aktiv — Sharpening Stone nicht nötig">Raptor+WF</span>';
            } else if (fd.weaponEnh?.isDW) {
              const mhStr = fd.weaponEnh.mh ? `<span class="buff-ok">${escapeHtml(fd.weaponEnh.mh)}</span>` : '<span class="buff-miss">—</span>';
              const ohStr = fd.weaponEnh.oh ? `<span class="buff-ok">${escapeHtml(fd.weaponEnh.oh)}</span>` : '<span class="buff-miss">—</span>';
              weaponCell = `MH: ${mhStr} / OH: ${ohStr}`;
            } else {
              weaponCell = `<span class="buff-ok">${escapeHtml(fd.weaponEnh)}</span>`;
            }
          }

          // Role/Spec-Tag (z.B. Druid:feral) für diesen Fight
          const roleLabel = fd && fd.roleKey ? normalizeRoleKey(fd.roleKey) : '';
          const roleTag = roleLabel
            ? `<span class="role-spec-tag" title="Erkannte Spec im Fight">${escapeHtml(roleLabel)}</span>`
            : '';

          html += `<tr class="buff-detail-row hidden" data-buff-parent="${ri}">`;
          html += `<td class="detail-fight-name" colspan="2"><span class="text-muted">&nbsp;&nbsp;</span>${escapeHtml(fName)} <span class="${fCss}">${fResult}</span></td>`;
          html += `<td>${roleTag}</td>`;
          html += `<td>${flaskCell}</td>`;
          html += `<td>${foodCell}</td>`;
          html += `<td>${scrollCell}</td>`;
          html += `<td>${weaponCell}</td>`;
          html += '</tr>';
        }
      }

    }
    html += '</tbody></table>';
    container.innerHTML = html;

    // Toggle expand/collapse for player rows
    container.querySelectorAll('.buff-summary-row.expandable').forEach(row => {
      row.addEventListener('click', () => {
        const idx = row.dataset.buffIdx;
        const expanded = row.classList.toggle('expanded');
        const arrow = row.querySelector('.expand-arrow');
        if (arrow) arrow.innerHTML = expanded ? '&#9660;' : '&#9654;';
        container.querySelectorAll(`.buff-detail-row[data-buff-parent="${idx}"]`).forEach(dr => {
          dr.classList.toggle('hidden', !expanded);
        });
      });
    });
  }

  // ─── GEAR ISSUES ───

  // Helper: get gem color counts for meta activation using GEM_DB
  function getGemColors(gemId, icon) {
    return GEM_DB.getColorCounts(gemId, icon);
  }

  // Helper: get players from summary endpoint (reliable player list with combatantInfo)
  function getPlayersFromSummary(summary) {
    const pd = summary.playerDetails || {};
    const all = [...(pd.tanks || []), ...(pd.healers || []), ...(pd.dps || [])];
    return all.filter(p => isValidClass(p.type));
  }

  // Check gear issues for a single player's gear data
  function checkPlayerGear(playerData, className) {
    const ciGear = (playerData.combatantInfo && playerData.combatantInfo.gear) || playerData.gear || [];
    const issues = [];

    // Build gear map by slot
    const gear = {};
    for (let gi = 0; gi < ciGear.length; gi++) {
      const g = ciGear[gi];
      if (!g) continue;
      const s = g.slot !== undefined ? g.slot : gi;
      gear[s] = g;
    }

    const mainHand = gear[15];
    const offHand = gear[16];
    const isTwoHand = mainHand && mainHand.id && (!offHand || !offHand.id);

    // Count gem colors for meta gem activation
    let redCount = 0, yellowCount = 0, blueCount = 0;
    let metaGemId = null;

    for (let slot = 0; slot < 18; slot++) {
      const item = gear[slot];
      if (!item || !item.id) continue;
      for (const gem of (item.gems || [])) {
        if (!gem || !gem.id) continue;
        if (slot === 0 && META_GEM_IDS.has(gem.id)) { metaGemId = gem.id; continue; }
        const colors = getGemColors(gem.id, gem.icon);
        redCount += colors.r;
        yellowCount += colors.y;
        blueCount += colors.b;
      }
    }

    for (let slot = 0; slot < 18; slot++) {
      if (slot === 3) continue; // shirt
      const item = gear[slot];
      const slotName = CLA_DATA.gearSlots[slot] || `Slot ${slot}`;

      if (!item || !item.id) {
        if (slot === 16 && isTwoHand) continue;
        issues.push({ slot: slotName, itemId: 0, issue: 'Leerer Slot', severity: 'high' });
        continue;
      }

      const iid = item.id;

      // Skip excluded items for enchant checks
      const isExcluded = CLA_GEAR.isExcludedItem(iid);

      // Uncut gems
      for (const gem of (item.gems || [])) {
        if (gem && gem.id && UNCUT_GEMS.includes(gem.id))
          issues.push({ slot: slotName, itemId: iid, issue: 'Ungeschliffener Edelstein', severity: 'high' });
      }

      // Gem quality check — always store all, frontend filters by settings
      for (const gem of (item.gems || [])) {
        if (!gem || !gem.id) continue;
        if (META_GEM_IDS.has(gem.id)) continue;
        const ql = GEM_DB.getQuality(gem.id, gem.itemLevel);
        if (ql === 'uncommon' || ql === 'common' || ql === 'rare')
          issues.push({ slot: slotName, itemId: iid, gemId: gem.id, issue: `Gem: ${ql}`, severity: 'medium', gemQuality: ql });
      }

      // Empty sockets
      const expectedSockets = CLA_SOCKETS[iid] || 0;
      const actualGems = (item.gems || []).filter(g => g && g.id).length;
      if (expectedSockets > 0 && actualGems < expectedSockets) {
        const missing = expectedSockets - actualGems;
        issues.push({ slot: slotName, itemId: iid, issue: `${missing} leere Sockel`, severity: 'high' });
      }

      // Riding gear
      if (RIDING_ITEMS.includes(iid))
        issues.push({ slot: slotName, itemId: iid, issue: 'Reit-Ausruestung', severity: 'high' });

      // Slowfall gear
      if (SLOWFALL_ITEMS.includes(iid))
        issues.push({ slot: slotName, itemId: iid, issue: 'Slowfall-Ausruestung', severity: 'medium' });

      // Enchant checks — always store all, tag vanilla enchants
      const enchantableSlots = [0, 2, 4, 6, 7, 8, 9, 14, 15, 16];
      if (enchantableSlots.includes(slot) && !isExcluded) {
        if (slot === 16) {
          const icon = (item.icon || '');
          if (!DW_CAPABLE_CLASSES.includes(className) || !OH_WEAPON_ICON_RE.test(icon)) {
            // skip: class can't DW or item isn't a weapon
          } else if (!item.permanentEnchant) {
            issues.push({ slot: slotName, itemId: iid, issue: 'Fehlende Verzauberung', severity: 'high' });
          } else {
            const badName = CLA_GEAR.isEnchantBad(item.permanentEnchant, slot, className, null);
            if (badName) {
              const entry = CLA_GEAR.badEnchants.find(e => e.id === item.permanentEnchant && (e.slot === undefined || e.slot === slot));
              issues.push({ slot: slotName, itemId: iid, issue: badName, severity: 'medium', isVanillaEnchant: entry && !entry.tbc });
            }
          }
        } else if (!item.permanentEnchant) {
          issues.push({ slot: slotName, itemId: iid, issue: 'Fehlende Verzauberung', severity: 'high' });
        } else {
          const badName = CLA_GEAR.isEnchantBad(item.permanentEnchant, slot, className, null);
          if (badName) {
            const entry = CLA_GEAR.badEnchants.find(e => e.id === item.permanentEnchant && (e.slot === undefined || e.slot === slot));
            issues.push({ slot: slotName, itemId: iid, issue: badName, severity: 'medium', isVanillaEnchant: entry && !entry.tbc });
          }
        }
      }

      // Wrong hit type enchant (slot 16 only relevant for DW-capable classes)
      if (slot === 15 || (slot === 16 && DW_CAPABLE_CLASSES.includes(className))) {
        const te = item.temporaryEnchant;
        if (te) {
          if (MELEE_CLASSES.includes(className) && SPELL_HIT_ENCHANTS.includes(te))
            issues.push({ slot: slotName, itemId: iid, issue: 'Spell-Hit Enchant bei Nahkaempfer', severity: 'medium' });
          if (CASTER_CLASSES.includes(className) && MELEE_HIT_ENCHANTS.includes(te))
            issues.push({ slot: slotName, itemId: iid, issue: 'Melee-Hit Enchant bei Caster', severity: 'medium' });
        }
      }
    }

    // Meta gem activation
    if (metaGemId && META_GEM_IDS.has(metaGemId)) {
      const headItem = gear[0];
      if (!isMetaGemActive(metaGemId, redCount, yellowCount, blueCount)) {
        const reqDesc = {
          25896:'3+ Blue',25897:'mehr Red als Blue',25898:'5+ Blue',
          25893:'mehr Blue als Yellow',32640:'mehr Blue als Yellow',
          25895:'mehr Red als Yellow',34220:'2+ Blue',
          32409:'2+ R/Y/B',25899:'2+ R/Y/B',25901:'2+ R/Y/B',25890:'2+ R/Y/B',32410:'2+ R/Y/B',
          25894:'1+ Red, 2+ Yellow',28556:'1+ Red, 2+ Yellow',28557:'1+ Red, 2+ Yellow',
          32641:'3+ Yellow',35503:'3+ Red',35501:'2+ Blue, 1+ Yellow',
        }[metaGemId] || '?';
        issues.push({ slot: 'Head', itemId: headItem ? headItem.id : 0, issue: `Meta-Gem nicht aktiviert (braucht ${reqDesc}, hat R:${redCount} Y:${yellowCount} B:${blueCount})`, severity: 'high', metaGemId });
      }
    }

    return issues;
  }

  function wowheadLink(itemId, text) {
    if (!itemId) return text || '';
    return `<a href="https://www.wowhead.com/tbc/item=${itemId}" target="_blank" rel="noopener" data-wowhead="item=${itemId}&domain=tbc">${text || itemId}</a>`;
  }

  function wowheadGemLink(gemId) {
    if (!gemId) return '';
    return `<a href="https://www.wowhead.com/tbc/item=${gemId}" target="_blank" rel="noopener" data-wowhead="item=${gemId}&domain=tbc" class="gem-link">[Gem]</a>`;
  }

  function renderGearResults(results, showAll) {
    const container = $('#gear-results');
    if (!results.length) {
      container.innerHTML = '<p class="text-muted">Keine Gear-Probleme gefunden.</p>';
      return;
    }
    const SEV_RANK = { high: 3, medium: 2, low: 1 };
    // Disconnect-Issues raus, leere Spieler dann weg
    const cleaned = results.map(r => ({
      ...r,
      issues: (r.issues || []).filter(i => !i.disconnect)
        .slice()
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0))
    })).filter(r => r.issues.length > 0);
    if (!cleaned.length) {
      container.innerHTML = '<p class="text-muted">Keine Gear-Probleme gefunden.</p>';
      return;
    }
    // Sortierung wie im live-ticker: max-severity desc, dann high-count desc, dann count desc, dann name
    cleaned.sort((a, b) => {
      const maxA = a.issues.reduce((m, i) => Math.max(m, SEV_RANK[i.severity] || 0), 0);
      const maxB = b.issues.reduce((m, i) => Math.max(m, SEV_RANK[i.severity] || 0), 0);
      if (maxA !== maxB) return maxB - maxA;
      const highA = a.issues.filter(i => i.severity === 'high').length;
      const highB = b.issues.filter(i => i.severity === 'high').length;
      if (highA !== highB) return highB - highA;
      if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
      return (a.name || '').localeCompare(b.name || '');
    });

    const totalIssues = cleaned.reduce((s, r) => s + r.issues.length, 0);
    let html = `<div class="live-gear-header"><span class="gear-head-dot"></span><span class="gear-head-title">Gear Issues</span><span class="gear-head-meta">${totalIssues} Issues · ${cleaned.length} Spieler</span></div>`;
    html += '<div class="gear-grid">';
    for (const r of cleaned) {
      const css = classCssFromType(r.type);
      const cn = classNameFromType(r.type);
      const maxSev = r.issues.reduce((m, i) => (SEV_RANK[i.severity] || 0) > (SEV_RANK[m] || 0) ? i.severity : m, 'low');
      html += `<div class="gear-card gear-card--${maxSev}">`;
      html += `<div class="gear-card-head"><span class="gear-card-name ${css}">${renderPlayerName(r.name)}</span><span class="gear-card-class ${css}">${cn}</span><span class="gear-card-count">${r.issues.length}</span></div>`;
      html += '<ul class="gear-issue-list">';
      for (const iss of r.issues) {
        const itemHtml = iss.itemId ? wowheadLink(iss.itemId, iss.itemName || iss.slot) : escapeHtml(iss.slot);
        const gemExtra = iss.gemId ? ' ' + wowheadGemLink(iss.gemId) : '';
        html += `<li class="gear-issue gear-issue--${iss.severity}">`;
        html += `<span class="gear-issue-dot"></span>`;
        html += `<span class="gear-issue-slot">${escapeHtml(iss.slot)}</span>`;
        html += `<span class="gear-issue-item">${itemHtml}${gemExtra}</span>`;
        html += `<span class="gear-issue-problem">${escapeHtml(iss.issue)}</span>`;
        html += `</li>`;
      }
      html += '</ul></div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Trigger Wowhead tooltips refresh
    if (window.$WowheadPower && window.$WowheadPower.refreshLinks) {
      window.$WowheadPower.refreshLinks();
    }
  }

  // ─── SPELL RANKS ───

  function renderSpellRankResults(playerIssues, isAll) {
    const container = $('#spellranks-results');
    const issueCount = Object.keys(playerIssues).length;
    if (issueCount === 0) {
      container.innerHTML = '<p class="text-muted">Keine Downranked Spells gefunden. Alle Spieler nutzen Max-Rank.</p>';
      return;
    }

    // Sort by class, then name
    const sorted = Object.entries(playerIssues).sort((a, b) => {
      if (a[1].type !== b[1].type) return a[1].type.localeCompare(b[1].type);
      return a[0].localeCompare(b[0]);
    });

    // Count total downranked spells
    const totalSpells = sorted.reduce((s, [, d]) => {
      const keys = new Set();
      for (const iss of d.issues) keys.add(iss.spellName + '|' + iss.spellId);
      return s + keys.size;
    }, 0);

    let html = `<div class="gear-summary"><strong>${totalSpells} Downranked Spell${totalSpells !== 1 ? 's' : ''}</strong> bei ${issueCount} Spieler${issueCount !== 1 ? 'n' : ''}</div>`;

    for (const [name, data] of sorted) {
      // Aggregate spells across fights
      const spellMap = {};
      for (const iss of data.issues) {
        const key = iss.spellName + '|' + iss.spellId;
        if (!spellMap[key]) {
          spellMap[key] = { ...iss, totalCasts: 0, fights: [] };
        }
        spellMap[key].totalCasts += iss.casts;
        spellMap[key].fights.push({ name: iss.fightName, kill: iss.fightKill, casts: iss.casts });
      }

      const cn = classNameFromType(data.type);
      const css = classCssFromType(data.type);
      const spells = Object.values(spellMap);

      html += `<div class="player-card">`;
      html += `<div class="player-card-header"><span class="${css}">${renderPlayerName(name)}</span> <small class="${css}">(${cn})</small>`;
      html += ` <span class="tag tag-danger">${spells.length} Spell${spells.length > 1 ? 's' : ''}</span>`;
      html += `</div>`;

      html += `<table class="issues-table"><thead><tr><th>Spell</th><th>Rang</th><th>Casts</th><th>${isAll ? 'Fights' : 'Fight'}</th></tr></thead><tbody>`;
      for (const sp of spells) {
        const wowheadLink = `<a href="https://www.wowhead.com/tbc/spell=${sp.spellId}" data-wowhead="spell=${sp.spellId}">${escapeHtml(sp.spellName)}</a>`;
        const rankTag = `<span class="tag tag-warning">Rank ${sp.rank} / ${sp.maxRank}</span>`;

        let fightCell;
        if (isAll) {
          const fightDetails = sp.fights.map(f => `${escapeHtml(f.name)}${f.kill ? '' : ' (Wipe)'}: ${f.casts}x`);
          fightCell = `<span title="${escapeHtml(fightDetails.join('\n'))}">${sp.fights.length} Fight${sp.fights.length !== 1 ? 's' : ''}</span>`;
        } else {
          const f = sp.fights[0];
          fightCell = `${escapeHtml(f.name)} <span class="${f.kill ? 'kill-badge' : 'wipe-badge'}">${f.kill ? 'Kill' : 'Wipe'}</span>`;
        }

        html += `<tr>`;
        html += `<td>${wowheadLink}</td>`;
        html += `<td>${rankTag}</td>`;
        html += `<td>${sp.totalCasts}x</td>`;
        html += `<td>${fightCell}</td>`;
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
    }

    container.innerHTML = html;
    try { window.$WowheadPower.refreshLinks(); } catch (e) {}
  }

  // ─── DRUMS ───

  async function analyzeDrums() {
    if (!api || !reportCode) return alert('Bitte erst einen Report laden.');
    if (!bossFights.length) return alert('Keine Boss-Fights.');
    if (!playerList.length) return alert('Keine Spieler.');

    const statusId = '#drums-status';
    const drumFilter = `ability.id IN (${DRUM_SPELL_IDS.join(',')})`;
    showLoading('Analysiere Drums...');

    try {
      const start = bossFights[0].start_time;
      const end = bossFights[bossFights.length - 1].end_time;
      const results = [];

      for (let pi = 0; pi < playerList.length; pi++) {
        const player = playerList[pi];
        setStatus(statusId, `Drums fuer ${player.name} (${pi + 1}/${playerList.length})...`);

        // Buff events (as target)
        let allBuffEvents = [];
        let nextPage;
        let params = { start, end, by: 'source', targetid: player.id, filter: drumFilter, translate: true };
        while (true) {
          if (nextPage !== undefined) params.start = nextPage;
          const data = await api.getEvents(reportCode, 'buffs', params);
          allBuffEvents = allBuffEvents.concat(data.events || []);
          if (data.nextPageTimestamp) nextPage = data.nextPageTimestamp;
          else break;
        }

        // Cast events (as source)
        let allCastEvents = [];
        nextPage = undefined;
        params = { start, end, by: 'source', sourceid: player.id, filter: drumFilter, translate: true };
        while (true) {
          if (nextPage !== undefined) params.start = nextPage;
          const data = await api.getEvents(reportCode, 'casts', params);
          allCastEvents = allCastEvents.concat(data.events || []);
          if (data.nextPageTimestamp) nextPage = data.nextPageTimestamp;
          else break;
        }

        const applyBuffs = allBuffEvents.filter(e => e.type === 'applybuff');
        const removeBuffs = allBuffEvents.filter(e => e.type === 'removebuff');
        const drumEntries = [];
        let drumCount = 0, playersReceived = 0;

        for (const evt of applyBuffs) {
          const isClose = drumEntries.some(p => p.sourceID === evt.sourceID && Math.abs(evt.timestamp - p.timestamp) <= 30100);
          if (!isClose) { drumCount++; playersReceived++; drumEntries.push({ timestamp: evt.timestamp, sourceID: evt.sourceID }); }
          else playersReceived++;
        }

        for (const evt of removeBuffs) {
          const isCloseToApply = applyBuffs.some(ab => Math.abs(evt.timestamp - ab.timestamp) <= 100);
          if (!isCloseToApply) {
            const isCloseToExisting = drumEntries.some(p => p.sourceID === evt.sourceID && Math.abs(evt.timestamp - p.timestamp) <= 30100);
            if (!isCloseToExisting) { drumCount++; playersReceived++; drumEntries.push({ timestamp: evt.timestamp, sourceID: evt.sourceID }); }
            else playersReceived++;
          }
        }

        let failedCasts = 0;
        for (const c of allCastEvents) {
          if (c.type !== 'cast') continue;
          if (!applyBuffs.some(ab => ab.sourceID === c.sourceID && Math.abs(ab.timestamp - c.timestamp) <= 100)) failedCasts++;
        }

        results.push({
          name: player.name, type: player.type,
          drumCount, playersReceived, failedCasts,
          avgReceivers: drumCount > 0 ? (playersReceived / drumCount).toFixed(1) : '0'
        });
      }

      renderDrumResults(results);
      setStatus(statusId, `Drum-Analyse fertig. ${playerList.length} Spieler.`);
      hideLoading();
    } catch (err) {
      hideLoading();
      setStatus(statusId, 'Fehler: ' + err.message, true);
      console.error(err);
    }
  }

  function renderDrumResults(results) {
    const container = $('#drums-results');
    if (!results.length) { container.innerHTML = '<p class="text-muted">Keine Ergebnisse.</p>'; return; }

    const relevant = results.filter(r => r.drumCount > 0 || r.playersReceived > 0 || r.failedCasts > 0);
    const display = relevant.length > 0 ? relevant : results;

    let html = '<table class="results-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>Drums</th><th>Spieler getroffen</th><th>Avg</th><th>Fehlgeschlagen</th></tr></thead><tbody>';
    display.sort((a, b) => b.drumCount - a.drumCount);
    for (const r of display) {
      const css = classCssFromType(r.type);
      html += `<tr><td class="${css}">${escapeHtml(r.name)}</td><td class="${css}">${classNameFromType(r.type)}</td>` +
        `<td>${r.drumCount}</td><td>${r.playersReceived}</td><td>${r.avgReceivers}</td>` +
        `<td>${r.failedCasts > 0 ? '<span class="tag tag-warning">' + r.failedCasts + '</span>' : '0'}</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ─── SHADOW RESISTANCE ───

  async function analyzeSR() {
    if (!api || !reportCode) return alert('Bitte erst einen Report laden.');
    const fightIdx = $('#sr-fight-select').value;
    if (fightIdx === '') return alert('Bitte einen Fight waehlen.');

    const fight = bossFights[parseInt(fightIdx)];
    const statusId = '#sr-status';
    showLoading('Analysiere Shadow Resistance...');
    setStatus(statusId, `Lade Daten fuer ${fight.name}...`);

    try {
      const castsData = await api.getTables(reportCode, 'casts', {
        start: fight.start_time, end: fight.end_time, translate: true
      });

      const entries = (castsData.entries || []).filter(e => isValidClass(e.type) && e.total > 20);
      const results = [];

      for (let pi = 0; pi < entries.length; pi++) {
        const player = entries[pi];
        setStatus(statusId, `SR fuer ${player.name} (${pi + 1}/${entries.length})...`);

        let gearSR = 0, enchantSR = 0, gemSR = 0;
        const rawGear = player.gear || [];
        const gear = {};
        for (let gi = 0; gi < rawGear.length; gi++) {
          const g = rawGear[gi];
          if (!g) continue;
          gear[g.slot !== undefined ? g.slot : gi] = g;
        }

        for (let slot = 0; slot < 18; slot++) {
          const item = gear[slot];
          if (!item || !item.id) continue;
          if (item.permanentEnchant && SR_ENCHANT_VALUES[item.permanentEnchant])
            enchantSR += SR_ENCHANT_VALUES[item.permanentEnchant];
          for (const gem of (item.gems || [])) {
            if (gem && gem.id && SR_GEM_VALUES[gem.id]) gemSR += SR_GEM_VALUES[gem.id];
          }
        }

        let buffSR = 0;
        try {
          const buffsData = await api.getTables(reportCode, 'buffs', {
            start: fight.start_time, end: fight.end_time, sourceid: player.id, translate: true
          });
          for (const aura of (buffsData.auras || [])) {
            if (SR_BUFF_VALUES[aura.guid]) buffSR += SR_BUFF_VALUES[aura.guid];
          }
        } catch (e) { console.warn(`SR buff error ${player.name}:`, e); }

        results.push({
          name: player.name, type: player.type,
          gearSR, enchantSR, gemSR, buffSR,
          totalSR: gearSR + enchantSR + gemSR + buffSR
        });
      }

      renderSRResults(results, fight);
      setStatus(statusId, `SR-Analyse fertig fuer ${fight.name}. ${results.length} Spieler.`);
      hideLoading();
    } catch (err) {
      hideLoading();
      setStatus(statusId, 'Fehler: ' + err.message, true);
      console.error(err);
    }
  }

  function renderSRResults(results, fight) {
    const container = $('#sr-results');
    if (!results.length) { container.innerHTML = '<p class="text-muted">Keine Ergebnisse.</p>'; return; }
    results.sort((a, b) => a.totalSR - b.totalSR);
    let html = `<h3>Shadow Resistance: ${escapeHtml(fight.name)}</h3>`;
    html += '<table class="results-table"><thead><tr><th>Spieler</th><th>Klasse</th><th>Gear</th><th>Enchant</th><th>Gems</th><th>Buffs</th><th>Gesamt</th></tr></thead><tbody>';
    for (const r of results) {
      const css = classCssFromType(r.type);
      const tc = r.totalSR >= 200 ? 'pct-100' : r.totalSR >= 150 ? 'pct-high' : r.totalSR >= 100 ? 'pct-mid' : 'pct-low';
      html += `<tr><td class="${css}">${r.name}</td><td class="${css}">${classNameFromType(r.type)}</td>` +
        `<td>${r.gearSR}</td><td>${r.enchantSR}</td><td>${r.gemSR}</td><td>${r.buffSR}</td>` +
        `<td class="${tc}"><strong>${r.totalSR}</strong></td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ─── PLAYER PROGRESSION (25-MAN) ───

  // Check buffs for a single player in a single fight (from pre-fetched data)
  // petAurasList: optional array of { auras: [] } for hunter pets
  function checkPlayerBuffs(auras, playerData, summaryData, settings) {
    const auraIds = new Set((auras || []).map(a => a.guid));
    const result = { flask: false, food: false, weaponEnh: false, scrollsOk: false, scrollExpected: 0 };

    // Flask or Elixirs (always accept elixir combo, consistent with buff tab)
    for (const id of BUFF_IDS.flask) { if (auraIds.has(id)) { result.flask = true; break; } }
    if (!result.flask) {
      let hasBattle = false, hasGuardian = false;
      for (const id of BUFF_IDS.battleElixir) { if (auraIds.has(id)) { hasBattle = true; break; } }
      for (const id of BUFF_IDS.guardianElixir) { if (auraIds.has(id)) { hasGuardian = true; break; } }
      if (hasBattle && hasGuardian) result.flask = true;
    }

    // Food
    for (const id of BUFF_IDS.foodBuff) { if (auraIds.has(id)) { result.food = true; break; } }

    // Weapon Enhancement
    const pDetail = getPlayerDetailMap(summaryData)[playerData.name];
    result.weaponEnh = hasWeaponEnh(detectWeaponEnhancement(pDetail, playerData.type, auras));

    // Scrolls: check required scrolls for this player's role
    const roleKey = getPlayerFightRole(summaryData, playerData.name, playerData.type);
    const requiredScrolls = getScrollRequirementsForRole(roleKey);
    if (requiredScrolls && requiredScrolls.length) {
      result.scrollExpected = requiredScrolls.length;
      const scrollEntries = [];
      for (const a of (auras || [])) {
        if (BUFF_SETS.scrolls.has(a.guid)) scrollEntries.push({ spellId: a.guid });
      }
      const missing = getMissingScrolls(scrollEntries, roleKey);
      result.scrollsOk = missing.length === 0;
    }

    return result;
  }

  // ─── Release Notes (markdown rendering) ───
  function renderMarkdown(md) {
    const lines = md.split('\n');
    const out = [];
    let inList = false;
    function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
    function inline(s) {
      return escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
    for (let raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (line === '---') { closeList(); out.push('<hr>'); continue; }
      if (!line.trim()) { closeList(); continue; }
      let m;
      if ((m = line.match(/^#{3}\s+(.+)$/))) { closeList(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
      if ((m = line.match(/^#{2}\s+(.+)$/))) { closeList(); out.push('<h3>' + inline(m[1]) + '</h3>'); continue; }
      if ((m = line.match(/^#{1}\s+(.+)$/))) { closeList(); out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
      if ((m = line.match(/^[\s]*[-*]\s+(.+)$/))) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(m[1]) + '</li>');
        continue;
      }
      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }
    closeList();
    return out.join('\n');
  }
  async function loadReleaseNotes() {
    const host = $('#release-notes-content');
    if (!host || host._loaded) return;
    host.innerHTML = '<p class="text-muted">Lade...</p>';
    try {
      const r = await apiFetch('/api/release-notes');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const md = await r.text();
      host.innerHTML = renderMarkdown(md);
      host._loaded = true;
    } catch (e) {
      host.innerHTML = '<p class="text-error">Release Notes konnten nicht geladen werden: ' + escapeHtml(e.message) + '</p>';
    }
  }

  // ─── EDIKT: Consumable-Policy public ───
  async function loadEdikt() {
    const host = $('#edikt-content');
    if (!host) return;
    host.innerHTML = '<p class="text-muted">Wird verkündet...</p>';
    try {
      const [polR, namesR] = await Promise.all([
        apiFetch('/api/elixir-policy'),
        apiFetch('/api/elixir-names'),
      ]);
      const pol = polR.ok ? (await polR.json()).policy || {} : {};
      const names = namesR.ok ? await namesR.json() : { flasks: [], battleElixirs: [], guardianElixirs: [] };
      const idToName = {};
      for (const list of [names.flasks, names.battleElixirs, names.guardianElixirs]) {
        for (const e of (list || [])) {
          // Apply override names (z.B. „Greater Versatility" → „Elixir of Major Mageblood")
          const display = (window.ELIXIR_NAME_OVERRIDES_PUBLIC && window.ELIXIR_NAME_OVERRIDES_PUBLIC[e.id]) || e.name;
          idToName[e.id] = display;
        }
      }
      // Use the same override map already in app.js scope
      idToName[28509] = 'Elixir of Major Mageblood'; // override

      host.innerHTML = renderEdikt(pol, idToName);
    } catch (e) {
      host.innerHTML = `<p class="text-error">Edikt konnte nicht verkündet werden: ${escapeHtml(e.message)}</p>`;
    }
  }

  // Defaults — werden von ediktTexts-Setting überschrieben
  const EDIKT_DEFAULTS = {
    title: 'Edikt zu den Konsumeln',
    subtitle: 'Hier sind die Regeln für Flask- und Elixier-Nutzung pro Klasse und Spec.',
    emptyState: 'Noch keine Verordnung erlassen. Jeder mag panschen wie er beliebt.',
    ruleAny: 'Frei verfügbar — keine Einschränkungen.',
    ruleFlaskOnly: 'Nur folgende Flasks sind erlaubt. Combos sind verboten!',
    whitelistFlasksLabel: 'Flasken erlaubt:',
    whitelistComboLabel: 'Elixier-Combo (beide Hälften müssen aus der Liste sein):',
    comboBattleLabel: 'Battle',
    comboGuardianLabel: 'Guardian',
    comboNoneText: '— keine erlaubt —',
    comboFlaskOnlyText: 'Combo-Tinkturen: keine erlaubt. Nur Flask zählt!',
    classHeading: 'An die {className}',
    roleHeading: 'An die {className} ({specLabel}){flavor}',
    footer: '',
    specLabel: { tank:'Tank', healer:'Heiler', balance:'Balance', elemental:'Elemental', feral:'Feral', enhancement:'Enhancement', retribution:'Vergeltung', dps:'DPS' },
    classFlavor: { Warrior:'Krieger', Rogue:'Schurken', Hunter:'Jäger', Paladin:'Paladine', Druid:'Druiden', Shaman:'Schamanen', Mage:'Magier', Warlock:'Hexenmeister', Priest:'Priester' },
    roleFlavor: {},
    roleFootnote: {},
  };
  function renderEdikt(policy, idToName) {
    const T = Object.assign({}, EDIKT_DEFAULTS, (window._branding && window._branding.ediktTexts) || {});
    // Maps sind keine plain merges — auf Object-Ebene mergen
    T.specLabel = Object.assign({}, EDIKT_DEFAULTS.specLabel, T.specLabel || {});
    T.classFlavor = Object.assign({}, EDIKT_DEFAULTS.classFlavor, T.classFlavor || {});
    T.roleFlavor = T.roleFlavor || {};
    T.roleFootnote = T.roleFootnote || {};
    const SPEC_LABEL = T.specLabel;
    const CLASS_FLAVOR = T.classFlavor;
    const ROLE_FLAVOR = T.roleFlavor;
    const ROLE_FOOTNOTE = T.roleFootnote;

    let html = '';
    html += '<div class="edikt-scroll">';
    html += '<div class="edikt-header">';
    html += '<div class="edikt-seal">📜</div>';
    html += `<h1 class="edikt-title">${escapeHtml(T.title)}</h1>`;
    html += `<p class="edikt-subtitle">${T.subtitle}</p>`;
    html += '</div>';

    // Group entries by class
    const grouped = new Map();
    const roles = Object.keys(policy).sort();
    for (const role of roles) {
      const [cls] = role.split(':');
      if (!grouped.has(cls)) grouped.set(cls, []);
      grouped.get(cls).push(role);
    }

    if (!grouped.size) {
      html += `<div class="edikt-empty"><p>${escapeHtml(T.emptyState)}</p></div>`;
      html += '</div>';
      return html;
    }

    const classOrder = ['Warrior', 'Paladin', 'Druid', 'Shaman', 'Hunter', 'Rogue', 'Mage', 'Warlock', 'Priest'];
    const sortedClasses = [...grouped.entries()].sort((a, b) => {
      const ai = classOrder.indexOf(a[0]); const bi = classOrder.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    // Specs sort order within class
    const specOrder = { tank: 1, healer: 2, balance: 3, elemental: 3, retribution: 4, feral: 4, enhancement: 4, dps: 5 };

    for (const [cls, clsRoles] of sortedClasses) {
      const css = classCssFromType(cls);
      const clsName = CLASS_FLAVOR[cls] || cls;
      clsRoles.sort((a, b) => {
        const sa = a.split(':')[1]; const sb = b.split(':')[1];
        return (specOrder[sa]||9) - (specOrder[sb]||9);
      });
      const clsHeadingTxt = (T.classHeading || 'An die {className}').replace('{className}', clsName);
      html += `<div class="edikt-class"><h2 class="edikt-class-title ${css}">${escapeHtml(clsHeadingTxt)}</h2><div class="edikt-class-body">`;
      for (const role of clsRoles) {
        const spec = role.split(':')[1];
        const specLabel = SPEC_LABEL[spec] || spec;
        const specFlavor = ROLE_FLAVOR[role] || '';
        const p = policy[role] || { mode: 'any' };
        const flavorPart = specFlavor ? ` <em>– ${escapeHtml(specFlavor)}</em>` : '';
        const roleHeadingHtml = (T.roleHeading || 'An die {className} ({specLabel}){flavor}')
          .replace('{className}', `<strong>${escapeHtml(clsName)}`)
          .replace('{specLabel}', `${escapeHtml(specLabel)}</strong>`)
          .replace('{flavor}', flavorPart);
        html += '<div class="edikt-role">';
        html += `<div class="edikt-role-title">— ${roleHeadingHtml}:</div>`;
        if (p.mode === 'any') {
          html += `<p class="edikt-rule edikt-rule--free">${escapeHtml(T.ruleAny)}</p>`;
        } else if (p.mode === 'flask-only') {
          const flasks = (p.flaskAllowed || []).map(id => idToName[id] || `#${id}`);
          html += `<p class="edikt-rule edikt-rule--strict">${escapeHtml(T.ruleFlaskOnly)}</p>`;
          html += '<ul class="edikt-list">' + flasks.map(n => `<li>${escapeHtml(n)}</li>`).join('') + '</ul>';
        } else {
          // whitelist
          const fl = (p.flaskAllowed || []).map(id => idToName[id] || `#${id}`);
          const ba = (p.battleAllowed || []).map(id => idToName[id] || `#${id}`);
          const ga = (p.guardianAllowed || []).map(id => idToName[id] || `#${id}`);
          html += '<div class="edikt-whitelist">';
          if (fl.length) {
            html += `<div><strong>${escapeHtml(T.whitelistFlasksLabel)}</strong><ul class="edikt-list">` + fl.map(n => `<li>${escapeHtml(n)}</li>`).join('') + '</ul></div>';
          }
          if (ba.length || ga.length) {
            html += `<div><strong>${escapeHtml(T.whitelistComboLabel)}</strong>`;
            html += '<div class="edikt-combo">';
            html += `<div><em>${escapeHtml(T.comboBattleLabel)}:</em><ul class="edikt-list">` + (ba.length ? ba.map(n => `<li>${escapeHtml(n)}</li>`).join('') : `<li class="edikt-empty-line">${escapeHtml(T.comboNoneText)}</li>`) + '</ul></div>';
            html += `<div><em>${escapeHtml(T.comboGuardianLabel)}:</em><ul class="edikt-list">` + (ga.length ? ga.map(n => `<li>${escapeHtml(n)}</li>`).join('') : `<li class="edikt-empty-line">${escapeHtml(T.comboNoneText)}</li>`) + '</ul></div>';
            html += '</div></div>';
          } else {
            html += `<p class="edikt-rule"><em>${escapeHtml(T.comboFlaskOnlyText)}</em></p>`;
          }
          html += '</div>';
        }
        if (ROLE_FOOTNOTE[role]) {
          html += `<p class="edikt-footnote">✦ ${escapeHtml(ROLE_FOOTNOTE[role])}</p>`;
        }
        html += '</div>';
      }
      html += '</div></div>';
    }

    if (T.footer) html += `<div class="edikt-footer">${T.footer}</div>`;
    html += '</div>';
    return html;
  }

  async function analyzeProgression(forceRefresh) {
    if (!api || !guildReports.length) return;

    const statusId = '#progression-status';
    const settings = getSettings();

    // Fetch elixir policy (which class:spec may use which flask/elixir combos)
    try {
      const epResp = await apiFetch('/api/elixir-policy');
      if (epResp.ok) {
        const ep = await epResp.json();
        window._elixirPolicy = ep.policy || {};
        window._bossPolicy = ep.bossPolicy || {};
      }
    } catch (e) { window._elixirPolicy = {}; window._bossPolicy = {}; }

    // Fetch penalties & excused absences
    try {
      const pResp = await apiFetch('/api/penalties');
      if (pResp.ok) {
        const pData = await pResp.json();
        window._penalties = new Map((pData.penalties || []).map(p => [p.player_name, p.penalty_pct]));
        window._penaltyReasons = new Map((pData.penalties || []).map(p => [p.player_name, p.reason]));
        // Excused raid dates → ISO weeks (global, affects all players)
        const excusedWeeks = new Set();
        function dateToIsoWeek(dateStr) {
          const d = new Date(dateStr + 'T12:00:00');
          return isoWeekOf(d);
        }
        for (const e of (pData.excused || [])) excusedWeeks.add(dateToIsoWeek(e.raid_date));
        window._excusedWeeks = excusedWeeks;
        // Revoked attendance: Map<playerName, Set<isoWeek>>
        const revokedWeeks = new Map();
        const revokedReasons = new Map();
        for (const e of (pData.revoked || [])) {
          const wk = dateToIsoWeek(e.raid_date);
          if (!revokedWeeks.has(e.player_name)) revokedWeeks.set(e.player_name, new Set());
          revokedWeeks.get(e.player_name).add(wk);
          if (e.reason) revokedReasons.set(e.player_name + '|' + wk, e.reason);
        }
        window._revokedWeeks = revokedWeeks;
        window._revokedReasons = revokedReasons;
        // Excluded players
        window._excludedPlayerSet = new Set((pData.excludedPlayers || []).map(e => e.player_name));
        // Join dates: Map<playerName, isoWeek>
        const joinDateWeeks = new Map();
        for (const e of (pData.joinDates || [])) {
          joinDateWeeks.set(e.player_name, dateToIsoWeek(e.join_date));
        }
        window._joinDateWeeks = joinDateWeeks;
        // Player-specific excused: Map<playerName, Set<isoWeek>>
        const excusedPlayerWeeks = new Map();
        for (const e of (pData.excusedPlayers || [])) {
          const wk = dateToIsoWeek(e.raid_date);
          if (!excusedPlayerWeeks.has(e.player_name)) excusedPlayerWeeks.set(e.player_name, new Set());
          excusedPlayerWeeks.get(e.player_name).add(wk);
        }
        window._excusedPlayerWeeks = excusedPlayerWeeks;
        // Player role overrides
        window._playerRoleOverrides = {};
        for (const r of (pData.playerRoles || [])) window._playerRoleOverrides[r.player_name] = r.role;
      }
    } catch (e) { /* ignore */ }

    try {
      // Progression matrix is pre-computed on the server from the cached pre-analyzer
      // outputs (gear + buffs per fight per player). One fetch replaces the thousands
      // of WCL calls the old client-side aggregator used to fire.
      setStatus(statusId, 'Lade Progression...');
      const progResp = await apiFetch('/api/progression?track=' + encodeURIComponent(window._progressionTrack || 'current'));
      if (!progResp.ok) {
        hideLoading();
        setStatus(statusId, 'Fehler beim Laden der Progression (HTTP ' + progResp.status + ')', true);
        return;
      }
      const progData = await progResp.json();
      const reportMeta = progData.reportMeta || [];
      if (!reportMeta.length) {
        hideLoading();
        setStatus(statusId, 'Keine 25er Reports gefunden.', true);
        return;
      }
      const reportCount = reportMeta.length;
      const playerMap = {};
      for (const p of (progData.players || [])) playerMap[p.name] = p;

      // Phase 5: Calculate stats and render
      // Group raid days by calendar week for attendance (present at 1+ day per week = attended)
      const weekOfDay = reportMeta.map(m => isoWeekOf(new Date(m.report.start)));
      const wclWeeks = new Set(weekOfDay);

      // Build TMB attendance for raid days missing from WCL + bench lookup for WCL days
      // Key format: "week|day" e.g. "2026-W09|tue"
      function raidDay(dayOfWeek) {
        if (dayOfWeek === 1) return 'mon';      // Montag = Altcontent
        if (dayOfWeek === 2) return 'tue';
        return 'thu';                            // Do(4) + Fr(5) bleiben 'thu'
      }
      const wclDayKeys = new Set(reportMeta.map(m => {
        const d = new Date(m.report.start);
        return isoWeekOf(d) + '|' + raidDay(d.getDay());
      }));

      // tmbRaidDays: array of { key, week, date, name, chars: Set } (only for days WITHOUT WCL data)
      const tmbRaidDays = [];
      // tmbCharsByDayKey: Map<dayKey, Set<name>> — TMB attendance for ALL days (including WCL days, for bench detection)
      const tmbCharsByDayKey = new Map();
      const tmbBenchedByDayKey = new Map(); // dayKey → Set<name> (explicitly benched in TMB)
      const tmbData = window._tmbAttendance;
      // Track-Filter für TMB-Raids: aus raidSchedule den passenden Eintrag suchen,
      // dessen track-Feld nutzen. Kein dayOfWeek-Match → Fallback auf 'current'.
      const currentTrack = window._progressionTrack || 'current';
      const _sched = (window._branding && Array.isArray(window._branding.raidSchedule)) ? window._branding.raidSchedule : [];
      function tmbRaidMatchesTrack(d) {
        const berlin = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const adj = new Date(berlin);
        if (adj.getHours() < 5) adj.setDate(adj.getDate() - 1);
        const dow = adj.getDay() === 0 ? 7 : adj.getDay();
        const entry = _sched.find(s => s.dayOfWeek === dow);
        const tmbTrack = entry ? (entry.track || 'current') : 'current';
        return tmbTrack === currentTrack;
      }
      if (tmbData && tmbData.raids) {
        for (const raid of tmbData.raids) {
          const d = new Date(raid.date.replace(' ', 'T') + 'Z');
          if (!tmbRaidMatchesTrack(d)) continue;
          const wk = isoWeekOf(d);
          const day = raidDay(d.getUTCDay());
          const dayKey = wk + '|' + day;
          const chars = new Set();
          for (const c of raid.characters) {
            // Alt status gates attendance (so one member doesn't count twice),
            // but bench applies to whichever character was actually benched —
            // e.g. a Tuesday-only alt that got sat out shouldn't look absent.
            if (c.benched) {
              if (!tmbBenchedByDayKey.has(dayKey)) tmbBenchedByDayKey.set(dayKey, new Set());
              tmbBenchedByDayKey.get(dayKey).add(c.name);
            }
            if (!c.isAlt) chars.add(c.name);
          }
          // Merge chars into dayKey lookup (multiple TMB raids on same day)
          if (!tmbCharsByDayKey.has(dayKey)) tmbCharsByDayKey.set(dayKey, new Set());
          for (const name of chars) tmbCharsByDayKey.get(dayKey).add(name);
          if (wclDayKeys.has(dayKey)) continue; // WCL has this day — don't add as separate column
          tmbRaidDays.push({ key: dayKey, week: wk, ts: d.getTime(), name: raid.name, chars });
        }
      }

      // Track-spezifische Wochen für den Attendance-Nenner (nur Wochen wo dieser
      // Track Raids hatte — sonst wäre 1/12 statt 1/1 bei Legacy).
      const trackWeeks = [...new Set([...weekOfDay, ...tmbRaidDays.map(t => t.week)])].sort();
      // Global gültige Wochen für die Tabellen-Anzeige (identische Wochenzählung
      // über beide Tracks: Union aller 25er-TBC-Raids + aller TMB-Raidtermine).
      const allRaidWeeks = new Set(trackWeeks);
      for (const r of guildReports) {
        const z = CLA_DATA.zones[r.zone];
        if (!z || !z.tbc || z.size < 25) continue;
        allRaidWeeks.add(isoWeekOf(new Date(r.start)));
      }
      if (tmbData && tmbData.raids) {
        for (const raid of tmbData.raids) {
          const d = new Date(raid.date.replace(' ', 'T') + 'Z');
          allRaidWeeks.add(isoWeekOf(d));
        }
      }
      const allWeeks = [...allRaidWeeks].sort();
      const weekCount = trackWeeks.length;
      // Exclude excused raid weeks from attendance denominator
      const excusedWeeks = window._excusedWeeks || new Set();
      const excusedCount = trackWeeks.filter(wk => excusedWeeks.has(wk)).length;
      const effectiveWeekCount = Math.max(1, weekCount - excusedCount);

      // Build TMB week attendance for attendance calculation (merge all TMB days per week)
      const tmbWeekAttendance = new Map();
      for (const t of tmbRaidDays) {
        if (!tmbWeekAttendance.has(t.week)) tmbWeekAttendance.set(t.week, new Set());
        for (const name of t.chars) tmbWeekAttendance.get(t.week).add(name);
      }

      // Build dayKey for each WCL report for bench detection
      const wclDayKeyByIdx = reportMeta.map(m => {
        const d = new Date(m.report.start);
        return isoWeekOf(d) + '|' + raidDay(d.getDay());
      });

      const excludedSet = window._excludedPlayerSet || new Set();
      const playerResults = Object.entries(playerMap).filter(([name]) => !excludedSet.has(name)).map(([name, data]) => {
        // Attendance: count weeks where player was present at least once (WCL or TMB)
        const weeksPresent = new Set();
        data.raids.forEach((r, i) => { if (r) weeksPresent.add(weekOfDay[i]); });
        // Add TMB weeks for this player
        for (const [wk, chars] of tmbWeekAttendance) {
          if (chars.has(name)) weeksPresent.add(wk);
        }
        // Bench count: days where player is explicitly benched in TMB OR in TMB but not in WCL log
        let benchCount = 0;
        data.raids.forEach((r, i) => {
          const dk = wclDayKeyByIdx[i];
          const benched = tmbBenchedByDayKey.get(dk);
          if (benched && benched.has(name)) {
            // Explicitly benched in TMB
            benchCount++;
            weeksPresent.add(weekOfDay[i]);
          } else if (!r) {
            // Not in WCL log but in TMB attendance → normal attendance (not bench)
            const tmbChars = tmbCharsByDayKey.get(dk);
            if (tmbChars && tmbChars.has(name)) {
              weeksPresent.add(weekOfDay[i]);
            }
          }
        });

        // Revoked: remove weeks where attendance was revoked for this player
        const playerRevoked = (window._revokedWeeks || new Map()).get(name);
        let revokedCount = 0;
        if (playerRevoked) {
          for (const wk of playerRevoked) {
            if (weeksPresent.has(wk)) { weeksPresent.delete(wk); revokedCount++; }
          }
        }

        const attended = weeksPresent.size;
        // Player-specific excused weeks (on top of global excused)
        const playerExcused = (window._excusedPlayerWeeks || new Map()).get(name);
        let playerExcusedCount = 0;
        if (playerExcused) {
          for (const wk of allWeeks) {
            if (excusedWeeks.has(wk)) continue; // already globally excluded
            if (weeksPresent.has(wk)) continue; // was present
            if (playerExcused.has(wk)) playerExcusedCount++;
          }
        }
        // Join date: only count weeks on or after player's join week
        const joinWeek = (window._joinDateWeeks || new Map()).get(name);
        let joinWeeksExcluded = 0;
        if (joinWeek) {
          for (const wk of allWeeks) {
            if (wk < joinWeek && !excusedWeeks.has(wk)) joinWeeksExcluded++;
          }
        }
        const playerEffWeeks = Math.max(1, effectiveWeekCount - playerExcusedCount - joinWeeksExcluded);
        const rawAttendPct = Math.round(attended / playerEffWeeks * 100);
        const penalty = (window._penalties || new Map()).get(name) || 0;
        const attendPct = Math.max(0, Math.min(100, rawAttendPct) - penalty);

        // Trend: compare gear issues first half vs second half
        const presentRaids = data.raids.map((r, i) => r ? { ...r, idx: i } : null).filter(Boolean);
        const half = Math.ceil(presentRaids.length / 2);
        const firstHalf = presentRaids.slice(0, half);
        const secondHalf = presentRaids.slice(half);
        const avgFirst = firstHalf.length ? firstHalf.reduce((s, r) => s + r.issueCount, 0) / firstHalf.length : 0;
        const avgSecond = secondHalf.length ? secondHalf.reduce((s, r) => s + r.issueCount, 0) / secondHalf.length : 0;
        let trend = 'stable';
        if (presentRaids.length >= 2) {
          if (avgSecond < avgFirst - 0.5) trend = 'improving';
          else if (avgSecond > avgFirst + 0.5) trend = 'declining';
        }

        // Average consumable rates
        const avgFlask = presentRaids.length ? Math.round(presentRaids.reduce((s, r) => s + r.flaskPct, 0) / presentRaids.length) : 0;
        const avgFood = presentRaids.length ? Math.round(presentRaids.reduce((s, r) => s + r.foodPct, 0) / presentRaids.length) : 0;
        const avgWeapon = presentRaids.length ? Math.round(presentRaids.reduce((s, r) => s + r.weaponEnhPct, 0) / presentRaids.length) : 0;
        const scrollRaids = presentRaids.filter(r => r.scrollPct >= 0);
        const avgScroll = scrollRaids.length ? Math.round(scrollRaids.reduce((s, r) => s + r.scrollPct, 0) / scrollRaids.length) : -1;

        // Determine main role: manual override > majority vote
        const rc = data._roleCounts || { tank: 0, healer: 0, dps: 0 };
        const roleOvr = (window._playerRoleOverrides || {})[name];
        const mainRole = roleOvr ? (roleOvr === 'tank' ? 'Tank' : roleOvr === 'healer' ? 'Heal' : 'DD') :
                         rc.tank >= rc.healer && rc.tank >= rc.dps ? (rc.tank > 0 ? 'Tank' : 'DD') :
                         rc.healer >= rc.dps ? 'Heal' : 'DD';

        return { name, ...data, attended, attendPct, rawAttendPct, penalty, revokedCount, playerExcusedCount, playerEffWeeks, _weeksPresent: [...weeksPresent], benchCount, trend, avgFlask, avgFood, avgWeapon, avgScroll, mainRole };
      });

      // Build loot-by-player map from TMB loot data (deduplicate by itemId)
      const lootByPlayer = new Map();
      if (window._tmbLoot && window._tmbLoot.loot) {
        for (const l of window._tmbLoot.loot) {
          if (!lootByPlayer.has(l.character)) lootByPlayer.set(l.character, []);
          const existing = lootByPlayer.get(l.character);
          // Skip duplicate items (same itemId for same player)
          if (!existing.some(e => e.itemId === l.itemId)) {
            existing.push(l);
          }
        }
        // Sort each player's loot by date (newest first)
        for (const [, items] of lootByPlayer) {
          items.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
        }
      }

      // Store for re-render on filter change
      window._lastProgression = { players: playerResults, reportMeta, reportCount, weekCount: effectiveWeekCount, allWeeks, settings, tmbRaidDays, tmbCharsByDayKey, tmbBenchedByDayKey, lootByPlayer };
      renderProgression(playerResults, reportMeta, reportCount, effectiveWeekCount, settings, tmbRaidDays, tmbCharsByDayKey, tmbBenchedByDayKey, lootByPlayer, window._tmbRaidGroups, allWeeks);
      const excNote = excusedCount > 0 ? `, ${excusedCount} ausgeschlossen` : '';
      setStatus(statusId, `${Object.keys(playerMap).length} Spieler ueber ${reportCount} Raids (${effectiveWeekCount} Wochen${excNote}) analysiert.`);
    } catch (err) {
      setStatus(statusId, 'Fehler: ' + err.message, true);
      console.error(err);
    }
  }

  function renderProgression(players, reportMeta, reportCount, weekCount, settings, tmbRaidDays, tmbCharsByDayKey = new Map(), tmbBenchedByDayKey = new Map(), lootByPlayer = new Map(), tmbRaidGroups = null, allWeeks = null) {
    tmbRaidDays = tmbRaidDays || [];
    const container = $('#progression-results');
    if (!players.length) {
      container.innerHTML = '<p class="text-muted">Keine Spieler gefunden.</p>';
      return;
    }

    // Apply current settings filter to all raid issues
    const currentSettings = getSettings();
    const showOffspec = $('#prog-show-offspec')?.checked;
    for (const p of players) {
      for (const raid of p.raids) {
        if (!raid || !raid.issues) continue;
        let allIssues = raid.issues;
        if (showOffspec && raid.offspecIssues && raid.offspecIssues.length) {
          allIssues = [...raid.issues, ...raid.offspecIssues];
        }
        const filtered = filterIssuesBySettings(allIssues, currentSettings);
        raid._filteredIssues = filtered;
        raid._filteredHigh = filtered.filter(i => i.severity === 'high').length;
        raid._filteredMed = filtered.filter(i => i.severity === 'medium').length;
      }
    }

    // Sort: by class, then by attendance desc, then name
    const classOrder = ['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid'];
    players.sort((a, b) => {
      const ca = classOrder.indexOf(a.className);
      const cb = classOrder.indexOf(b.className);
      if (ca !== cb) return ca - cb;
      if (b.attendPct !== a.attendPct) return b.attendPct - a.attendPct;
      return a.name.localeCompare(b.name);
    });

    // Merge alts by TMB member name
    const mergeAlts = $('#prog-merge-alts')?.checked && tmbRaidGroups && tmbRaidGroups.charToMember;
    let mergedGroups = null; // Map<memberName, { main: player, alts: player[] }>
    if (mergeAlts) {
      const ctm = tmbRaidGroups.charToMember;
      const groups = new Map();
      for (const p of players) {
        const member = ctm[p.name];
        if (!member || !tmbRaidGroups.members[member]) {
          // No alt mapping — treat as standalone
          groups.set(p.name, { main: p, alts: [], member: null });
        } else {
          if (!groups.has(member)) {
            groups.set(member, { main: p, alts: [], member });
          } else {
            groups.get(member).alts.push(p);
          }
        }
      }
      mergedGroups = groups;

      // Build merged player list: merged rows replace individual ones
      const mergedPlayers = [];
      for (const [, g] of groups) {
        if (!g.alts.length) {
          mergedPlayers.push(g.main);
          continue;
        }
        // Create merged player row: combine attendance (union of weeks), loot, etc.
        const allChars = [g.main, ...g.alts];
        // Merged attendance: UNION der Wochen über alle Chars (= Summe ohne Doppelzählung).
        // Beispiel: Main 5/10, Alt 3/10 davon 1 überlappt → merged 7/10.
        const mergedWeeks = new Set();
        let totalBench = 0;
        for (const c of allChars) {
          if (c._weeksPresent) c._weeksPresent.forEach(w => mergedWeeks.add(w));
          totalBench += (c.benchCount || 0);
        }
        const mainPenalty = g.main.penalty || 0;
        // Denominator: kleinster playerEffWeeks (wenn ein Alt später joined ist sein
        // Fenster kleiner — wir nehmen das größte verfügbare Fenster der Gruppe).
        const mergedEffWeeks = Math.max(1, Math.max(...allChars.map(c => c.playerEffWeeks || 1)));
        const mergedAttended = mergedWeeks.size;
        const mergedRawAttendPct = Math.round(mergedAttended / mergedEffWeeks * 100);
        const bestAttend = Math.max(0, Math.min(100, mergedRawAttendPct) - mainPenalty);
        const bestAttended = mergedAttended;

        // Merge raids: for each raid slot, pick the char that was present
        const mergedRaids = [];
        const raidCount = g.main.raids.length;
        for (let ri = 0; ri < raidCount; ri++) {
          let picked = null;
          for (const c of allChars) {
            if (c.raids[ri]) { picked = c.raids[ri]; picked._charName = c.name; break; }
          }
          mergedRaids.push(picked);
        }

        // Merge consumable averages (weighted by present raids)
        const presentCounts = allChars.map(c => c.raids.filter(r => r).length);
        const totalPresent = presentCounts.reduce((a, b) => a + b, 0);
        const wavg = (field) => {
          if (!totalPresent) return 0;
          return Math.round(allChars.reduce((s, c, i) => s + (c[field] || 0) * presentCounts[i], 0) / totalPresent);
        };

        // Merge loot
        const mergedLootItems = [];
        const seenItemIds = new Set();
        for (const c of allChars) {
          const items = lootByPlayer.get(c.name) || [];
          for (const l of items) {
            if (!seenItemIds.has(l.itemId)) {
              seenItemIds.add(l.itemId);
              mergedLootItems.push(l);
            }
          }
        }
        mergedLootItems.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

        const merged = {
          ...g.main,
          _isMerged: true,
          _memberName: g.member,
          _alts: g.alts,
          _allChars: allChars,
          _mainRaids: g.main.raids,
          _mainAttendPct: g.main.attendPct,
          _mainAttended: g.main.attended,
          _mainBenchCount: g.main.benchCount || 0,
          _mergedLoot: mergedLootItems,
          attendPct: bestAttend,
          attended: bestAttended,
          benchCount: totalBench,
          raids: mergedRaids,
          avgFlask: wavg('avgFlask'),
          avgFood: wavg('avgFood'),
          avgWeapon: wavg('avgWeapon'),
          avgScroll: wavg('avgScroll'),
          avgPetScroll: wavg('avgPetScroll'),
        };
        mergedPlayers.push(merged);
      }

      // Re-sort merged list
      mergedPlayers.sort((a, b) => {
        const ca = classOrder.indexOf(a.className);
        const cb = classOrder.indexOf(b.className);
        if (ca !== cb) return ca - cb;
        if (b.attendPct !== a.attendPct) return b.attendPct - a.attendPct;
        return a.name.localeCompare(b.name);
      });
      players = mergedPlayers;
    }

    // Legend
    let html = '<div class="progression-legend">';
    html += '<span class="legend-item"><span class="cell-ok-demo">&#10003;</span> Keine Issues</span>';
    html += '<span class="legend-item"><span class="cell-warn-demo">3</span> Nur Medium</span>';
    html += '<span class="legend-item"><span class="cell-bad-demo">5</span> High Issues</span>';
    html += '<span class="legend-item"><span class="cell-absent-demo">—</span> Abwesend</span>';
    html += '<span class="legend-sep">|</span>';
    html += '<span class="legend-item">Dots: <span class="dot dot-legend"></span> Flask <span class="dot dot-legend"></span> Food <span class="dot dot-legend"></span> Weapon <span class="dot dot-legend"></span> Scrolls</span>';
    html += '</div>';

    // Table
    html += '<div class="progression-wrapper"><table class="progression-table"><thead><tr>';

    // Day filter from checkboxes
    const showThu = $('#prog-show-thu')?.checked !== false;
    const showTue = $('#prog-show-tue')?.checked !== false;
    const showMon = $('#prog-show-mon')?.checked !== false;

    // Build unified column list: WCL raids + TMB-only weeks, sorted chronologically
    const columns = [];
    for (let ri = 0; ri < reportCount; ri++) {
      const m = reportMeta[ri];
      const d = new Date(m.report.start);
      const dow = d.getDay();
      const day = dow === 1 ? 'mon' : dow === 2 ? 'tue' : 'thu';
      if ((day === 'thu' && !showThu) || (day === 'tue' && !showTue) || (day === 'mon' && !showMon)) continue;
      const wk = isoWeekOf(d);
      const dayKey = wk + '|' + day;
      const tmbChars = tmbCharsByDayKey.get(dayKey) || null;
      const tmbBenched = tmbBenchedByDayKey.get(dayKey) || null;
      columns.push({ type: 'wcl', ri, ts: m.report.start, meta: m, day, week: wk, tmbChars, tmbBenched });
    }
    for (const t of tmbRaidDays) {
      const day = t.key.endsWith('|tue') ? 'tue' : t.key.endsWith('|mon') ? 'mon' : 'thu';
      if ((day === 'thu' && !showThu) || (day === 'tue' && !showTue) || (day === 'mon' && !showMon)) continue;
      const tmbBenched = tmbBenchedByDayKey.get(t.key) || null;
      columns.push({ type: 'tmb', week: t.week, ts: t.ts, name: t.name, chars: t.chars, day, tmbBenched });
    }
    // Fülle Wochen ohne Raid-Spalte mit Placeholdern auf — aber nur im Current-Track.
    // Im Altcontent-Track werden leere Wochen ausgeblendet.
    const currentTrack = window._progressionTrack || 'current';
    if (currentTrack !== 'legacy' && allWeeks && allWeeks.length) {
      const presentWeeks = new Set(columns.map(c => c.week));
      for (const wk of allWeeks) {
        if (presentWeeks.has(wk)) continue;
        // Synthetischer Timestamp: Donnerstag der Woche um 20:00
        const [yy, ww] = wk.split('-W').map(Number);
        const jan4 = new Date(Date.UTC(yy, 0, 4));
        const day0 = (jan4.getUTCDay() + 6) % 7;
        const week1Mon = new Date(jan4.getTime() - day0 * 86400000);
        const ts = week1Mon.getTime() + (ww - 1) * 7 * 86400000 + 3 * 86400000 + 20 * 3600000;
        columns.push({ type: 'empty', week: wk, ts, day: 'thu' });
      }
    }
    columns.sort((a, b) => b.ts - a.ts);
    // Standard: nur die letzten 6 Wochen — Rest hinter Toggle (Matrix sonst endlos breit)
    const _allWeekKeys = [...new Set(columns.map(c => c.week))];
    const PROG_DEFAULT_WEEKS = 6;
    let prunedColumns = columns;
    let _hiddenWeeks = 0;
    if (!window._progShowAllWeeks && _allWeekKeys.length > PROG_DEFAULT_WEEKS) {
      const _keep = new Set(_allWeekKeys.slice(0, PROG_DEFAULT_WEEKS));
      _hiddenWeeks = _allWeekKeys.length - PROG_DEFAULT_WEEKS;
      prunedColumns = columns.filter(c => _keep.has(c.week));
    }
    const _weeksBtn = document.getElementById('btn-prog-weeks');
    if (_weeksBtn) {
      _weeksBtn.classList.toggle('hidden', _allWeekKeys.length <= PROG_DEFAULT_WEEKS);
      _weeksBtn.textContent = window._progShowAllWeeks ? 'Nur letzte 6 Wochen' : `Alle ${_allWeekKeys.length} Wochen anzeigen`;
    }
    columns.length = 0;
    columns.push(...prunedColumns);
    const totalCols = columns.length;

    // Build week spans for the top header row
    const weekSpans = [];
    for (const col of columns) {
      if (weekSpans.length && weekSpans[weekSpans.length - 1].week === col.week) {
        weekSpans[weekSpans.length - 1].span++;
      } else {
        weekSpans.push({ week: col.week, span: 1 });
      }
    }

    // Week header row — Nummerierung basiert auf der globalen Wochenliste, damit
    // Current- und Altcontent-Track dieselben Wochennummern zeigen.
    const globalWeeks = allWeeks && allWeeks.length ? allWeeks : weekSpans.map(s => s.week).reverse();
    const globalWeekNumber = (wk) => {
      const idx = globalWeeks.indexOf(wk);
      return idx >= 0 ? idx + 1 : null;
    };
    html += '<th colspan="5" class="col-week-spacer"></th>';
    for (let wi = 0; wi < weekSpans.length; wi++) {
      const ws = weekSpans[wi];
      const num = globalWeekNumber(ws.week);
      const weekNum = num != null ? `Woche ${num}` : `Woche ${weekSpans.length - wi}`;
      const altClass = wi % 2 === 0 ? 'week-even' : 'week-odd';
      html += `<th colspan="${ws.span}" class="col-week ${altClass}">${weekNum}</th>`;
    }
    html += '</tr><tr>';

    // Regular header row
    html += '<th class="col-player">Spieler</th>';
    html += '<th class="col-attend">Anw.</th>';
    html += '<th class="col-trend">Trend</th>';
    html += '<th class="col-consavg" title="Durchschnittliche Consumable-Rate">Cons.</th>';
    html += '<th class="col-loot" title="Erhaltener Loot (TMB)">Loot</th>';

    // Assign week index to columns for alternating bg + week-start marker
    let prevWeek = null;
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const wi = weekSpans.findIndex((_, i) => {
        let offset = 0;
        for (let j = 0; j <= i; j++) offset += weekSpans[j].span;
        return ci < offset;
      });
      col._weekIdx = wi;
      col._weekStart = (col.week !== prevWeek);
      prevWeek = col.week;

      const dayCls = col.day === 'mon' ? 'col-mon' : col.day === 'tue' ? 'col-tue' : 'col-thu';
      const weekCls = wi % 2 === 0 ? 'week-even' : 'week-odd';
      const startCls = col._weekStart ? 'week-start' : '';

      if (col.type === 'wcl') {
        const m = col.meta;
        const date = fmtDate(m.report.start);
        const dayLabel = col.day === 'mon' ? 'Mo' : col.day === 'tue' ? 'Di' : 'Do';
        html += `<th class="col-raid ${dayCls} ${weekCls} ${startCls}" data-code="${escapeHtml((m.reports || [m.report])[0].id)}"><div class="raid-col-header">` +
          `<span class="zone-badge-sm" style="background:${m.zone.color}22;color:${m.zone.color}">${m.zone.short}</span>` +
          `<span class="raid-day-label">${dayLabel}</span>` +
          `<span class="raid-date">${date}</span>` +
          `</div></th>`;
      } else if (col.type === 'empty') {
        html += `<th class="col-raid col-empty ${weekCls} ${startCls}"><div class="raid-col-header">` +
          `<span class="zone-badge-sm" style="background:#33333322;color:#888">—</span>` +
          `<span class="raid-day-label" style="color:#666">kein Raid</span>` +
          `</div></th>`;
      } else {
        const tmbDate = fmtDate(col.ts);
        const dayLabel = col.day === 'mon' ? 'Mo' : col.day === 'tue' ? 'Di' : 'Do';
        html += `<th class="col-raid col-tmb ${dayCls} ${weekCls} ${startCls}"><div class="raid-col-header">` +
          `<span class="zone-badge-sm" style="background:#55555522;color:#999">TMB</span>` +
          `<span class="raid-day-label">${dayLabel}</span>` +
          `<span class="raid-date">${tmbDate}</span>` +
          `</div></th>`;
      }
    }
    html += '</tr></thead><tbody>';

    // Helper: render raid columns for a player
    function renderRaidCols(p, checkNames) {
      let h = '';
      for (const col of columns) {
        const dayCls = col.day === 'mon' ? 'col-mon' : col.day === 'tue' ? 'col-tue' : 'col-thu';
        const weekCls = col._weekIdx % 2 === 0 ? 'week-even' : 'week-odd';
        const startCls = col._weekStart ? 'week-start' : '';

        if (col.type === 'tmb') {
          const present = checkNames.some(n => col.chars && col.chars.has(n));
          const benched = checkNames.some(n => col.tmbBenched && col.tmbBenched.has(n));
          if (benched) {
            h += `<td class="cell-bench ${dayCls} ${weekCls} ${startCls}" title="Auf der Bank (TMB: Benched)">B</td>`;
          } else if (present) {
            h += `<td class="cell-tmb-present ${dayCls} ${weekCls} ${startCls}" title="Anwesend (TMB)">&#10003;</td>`;
          } else {
            h += `<td class="cell-absent ${dayCls} ${weekCls} ${startCls}" title="Abwesend">—</td>`;
          }
          continue;
        }
        if (col.type === 'empty') {
          h += `<td class="cell-empty ${weekCls} ${startCls}" title="Kein Raid in dieser Woche">·</td>`;
          continue;
        }

        const raid = p.raids[col.ri];
        // Check if this raid is revoked for this player
        const isRevoked = checkNames.some(n => {
          const rv = (window._revokedWeeks || new Map()).get(n);
          return rv && rv.has(col.week);
        });

        if (!raid) {
          const explicitBench = checkNames.some(n => col.tmbBenched && col.tmbBenched.has(n));
          const inTmb = checkNames.some(n => col.tmbChars && col.tmbChars.has(n));
          if (explicitBench) {
            h += `<td class="cell-bench ${dayCls} ${weekCls} ${startCls}" title="Auf der Bank (TMB: Benched)">B</td>`;
          } else if (inTmb) {
            h += `<td class="cell-tmb-present ${dayCls} ${weekCls} ${startCls}" title="Anwesend (TMB, kein WCL-Log)">&#10003;</td>`;
          } else {
            h += `<td class="cell-absent ${dayCls} ${weekCls} ${startCls}" title="Abwesend">—</td>`;
          }
          continue;
        }

        const filteredIssues = raid._filteredIssues || raid.issues;
        const filteredCount = filteredIssues.length;
        const filteredHigh = raid._filteredHigh || 0;
        let cellClass, gearText;
        const tooltipLines = [];
        if (filteredCount === 0) {
          cellClass = 'cell-ok';
          gearText = '&#10003;';
        } else {
          cellClass = filteredHigh > 0 ? 'cell-bad' : 'cell-warn';
          gearText = String(filteredCount);
          for (const iss of filteredIssues) tooltipLines.push(`${iss.offspec ? '[OS] ' : ''}${iss.slot}: ${iss.issue}`);
        }

        const fDot = raid.flaskPct >= 80 ? 'dot-green' : raid.flaskPct >= 40 ? 'dot-yellow' : 'dot-red';
        const fdDot = raid.foodPct >= 80 ? 'dot-green' : raid.foodPct >= 40 ? 'dot-yellow' : 'dot-red';
        const wDot = raid.weaponEnhPct >= 80 ? 'dot-green' : raid.weaponEnhPct >= 40 ? 'dot-yellow' : 'dot-red';
        const combinedScrollPct = raid.scrollPct;
        const sDot = combinedScrollPct < 0 ? '' : combinedScrollPct >= 80 ? 'dot-green' : combinedScrollPct >= 40 ? 'dot-yellow' : 'dot-red';

        tooltipLines.push(`---`);
        tooltipLines.push(`Flask/Elixir: ${raid.flaskPct}% (${raid.flaskCount}/${raid.fightsPresentBuff})`);
        tooltipLines.push(`Food: ${raid.foodPct}% (${raid.foodCount}/${raid.fightsPresentBuff})`);
        tooltipLines.push(`Weapon Enh: ${raid.weaponEnhPct}% (${raid.weaponEnhCount}/${raid.fightsPresentBuff})`);
        if (raid.scrollPct >= 0) tooltipLines.push(`Scrolls: ${raid.scrollPct}% (${raid.scrollOkCount}/${raid.scrollExpectedFights} Fights alle Scrolls)`);

        if (isRevoked) {
          const rvReason = checkNames.map(n => {
            const r = (window._revokedReasons || new Map()).get(n + '|' + col.week);
            return r || '';
          }).filter(Boolean).join(', ');
          tooltipLines.unshift('ABERKANNT' + (rvReason ? ': ' + rvReason : ''));
        }
        const tooltip = escapeHtml(tooltipLines.join('\n'));
        const charLabel = raid._charName ? ` [${raid._charName}]` : '';
        const revokedCls = isRevoked ? ' cell-revoked' : '';

        h += `<td class="${cellClass}${revokedCls} ${dayCls} ${weekCls} ${startCls}" title="${tooltip}${charLabel}">`;
        h += `<div class="cell-content"><span class="cell-gear">${gearText}</span>`;
        h += `<span class="cell-dots"><span class="dot ${fDot}"></span><span class="dot ${fdDot}"></span><span class="dot ${wDot}"></span>${sDot ? `<span class="dot ${sDot}"></span>` : ''}</span>`;
        h += `</div></td>`;
      }
      return h;
    }

    // Helper: render summary columns (attend, trend, cons, loot) for a player
    function renderSummaryCols(p, pLoot) {
      let h = '';
      const trendIcon = p.trend === 'improving' ? '<span class="trend-up" title="Verbessert">&#9650;</span>' :
                        p.trend === 'declining' ? '<span class="trend-down" title="Verschlechtert">&#9660;</span>' :
                        '<span class="trend-stable" title="Stabil">&#9644;</span>';
      const attendCss = p.attendPct >= 75 ? 'attend-high' : p.attendPct >= 40 ? 'attend-mid' : 'attend-low';
      const consComponents = [p.avgFlask, p.avgFood, p.avgWeapon];
      if (p.avgScroll >= 0) consComponents.push(p.avgScroll);
      const consAvg = Math.round(consComponents.reduce((a, b) => a + b, 0) / consComponents.length);
      const consCss = consAvg >= 80 ? 'attend-high' : consAvg >= 50 ? 'attend-mid' : 'attend-low';

      const effW = p.playerEffWeeks || weekCount;
      const benchLabel = p.benchCount > 0 ? ` <small class="bench-count" title="${p.benchCount}x auf der Bank">(${p.benchCount}B)</small>` : '';
      const revokedLabel = (p.revokedCount || 0) > 0 ? ` <small class="penalty-badge" title="${p.revokedCount}x aberkannt">(${p.revokedCount}R)</small>` : '';
      const excusedLabel = (p.playerExcusedCount || 0) > 0 ? ` <small class="excused-badge" title="${p.playerExcusedCount}x entschuldigt">(${p.playerExcusedCount}E)</small>` : '';
      const penaltyVal = p.penalty || 0;
      const penaltyReason = penaltyVal ? (window._penaltyReasons || new Map()).get(p.name) || '' : '';
      const penaltyLabel = penaltyVal ? ` <small class="penalty-badge" title="Strafe: -${penaltyVal}%${penaltyReason ? ' (' + penaltyReason + ')' : ''}">-${penaltyVal}</small>` : '';
      h += `<td class="col-attend ${attendCss}">${p.attendPct}%<small class="attend-count">${p.attended}/${effW}</small>${benchLabel}${revokedLabel}${excusedLabel}${penaltyLabel}</td>`;
      h += `<td class="col-trend">${trendIcon}</td>`;
      let consTitle = `Flask: ${p.avgFlask}% | Food: ${p.avgFood}% | Weapon: ${p.avgWeapon}%`;
      if (p.avgScroll >= 0) consTitle += ` | Scrolls: ${p.avgScroll}%`;
      h += `<td class="col-consavg ${consCss}" title="${consTitle}">${consAvg}%</td>`;

      const msLoot = pLoot.filter(l => !l.offspec);
      const osCount = pLoot.length - msLoot.length;
      if (pLoot.length > 0) {
        const lootTitle = pLoot.map(l => `${l.item} (${l.source})${l.offspec ? ' [OS]' : ''}`).join('\n');
        const osLabel = osCount > 0 ? ` <small class="loot-os" title="${osCount} Offspec">(${osCount}OS)</small>` : '';
        h += `<td class="col-loot" title="${lootTitle.replace(/"/g, '&quot;')}">${msLoot.length}${osLabel}</td>`;
      } else {
        h += '<td class="col-loot text-muted">—</td>';
      }
      return h;
    }

    // Player rows
    let lastClass = '';
    let mergeGroupId = 0;
    // TMB-Abgleich: Chars ohne TMB-Account ausgrauen (nur wenn TMB-Daten existieren)
    const _tmbNorm = s => (s || '').normalize('NFC').toLowerCase();
    const _tmbKnown = new Set();
    for (const set of (tmbCharsByDayKey || new Map()).values()) for (const n of set) _tmbKnown.add(_tmbNorm(n));
    for (const set of (tmbBenchedByDayKey || new Map()).values()) for (const n of set) _tmbKnown.add(_tmbNorm(n));
    for (const n of (lootByPlayer || new Map()).keys()) _tmbKnown.add(_tmbNorm(n));
    const _hasTmb = name => _tmbKnown.size === 0 || _tmbKnown.has(_tmbNorm(name));

    for (const p of players) {
      if (p.className !== lastClass) {
        lastClass = p.className;
        html += `<tr class="class-separator"><td colspan="${5 + totalCols}"><span class="${classCssFromType(p.type)}">${p.className}</span></td></tr>`;
      }
      const _noTmbRow = !_hasTmb(p.name) && (!p._allChars || !p._allChars.some(c => _hasTmb(c.name)));

      const css = classCssFromType(p.type);

      if (p._isMerged && p._alts.length > 0) {
        // Merged row
        const gid = 'mg-' + (mergeGroupId++);
        const altNames = p._alts.map(a => a.name).join(', ');
        const pLoot = p._mergedLoot || [];
        const checkNames = p._allChars.map(c => c.name);
        html += `<tr class="merge-parent${_noTmbRow ? ' no-tmb' : ''}" data-merge-group="${gid}"${_noTmbRow ? ' title="Kein TMB-Account"' : ''}>`;
        html += `<td class="col-player ${css}"><span class="merge-toggle" title="Alts: ${altNames}">&#9654;</span> ${renderPlayerName(p.name)} <small class="merge-alt-count">(+${p._alts.length})</small><span class="role-badge role-${(p.mainRole || 'DD').toLowerCase()}">${p.mainRole || 'DD'}</span></td>`;
        html += renderSummaryCols(p, pLoot);
        html += renderRaidCols(p, checkNames);
        html += '</tr>';

        // Alt sub-rows (hidden by default)
        for (const alt of p._alts) {
          const altCss = classCssFromType(alt.type);
          const altLoot = lootByPlayer.get(alt.name) || [];
          html += `<tr class="merge-child hidden${_hasTmb(alt.name) ? '' : ' no-tmb'}" data-merge-group="${gid}">`;
          html += `<td class="col-player ${altCss} merge-indent">${renderPlayerName(alt.name)}${_hasTmb(alt.name) ? '' : ' <small class="no-tmb-tag" title="Kein TMB-Account">kein TMB</small>'}</td>`;
          html += renderSummaryCols(alt, altLoot);
          html += renderRaidCols(alt, [alt.name]);
          html += '</tr>';
        }
        // Also show main char as sub-row with original (non-merged) raids
        const mainLoot = lootByPlayer.get(p.name) || [];
        html += `<tr class="merge-child hidden" data-merge-group="${gid}">`;
        html += `<td class="col-player ${css} merge-indent">${renderPlayerName(p.name)} <small class="text-muted">(Main)</small></td>`;
        html += renderSummaryCols({ ...p, attendPct: p._mainAttendPct, attended: p._mainAttended, benchCount: p._mainBenchCount }, mainLoot);
        html += renderRaidCols({ ...p, raids: p._mainRaids || p.raids }, [p.name]);
        html += '</tr>';
      } else {
        // Regular (non-merged) row
        const pLoot = lootByPlayer.get(p.name) || [];
        html += `<tr${_noTmbRow ? ' class="no-tmb" title="Kein TMB-Account"' : ''}>`;
        html += `<td class="col-player ${css}">${renderPlayerName(p.name)}${_noTmbRow ? ' <small class="no-tmb-tag">kein TMB</small>' : ''}<span class="role-badge role-${(p.mainRole || 'DD').toLowerCase()}">${p.mainRole || 'DD'}</span></td>`;
        html += renderSummaryCols(p, pLoot);
        html += renderRaidCols(p, [p.name]);
        html += '</tr>';
      }
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Wire report links to open in the report viewer
    container.querySelectorAll('th[data-code]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => openReport(th.dataset.code));
    });

    // Wire merge expand/collapse toggles
    container.querySelectorAll('.merge-parent').forEach(row => {
      row.addEventListener('click', () => {
        const gid = row.dataset.mergeGroup;
        const children = container.querySelectorAll(`.merge-child[data-merge-group="${gid}"]`);
        const expanded = !children[0]?.classList.contains('hidden');
        const toggle = row.querySelector('.merge-toggle');
        children.forEach(c => c.classList.toggle('hidden', expanded));
        if (toggle) toggle.innerHTML = expanded ? '&#9654;' : '&#9660;';
        row.classList.toggle('merge-expanded', !expanded);
      });
    });
  }

  // ─── LIVE TICKER (25-man only, own tab) ───

  // ─── LIVE TICKER (server-side analysis, frontend is pure view) ───

  let liveTimerId = null;
  let liveLastData = null;
  let liveLastFightCount = 0;

  function initLiveTicker() {
    // Poll server every 120s
    pollLiveStatus();
    liveTimerId = setInterval(pollLiveStatus, 120 * 1000);

    // Wire healer filter
    const cb = $('#live-hide-healer-downranks');
    if (cb) cb.addEventListener('change', () => { if (liveLastData) renderLiveView(liveLastData); });
  }

  async function pollLiveStatus() {
    try {
      const resp = await fetch('/api/live/status');
      if (!resp.ok) return;
      const data = await resp.json();
      liveLastData = data;

      // Live indicator
      const dot = $('#live-dot-tab');
      if (dot) {
        if (data.raidActive) dot.classList.remove('hidden');
        else dot.classList.add('hidden');
      }

      // Kein Auto-Switch + kein Auto-Dashboard-Refresh mehr — User soll auf der Seite
      // bleiben auf der er gerade ist. Live-Dot in der Nav signalisiert dass ein Raid
      // läuft, der Live-Tab aktualisiert sich nur wenn der User dort hin navigiert.
      renderLiveView(data);
      liveLastFightCount = data.fights ? data.fights.length : 0;

    } catch (e) {
      console.warn('[LIVE] Poll error:', e);
    }
  }

  // ─── WoW-Loading-Screen-Tipps (Easter Egg, nur Do 2026-05-14 23:00 → Fr 2026-05-15 03:00) ───
  const WOW_TIPS = [
    // ── SSC: Hydross the Unstable ──
    'Hydross: Die Aura wechselt. Dein Resistance-Set sollte das auch.',
    'Hydross: Frost-Set bei Nature-Aura ist eine kreative Wahl. Aber keine gute.',
    'Hydross: Tank-Position vor dem Aura-Wechsel klären. "Irgendwo" ist keine Position.',
    'Hydross: Wer die Aura ignoriert, schmilzt vor sich hin. Sichtbar, langsam, vermeidbar.',

    // ── SSC: The Lurker Below ──
    'Lurker Below: Solange der Boss unter Wasser ist, ist er nicht oben.',
    'Lurker: Spout ist nicht zum Mitsingen. Steh nicht im Strahl.',
    'Lurker: Whirl macht AoE. Schwimmen sollte man können.',
    'Lurker: Wenn niemand angelt, pullt niemand. Nüchtern betrachtet logisch.',
    'Lurker: Add-Wellen kommen auch noch. Falls Du Dich gelangweilt hast.',

    // ── SSC: Leotheras the Blind ──
    'Leotheras Whirlwind: 10 Yards weg. Nicht 9.',
    'Leotheras Demon-Phase: Inner Demons töten. Sonst sterben sie nicht.',
    'Leotheras: Banish hilft im Demon-Switch. Auch wenn keiner gerne zaubert.',
    'Leotheras: Dein Inner Demon hat ca. 30% Deiner HP. Klingt wenig, ist es nicht.',
    'Leotheras: "Ich greife Euch nicht an" gilt nicht im Whirlwind.',

    // ── SSC: Fathom-Lord Karathress ──
    'Karathress: 4 Bosse, eine Reihenfolge. "Egal" ist keine Reihenfolge.',
    'Karathress: Caribdis heilt. Caribdis stirbt zuerst. Klare Logik.',
    'Karathress: Tidalvess castet Totems. Töte sie. Sie bewegen sich nicht.',
    'Karathress: Sharkkis hat ein Pet. Es ist kein Reittier.',
    'Karathress selbst stirbt zuletzt. Das nennt man Council.',

    // ── SSC: Morogrim Tidewalker ──
    'Morogrim: Quake-Cast hörbar. Sprungheilung empfohlen.',
    'Morogrim: Murlocs spawnen. Töte sie. Sie sind keine Snacks.',
    'Morogrim: Watery Grave heißt Du sitzt in einer Blase. Der Raid muss Dich rausschlagen.',
    'Morogrim: Earthquake = AoE. Heiler-Bingo, weil alle 25 gleichzeitig Schaden kriegen.',

    // ── SSC: Lady Vashj ──
    'Vashj Phase 2: Tainted Elementals droppen die Cores. Erst töten, dann werfen.',
    'Vashj Phase 2: Kerne in die Generatoren. Nicht auf den Boden.',
    'Vashj: 4 Generatoren um die Plattform. Einer wird trotzdem vergessen.',
    'Vashj Phase 3: Naga-Wellen. "Welle" bedeutet: mehrere nacheinander.',
    'Vashj ist die letzte SSC. Vor ihr kommen 5 andere. Manche vergessen das.',
    'Vashj: Wer den Kern fallen lässt, sucht ihn auf dem Boden. Boden ist groß.',

    // ── TK: Al'ar ──
    'Al’ar: Vögel sind feindlich. Auch die, die hübsch aussehen.',
    'Al’ar Phase 1: 4 Plattformen. Er wechselt. Du auch.',
    'Al’ar Phase 2: Embers sind Adds. Töte sie, bevor sie explodieren.',
    'Al’ar: Wer von der Plattform fällt, fällt. Es gibt keinen sicheren Fall.',
    'Al’ar: Wenn er als Asche wieder auftaucht, ist Phase 2 da. Überraschung.',

    // ── TK: Void Reaver ──
    'Void Reaver: Arkane Kugeln machen Schaden. Ausweichen wird empfohlen.',
    'Void Reaver: Pounding trifft alle in Melee. Heiler bitte nicht überraschen lassen.',
    'Void Reaver: Ranged spreaden auf 15 Yards. Wegen der Orbs, nicht aus Antipathie.',
    'Void Reaver droppt Loot. Sonst hieße er nicht so.',
    'Void Reaver Orb: fliegt langsam. Davon laufen reicht meistens.',

    // ── TK: High Astromancer Solarian ──
    'Solarian: Drei Solarians = drei Ziele. Nicht eines.',
    'Solarian Phase 1: Adds. Töte sie. Sie kommen sonst weiter.',
    'Solarian: Wormholes teleportieren. Sie sind nicht zum Spaß da.',
    'Solarian Phase 3: Wenn die drei wieder eine sind, wird es nochmal richtig laut.',

    // ── TK: Kael'thas Sunstrider ──
    'Kael’thas Phase 1: Sieben Waffen, sieben Aufgaben. Klingt nach Spaß. Ist es nicht.',
    'Kael’thas Phase 2: 4 Advisor. Reihenfolge wichtig. Improvisation nicht.',
    'Kael’thas Phase 3: Alle Waffen wieder, diesmal gleichzeitig. Halt Dich fest.',
    'Kael’thas Phase 4: Pyroblast hat einen Cast. Unterbrich ihn.',
    'Kael’thas Phase 5: Wer fällt, fällt langsam. Es heilt trotzdem nicht.',
    'Kael’thas: Mind Control ist temporär. Vielleicht.',
    'Kael’thas: Gravity Lapse macht alle fliegen. Auch die, die nicht wollten.',

    // ── Allgemein Captain Obvious ──
    'Steh nicht in der bunten Pfütze. Das einzige Raid-Manual, das Du wirklich brauchst.',
    'Wenn der Boss noch volle HP hat, ist er noch nicht tot.',
    'Wenn der Heiler "OOM" schreibt, meint er OOM. Nicht "fast".',
    'Drei Markierungen am Boden = drei Sachen die explodieren.',
    'Wenn der Tank stirbt, stirbt meistens der Raid.',
    'Cooldown nutzen ist besser als Cooldown verlieren.',
    'Enrage-Timer existiert. Bosse warten nicht auf Dich.',
    'Wenn "Aggro!" im Chat steht, hat jemand Aggro. Wahrscheinlich Du.',
    'Adds zuerst. Außer es ist anders. Dann anders.',
    'Heiler heilen. DPS macht DPS. Tanks tanken. Theoretisch.',

    // ── Raid-Hygiene (Captain Obvious): aus dem Roster motiviert ──
    'Flask ist nicht "nice to have". Es ist "have". Auch im 19. Fight.',
    'Weapon-Enhancement heißt "Enhancement". Nicht "Optional Enhancement".',
    'Vanilla-Enchants sind Klassiker. Aber wir sind nicht mehr in Vanilla.',
    'Common- und Uncommon-Gems gehören in die Bank, nicht ins Gear.',
    'Leere Sockel sind keine Stilfrage. Da gehört was rein.',
    'Fehlende Verzauberungen auf 5 Slots sind kein Build. Das ist eine Notiz.',
    'Food Buff: gibt es, wenn Du Food isst. Sonst nicht.',
    'Scrolls sind günstig. Stats sind teuer. Macht Mathe.',
    'Wer ohne Reparieren startet, raidet mit halben Items.',
    'Top-Parse auf Trash ist kein DPS-Beweis. Es ist ein Trash-Parse.',
    'Details! ist eine Statistik. Kein Charakterzeugnis.',
    'Wer downranked, spart Mana. Spart auch Output. Trade-off.',
    'Heiler heilen sich auch selbst. Theoretisch. Manchmal.',
    'Tank pullt. DPS wartet. So rum, nicht andersrum.',

    // ── Klassische WoW-Memes ──
    '„Leeeeeroy Jenkins!" — der älteste Pull-Befehl der WoW-Geschichte. Funktioniert seit 2005 in 0% der Fälle.',
    '„Many whelps! Handle it!" — Onyxia, 2006. Heute übertragbar auf jede Add-Phase.',
    '„Onyxia deep breath MORE!" Mehr Atem geht nicht. Trotzdem überlebt es keiner.',
    '„You are not prepared!" — Illidan wusste es vor Dir. Er wusste auch warum.',
    '„Time is money, friend." Goblin-Weisheit seit 2004. Macht jede Repair-Bill teurer.',
    'Details! ist kein Penisvergleich. (Doch.)',
    '„l2p" war früher das gesamte Coaching-Konzept. Hat trotzdem irgendwie geklappt.',
    '„WTB Healer für Heroic" — der ehrlichste Job-Antrag in Outland.',
  ];
  function isWowTipsActive() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    const h = now.getHours();
    if (y === 2026 && mo === 4 && d === 14 && h >= 23) return true;
    if (y === 2026 && mo === 4 && d === 15 && h < 3) return true;
    return false;
  }
  function pickWowTip() {
    return WOW_TIPS[Math.floor(Math.random() * WOW_TIPS.length)];
  }
  function renderWowTip() {
    if (!isWowTipsActive()) return '';
    return `<div class="wow-tip"><span class="wow-tip-label">Tipp:</span> <span class="wow-tip-text">${escapeHtml(pickWowTip())}</span></div>`;
  }
  let wowTipTimer = null;
  function ensureWowTipRotation() {
    if (!isWowTipsActive()) {
      if (wowTipTimer) { clearInterval(wowTipTimer); wowTipTimer = null; }
      return;
    }
    if (wowTipTimer) return;
    wowTipTimer = setInterval(() => {
      const el = document.querySelector('.wow-tip .wow-tip-text');
      if (!el) return;
      if (!isWowTipsActive()) { clearInterval(wowTipTimer); wowTipTimer = null; return; }
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = pickWowTip(); el.style.opacity = '1'; }, 350);
    }, 9000);
  }

  // Items die nicht in die "Σ Genommen"-Summe zählen — admin-konfigurierbar via consumesExcludedIds.
  // Default-Ausschluss (wenn kein Setting gesetzt):
  //   Healthstones R1-R3, Mana Emerald, Mana Ruby (klassen-exklusive / verschenkte Items),
  //   Engineering-Items (Engi-Profession only),
  //   Demonic Rune (Lock-exklusiv), Thistle Tea (Rogue-exklusiv).
  const DEFAULT_FREE_CONJURED_IDS = [
    // Healthstones + Mana Gems
    22105, 22104, 22103, 22044, 8008,
    27235, 27236, 27237, 27101, 27103,
    // Engineering items (Profession-locked)
    23827, 30486, 10646, 13241, 23737, 30217, 23736, 30216, 18641, 23063, 23841, 30526, 24268, 31367,
    // Class-exclusive items
    12662, 16666,        // Demonic Rune (Lock)
    7676, 9512,          // Thistle Tea (Rogue)
  ];
  const DEFAULT_SLACKER_THRESHOLD_PCT = 35;
  function getExcludedConsumeIds() {
    if (Array.isArray(window._consumesExcludedIds)) return new Set(window._consumesExcludedIds);
    return new Set(DEFAULT_FREE_CONJURED_IDS);
  }
  const isFreeConjured = (i) => {
    const ex = getExcludedConsumeIds();
    if (i.itemId && ex.has(i.itemId)) return true;
    if (i.spellId && ex.has(i.spellId)) return true;
    return false;
  };

  function renderRaidConsumablesSummary(data) {
    if (!data.fights || !data.fights.length) return '';
    const renderIcon = (i) => {
      const inner = i.uses > 1 ? `<span class="cons-icon-count">${i.uses}</span>` : '';
      if (i.itemId) return `<span class="cons-icon-wrap" title="${escapeHtml(i.label)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/item=${i.itemId}" data-wowhead="item=${i.itemId}&amp;domain=tbc" class="cons-icon-link" rel="np">${escapeHtml(i.label)}</a>${inner}</span>`;
      if (i.spellId) return `<span class="cons-icon-wrap" title="${escapeHtml(i.label)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/spell=${i.spellId}" data-wowhead="spell=${i.spellId}" class="cons-icon-link" rel="np">${escapeHtml(i.label)}</a>${inner}</span>`;
      return `<span class="cons-text-fallback" title="${escapeHtml(i.label)}">${i.uses}× ${escapeHtml(i.label)}</span>`;
    };
    // Aggregiere pro Spieler über ALLE Fights — getrennt: consMap (Cons inkl. Free-Conjured) + trinketMap (Trinkets)
    const consByPlayer = new Map();
    const trinketByPlayer = new Map();
    for (const f of data.fights) {
      for (const c of (f.consumables || [])) {
        let entry = consByPlayer.get(c.name);
        if (!entry) { entry = { name: c.name, type: c.type, items: new Map() }; consByPlayer.set(c.name, entry); }
        for (const i of (c.items || [])) {
          const key = i.itemId ? `i${i.itemId}` : i.spellId ? `s${i.spellId}` : `n${i.label}`;
          const ex = entry.items.get(key);
          if (ex) ex.uses += (i.uses || 0);
          else entry.items.set(key, { label: i.label, cat: i.cat, itemId: i.itemId, spellId: i.spellId, uses: i.uses || 0 });
        }
      }
      for (const t of (f.trinketUsage || [])) {
        let entry = trinketByPlayer.get(t.name);
        if (!entry) { entry = { name: t.name, type: t.type, items: new Map() }; trinketByPlayer.set(t.name, entry); }
        for (const i of (t.items || [])) {
          const key = i.itemId ? `i${i.itemId}` : `s${i.spellId}`;
          const ex = entry.items.get(key);
          if (ex) ex.uses += (i.uses || 0);
          else entry.items.set(key, { label: i.name, itemId: i.itemId, spellId: i.spellId, uses: i.uses || 0 });
        }
      }
    }
    // Cons-Liste: gezählte Items (Free-conjured ausgeschlossen) gehen ins Total
    const consPlayers = [...consByPlayer.values()].map(p => {
      const items = [...p.items.values()];
      const total = items.filter(i => !isFreeConjured(i)).reduce((s, i) => s + (i.uses || 0), 0);
      return { ...p, total };
    }).filter(p => p.items.size > 0).sort((a, b) => b.total - a.total);
    // Trinket-Liste: alle Casts zählen
    const trinketPlayers = [...trinketByPlayer.values()].map(p => {
      const items = [...p.items.values()];
      const total = items.reduce((s, i) => s + (i.uses || 0), 0);
      return { ...p, total };
    }).filter(p => p.items.size > 0).sort((a, b) => b.total - a.total);
    if (!consPlayers.length && !trinketPlayers.length) return '';
    const totalConsUses = consPlayers.reduce((s, p) => s + p.total, 0);
    const totalTrinketUses = trinketPlayers.reduce((s, p) => s + p.total, 0);
    const consPrimus = consPlayers[0]?.total || 0;
    const _thPct = Number.isFinite(window._consumesSlackerPct) ? window._consumesSlackerPct : DEFAULT_SLACKER_THRESHOLD_PCT;
    const consSlackerTh = Math.ceil(consPrimus * (_thPct / 100));
    const trinketPrimus = trinketPlayers[0]?.total || 0;
    const trinketSlackerTh = Math.ceil(trinketPrimus * (_thPct / 100));

    const renderColumn = (title, players, primusName, primus, slackerTh, totalU, sideClass) => {
      let h = `<div class="raid-summary-side ${sideClass}">`;
      h += `<div class="raid-summary-side-head"><strong>${escapeHtml(title)}</strong><span class="text-muted">${players.length} Spieler · ${totalU} Casts${primus > 0 ? ` · Primus: ${escapeHtml(primusName)} (${primus})` : ''}</span></div>`;
      h += '<ul class="slacker-list slacker-list--summary">';
      let dividerShown = false;
      for (const p of players) {
        const isSlacker = primus > 0 && p.total < slackerTh;
        if (isSlacker && !dividerShown) {
          h += `<li class="slacker-divider"><span class="slacker-divider-line"></span><span class="slacker-divider-label">⚠ Slacker (&lt; ${slackerTh})</span><span class="slacker-divider-line"></span></li>`;
          dividerShown = true;
        }
        const css = classCssFromType(p.type);
        const items = [...p.items.values()].sort((a, b) => b.uses - a.uses);
        const iconsHtml = items.map(renderIcon).join('');
        h += `<li class="slacker-row${isSlacker ? ' is-slacker' : ''}"><span class="slacker-name ${css}">${renderPlayerName(p.name)}</span><span class="slacker-pills">${iconsHtml}<span class="raid-cons-total${isSlacker ? ' raid-cons-total--low' : ''}">${p.total}</span></span></li>`;
      }
      h += '</ul></div>';
      return h;
    };

    let html = '<details class="raid-cons-summary">';
    html += `<summary><span class="raid-cons-icon">🧪</span><span class="raid-cons-title">Raid-Übersicht Consumables & Trinkets</span><span class="raid-cons-meta">${totalConsUses} Cons · ${totalTrinketUses} Trinket-Casts über ${data.fights.length} Fights</span></summary>`;
    html += '<div class="raid-summary-split">';
    html += renderColumn('Consumables', consPlayers, consPlayers[0]?.name || '', consPrimus, consSlackerTh, totalConsUses, '');
    html += renderColumn('On-Use Trinkets', trinketPlayers, trinketPlayers[0]?.name || '', trinketPrimus, trinketSlackerTh, totalTrinketUses, 'raid-summary-side--trinkets');
    html += '</div></details>';
    return html;
  }

  function renderLiveView(data) {
    const container = $('#live-ticker-content');
    if (!container) return;

    if (!data.active || !data.reportCode) {
      const sched = (window._branding && window._branding.raidSchedule) || [];
      let msg = 'Kein Live-Raid erkannt. Der Ticker sucht automatisch nach aktiven Raids.';
      if (sched.length) {
        const dayMap = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So' };
        const days = sched.map(s => dayMap[s.dayOfWeek] || '?').join('/');
        const times = [...new Set(sched.map(s => s.startTime).filter(Boolean))].join('/');
        msg = `Kein Live-Raid erkannt. Der Ticker sucht ${days}${times ? ' ab ' + times : ''} automatisch nach aktiven Raids.`;
      }
      container.innerHTML = `<p class="text-muted">${escapeHtml(msg)}</p>`;
      return;
    }

    const zone = CLA_DATA.zones[data.zone] || { name: '?', short: '?', color: '#666' };
    const startTime = data.raidStart ? CLA_DATA.formatDate(data.raidStart) : '';
    const settings = getSettings();
    const hideHealers = $('#live-hide-healer-downranks')?.checked !== false;
    // Player-ID → Name Map für Wipe-Card-Rendering
    if (data.wipesAnalysis && Array.isArray(data.wipesAnalysis)) {
      window._playerIdToName = window._playerIdToName || {};
      for (const w of data.wipesAnalysis) {
        for (const p of (w.players || [])) {
          if (p.id != null && p.name) window._playerIdToName[p.id] = p.name;
        }
      }
    }
    // Index wipes by fightId für schnellen Lookup
    const wipesByFightId = {};
    for (const w of (data.wipesAnalysis || [])) wipesByFightId[w.fightId] = w;

    let html = '';

    // ── Sticky Header (kompakt) ──
    html += '<div class="live-header-v2">';
    html += `<span class="zone-badge" style="background:${zone.color}22;color:${zone.color}">${zone.short}</span>`;
    html += `<span class="live-header-title">${escapeHtml(zone.name)}</span>`;
    if (data.raidActive) {
      html += '<span class="live-status active"><span class="live-dot-tab"></span>Live</span>';
    } else {
      html += '<span class="live-status ended">Beendet</span>';
    }
    html += `<span class="live-header-meta">${startTime}</span>`;
    if (data.fights && data.fights.length) {
      const kills = data.fights.filter(f => f.kill).length;
      const wipes = data.fights.filter(f => !f.kill).length;
      html += `<span class="live-header-stats"><span class="bg-kill">✅ ${kills}</span><span class="bg-wipe">💀 ${wipes}</span></span>`;
    }
    if (data.analyzing) html += '<span class="live-analyzing">Analysiere…</span>';
    html += '</div>';

    if (!data.fights || !data.fights.length) {
      html += renderWowTip();
      html += '<p class="text-muted" style="margin-top:24px">Warte auf ersten Boss-Pull...</p>';
      container.innerHTML = html;
      ensureWowTipRotation();
      return;
    }

    // ── Raid-Übersicht Consumables (aggregiert über alle Fights) ──
    html += renderRaidConsumablesSummary(data);

    // ── Fights: latest expanded, older compact (click-to-expand) ──
    html += '<div class="live-fights-list-v2">';
    for (let i = 0; i < data.fights.length; i++) {
      const f = data.fights[i];
      const isNewest = i === 0;
      const dur = CLA_DATA.formatDuration(f.duration);
      const resultClass = f.kill ? 'kill' : 'wipe';
      const resultText = f.kill ? '✅ Kill' : '💀 Wipe';
      const fightNum = data.fights.length - i;

      const buffSlackerCount = (f.slackers?.buffs || []).length;
      const spellSlackerCount = (hideHealers ? (f.slackers?.spellranks || []).filter(s => !s.isHealer) : (f.slackers?.spellranks || [])).length;
      const fId = f.fightId ?? f.id;
      const wipeData = wipesByFightId[fId];

      // Compact card for older fights, expanded for newest
      html += `<div class="live-fight-card-v2${isNewest ? ' expanded latest' : ''}" data-fightid="${fId}">`;
      // === Compact-Header (clickable bei nicht-newest) ===
      html += '<div class="live-fight-head-v2">';
      html += `<span class="fight-num">#${fightNum}</span>`;
      html += `<span class="fight-name">${escapeHtml(f.name)}</span>`;
      html += `<span class="fight-result ${resultClass}">${resultText}</span>`;
      html += `<span class="fight-dur">${dur}</span>`;
      html += `<span class="fight-time">${f.fightTime || ''}</span>`;
      // Mini-Stats Badges (clickable Indicators)
      html += '<span class="fight-mini-stats">';
      if (buffSlackerCount) html += `<span class="mini-stat buff">🛡 ${buffSlackerCount}</span>`;
      if (spellSlackerCount) html += `<span class="mini-stat spell">📜 ${spellSlackerCount}</span>`;
      if (wipeData) {
        const tag = wipeData.kill ? '<span class="mini-stat kill-analyse">✅ Analyse</span>' : '<span class="mini-stat wipe-analyse">💀 Analyse</span>';
        html += tag;
      }
      html += '</span>';
      if (!isNewest) html += '<span class="fight-toggle">▶</span>';
      html += '</div>';

      // Body wird je nach Expansion-State angezeigt (default: latest expanded, andere collapsed)
      html += '<div class="live-fight-body-v2">';

      // ── Three Card Layout: Buffs / Spell-Ranks / Consumables nebeneinander ──
      const buffSlackers = f.slackers?.buffs || [];
      let spellSlackers = f.slackers?.spellranks || [];
      if (hideHealers) spellSlackers = spellSlackers.filter(s => !s.isHealer);
      const cons = (f.consumables || []).filter(c => (c.pot || 0) + (c.rune || 0) + (c.engi || 0) + (c.other || 0) + (c.mana || 0) + (c.health || 0) > 0);
      const cleanText = (t) => (t || '')
        .replace(/\s*\(Policy[\-‑– ]?Verstoss\)/gi, '')   // (Policy-Verstoss) Marker entfernen
        .replace(/\s*fehlt\b/gi, '')
        .replace(/^\s*[;,]\s*|\s*[;,]\s*$/g, '')
        .trim();
      const BUFF_CAT_ICON = {
        Flask:   { item: 22851, label: 'Flask' },
        Food:    { item: 27658, label: 'Food' },
        Scrolls: { item: 27498, label: 'Scrolls' },
      };
      // Weapon-Enhancement-Icon hängt von Klasse ab: Physical → Stone, Caster → Wizard Oil, Healer → Mana Oil
      const WEAPON_ICON_BY_TYPE = {
        Warrior:        { item: 23529, label: 'Stone' },
        Rogue:          { item: 23529, label: 'Stone' },
        Hunter:         { item: 23529, label: 'Stone' },
        'Death Knight': { item: 23529, label: 'Stone' },
        Paladin:        { item: 23529, label: 'Stone' },
        Shaman:         { item: 23529, label: 'Stone' },
        Druid:          { item: 22521, label: 'Mana Oil' },
        Mage:           { item: 22522, label: 'Wizard Oil' },
        Warlock:        { item: 22522, label: 'Wizard Oil' },
        Priest:         { item: 22521, label: 'Mana Oil' },
      };
      const WEAPON_FALLBACK = { item: 23529, label: 'Weapon' };
      const renderBuffMissIcon = (iss, playerType) => {
        const info = iss.cat === 'Weapon'
          ? (WEAPON_ICON_BY_TYPE[playerType] || WEAPON_FALLBACK)
          : BUFF_CAT_ICON[iss.cat];
        const isPolicyViolation = iss.policy === true || /Policy-Verstoss/i.test(iss.text || '');
        const detail = cleanText(iss.text);
        const tooltip = `${iss.cat}: ${detail || 'fehlt'}${isPolicyViolation ? ' (Policy)' : ''}`;
        const iconCls = isPolicyViolation ? 'buff-miss-icon buff-policy' : 'buff-miss-icon';
        // Policy-Verstoss: Icon vom tatsächlich konsumierten Spell, kein generisches Flask-Item
        if (isPolicyViolation && iss.spellId) {
          return `<span class="buff-miss" title="${escapeHtml(detail || iss.cat)} (Policy)"><a href="https://www.wowhead.com/tbc/spell=${iss.spellId}" data-wowhead="spell=${iss.spellId}" class="cons-icon-link ${iconCls}" rel="np">${escapeHtml(detail || iss.cat)}</a>${detail ? `<span class="buff-miss-tag">${escapeHtml(detail)}</span>` : ''}</span>`;
        }
        if (info) {
          if (iss.cat === 'Scrolls' && !detail) return '';
          if (iss.cat === 'Scrolls') {
            return `<span class="buff-miss"><span class="cons-icon-link ${iconCls} buff-miss-static" style="background-image:url('https://wow.zamimg.com/images/wow/icons/medium/inv_scroll_05.jpg')"></span>${detail && detail.toLowerCase() !== iss.cat.toLowerCase() ? `<span class="buff-miss-tag">${escapeHtml(detail)}</span>` : ''}</span>`;
          }
          return `<span class="buff-miss" title="${escapeHtml(tooltip)}"><a href="https://www.wowhead.com/tbc/item=${info.item}" data-wowhead="item=${info.item}&amp;domain=tbc" class="cons-icon-link ${iconCls}" rel="np">${escapeHtml(info.label)}</a>${detail && detail.toLowerCase() !== iss.cat.toLowerCase() ? `<span class="buff-miss-tag">${escapeHtml(detail)}</span>` : ''}</span>`;
        }
        return `<span class="issue-pill issue-pill--high" title="${escapeHtml(tooltip)}">${escapeHtml(iss.cat)}${detail ? ` · ${escapeHtml(detail)}` : ''}</span>`;
      };
      const renderConsIcon = (i) => {
        const inner = i.uses > 1 ? `<span class="cons-icon-count">${i.uses}</span>` : '';
        if (i.itemId) return `<span class="cons-icon-wrap" title="${escapeHtml(i.label)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/item=${i.itemId}" data-wowhead="item=${i.itemId}&amp;domain=tbc" class="cons-icon-link" rel="np">${escapeHtml(i.label)}</a>${inner}</span>`;
        if (i.spellId) return `<span class="cons-icon-wrap" title="${escapeHtml(i.label)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/spell=${i.spellId}" data-wowhead="spell=${i.spellId}" class="cons-icon-link" rel="np">${escapeHtml(i.label)}</a>${inner}</span>`;
        return `<span class="cons-text-fallback" title="${escapeHtml(i.label)}">${i.uses}× ${escapeHtml(i.label)}</span>`;
      };

      html += '<div class="live-cards-grid">';

      // ─── Card 1: Buff Slackers ───
      html += '<section class="live-card live-card--buffs">';
      html += `<header class="live-card-head"><span class="live-card-pulse"></span><span class="live-card-title">Missing Buffs</span><span class="live-card-count">${buffSlackers.length}</span></header>`;
      if (buffSlackers.length) {
        html += '<ul class="card-rows">';
        for (const s of buffSlackers) {
          const css = classCssFromType(s.type);
          // Expand each issue; Scrolls/Weapon-Mehrfach und Flask-Policy werden in einzelne Zeilen aufgeteilt
          const expanded = [];
          for (const iss of s.issues) {
            const detail = cleanText(iss.text);
            // Flask-Policy mit konkreten parts (z.B. Battle + Guardian Elixier)
            if (iss.cat === 'Flask' && iss.policy && Array.isArray(iss.parts) && iss.parts.length) {
              for (const part of iss.parts) {
                expanded.push({ cat: iss.cat, text: part.text, policy: true, spellId: part.spellId });
              }
            } else if (iss.cat === 'Scrolls' && detail && /[,;]\s/.test(detail)) {
              for (const part of detail.split(/[,;]\s*/).filter(Boolean)) {
                expanded.push({ ...iss, text: part });
              }
            } else if (iss.cat === 'Weapon' && /\+/.test(detail || '')) {
              for (const part of detail.replace(/\s*fehlt\s*$/i, '').split(/\s*\+\s*/).filter(Boolean)) {
                expanded.push({ ...iss, text: part });
              }
            } else {
              expanded.push(iss);
            }
          }
          for (let i = 0; i < expanded.length; i++) {
            const iss = expanded[i];
            const nameCell = i === 0
              ? `<span class="card-row-name ${css}">${renderPlayerName(s.name)}</span>`
              : `<span class="card-row-name card-row-name--cont"></span>`;
            const contCls = i > 0 ? ' card-row--cont' : '';
            html += `<li class="card-row${contCls}">${nameCell}<span class="card-row-body">${renderBuffMissIcon(iss, s.type)}</span></li>`;
          }
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">Alle OK ✓</div>';
      }
      html += '</section>';

      // ─── Card 2: Downranked Spells ───
      html += '<section class="live-card live-card--spells">';
      html += `<header class="live-card-head"><span class="live-card-pulse"></span><span class="live-card-title">Downranked Spells</span><span class="live-card-count">${spellSlackers.length}</span></header>`;
      if (spellSlackers.length) {
        html += '<ul class="card-rows">';
        for (const s of spellSlackers) {
          const css = classCssFromType(s.type);
          const pills = s.issues.map(sp =>
            `<span class="cons-icon-wrap" title="${escapeHtml(sp.spellName)} R${sp.rank}/${sp.maxRank} — ${sp.casts}×"><a href="https://www.wowhead.com/tbc/spell=${sp.spellId}" data-wowhead="spell=${sp.spellId}" class="cons-icon-link" rel="np">${escapeHtml(sp.spellName)}</a>${sp.casts > 1 ? `<span class="cons-icon-count">${sp.casts}</span>` : ''}</span>`
          ).join('');
          html += `<li class="card-row"><span class="card-row-name ${css}">${renderPlayerName(s.name)}</span><span class="card-row-body">${pills}</span></li>`;
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">Alle Max-Rank ✓</div>';
      }
      html += '</section>';

      // ─── Card 3: Consumables — 2 Spalten (links Verbrauchten, rechts Slacker) ───
      const allCons = f.consumables || [];
      const noConsList = allCons.filter(c => (c.pot || 0) + (c.rune || 0) + (c.engi || 0) + (c.other || 0) + (c.mana || 0) + (c.health || 0) === 0);
      html += '<section class="live-card live-card--cons">';
      html += `<header class="live-card-head"><span class="live-card-pulse"></span><span class="live-card-title">Consumables</span><span class="live-card-count">${cons.length}/${cons.length + noConsList.length}</span></header>`;
      html += '<div class="cons-split">';
      // Links: Verbrauchten
      html += '<div class="cons-split-col">';
      html += `<div class="cons-split-head">${cons.length} verbraucht</div>`;
      if (cons.length) {
        html += '<ul class="card-rows">';
        for (const c of cons) {
          const css = classCssFromType(c.type);
          const items = c.items.filter(i => ['pot','mana','health','rune','engi','other'].includes(i.cat)).map(renderConsIcon).join('');
          html += `<li class="card-row"><span class="card-row-name ${css}">${renderPlayerName(c.name)}</span><span class="card-row-body">${items}</span></li>`;
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">—</div>';
      }
      html += '</div>';
      // Rechts: No Consumes
      html += '<div class="cons-split-col cons-split-col--slacker">';
      html += `<div class="cons-split-head">${noConsList.length} ohne</div>`;
      if (noConsList.length) {
        html += '<ul class="card-rows">';
        for (const c of noConsList) {
          const css = classCssFromType(c.type);
          html += `<li class="card-row card-row--name-only is-slacker"><span class="card-row-name ${css}">${renderPlayerName(c.name)}</span></li>`;
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">Alle ✓</div>';
      }
      html += '</div>';
      html += '</div>';
      html += '</section>';

      // ─── Card 6: Major Cooldowns (2-8 min, Used + Slackers) ───
      const cdUsedList = f.cdUsage || [];
      const cdSlackList = f.cdSlackers || [];
      html += '<section class="live-card live-card--cds">';
      html += `<header class="live-card-head"><span class="live-card-pulse"></span><span class="live-card-title">Major CDs</span><span class="live-card-count">${cdUsedList.length}/${cdUsedList.length + cdSlackList.length}</span></header>`;
      if (cdUsedList.length || cdSlackList.length) {
        html += '<ul class="card-rows">';
        for (const u of cdUsedList) {
          const css = classCssFromType(u.type);
          const icons = (u.items || []).map(i => {
            const inner = i.uses > 1 ? `<span class="cons-icon-count">${i.uses}</span>` : '';
            return `<span class="cons-icon-wrap" title="${escapeHtml(i.name)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/spell=${i.spellId}" data-wowhead="spell=${i.spellId}" class="cons-icon-link" rel="np">${escapeHtml(i.name)}</a>${inner}</span>`;
          }).join('');
          html += `<li class="card-row"><span class="card-row-name ${css}">${renderPlayerName(u.name)}</span><span class="card-row-body">${icons}</span></li>`;
        }
        if (cdSlackList.length) {
          html += `<li class="trinket-slacker-divider"><span>⚠ Kein Major-CD gepoppt</span></li>`;
          for (const s of cdSlackList) {
            const css = classCssFromType(s.type);
            const missing = (s.missing || []).map(m =>
              `<span class="buff-miss" title="${escapeHtml(m.name)} — nicht gepoppt"><a href="https://www.wowhead.com/tbc/spell=${m.spellId}" data-wowhead="spell=${m.spellId}" class="cons-icon-link buff-miss-icon" rel="np">${escapeHtml(m.name)}</a></span>`
            ).join('');
            html += `<li class="card-row is-slacker"><span class="card-row-name ${css}">${renderPlayerName(s.name)}</span><span class="card-row-body">${missing}</span></li>`;
          }
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">Keine CD-Pops</div>';
      }
      html += '</section>';

      // ─── Card 5: On-Use Trinkets (Used + Slackers) ───
      const trinkets = (f.trinketUsage || []).filter(t => t.total > 0);
      const trinketSlackers = (f.trinketSlackers || []);
      html += '<section class="live-card live-card--trinkets">';
      html += `<header class="live-card-head"><span class="live-card-pulse"></span><span class="live-card-title">On-Use Trinkets</span><span class="live-card-count">${trinkets.length}/${trinkets.length + trinketSlackers.length}</span></header>`;
      if (trinkets.length || trinketSlackers.length) {
        html += '<ul class="card-rows">';
        for (const t of trinkets) {
          const css = classCssFromType(t.type);
          const icons = t.items.map(i => {
            const inner = i.uses > 1 ? `<span class="cons-icon-count">${i.uses}</span>` : '';
            return `<span class="cons-icon-wrap" title="${escapeHtml(i.name)} ×${i.uses}"><a href="https://www.wowhead.com/tbc/item=${i.itemId}" data-wowhead="item=${i.itemId}&amp;domain=tbc" class="cons-icon-link" rel="np">${escapeHtml(i.name)}</a>${inner}</span>`;
          }).join('');
          html += `<li class="card-row"><span class="card-row-name ${css}">${renderPlayerName(t.name)}</span><span class="card-row-body">${icons}</span></li>`;
        }
        if (trinketSlackers.length) {
          html += `<li class="trinket-slacker-divider"><span>⚠ Equipped, nicht benutzt</span></li>`;
          for (const s of trinketSlackers) {
            const css = classCssFromType(s.type);
            const icons = s.unused.map(u =>
              `<span class="buff-miss" title="${escapeHtml(u.name)} — nicht benutzt"><a href="https://www.wowhead.com/tbc/item=${u.itemId}" data-wowhead="item=${u.itemId}&amp;domain=tbc" class="cons-icon-link buff-miss-icon" rel="np">${escapeHtml(u.name)}</a></span>`
            ).join('');
            html += `<li class="card-row is-slacker"><span class="card-row-name ${css}">${renderPlayerName(s.name)}</span><span class="card-row-body">${icons}</span></li>`;
          }
        }
        html += '</ul>';
      } else {
        html += '<div class="card-empty">Niemand</div>';
      }
      html += '</section>';

      html += '</div>'; // end live-cards-grid

      // === Fight-Analyse Section (Wipe oder Kill) ===
      if (wipeData) {
        const label = wipeData.kill ? '✅ Kill-Analyse' : '💀 Wipe-Analyse';
        html += `<details class="live-wipe-detail${wipeData.kill ? ' live-wipe-detail--kill' : ''}" open><summary>${label}</summary>`;
        html += renderSingleWipe(wipeData, { compact: true });
        html += '</details>';
      }

      html += '</div>'; // end body
      html += '</div>'; // end fight card
    }
    html += '</div>';

    // ── Tip (klein, am Ende) ──
    html += renderWowTip();

    // ── Gear Issues (fight-independent, bottom section) ──
    const rawGear = data.gearIssues || [];
    const SEV_RANK = { high: 3, medium: 2, low: 1 };
    // Apply settings filter + sort issues innerhalb jeder Karte nach Severity (desc)
    const gearResults = rawGear.map(r => {
      const filtered = filterIssuesBySettings(r.issues, settings)
        .slice()
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
      return { ...r, issues: filtered };
    }).filter(r => r.issues.length > 0);
    // Karten sortieren: max-severity desc, dann Anzahl Issues desc, dann Name asc
    gearResults.sort((a, b) => {
      const maxA = a.issues.reduce((m, i) => Math.max(m, SEV_RANK[i.severity] || 0), 0);
      const maxB = b.issues.reduce((m, i) => Math.max(m, SEV_RANK[i.severity] || 0), 0);
      if (maxA !== maxB) return maxB - maxA;
      const highA = a.issues.filter(i => i.severity === 'high').length;
      const highB = b.issues.filter(i => i.severity === 'high').length;
      if (highA !== highB) return highB - highA;
      if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
      return (a.name || '').localeCompare(b.name || '');
    });

    if (gearResults.length) {
      const totalGearIssues = gearResults.reduce((s, r) => s + r.issues.length, 0);
      html += '<div class="live-gear-section">';
      html += `<div class="live-gear-header"><span class="gear-head-dot"></span><span class="gear-head-title">Gear Issues</span><span class="gear-head-meta">${totalGearIssues} Issues · ${gearResults.length}/${data.totalPlayers || '?'} Spieler</span></div>`;
      // Disconnect-Issues silent rausfiltern (kein Banner)
      const realGear = gearResults.map(r => ({
        ...r,
        issues: (r.issues || []).filter(i => !i.disconnect)
      })).filter(r => r.issues.length > 0);
      html += '<div class="gear-grid">';
      for (const r of realGear) {
        const css = classCssFromType(r.type);
        const cn = classNameFromType(r.type);
        const maxSev = r.issues.reduce((m, i) => (SEV_RANK[i.severity] || 0) > (SEV_RANK[m] || 0) ? i.severity : m, 'low');
        html += `<div class="gear-card gear-card--${maxSev}">`;
        html += `<div class="gear-card-head"><span class="gear-card-name ${css}">${renderPlayerName(r.name)}</span><span class="gear-card-class ${css}">${cn}</span><span class="gear-card-count">${r.issues.length}</span></div>`;
        html += '<ul class="gear-issue-list">';
        for (const iss of r.issues) {
          const itemHtml = iss.itemId ? wowheadLink(iss.itemId, iss.itemName || iss.slot) : escapeHtml(iss.slot);
          const gemExtra = iss.gemId ? ' ' + wowheadGemLink(iss.gemId) : '';
          html += `<li class="gear-issue gear-issue--${iss.severity}">`;
          html += `<span class="gear-issue-dot"></span>`;
          html += `<span class="gear-issue-slot">${escapeHtml(iss.slot)}</span>`;
          html += `<span class="gear-issue-item">${itemHtml}${gemExtra}</span>`;
          html += `<span class="gear-issue-problem">${escapeHtml(iss.issue)}</span>`;
          html += `</li>`;
        }
        html += '</ul></div>';
      }
      html += '</div></div>';
    }

    container.innerHTML = html;
    try { window.$WowheadPower.refreshLinks(); } catch (e) {}
    ensureWowTipRotation();
    // Click-to-expand für nicht-latest Fight-Cards
    container.querySelectorAll('.live-fight-card-v2:not(.latest) .live-fight-head-v2').forEach(head => {
      head.addEventListener('click', () => {
        head.parentElement.classList.toggle('expanded');
        const toggle = head.querySelector('.fight-toggle');
        if (toggle) toggle.textContent = head.parentElement.classList.contains('expanded') ? '▼' : '▶';
      });
    });
  }

  // ─── EVENT WIRING ───

  // Store loaded bundle analysis data for client-side filtering
  let currentBundle = null;

  function initActions() {
    $('#gear-show-all').addEventListener('change', filterGearByFight);
    $('#gear-hide-offspec')?.addEventListener('change', filterGearByFight);
    $('#gear-fight-select').addEventListener('change', filterGearByFight);
    $('#btn-run-drums').addEventListener('click', analyzeDrums);
    $('#btn-run-sr').addEventListener('click', analyzeSR);
    $('#spellranks-fight-select').addEventListener('change', filterSpellRanksByFight);
    $('#spellranks-hide-healers').addEventListener('change', filterSpellRanksByFight);
    $('#avoidable-fight-select').addEventListener('change', filterAvoidableByFight);

    // Progression day/merge filter checkboxes
    const reRenderProg = () => {
      const d = window._lastProgression;
      if (d) renderProgression(d.players, d.reportMeta, d.reportCount, d.weekCount, d.settings, d.tmbRaidDays, d.tmbCharsByDayKey, d.tmbBenchedByDayKey, d.lootByPlayer, window._tmbRaidGroups, d.allWeeks);
    };
    const progThu = $('#prog-show-thu');
    const progTue = $('#prog-show-tue');
    const progMon = $('#prog-show-mon');
    if (progMon) progMon.addEventListener('change', reRenderProg);
    const progMerge = $('#prog-merge-alts');
    if (progThu) progThu.addEventListener('change', reRenderProg);
    if (progTue) progTue.addEventListener('change', reRenderProg);
    if (progMerge) progMerge.addEventListener('change', reRenderProg);
    const progOffspec = $('#prog-show-offspec');
    if (progOffspec) progOffspec.addEventListener('change', reRenderProg);

    // Track-Toggle: Aktuell / Altcontent
    function setTrack(track) {
      window._progressionTrack = track;
      for (const btn of document.querySelectorAll('.progression-track-toggle button')) {
        btn.classList.toggle('btn-primary', btn.dataset.track === track);
      }
      // Reset cached progression so analyzeProgression fetches fresh
      window._lastProgression = null;
      analyzeProgression().catch(e => console.warn('Progression error:', e));
    }
    const btnCurr = $('#btn-prog-track-current');
    const btnLeg = $('#btn-prog-track-legacy');
    if (btnCurr) btnCurr.addEventListener('click', () => setTrack('current'));
    if (btnLeg) btnLeg.addEventListener('click', () => setTrack('legacy'));
    const btnWeeks = $('#btn-prog-weeks');
    if (btnWeeks) btnWeeks.addEventListener('click', () => {
      window._progShowAllWeeks = !window._progShowAllWeeks;
      const lp = window._lastProgression;
      if (lp) renderProgression(lp.players, lp.reportMeta, lp.reportCount, lp.weekCount, lp.settings, lp.tmbRaidDays, lp.tmbCharsByDayKey, lp.tmbBenchedByDayKey, lp.lootByPlayer, window._tmbRaidGroups, lp.allWeeks);
    });
  }

  // ─── ADMIN ───

  let adminAuthenticated = false;

  function initAdmin() {
    const back = $('#btn-admin-back');
    if (back) back.addEventListener('click', () => {
      location.hash = '';
      switchView('view-dashboard');
    });

    const loginBtn = $('#btn-admin-login');
    if (loginBtn) loginBtn.addEventListener('click', adminLogin);

    const pwInput = $('#admin-password');
    if (pwInput) pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
    const unInput = $('#admin-username');
    if (unInput) unInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#admin-password').focus(); });

    // Logout
    const logoutBtn = $('#btn-admin-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      adminAuthenticated = false; adminRole = ''; adminUsername = '';
      document.cookie = 'cla_session=; Path=/; Max-Age=0';
      $('#admin-login').classList.remove('hidden');
      $('#admin-reports').classList.add('hidden');
      const bl = $('#btn-bugs-link'); if (bl) bl.style.display = 'none';
    });

    // Change password toggle
    const changePwBtn = $('#btn-admin-change-pw');
    if (changePwBtn) changePwBtn.addEventListener('click', () => {
      $('#admin-change-pw-panel').classList.toggle('hidden');
    });
    const savePwBtn = $('#btn-admin-save-pw');
    if (savePwBtn) savePwBtn.addEventListener('click', async () => {
      const msg = $('#admin-pw-msg');
      const newPw = $('#admin-new-pw').value;
      const newPw2 = $('#admin-new-pw2').value;
      if (newPw !== newPw2) { msg.textContent = 'Passwoerter stimmen nicht ueberein'; msg.className = 'text-error'; return; }
      if (newPw.length < 6) { msg.textContent = 'Min. 6 Zeichen'; msg.className = 'text-error'; return; }
      try {
        const resp = await apiFetch('/api/admin/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPassword: $('#admin-old-pw').value, newPassword: newPw }) });
        if (resp.ok) { msg.textContent = 'Passwort geaendert!'; msg.className = 'text-success'; $('#admin-old-pw').value = ''; $('#admin-new-pw').value = ''; $('#admin-new-pw2').value = ''; }
        else { const d = await resp.json(); msg.textContent = d.error || 'Fehler'; msg.className = 'text-error'; }
      } catch (e) { msg.textContent = e.message; msg.className = 'text-error'; }
    });

    // User management
    const addUserBtn = $('#btn-add-admin-user');
    if (addUserBtn) addUserBtn.addEventListener('click', addAdminUser);

    wireActionButtons();

    // Start date
    loadStartDate();
    $('#btn-save-start-date')?.addEventListener('click', saveStartDate);

    const refreshBtn = $('#btn-admin-refresh-all');
    if (refreshBtn) refreshBtn.addEventListener('click', adminRefreshAll);

    const penaltyBtn = $('#btn-penalty-add');
    if (penaltyBtn) penaltyBtn.addEventListener('click', addPenalty);
    const excusedBtn = $('#btn-excused-add');
    if (excusedBtn) excusedBtn.addEventListener('click', addExcused);
    const excusedPlayerBtn = $('#btn-excused-player-add');
    if (excusedPlayerBtn) excusedPlayerBtn.addEventListener('click', addExcusedPlayer);
    const revokedBtn = $('#btn-revoked-add');
    if (revokedBtn) revokedBtn.addEventListener('click', addRevoked);

    // Wire autocomplete inputs
    // Normalize: strip diacritics so "Boomie" matches "Boömie", "Scar" matches "Scár" etc.
    function normalize(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

    function wireAutocomplete(inputId, listId, onSelect) {
      const input = $(`#${inputId}`);
      const list = $(`#${listId}`);
      if (!input || !list) return;
      let activeIdx = -1;

      input.addEventListener('input', () => {
        const val = normalize(input.value.trim());
        const names = window._acPlayerNames || [];
        if (val.length < 1) { list.classList.add('hidden'); return; }
        const matches = names.filter(n => normalize(n).includes(val)).slice(0, 10);
        if (!matches.length) { list.classList.add('hidden'); return; }
        list.innerHTML = matches.map(n => `<div class="autocomplete-item">${escapeHtml(n)}</div>`).join('');
        list.classList.remove('hidden');
        activeIdx = -1;
        list.querySelectorAll('.autocomplete-item').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = item.textContent;
            list.classList.add('hidden');
            if (onSelect) onSelect(item.textContent);
          });
        });
      });

      input.addEventListener('keydown', (e) => {
        const items = list.querySelectorAll('.autocomplete-item');
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); }
        else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
          e.preventDefault(); input.value = items[activeIdx].textContent; list.classList.add('hidden');
          if (onSelect) onSelect(items[activeIdx].textContent);
          return;
        } else if (e.key === 'Escape') { list.classList.add('hidden'); return; }
        else return;
        items.forEach((it, i) => it.classList.toggle('active', i === activeIdx));
      });

      input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    }
    wireAutocomplete('penalty-player', 'penalty-player-ac');
    wireAutocomplete('revoked-player', 'revoked-player-ac', updateRevokedDropdown);
    wireAutocomplete('excused-player-name', 'excused-player-ac');
    wireAutocomplete('excluded-player-name', 'excluded-player-ac');
    wireAutocomplete('playerrole-name', 'playerrole-ac');
    wireAutocomplete('joindate-player', 'joindate-player-ac');

    const exclPlayerBtn = $('#btn-excluded-player-add');
    if (exclPlayerBtn) exclPlayerBtn.addEventListener('click', addExcludedPlayer);
    const joinDateBtn = $('#btn-joindate-add');
    if (joinDateBtn) joinDateBtn.addEventListener('click', addJoinDate);
    const roleBtn = $('#btn-playerrole-add');
    if (roleBtn) roleBtn.addEventListener('click', addPlayerRole);

    // Admin sub-tabs
    $$('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.admin-tab-panel').forEach(p => p.classList.remove('active'));
        const panel = $(`#${btn.dataset.adminTab}`);
        if (panel) panel.classList.add('active');
        // Hash sync für Admin-Tab
        const newHash = `#admin/${btn.dataset.adminTab}`;
        if (location.hash !== newHash) history.replaceState(null, '', newHash);
      });
    });

    window.addEventListener('hashchange', handleHash);
    handleHash();

    // Check session on load to show bug tracker link (without switching views)
    if (!adminAuthenticated) {
      apiFetch('/api/admin/session').then(r => r.json()).then(data => {
        if (data.authenticated) {
          adminAuthenticated = true;
          adminUsername = data.username;
          adminRole = data.role;
          const bl = $('#btn-bugs-link'); if (bl) bl.style.display = '';
        }
      }).catch(() => {});
    }
  }

  async function handleHash() {
    // #report/CODE oder #report/CODE/TAB
    if (location.hash.startsWith('#report/')) {
      const parts = location.hash.substring(8).split('/');
      const code = parts[0];
      const tab = parts[1] || null;
      if (code && reportCode !== code) {
        await openReport(code, tab);
      } else if (code && tab) {
        // gleicher Report, anderer Tab
        const btn = $(`.tab-btn[data-tab="${tab}"]`);
        if (btn) btn.click();
      }
      return;
    }
    if (location.hash.startsWith('#player/')) {
      const playerName = decodeURIComponent(location.hash.substring(8));
      switchView('view-player');
      loadPlayerDetail(playerName);
      return;
    }
    if (location.hash === '#bugs') {
      switchView('view-bugs');
      if (!adminAuthenticated) {
        $('#bugs-list').innerHTML = '<p class="text-muted">Bitte zuerst im <a href="#admin">Admin-Bereich</a> einloggen.</p>';
        try {
          const resp = await apiFetch('/api/admin/session');
          const data = await resp.json();
          if (data.authenticated) { showAdminPanel(data.username, data.role); loadBugTickets(); }
        } catch (e) { /* no session */ }
      } else {
        loadBugTickets();
      }
      return;
    }
    if (location.hash === '#admin' || location.hash.startsWith('#admin/')) {
      switchView('view-admin');
      const targetSubTab = location.hash.startsWith('#admin/') ? location.hash.substring(7) : null;
      const activateSubTab = () => {
        if (!targetSubTab) return;
        const btn = $(`.admin-tab-btn[data-admin-tab="${targetSubTab}"]`);
        if (btn) btn.click();
      };
      if (!adminAuthenticated) {
        $('#admin-login').classList.remove('hidden');
        $('#admin-reports').classList.add('hidden');
        try {
          const resp = await apiFetch('/api/admin/session');
          const data = await resp.json();
          if (data.authenticated) {
            showAdminPanel(data.username, data.role);
            setTimeout(activateSubTab, 100);
          }
        } catch (e) { /* no session */ }
      } else {
        $('#admin-login').classList.add('hidden');
        $('#admin-reports').classList.remove('hidden');
        loadAllAdmin();
        setTimeout(activateSubTab, 100);
      }
    }
  }

  let adminRole = '';
  let adminUsername = '';

  function showAdminPanel(username, role) {
    adminAuthenticated = true;
    adminUsername = username;
    adminRole = role;
    $('#admin-login').classList.add('hidden');
    $('#admin-reports').classList.remove('hidden');
    $('#admin-current-user').textContent = username;
    const roleBadge = $('#admin-current-role');
    roleBadge.textContent = role === 'superadmin' ? 'Superadmin' : 'Admin';
    roleBadge.className = 'admin-role-badge ' + (role === 'superadmin' ? 'role-super' : 'role-admin');
    // Show/hide superadmin-only elements
    $$('.admin-superadmin-only').forEach(el => el.classList.toggle('hidden', role !== 'superadmin'));
    // Show bug tracker link when logged in
    const bugsLink = $('#btn-bugs-link');
    if (bugsLink) bugsLink.style.display = '';
    loadAllAdmin();
  }

  function loadAllAdmin() {
    loadAdminReports(); loadAdminPenalties(); loadAdminRevoked(); loadAdminExcused(); loadAdminExcusedPlayers(); loadAdminExcludedPlayers(); loadAdminPlayerRoles(); loadAdminJoinDates(); loadAdminChangelog(); loadSysinfo(); loadRaidDateDropdowns();
    loadDataStatus(); loadPipelineStatus(); loadElixirPolicyEditor(); loadTrackingConfig();
    loadGeneralSettings(); loadRaidScheduleEditor(); loadEasterEggsEditor(); loadEdiktTextsEditor(); loadSimControl(); loadManualReports(); loadConsumesScoringEditor(); loadAntiInkompetenz();
    if (adminRole === 'superadmin') loadAdminUsers();
  }

  // ─── Admin: Allgemein (Branding + TMB + Faction + Zone-Klassifikation) ───
  async function loadGeneralSettings() {
    if (!$('#set-appName')) return;
    let currentZones = [], legacyZones = [];
    try {
      const r = await apiFetch('/api/settings');
      const s = await r.json();
      $('#set-appName').value = s.appName || '';
      $('#set-guildName').value = s.guildName || '';
      $('#set-serverName').value = s.serverName || '';
      $('#set-region').value = s.region || '';
      $('#set-faction').value = s.faction || '';
      $('#set-tmbGuildId').value = s.tmbGuildId || '';
      $('#set-tmbGuildSlug').value = s.tmbGuildSlug || '';
      // Secrets: nie zurückgegeben, nur „_set" Indikator. Felder bleiben leer.
      for (const k of ['apiKey', 'wclV2ClientId', 'wclV2ClientSecret', 'tmbCookie']) {
        const el = document.getElementById(`set-${k}`);
        if (el) {
          el.value = '';
          el.placeholder = s[`${k}_set`] ? '(gesetzt — leerlassen um zu behalten)' : (k === 'tmbCookie' ? 'laravel_session=...' : '');
        }
      }
      try { currentZones = JSON.parse(s.currentZones || '[]').map(Number); } catch (_) {}
      try { legacyZones = JSON.parse(s.legacyZones || '[]').map(Number); } catch (_) {}
    } catch (_) {}
    renderZoneClassification(currentZones, legacyZones);
    const btn = $('#btn-save-general');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const body = {
          appName: $('#set-appName').value.trim(),
          guildName: $('#set-guildName').value.trim(),
          serverName: $('#set-serverName').value.trim(),
          region: $('#set-region').value.trim(),
          faction: $('#set-faction').value,
          tmbGuildId: $('#set-tmbGuildId').value.trim(),
          tmbGuildSlug: $('#set-tmbGuildSlug').value.trim(),
          currentZones: JSON.stringify(collectZoneClassification('current')),
          legacyZones: JSON.stringify(collectZoneClassification('legacy')),
        };
        // Secrets nur senden wenn explizit was eingetragen wurde
        for (const k of ['apiKey', 'wclV2ClientId', 'wclV2ClientSecret', 'tmbCookie']) {
          const v = (document.getElementById(`set-${k}`)?.value || '').trim();
          if (v) body[k] = v;
        }
        const msg = $('#general-save-msg');
        try {
          await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          msg.textContent = '✓ Gespeichert — Reload empfohlen';
          msg.style.color = '#4ade80';
        } catch (e) { msg.textContent = '✗ Fehler: ' + e.message; msg.style.color = '#f87171'; }
      });
    }
  }
  function renderZoneClassification(currentZones, legacyZones) {
    const host = $('#zone-classification');
    if (!host) return;
    const zones = CLA_DATA.zones;
    // Sort TBC zones by tier desc, then ID
    const zoneEntries = Object.entries(zones)
      .filter(([, z]) => z.tbc)
      .sort((a, b) => (b[1].tier || 0) - (a[1].tier || 0) || a[0] - b[0]);
    const curSet = new Set(currentZones.map(Number));
    const legSet = new Set(legacyZones.map(Number));
    host.innerHTML = `<table class="results-table"><thead><tr><th>Zone</th><th>Tier</th><th>Klassifikation</th></tr></thead><tbody>${
      zoneEntries.map(([zid, z]) => {
        const id = Number(zid);
        const cls = curSet.has(id) ? 'current' : legSet.has(id) ? 'legacy' : (z.tier >= 5 ? 'current' : 'legacy');
        return `<tr>
          <td>${escapeHtml(z.name)} <small class="text-muted">(${z.short})</small></td>
          <td>T${z.tier}</td>
          <td><select data-zid="${id}" class="zone-class-select">
            <option value="auto"${(!curSet.has(id) && !legSet.has(id)) ? ' selected' : ''}>Auto (Tier-Heuristik: ${z.tier >= 5 ? 'current' : 'legacy'})</option>
            <option value="current"${curSet.has(id) ? ' selected' : ''}>Current</option>
            <option value="legacy"${legSet.has(id) ? ' selected' : ''}>Legacy</option>
          </select></td>
        </tr>`;
      }).join('')
    }</tbody></table>`;
  }
  function collectZoneClassification(which) {
    const out = [];
    document.querySelectorAll('.zone-class-select').forEach(sel => {
      if (sel.value === which) out.push(Number(sel.dataset.zid));
    });
    return out;
  }

  // ─── Admin: Raid-Schedule ───
  function _raidScheduleState() { return window._raidSchedule || (window._raidSchedule = []); }
  async function loadRaidScheduleEditor() {
    if (!$('#schedule-body')) return;
    try {
      const r = await apiFetch('/api/settings');
      const s = await r.json();
      let sched = [];
      try { sched = JSON.parse(s.raidSchedule || '[]'); } catch (_) {}
      window._raidSchedule = Array.isArray(sched) ? sched : [];
    } catch (_) { window._raidSchedule = []; }
    renderRaidScheduleRows();
    const addBtn = $('#btn-schedule-add');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', () => {
        _raidScheduleState().push({ dayOfWeek: 4, startTime: '19:30', raidSize: 25, track: 'current' });
        renderRaidScheduleRows();
      });
    }
    const saveBtn = $('#btn-schedule-save');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const msg = $('#schedule-save-msg');
        try {
          await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raidSchedule: JSON.stringify(_raidScheduleState()) }) });
          msg.textContent = '✓ Gespeichert'; msg.style.color = '#4ade80';
        } catch (e) { msg.textContent = '✗ Fehler: ' + e.message; msg.style.color = '#f87171'; }
      });
    }
  }
  function renderRaidScheduleRows() {
    const tbody = $('#schedule-body');
    if (!tbody) return;
    const dayNames = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    const sched = _raidScheduleState();
    if (!sched.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Noch keine Einträge.</td></tr>'; return; }
    tbody.innerHTML = sched.map((row, i) => `
      <tr>
        <td><select data-idx="${i}" data-k="dayOfWeek">${[1,2,3,4,5,6,7].map(d => `<option value="${d}"${row.dayOfWeek===d?' selected':''}>${dayNames[d]}</option>`).join('')}</select></td>
        <td><input type="text" data-idx="${i}" data-k="startTime" value="${escapeHtml(row.startTime || '')}" placeholder="HH:MM" maxlength="5" style="width:80px"></td>
        <td><input type="number" data-idx="${i}" data-k="raidSize" value="${row.raidSize || 25}" min="10" max="40" style="width:70px"></td>
        <td><select data-idx="${i}" data-k="track"><option value="current"${row.track==='current'?' selected':''}>Current</option><option value="legacy"${row.track==='legacy'?' selected':''}>Legacy</option></select></td>
        <td><button class="btn btn-sm" data-rm="${i}">✕</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('select[data-idx], input[data-idx]').forEach(el => {
      el.addEventListener('change', () => {
        const i = +el.dataset.idx, k = el.dataset.k;
        let v = el.value;
        if (k === 'dayOfWeek' || k === 'raidSize') v = parseInt(v, 10) || 0;
        sched[i][k] = v;
      });
    });
    tbody.querySelectorAll('button[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => { sched.splice(+btn.dataset.rm, 1); renderRaidScheduleRows(); });
    });
  }

  // ─── Admin: Edikt-Texte ───
  async function loadEdiktTextsEditor() {
    if (!$('#set-ediktTitle')) return;
    let texts = {};
    try {
      const r = await apiFetch('/api/settings');
      const s = await r.json();
      try { texts = JSON.parse(s.ediktTexts || '{}'); } catch (_) { texts = {}; }
    } catch (_) {}
    const T = Object.assign({}, EDIKT_DEFAULTS, texts);
    T.classFlavor = Object.assign({}, EDIKT_DEFAULTS.classFlavor, texts.classFlavor || {});
    T.roleFlavor = texts.roleFlavor || {};
    T.roleFootnote = texts.roleFootnote || {};
    $('#set-ediktTitle').value = T.title || '';
    $('#set-ediktSubtitle').value = T.subtitle || '';
    $('#set-ediktFooter').value = T.footer || '';
    $('#set-ediktEmpty').value = T.emptyState || '';
    $('#set-ediktRuleAny').value = T.ruleAny || '';
    $('#set-ediktRuleFlask').value = T.ruleFlaskOnly || '';
    $('#set-ediktWhitelistFlask').value = T.whitelistFlasksLabel || '';
    $('#set-ediktWhitelistCombo').value = T.whitelistComboLabel || '';
    $('#set-ediktComboBattle').value = T.comboBattleLabel || '';
    $('#set-ediktComboGuardian').value = T.comboGuardianLabel || '';
    $('#set-ediktComboNone').value = T.comboNoneText || '';
    $('#set-ediktComboFlaskOnly').value = T.comboFlaskOnlyText || '';
    $('#set-ediktClassHeading').value = T.classHeading || '';
    $('#set-ediktRoleHeading').value = T.roleHeading || '';
    $('#set-ediktClassFlavor').value = JSON.stringify(T.classFlavor, null, 2);
    $('#set-ediktRoleFlavor').value = JSON.stringify(T.roleFlavor, null, 2);
    $('#set-ediktRoleFootnote').value = JSON.stringify(T.roleFootnote, null, 2);
    const btn = $('#btn-edikt-save');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const msg = $('#edikt-save-msg');
        let classFlavor, roleFlavor, roleFootnote;
        try {
          classFlavor = JSON.parse($('#set-ediktClassFlavor').value || '{}');
          roleFlavor = JSON.parse($('#set-ediktRoleFlavor').value || '{}');
          roleFootnote = JSON.parse($('#set-ediktRoleFootnote').value || '{}');
        } catch (e) {
          msg.textContent = '✗ JSON-Parse-Fehler: ' + e.message;
          msg.style.color = '#f87171';
          return;
        }
        const body = {
          ediktTexts: JSON.stringify({
            title: $('#set-ediktTitle').value,
            subtitle: $('#set-ediktSubtitle').value,
            footer: $('#set-ediktFooter').value,
            emptyState: $('#set-ediktEmpty').value,
            ruleAny: $('#set-ediktRuleAny').value,
            ruleFlaskOnly: $('#set-ediktRuleFlask').value,
            whitelistFlasksLabel: $('#set-ediktWhitelistFlask').value,
            whitelistComboLabel: $('#set-ediktWhitelistCombo').value,
            comboBattleLabel: $('#set-ediktComboBattle').value,
            comboGuardianLabel: $('#set-ediktComboGuardian').value,
            comboNoneText: $('#set-ediktComboNone').value,
            comboFlaskOnlyText: $('#set-ediktComboFlaskOnly').value,
            classHeading: $('#set-ediktClassHeading').value,
            roleHeading: $('#set-ediktRoleHeading').value,
            classFlavor, roleFlavor, roleFootnote,
          }),
        };
        try {
          await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          msg.textContent = '✓ Gespeichert — Edikt-Tab neu laden zum Anzeigen';
          msg.style.color = '#4ade80';
        } catch (e) { msg.textContent = '✗ Fehler: ' + e.message; msg.style.color = '#f87171'; }
      });
    }
  }

  // ─── Admin: Live-Ticker Sim ───
  async function loadSimControl() {
    const sel = $('#sim-report-select');
    const btnStart = $('#btn-sim-start');
    const btnStop = $('#btn-sim-stop');
    const status = $('#sim-status');
    if (!sel || !btnStart || !btnStop) return;
    // Recent reports laden
    try {
      const r = await apiFetch('/api/admin/sim/recent-reports');
      const list = await r.json();
      const opts = ['<option value="">— Neuester Report —</option>'];
      for (const rep of list) {
        const date = rep.start ? new Date(rep.start).toISOString().slice(0, 10) : '';
        const z = (CLA_DATA.zones[rep.zone] && CLA_DATA.zones[rep.zone].short) || '?';
        opts.push(`<option value="${escapeHtml(rep.code)}">${escapeHtml(date)} · ${z} · ${escapeHtml(rep.title || rep.code)}</option>`);
      }
      sel.innerHTML = opts.join('');
    } catch (_) {}
    // Status refreshen
    async function refresh() {
      try {
        const r = await apiFetch('/api/admin/sim/status');
        const s = await r.json();
        if (s.running) {
          const since = s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : '';
          status.innerHTML = `<span style="color:#4ade80">● Läuft</span> — Report: <code>${escapeHtml(s.reportCode || '?')}</code> seit ${since}`;
        } else {
          status.innerHTML = '<span style="color:#888">○ Gestoppt</span>';
        }
      } catch (_) { status.textContent = 'Status nicht ermittelbar'; }
    }
    refresh();
    if (!btnStart._wired) {
      btnStart._wired = true;
      btnStart.addEventListener('click', async () => {
        const reportCode = sel.value;
        status.textContent = 'Starte...';
        try {
          const r = await apiFetch('/api/admin/sim/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportCode }) });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Fehler');
          setTimeout(refresh, 800);
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
    if (!btnStop._wired) {
      btnStop._wired = true;
      btnStop.addEventListener('click', async () => {
        status.textContent = 'Stoppe...';
        try {
          await apiFetch('/api/admin/sim/stop', { method: 'POST' });
          setTimeout(refresh, 500);
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
  }

  function openRedateModal(origDate, raidName, currentDate, onConfirm) {
    const body = `
      <div class="redate-modal">
        <p class="text-muted" style="margin:0 0 12px;font-size:0.82rem">Aktuelles Datum: <code>${escapeHtml(currentDate)}</code></p>
        <div class="redate-modal__raid">
          <span class="redate-modal__raid-name">${escapeHtml(raidName)}</span>
        </div>
        <label class="redate-modal__label" for="redate-input">Neues Datum</label>
        <input type="date" id="redate-input" class="penalty-input" value="${escapeHtml(currentDate)}" max="9999-12-31">
        <p class="redate-modal__error hidden" id="redate-modal-error"></p>
      </div>
    `;
    showModal('Raid umdatieren', body, [
      { label: 'Abbrechen' },
      { label: 'Übernehmen', primary: true, action: () => {
          // synchron Validation in click-handler: showModal schließt automatisch, daher pre-collect
        } },
    ]);
    // Reassign primary button behavior to validate vor dem submit
    const overlay = $('#cla-modal-overlay');
    const primary = $('#cla-modal-actions .btn-primary');
    if (primary) {
      // showModal hat den schließenden Handler bereits angebunden — wir bauen ihn nach
      const newPrimary = primary.cloneNode(true);
      primary.parentNode.replaceChild(newPrimary, primary);
      newPrimary.addEventListener('click', () => {
        const input = $('#redate-input');
        const err = $('#redate-modal-error');
        const val = (input && input.value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          if (err) { err.textContent = 'Bitte ein gültiges Datum wählen.'; err.classList.remove('hidden'); }
          return;
        }
        overlay.classList.add('hidden');
        onConfirm(val);
      });
    }
    const inp = $('#redate-input');
    if (inp) {
      setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 50);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const p = $('#cla-modal-actions .btn-primary');
          if (p) p.click();
        }
      });
    }
  }

  // ─── Admin: Anti-Inkompetenz (TMB-Raid-Datum-Overrides) ───
  async function loadAntiInkompetenz() {
    const ovrBody = $('#anti-overrides-body');
    const raidsBody = $('#anti-raids-body');
    const status = $('#anti-overrides-status');
    if (!ovrBody || !raidsBody) return;
    async function refresh() {
      // Overrides + TMB-Raid-Liste laden
      try {
        const [ovrR, tmbR] = await Promise.all([
          apiFetch('/api/admin/tmb-raid-overrides'),
          apiFetch('/api/tmb/attendance'),
        ]);
        if (!ovrR.ok) { ovrBody.innerHTML = '<tr><td colspan="5" class="text-muted">Override-Liste nicht ladbar.</td></tr>'; return; }
        const { overrides } = await ovrR.json();
        if (!overrides.length) {
          ovrBody.innerHTML = '<tr><td colspan="5" class="text-muted">Keine Overrides definiert.</td></tr>';
        } else {
          ovrBody.innerHTML = overrides.map(o => {
            const setBy = new Date(o.set_at).toLocaleString('de-DE');
            return `<tr>
              <td><code>${escapeHtml(o.orig_date)}</code></td>
              <td>${escapeHtml(o.raid_name)}</td>
              <td><code>${escapeHtml(o.new_date)}</code></td>
              <td>${escapeHtml(o.set_by || '—')} <small class="text-muted">${escapeHtml(setBy)}</small></td>
              <td><button class="penalty-btn penalty-btn--remove" data-ovr-orig="${escapeHtml(o.orig_date)}" data-ovr-name="${escapeHtml(o.raid_name)}">Override entfernen</button></td>
            </tr>`;
          }).join('');
          ovrBody.querySelectorAll('[data-ovr-orig]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const origDate = btn.getAttribute('data-ovr-orig');
              const raidName = btn.getAttribute('data-ovr-name');
              if (!confirm(`Override für "${raidName}" (${origDate}) wirklich entfernen?`)) return;
              try {
                const r = await apiFetch('/api/admin/tmb-raid-overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origDate, raidName }) });
                if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Fehler'); }
                status.textContent = 'Override entfernt.';
                refresh();
              } catch (e) { status.textContent = '✗ ' + e.message; }
            });
          });
        }
        // Raid-Liste
        if (!tmbR.ok) { raidsBody.innerHTML = '<tr><td colspan="4" class="text-muted">TMB-Daten nicht ladbar.</td></tr>'; return; }
        const att = await tmbR.json();
        const raids = (att.raids || []).slice();
        // Override-Lookup: Original-Datum → ggf. zeigen wir das schon korrigierte Datum
        const ovrLookup = new Map(overrides.map(o => [o.orig_date + '|' + o.raid_name, o.new_date]));
        raids.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        raidsBody.innerHTML = raids.slice(0, 100).map(r => {
          const isOverridden = ovrLookup.has(r.date + '|' + r.name);
          const charCount = (r.characters || []).length;
          return `<tr${isOverridden ? ' style="opacity:0.6"' : ''}>
            <td><code>${escapeHtml(r.date)}</code>${isOverridden ? ' <small class="text-muted">(bereits umdatiert)</small>' : ''}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${charCount}</td>
            <td><button class="penalty-btn" data-rename-orig="${escapeHtml(r.date)}" data-rename-name="${escapeHtml(r.name)}">Umdatieren</button></td>
          </tr>`;
        }).join('');
        raidsBody.querySelectorAll('[data-rename-orig]').forEach(btn => {
          btn.addEventListener('click', () => {
            const origDate = btn.getAttribute('data-rename-orig');
            const raidName = btn.getAttribute('data-rename-name');
            const cur = ovrLookup.get(origDate + '|' + raidName) || origDate;
            openRedateModal(origDate, raidName, cur, async (newDate) => {
              try {
                const r = await apiFetch('/api/admin/tmb-raid-overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origDate, raidName, newDate }) });
                if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Fehler'); }
                status.textContent = `Umdatiert: ${origDate} → ${newDate}.`;
                refresh();
              } catch (e) { status.textContent = '✗ ' + e.message; }
            });
          });
        });
      } catch (e) {
        ovrBody.innerHTML = `<tr><td colspan="5" class="text-muted">Fehler: ${escapeHtml(e.message)}</td></tr>`;
      }
    }
    refresh();
  }

  // ─── Admin: Consumes Übersichts-Wertung ───
  async function loadConsumesScoringEditor() {
    const host = $('#consumes-scoring-editor');
    const saveBtn = $('#btn-consumes-scoring-save');
    const status = $('#consumes-scoring-status');
    if (!host || !saveBtn) return;
    try {
      const [catR, curR] = await Promise.all([
        apiFetch('/api/admin/tracking-config'),
        apiFetch('/api/consumes-scoring'),
      ]);
      if (!catR.ok) { host.innerHTML = '<p class="text-muted">Tracking-Config nicht ladbar.</p>'; return; }
      const cfg = await catR.json();
      const cur = curR.ok ? await curR.json() : { excludedIds: null, thresholdPct: null };
      const excluded = new Set(Array.isArray(cur.excludedIds) ? cur.excludedIds : DEFAULT_FREE_CONJURED_IDS);
      const thInput = $('#consumes-scoring-threshold');
      if (thInput) thInput.value = String(Number.isFinite(cur.thresholdPct) ? cur.thresholdPct : DEFAULT_SLACKER_THRESHOLD_PCT);
      // Bekannte Consumes katalogisieren: itemId + spellId(s) pro Eintrag
      const entries = [];
      const seen = new Set();
      function addGroup(map) {
        for (const def of Object.values(map || {})) {
          if (!def || !def.label) continue;
          const key = (def.item || '') + '|' + def.label;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ label: def.label, cat: def.cat || 'other', itemId: def.item || null, spellIds: def.ids || [] });
        }
      }
      addGroup(cfg.consumableBuffs);
      addGroup(cfg.consumableCasts);
      // Gruppieren nach Kategorie
      const byCat = {};
      for (const e of entries) {
        (byCat[e.cat] ||= []).push(e);
      }
      const catLabels = { pot:'Combat-Potions', mana:'Mana', health:'Health/Mana-Gems', rune:'Runen', engi:'Engineering', other:'Sonstige' };
      const order = ['pot','mana','health','rune','engi','other'];
      const rows = [];
      for (const cat of order) {
        const list = byCat[cat]; if (!list) continue;
        rows.push(`<h4 style="margin:14px 0 4px;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(catLabels[cat] || cat)}</h4>`);
        rows.push('<div class="consumes-grid">');
        for (const e of list.sort((a,b)=>a.label.localeCompare(b.label))) {
          // Eintrag gilt als "eingeschlossen" wenn weder itemId noch eine seiner spellIds in excluded ist
          const isExcluded = (e.itemId && excluded.has(e.itemId)) || (e.spellIds || []).some(id => excluded.has(id));
          const idData = JSON.stringify({ itemId: e.itemId, spellIds: e.spellIds });
          rows.push(`<label class="consumes-check"><input type="checkbox" ${isExcluded ? '' : 'checked'} data-consume-ids='${escapeHtml(idData)}'> <span>${escapeHtml(e.label)}</span></label>`);
        }
        rows.push('</div>');
      }
      host.innerHTML = rows.join('');
    } catch (e) {
      host.innerHTML = '<p class="text-error">Fehler: ' + escapeHtml(e.message) + '</p>';
      return;
    }
    if (!saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const checks = host.querySelectorAll('input[type=checkbox][data-consume-ids]');
        const excludedIds = [];
        checks.forEach(cb => {
          if (cb.checked) return; // included → nicht in excluded
          let info; try { info = JSON.parse(cb.getAttribute('data-consume-ids')); } catch (_) { return; }
          if (info.itemId) excludedIds.push(info.itemId);
          for (const sid of (info.spellIds || [])) excludedIds.push(sid);
        });
        const thInput = $('#consumes-scoring-threshold');
        const thresholdPct = thInput ? parseInt(thInput.value, 10) : null;
        try {
          const r = await apiFetch('/api/admin/consumes-scoring', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excludedIds, thresholdPct }),
          });
          if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'HTTP ' + r.status); }
          window._consumesExcludedIds = excludedIds;
          if (Number.isFinite(thresholdPct)) window._consumesSlackerPct = thresholdPct;
          status.textContent = `Gespeichert (${excludedIds.length} IDs ausgeschlossen, Schwelle ${thresholdPct}%).`;
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
  }

  // ─── Admin: Manuelle Reports ───
  async function loadManualReports() {
    const tbody = $('#manual-reports-body');
    const input = $('#manual-report-input');
    const btnAdd = $('#btn-manual-report-add');
    const status = $('#manual-report-status');
    if (!tbody || !input || !btnAdd) return;

    async function refresh() {
      try {
        const r = await apiFetch('/api/admin/manual-reports');
        const j = await r.json();
        const list = j.reports || [];
        if (!list.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Keine manuellen Reports.</td></tr>';
          return;
        }
        tbody.innerHTML = list.map(m => {
          const date = m.start_ts ? new Date(m.start_ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
          return `<tr>
            <td><code><a href="https://classic.warcraftlogs.com/reports/${escapeHtml(m.report_code)}" target="_blank" rel="noopener">${escapeHtml(m.report_code)}</a></code></td>
            <td>${escapeHtml(m.title || '—')}</td>
            <td>${escapeHtml(m.owner || '—')}</td>
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(m.added_by || '—')}</td>
            <td><button class="penalty-btn penalty-btn--remove" data-manual-del="${escapeHtml(m.report_code)}">Entfernen</button></td>
          </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-manual-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const code = btn.getAttribute('data-manual-del');
            if (!confirm('Manuellen Report ' + code + ' entfernen?')) return;
            try {
              const r = await apiFetch('/api/admin/manual-reports/' + encodeURIComponent(code), { method: 'DELETE' });
              if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Fehler'); }
              await refresh();
            } catch (e) { status.textContent = '✗ ' + e.message; }
          });
        });
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Fehler: ' + escapeHtml(e.message) + '</td></tr>';
      }
    }

    if (!btnAdd._wired) {
      btnAdd._wired = true;
      btnAdd.addEventListener('click', async () => {
        const val = (input.value || '').trim();
        if (!val) return;
        status.textContent = 'Lade von WCL...';
        try {
          const r = await apiFetch('/api/admin/manual-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: val })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Fehler');
          status.innerHTML = '<span style="color:#4ade80">✓ Hinzugefügt: ' + escapeHtml(j.title || j.code) + ' — Pre-Analyse läuft im Hintergrund.</span>';
          input.value = '';
          await refresh();
        } catch (e) {
          status.textContent = '✗ ' + e.message;
        }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnAdd.click(); });
    }
    refresh();
  }

  // ─── Admin: Easter Eggs ───
  function _eggsState() { return window._eggsList || (window._eggsList = []); }
  async function loadEasterEggsEditor() {
    if (!$('#eggs-body')) return;
    try {
      const r = await apiFetch('/api/settings');
      const s = await r.json();
      let eggs = [];
      try { eggs = JSON.parse(s.easterEggs || '[]'); } catch (_) {}
      window._eggsList = Array.isArray(eggs) ? eggs : [];
    } catch (_) { window._eggsList = []; }
    renderEggsRows();
    const addBtn = $('#btn-eggs-add');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', () => {
        _eggsState().push({ name: '', type: 'wobble', alt: '' });
        renderEggsRows();
      });
    }
    const saveBtn = $('#btn-eggs-save');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const msg = $('#eggs-save-msg');
        const cleaned = _eggsState().filter(e => e && e.name && e.type);
        try {
          await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ easterEggs: JSON.stringify(cleaned) }) });
          msg.textContent = '✓ Gespeichert — Reload empfohlen'; msg.style.color = '#4ade80';
        } catch (e) { msg.textContent = '✗ Fehler: ' + e.message; msg.style.color = '#f87171'; }
      });
    }
  }
  function renderEggsRows() {
    const tbody = $('#eggs-body');
    if (!tbody) return;
    const eggs = _eggsState();
    if (!eggs.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Noch keine Einträge.</td></tr>'; return; }
    const types = ['wobble', 'popup', 'girly', 'letterswap', 'slacker-wobble', 'tank-death-wobble'];
    tbody.innerHTML = eggs.map((row, i) => `
      <tr>
        <td><input type="text" data-idx="${i}" data-k="name" value="${escapeHtml(row.name || '')}" placeholder="Spielername" style="width:140px"></td>
        <td><select data-idx="${i}" data-k="type">${types.map(t => `<option value="${t}"${row.type===t?' selected':''}>${t}</option>`).join('')}</select></td>
        <td><input type="text" data-idx="${i}" data-k="alt" value="${escapeHtml(row.alt || row.text || '')}" placeholder="Alt/Popup-Text" style="width:200px"></td>
        <td><button class="btn btn-sm" data-rm="${i}">✕</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('input[data-idx], select[data-idx]').forEach(el => {
      el.addEventListener('change', () => {
        const i = +el.dataset.idx, k = el.dataset.k;
        // 'alt' für die meisten Types, aber 'popup' nutzt 'text' — beides in 'alt' speichern; Backend/Renderer akzeptiert beide
        eggs[i][k] = el.value;
        if (k === 'alt' && eggs[i].type === 'popup') { eggs[i].text = el.value; }
      });
    });
    tbody.querySelectorAll('button[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => { eggs.splice(+btn.dataset.rm, 1); renderEggsRows(); });
    });
  }

  // ─── Admin: Wipe-Analyse ───
  async function loadTrackingConfig() {
    const host = $('#tracking-content');
    if (!host) return;
    host.innerHTML = '<p class="text-muted">Lade Tracking-Konfiguration...</p>';
    try {
      const resp = await apiFetch('/api/admin/tracking-config');
      if (!resp.ok) { host.innerHTML = '<p class="text-error">Fehler: HTTP ' + resp.status + '</p>'; return; }
      const cfg = await resp.json();
      renderTrackingConfig(host, cfg);
    } catch (e) {
      host.innerHTML = '<p class="text-error">Fehler: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderTrackingConfig(host, cfg) {
    const iconLink = (type, id, label) => `<a href="https://www.wowhead.com/tbc/${type}=${id}" data-wowhead="${type}=${id}${type === 'item' ? '&amp;domain=tbc' : ''}" target="_blank">${escapeHtml(label)}</a>`;
    const spellLinks = (ids) => ids.map(id => `<a href="https://www.wowhead.com/tbc/spell=${id}" data-wowhead="spell=${id}" target="_blank"><code>${id}</code></a>`).join(' ');
    const itemLink = (id) => `<a href="https://www.wowhead.com/tbc/item=${id}" data-wowhead="item=${id}&amp;domain=tbc" target="_blank"><code>${id}</code></a>`;
    let html = '<div class="tracking-page">';
    html += '<h3>Tracking-Konfiguration <small class="text-muted">(read-only, automatisch aus dem Quellcode generiert)</small></h3>';

    // Consumables (Buff + Cast kombiniert)
    const consBuff = cfg.consumableBuffs || {};
    const consCast = cfg.consumableCasts || {};
    const consAll = [];
    for (const [k, def] of Object.entries(consBuff)) consAll.push({ key: k, ...def, source: 'buff' });
    for (const [k, def] of Object.entries(consCast)) consAll.push({ key: k, ...def, source: 'cast' });
    consAll.sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || a.label.localeCompare(b.label));
    html += `<details open><summary><strong>🧪 Consumables</strong> <span class="text-muted">(${consAll.length} Items)</span></summary>`;
    html += '<table class="results-table"><thead><tr><th>Kategorie</th><th>Item</th><th>Spell-IDs</th><th>Quelle</th></tr></thead><tbody>';
    for (const c of consAll) {
      html += `<tr><td><span class="cd-role-pill" style="background:rgba(255,255,255,0.05)">${escapeHtml(c.cat)}</span></td>`;
      html += `<td>${iconLink('item', c.item, c.label)}</td>`;
      html += `<td>${spellLinks(c.ids)}</td>`;
      html += `<td class="text-muted">${c.source}</td></tr>`;
    }
    html += '</tbody></table></details>';

    // On-Use Trinkets
    const trinkets = cfg.onuseTrinkets || {};
    const trEntries = Object.entries(trinkets).map(([sid, d]) => ({ spellId: Number(sid), ...d })).sort((a, b) => a.name.localeCompare(b.name));
    html += `<details open><summary><strong>🛡 On-Use Trinkets</strong> <span class="text-muted">(${trEntries.length} Items)</span></summary>`;
    html += '<table class="results-table"><thead><tr><th>Item</th><th>Use-Spell-ID</th></tr></thead><tbody>';
    for (const t of trEntries) {
      html += `<tr><td>${iconLink('item', t.item, t.name)}</td><td>${spellLinks([t.spellId])}</td></tr>`;
    }
    html += '</tbody></table></details>';

    // Major Cooldowns
    const cds = cfg.majorCooldowns || {};
    const cdEntries = Object.entries(cds).map(([k, d]) => ({ key: k, ...d })).sort((a, b) => a.cd - b.cd || a.name.localeCompare(b.name));
    html += `<details open><summary><strong>⚡ Major Cooldowns</strong> <span class="text-muted">(${cdEntries.length} CDs)</span></summary>`;
    html += '<table class="results-table"><thead><tr><th>Name</th><th>Role</th><th>CD</th><th>Spell-IDs</th></tr></thead><tbody>';
    const roleLbl = { dps: 'DMG', tank: 'TANK', heal: 'HELP', any: 'ANY' };
    const roleClr = { dps: '#f87171', tank: '#60a5fa', heal: '#34d399', any: '#fbbf24' };
    for (const c of cdEntries) {
      const cdMin = c.cd >= 60 ? `${Math.round(c.cd/60)} min` : `${c.cd}s`;
      const clr = roleClr[c.role] || '#888';
      html += `<tr><td>${iconLink('spell', c.ids[0], c.name)}</td>`;
      html += `<td><span class="cd-role-pill" style="background:${clr}22;color:${clr};border:1px solid ${clr}55">${roleLbl[c.role] || c.role.toUpperCase()}</span></td>`;
      html += `<td>${cdMin}</td><td>${spellLinks(c.ids)}</td></tr>`;
    }
    html += '</tbody></table></details>';

    // Buff Sets (Flask/Food/Scrolls/etc.)
    const buffSets = cfg.buffSetIds || {};
    html += `<details><summary><strong>🍃 Buff-Sets</strong> <span class="text-muted">(Flask, Food, Scrolls, Weapon-Enhancements)</span></summary>`;
    html += '<table class="results-table"><thead><tr><th>Set</th><th>Count</th><th>Spell-IDs</th></tr></thead><tbody>';
    for (const [k, ids] of Object.entries(buffSets)) {
      if (!Array.isArray(ids)) continue;
      const shown = ids.slice(0, 30);
      const more = ids.length > 30 ? ` <span class="text-muted">… +${ids.length - 30} mehr</span>` : '';
      html += `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${ids.length}</td><td style="font-size:0.7rem">${spellLinks(shown)}${more}</td></tr>`;
    }
    html += '</tbody></table></details>';

    // Scroll-Anforderungen — editierbar
    html += `<details><summary><strong>📜 Scroll-Anforderungen pro Class:Spec</strong> <span class="text-muted">(editierbar — welche Scrolls in der Spalte „Scrolls" gefordert werden)</span></summary>`;
    html += '<div id="scroll-req-editor"><p class="text-muted">Lade aktuelle Einstellungen...</p></div>';
    html += '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;padding-top:14px;border-top:1px solid var(--border)">';
    html += '<button id="btn-scroll-req-save" class="penalty-btn penalty-btn--add">Speichern</button>';
    html += '<button id="btn-scroll-req-reset" class="penalty-btn">Auf Defaults zurücksetzen</button>';
    html += '<span id="scroll-req-status" class="penalty-card__status"></span>';
    html += '</div>';
    html += '</details>';

    // CD-Role-Erwartungen — editierbar
    const defaults = cfg.liveCdRoleExpectations || {};
    const allCdKeys = Object.keys(cds);
    html += `<details open><summary><strong>🎯 CD-Erwartungen pro Role:Spec</strong> <span class="text-muted">(editierbar — was hier erwartet ist, fließt in die Slacker-Wertung ein)</span></summary>`;
    html += '<div id="cd-expectations-editor"><p class="text-muted">Lade aktuelle Einstellungen...</p></div>';
    html += '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;padding-top:14px;border-top:1px solid var(--border)">';
    html += '<button id="btn-cd-expect-save" class="penalty-btn penalty-btn--add">Speichern</button>';
    html += '<button id="btn-cd-expect-reset" class="penalty-btn">Auf Defaults zurücksetzen</button>';
    html += '<span id="cd-expect-status" class="penalty-card__status"></span>';
    html += '</div>';
    html += '</details>';

    html += '</div>';
    host.innerHTML = html;
    try { window.$WowheadPower.refreshLinks(); } catch (e) {}

    // CD-Expectations Editor wireup
    loadCdExpectationsEditor(cds, defaults, allCdKeys);
    // Scroll-Requirements Editor wireup
    loadScrollRequirementsEditor();
  }

  async function loadScrollRequirementsEditor() {
    const host = $('#scroll-req-editor');
    if (!host) return;
    let overrides = null;
    try {
      const r = await apiFetch('/api/scroll-requirements');
      if (r.ok) overrides = (await r.json()).overrides;
    } catch (_) {}
    const defaults = BUFF_IDS.scrollRequired || {};
    function effective(role) {
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, role)) return overrides[role];
      return defaults[role] || [];
    }
    const ALL_STATS = ['Agility','Strength','Intellect','Protection','Spirit','Stamina'];
    // Rollen aus defaults + observed roles
    const roleSet = new Set(Object.keys(defaults));
    if (_elixirPolicyState && _elixirPolicyState.observed && Array.isArray(_elixirPolicyState.observed.roles)) {
      for (const r of _elixirPolicyState.observed.roles) roleSet.add(normalizeRoleKey(r));
    }
    const roles = [...roleSet].filter(r => r && r.includes(':') && r !== 'HunterPet').sort();
    const specOrder = { tank: 1, healer: 2, balance: 3, elemental: 3, feral: 4, enhancement: 4, retribution: 4, dps: 5 };
    roles.sort((a, b) => {
      const [ca, sa] = a.split(':'); const [cb, sb] = b.split(':');
      if (ca !== cb) return ca.localeCompare(cb);
      return (specOrder[sa] || 9) - (specOrder[sb] || 9);
    });

    let html = '';
    for (const role of roles) {
      const eff = new Set(effective(role));
      const [cls, spec] = role.split(':');
      const css = classCssFromType(cls);
      html += `<div class="cd-expect-row" data-role="${escapeHtml(role)}">`;
      html += `<div class="cd-expect-row__head"><strong class="${css}">${escapeHtml(cls)}</strong> <span class="text-muted">·</span> <span>${escapeHtml(spec)}</span></div>`;
      html += '<div class="cd-expect-row__cds">';
      for (const stat of ALL_STATS) {
        const checked = eff.has(stat);
        html += `<label class="cd-expect-chip${checked ? ' is-checked' : ''}"><input type="checkbox" data-scroll-stat="${escapeHtml(stat)}" ${checked ? 'checked' : ''}><span>${escapeHtml(stat)}</span></label>`;
      }
      html += '</div></div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.cd-expect-chip input').forEach(cb => {
      cb.addEventListener('change', () => cb.closest('.cd-expect-chip').classList.toggle('is-checked', cb.checked));
    });

    const saveBtn = $('#btn-scroll-req-save');
    const resetBtn = $('#btn-scroll-req-reset');
    const status = $('#scroll-req-status');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const out = {};
        host.querySelectorAll('.cd-expect-row').forEach(row => {
          const role = row.getAttribute('data-role');
          const stats = [...row.querySelectorAll('input[data-scroll-stat]:checked')].map(cb => cb.getAttribute('data-scroll-stat'));
          out[role] = stats;
        });
        status.textContent = 'Speichere...';
        try {
          const r = await apiFetch('/api/admin/scroll-requirements', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides: out }),
          });
          if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'HTTP ' + r.status); }
          window._scrollRequirementOverrides = out;
          status.textContent = 'Gespeichert.';
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
    if (resetBtn && !resetBtn._wired) {
      resetBtn._wired = true;
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Alle Scroll-Anforderungen auf die Defaults zurücksetzen?')) return;
        try {
          const r = await apiFetch('/api/admin/scroll-requirements', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides: {} }),
          });
          if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'HTTP ' + r.status); }
          window._scrollRequirementOverrides = {};
          status.textContent = 'Zurückgesetzt.';
          loadScrollRequirementsEditor();
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
  }

  async function loadCdExpectationsEditor(cdDefs, defaults, allCdKeys) {
    const host = $('#cd-expectations-editor');
    if (!host) return;
    let currentOverrides = null;
    try {
      const r = await apiFetch('/api/cd-expectations');
      if (r.ok) currentOverrides = (await r.json()).overrides;
    } catch (_) {}
    // Effective state: pro Rolle die Liste der erwarteten Keys (Override > Default)
    function effective(role) {
      if (currentOverrides && Object.prototype.hasOwnProperty.call(currentOverrides, role)) return currentOverrides[role];
      return defaults[role] || [];
    }
    const roles = Object.keys(defaults).sort();
    const specOrder = { tank: 1, healer: 2, balance: 3, elemental: 3, feral: 4, enhancement: 4, retribution: 4, dps: 5 };
    roles.sort((a, b) => {
      const [ca, sa] = a.split(':'); const [cb, sb] = b.split(':');
      if (ca !== cb) return ca.localeCompare(cb);
      return (specOrder[sa] || 9) - (specOrder[sb] || 9);
    });

    let html = '';
    for (const role of roles) {
      const eff = new Set(effective(role));
      const [cls, spec] = role.split(':');
      const css = classCssFromType(cls);
      html += `<div class="cd-expect-row" data-role="${escapeHtml(role)}">`;
      html += `<div class="cd-expect-row__head"><strong class="${css}">${escapeHtml(cls)}</strong> <span class="text-muted">·</span> <span>${escapeHtml(spec)}</span></div>`;
      html += '<div class="cd-expect-row__cds">';
      // Nur CDs der eigenen Klasse — Racials raus
      const sortedKeys = allCdKeys
        .filter(k => cdDefs[k] && cdDefs[k].cls === cls)
        .sort((a, b) => {
          const da = cdDefs[a], db = cdDefs[b];
          return (da.role || '').localeCompare(db.role || '') || (da.name || '').localeCompare(db.name || '');
        });
      if (!sortedKeys.length) {
        html += '<span class="text-muted" style="font-size:0.8rem">Keine CDs für diese Klasse definiert.</span>';
      }
      for (const key of sortedKeys) {
        const def = cdDefs[key];
        const checked = eff.has(key);
        html += `<label class="cd-expect-chip${checked ? ' is-checked' : ''}" title="${escapeHtml(def.name)} (${def.role})"><input type="checkbox" data-cd-key="${escapeHtml(key)}" ${checked ? 'checked' : ''}><span>${escapeHtml(def.name)}</span></label>`;
      }
      html += '</div></div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.cd-expect-chip input').forEach(cb => {
      cb.addEventListener('change', () => cb.closest('.cd-expect-chip').classList.toggle('is-checked', cb.checked));
    });

    const saveBtn = $('#btn-cd-expect-save');
    const resetBtn = $('#btn-cd-expect-reset');
    const status = $('#cd-expect-status');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const overrides = {};
        host.querySelectorAll('.cd-expect-row').forEach(row => {
          const role = row.getAttribute('data-role');
          const keys = [...row.querySelectorAll('input[data-cd-key]:checked')].map(cb => cb.getAttribute('data-cd-key'));
          overrides[role] = keys;
        });
        status.textContent = 'Speichere...';
        try {
          const r = await apiFetch('/api/admin/cd-expectations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides }),
          });
          if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'HTTP ' + r.status); }
          status.textContent = 'Gespeichert.';
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
    if (resetBtn && !resetBtn._wired) {
      resetBtn._wired = true;
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Alle CD-Erwartungen auf die Default-Werte zurücksetzen?')) return;
        try {
          const r = await apiFetch('/api/admin/cd-expectations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overrides: {} }),
          });
          if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'HTTP ' + r.status); }
          currentOverrides = null;
          status.textContent = 'Zurückgesetzt.';
          // Re-render mit Defaults
          loadCdExpectationsEditor(cdDefs, defaults, allCdKeys);
        } catch (e) { status.textContent = '✗ ' + e.message; }
      });
    }
  }

  async function loadWipesAdmin() {
    const host = $('#wipes-content');
    if (!host) return;
    host.innerHTML = '<p class="text-muted">Lade Analysen...</p>';
    try {
      const resp = await apiFetch('/api/admin/wipes');
      if (!resp.ok) { host.innerHTML = '<p class="text-error">Fehler: HTTP ' + resp.status + '</p>'; return; }
      const data = await resp.json();
      renderWipesAdmin(data.reports || []);
    } catch (e) { host.innerHTML = '<p class="text-error">Fehler: ' + escapeHtml(e.message) + '</p>'; }
  }

  // Report-Tab Wipe-Analyse: wiederverwendet die Renderer aus dem Admin-Wipes-Tab
  function renderReportWipes(wipes, reportData) {
    const host = $('#wipes-results');
    if (!wipes || !wipes.length) {
      host.innerHTML = '<p class="text-muted">Keine Analysen für diesen Report.</p>';
      return;
    }
    // Player-ID-Map global aufbauen für CC-Attribution
    window._playerIdToName = window._playerIdToName || {};
    for (const w of wipes) {
      for (const p of (w.players || [])) {
        if (p.id != null && p.name) window._playerIdToName[p.id] = p.name;
      }
    }
    const kills = wipes.filter(w => w.kill).length;
    const ws = wipes.filter(w => !w.kill).length;
    // Lokaler State (separat vom Admin-Tab)
    window._reportWipeState = window._reportWipeState || { filter: 'all', collapsed: new Set() };
    const state = window._reportWipeState;
    let html = '<div class="wipes-page">';
    // Filter-Bar
    html += '<div class="wipes-filter">';
    html += `<div class="wipes-filter-group">`;
    html += `<button class="wf-btn${state.filter==='all'?' active':''}" data-rfilter="all">Alle (${wipes.length})</button>`;
    html += `<button class="wf-btn${state.filter==='wipes'?' active':''}" data-rfilter="wipes">💀 Wipes (${ws})</button>`;
    html += `<button class="wf-btn${state.filter==='kills'?' active':''}" data-rfilter="kills">✅ Kills (${kills})</button>`;
    html += `</div>`;
    html += `<div class="wipes-filter-group">`;
    html += `<button class="wf-btn-link" data-raction="collapse-all">Alle einklappen</button>`;
    html += `<button class="wf-btn-link" data-raction="expand-all">Alle aufklappen</button>`;
    html += `</div></div>`;
    // Filter
    let visible = wipes;
    if (state.filter === 'wipes') visible = visible.filter(w => !w.kill);
    if (state.filter === 'kills') visible = visible.filter(w => w.kill);
    // Boss-Gruppierung
    const byBoss = new Map();
    for (const w of visible) {
      const k = w.bossName || w.fightName;
      if (!byBoss.has(k)) byBoss.set(k, []);
      byBoss.get(k).push(w);
    }
    const groupOrder = [...byBoss.entries()].sort((a, b) => a[1][0].fightId - b[1][0].fightId);
    for (const [bossName, fights] of groupOrder) {
      const ks = fights.filter(x => x.kill).length;
      const ws = fights.length - ks;
      const collapsed = state.collapsed.has(bossName);
      html += `<div class="boss-group${collapsed?' collapsed':''}">`;
      html += `<div class="boss-group-head" data-rboss="${escapeHtml(bossName)}">`;
      html += `<span class="boss-group-toggle">${collapsed?'▶':'▼'}</span>`;
      html += `<strong class="boss-group-name">${escapeHtml(bossName)}</strong>`;
      html += `<span class="boss-group-stats">`;
      if (ks > 0) html += `<span class="bg-kill">✅ ${ks} Kill${ks>1?'s':''}</span>`;
      if (ws > 0) html += `<span class="bg-wipe">💀 ${ws} Wipe${ws>1?'s':''}</span>`;
      html += `</span></div>`;
      html += `<div class="boss-group-body${collapsed?' hidden':''}">`;
      for (const w of fights.sort((a, b) => a.fightId - b.fightId)) {
        html += renderSingleWipe(w);
      }
      html += `</div></div>`;
    }
    html += '</div>';
    host.innerHTML = html;
    // Wire up events
    host.querySelectorAll('[data-rfilter]').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.rfilter;
      renderReportWipes(wipes, reportData);
    }));
    host.querySelectorAll('[data-raction="collapse-all"]').forEach(b => b.addEventListener('click', () => {
      for (const [bn] of byBoss) state.collapsed.add(bn);
      renderReportWipes(wipes, reportData);
    }));
    host.querySelectorAll('[data-raction="expand-all"]').forEach(b => b.addEventListener('click', () => {
      state.collapsed.clear();
      renderReportWipes(wipes, reportData);
    }));
    host.querySelectorAll('.boss-group-head').forEach(head => head.addEventListener('click', () => {
      const boss = head.dataset.rboss;
      if (state.collapsed.has(boss)) state.collapsed.delete(boss);
      else state.collapsed.add(boss);
      renderReportWipes(wipes, reportData);
    }));
  }

  // Global state für Wipes-View (Filter, Boss-Auswahl)
  window._wipeState = window._wipeState || { filter: 'all', bossFilter: 'all', collapsed: new Set() };

  function renderWipesAdmin(reports) {
    const host = $('#wipes-content');
    if (!reports.length) {
      host.innerHTML = '<p class="text-muted">Keine Analysen verfügbar.</p>';
      return;
    }
    // Aggregat-Stats über alle Reports
    const allFights = [];
    for (const rep of reports) {
      for (const w of (rep.wipes || [])) {
        // Player-ID-Map global aufbauen
        for (const p of (w.players || [])) {
          window._playerIdToName = window._playerIdToName || {};
          if (p.id != null && p.name) window._playerIdToName[p.id] = p.name;
        }
        allFights.push({ ...w, reportCode: rep.reportCode, reportTitle: rep.title, reportDate: rep.start });
      }
    }
    const totalKills = allFights.filter(f => f.kill).length;
    const totalWipes = allFights.filter(f => !f.kill).length;
    // Unique Boss-Namen
    const bosses = [...new Set(allFights.map(f => f.bossName || f.fightName))];

    let html = '<div class="wipes-page"><h2 class="wipes-title">📊 Analyse — Forensik</h2>';

    // Filter-Bar
    const f = window._wipeState.filter;
    const bf = window._wipeState.bossFilter;
    html += '<div class="wipes-filter">';
    html += `<div class="wipes-filter-group">`;
    html += `<button class="wf-btn${f==='all'?' active':''}" data-filter="all">Alle (${allFights.length})</button>`;
    html += `<button class="wf-btn${f==='wipes'?' active':''}" data-filter="wipes">💀 Wipes (${totalWipes})</button>`;
    html += `<button class="wf-btn${f==='kills'?' active':''}" data-filter="kills">✅ Kills (${totalKills})</button>`;
    html += `</div>`;
    html += `<div class="wipes-filter-group">`;
    html += `<select class="wf-boss"><option value="all"${bf==='all'?' selected':''}>Alle Bosse</option>`;
    for (const b of bosses) html += `<option value="${escapeHtml(b)}"${bf===b?' selected':''}>${escapeHtml(b)}</option>`;
    html += `</select>`;
    html += `<button class="wf-btn-link" data-action="collapse-all">Alle einklappen</button>`;
    html += `<button class="wf-btn-link" data-action="expand-all">Alle aufklappen</button>`;
    html += `</div></div>`;

    // Filter anwenden
    let visible = allFights;
    if (f === 'wipes') visible = visible.filter(x => !x.kill);
    if (f === 'kills') visible = visible.filter(x => x.kill);
    if (bf !== 'all') visible = visible.filter(x => (x.bossName || x.fightName) === bf);

    // Gruppieren nach Boss
    const byBoss = new Map();
    for (const w of visible) {
      const k = w.bossName || w.fightName;
      if (!byBoss.has(k)) byBoss.set(k, []);
      byBoss.get(k).push(w);
    }
    // Sortierung: Boss-Gruppen nach erster Fight-Zeit (Reihenfolge im Raid)
    const groupOrder = [...byBoss.entries()].sort((a, b) => a[1][0].fightId - b[1][0].fightId);

    for (const [bossName, fights] of groupOrder) {
      const kills = fights.filter(x => x.kill).length;
      const wipes = fights.length - kills;
      const collapsed = window._wipeState.collapsed.has(bossName);
      html += `<div class="boss-group${collapsed?' collapsed':''}">`;
      html += `<div class="boss-group-head" data-boss="${escapeHtml(bossName)}">`;
      html += `<span class="boss-group-toggle">${collapsed?'▶':'▼'}</span>`;
      html += `<strong class="boss-group-name">${escapeHtml(bossName)}</strong>`;
      html += `<span class="boss-group-stats">`;
      if (kills > 0) html += `<span class="bg-kill">✅ ${kills} Kill${kills>1?'s':''}</span>`;
      if (wipes > 0) html += `<span class="bg-wipe">💀 ${wipes} Wipe${wipes>1?'s':''}</span>`;
      html += `</span></div>`;
      html += `<div class="boss-group-body${collapsed?' hidden':''}">`;
      // Fights innerhalb der Gruppe nach fightId sortieren
      for (const w of fights.sort((a, b) => a.fightId - b.fightId)) {
        html += renderSingleWipe(w);
      }
      html += `</div></div>`;
    }
    html += '</div>';
    host.innerHTML = html;

    // Event-Handler
    host.querySelectorAll('.wf-btn').forEach(b => {
      b.addEventListener('click', () => {
        window._wipeState.filter = b.dataset.filter;
        renderWipesAdmin(reports);
      });
    });
    const sel = host.querySelector('.wf-boss');
    if (sel) sel.addEventListener('change', () => {
      window._wipeState.bossFilter = sel.value;
      renderWipesAdmin(reports);
    });
    host.querySelectorAll('[data-action="collapse-all"]').forEach(b => {
      b.addEventListener('click', () => {
        for (const [bn] of byBoss) window._wipeState.collapsed.add(bn);
        renderWipesAdmin(reports);
      });
    });
    host.querySelectorAll('[data-action="expand-all"]').forEach(b => {
      b.addEventListener('click', () => {
        window._wipeState.collapsed.clear();
        renderWipesAdmin(reports);
      });
    });
    host.querySelectorAll('.boss-group-head').forEach(head => {
      head.addEventListener('click', () => {
        const boss = head.dataset.boss;
        if (window._wipeState.collapsed.has(boss)) window._wipeState.collapsed.delete(boss);
        else window._wipeState.collapsed.add(boss);
        renderWipesAdmin(reports);
      });
    });
  }

  // ─── Wipe-Diagnose UX (neue Struktur) ───

  function fmtMmss(sec) {
    const n = Math.max(0, Math.floor(sec));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }

  // CD-Keys → Klartext-Namen
  const CD_LABELS = {
    bloodlust: 'Bloodlust', heroism: 'Heroism',
    innervate: 'Innervate', manaTide: 'Mana Tide Totem',
    shadowfiend: 'Shadowfiend', powerInfusion: 'Power Infusion',
    divineShield: 'Divine Shield', divineProtection: 'Divine Protection',
    layOnHands: 'Lay on Hands', iceBlock: 'Ice Block',
    shieldWall: 'Shield Wall', lastStand: 'Last Stand',
    manaPot: 'Mana-Pots', demonicRune: 'Demonic Rune', darkRune: 'Dark Rune',
    drumsBattle: 'Drums of Battle', drumsRest: 'Drums of Restoration',
    drumsSpeed: 'Drums of Speed', drumsWar: 'Drums of War', drumsPanic: 'Drums of Panic',
  };

  // Kompakte Status-Line mit Stat-Pills (eine Zeile, alle Key-Stats auf einen Blick)
  function renderStatusLine(w) {
    const ex = w.extended || {};
    const pills = [];
    // Tank-Tode
    if (ex.tankInfo && ex.tankInfo.deaths && ex.tankInfo.deaths.length) {
      const list = ex.tankInfo.deaths.map(t => `${escapeHtml(t.name)} @ ${fmtMmss(t.atSec)}`).join(', ');
      pills.push({ icon: '🛡', value: `${ex.tankInfo.deaths.length}× Tank-Tod`, tooltip: list, severity: 'danger' });
    }
    // OOM Healers
    const oom = [];
    for (const [n, c] of Object.entries((w.curves && w.curves.healerMana) || {})) {
      if (!c.length) continue;
      const m = Math.min.apply(null, c.map(p => p.val));
      if (m < 15) oom.push({ n, m: Math.round(m) });
    }
    if (oom.length) {
      const list = oom.sort((a,b)=>a.m-b.m).map(x => `${escapeHtml(x.n)} ${x.m}%`).join(', ');
      pills.push({ icon: '🩹', value: `${oom.length}× OOM`, tooltip: list, severity: oom.length >= 2 ? 'danger' : 'warn' });
    }
    // DMG-Split
    if (ex.dpsBreakdown) {
      pills.push({ icon: '📊', value: `${ex.dpsBreakdown.bossPct}% Boss / ${ex.dpsBreakdown.addsPct}% Adds`, severity: 'info' });
    }
    // Boss-Stillstand
    const stuck = (w.encounterSignals || []).find(s => s.key === 'bossStuck');
    if (stuck) {
      pills.push({ icon: '🛑', value: stuck.value, severity: 'danger' });
    }
    // Generators (Vashj)
    const gen = (w.encounterSignals || []).find(s => s.key === 'vashjGenerators');
    if (gen) {
      pills.push({ icon: '🛡', value: `Generators ${gen.value}`, severity: gen.value.startsWith('4') ? 'good' : 'warn' });
    }
    // Add-Status (gekillt/CC/untouched)
    const addCurves = (w.curves && w.curves.addHp) || {};
    let killedA = 0, ccA = 0, untouchedA = 0;
    const TRIVIAL_RX = /lurker|sporebat|spitfire|earthbind|cyclone|totem|water elemental/i;
    const UNKILLABLE_RX = /^(nether vapor|water spirit|elemental spirit|frost spirit)/i;
    for (const [bn, ins] of Object.entries(addCurves)) {
      if (TRIVIAL_RX.test(bn)) continue;
      if (UNKILLABLE_RX.test(bn)) continue;
      for (const i of ins) {
        if (i.cc) ccA++;
        else if (i.untouched) {
          const m = (i.instance || '').match(/\s+(\d+)$/);
          const inst = m ? parseInt(m[1], 10) : 1;
          if (/karathress|caribdis|sharkkis|tidalvess|fathom-guard/i.test(bn) && inst > 1) continue;
          untouchedA++;
        }
        else if (i.curve && i.curve.length && Math.min.apply(null, i.curve.map(p => p.val)) < 5) killedA++;
      }
    }
    const totalA = killedA + ccA + untouchedA;
    if (totalA > 0) {
      const parts = [];
      if (killedA) parts.push(`${killedA} ✗`);
      if (ccA) parts.push(`${ccA} 🔒`);
      if (untouchedA) parts.push(`${untouchedA} 🆘`);
      pills.push({ icon: '👹', value: `Adds: ${parts.join(' · ')}`, severity: untouchedA >= 3 ? 'danger' : 'info' });
    }
    // CDs
    if (ex.cdUsage && ex.cdUsage.bloodlustTime != null) {
      pills.push({ icon: '🚀', value: `BL @ ${fmtMmss(+ex.cdUsage.bloodlustTime)}`, severity: 'info' });
    }
    // Avoidable Damage — top 3 "stood in stuff" Spieler
    if (w.avoidableHits > 0 && w.avoidablePerPlayer) {
      const ranked = Object.entries(w.avoidablePerPlayer)
        .map(([tid, p]) => ({ name: (window._playerIdToName || {})[tid] || `#${tid}`, ...p }))
        .sort((a, b) => b.damage - a.damage);
      const top3 = ranked.slice(0, 3);
      const tooltip = ranked.slice(0, 8).map(r => `${r.name}: ${r.hits}× / ${r.damage}`).join(' · ');
      pills.push({
        icon: '💢',
        value: `${w.avoidableHits} Avoidable-Hits${top3.length ? ' (' + top3.map(r => r.name).join(', ') + ')' : ''}`,
        tooltip,
        severity: w.avoidableHits > 30 ? 'danger' : (w.avoidableHits > 10 ? 'warn' : 'info'),
      });
    }
    // Render
    let html = '<div class="status-line">';
    for (const p of pills) {
      const tip = p.tooltip ? ` title="${p.tooltip.replace(/"/g,'&quot;')}"` : '';
      html += `<span class="stat-pill stat-${p.severity}"${tip}><span class="pill-icon">${p.icon}</span><span class="pill-val">${p.value}</span></span>`;
    }
    html += '</div>';
    // Sekundärer Detail-Block (collapsed by default)
    const causeBullets = buildWipeCause(w);
    if (causeBullets.length) {
      html += '<details class="wipe-cause-det"><summary>📋 Alle Schlüssel-Fakten</summary><ul class="wipe-cause-list">';
      for (const b of causeBullets) html += `<li><span class="wipe-cause-icon">${b.icon}</span><span class="wipe-cause-text">${b.text}</span></li>`;
      html += '</ul></details>';
    }
    return html;
  }

  // Schlüssel-Fakten (nur Zahlen + Namen, keine Interpretation)
  function buildWipeCause(w) {
    const ex = w.extended || {};
    const bullets = [];
    // Enrage
    if (w.reachedEnrage) {
      bullets.push({ icon: '⏱', text: `Enrage: ${Math.round(w.durationSec)}s / ${w.enrageSec}s Limit, Boss @ ${w.bossPctAtEnd}%.` });
    }
    // Boss-DMG-Stillstand
    const stuck = (w.encounterSignals || []).find(s => s.key === 'bossStuck');
    if (stuck) {
      bullets.push({ icon: '🛑', text: `Boss-DMG-Stillstand: ${escapeHtml(stuck.value)}.` });
    }
    // Tank-Tode (Liste)
    if (ex.tankInfo && ex.tankInfo.deaths && ex.tankInfo.deaths.length) {
      const list = ex.tankInfo.deaths.map(t => `${escapeHtml(t.name)} @ ${fmtMmss(t.atSec)}`).join(', ');
      bullets.push({ icon: '🛡', text: `Tank-Tode: ${list}.` });
    }
    // Healer-Mana-Minima
    const lowMana = [];
    for (const [name, curve] of Object.entries((w.curves && w.curves.healerMana) || {})) {
      if (!curve.length) continue;
      const minMana = Math.min.apply(null, curve.map(p => p.val));
      if (minMana < 30) lowMana.push({ name, minPct: Math.round(minMana) });
    }
    if (lowMana.length) {
      const list = lowMana.sort((a, b) => a.minPct - b.minPct).map(h => `${escapeHtml(h.name)} ${h.minPct}%`).join(', ');
      bullets.push({ icon: '🩹', text: `Healer-Mana-Minimum: ${list}.` });
    }
    // DMG-Verteilung Boss/Adds (Zahl)
    if (ex.dpsBreakdown) {
      const d = ex.dpsBreakdown;
      bullets.push({ icon: '📊', text: `DMG-Verteilung: ${d.bossPct}% Boss · ${d.addsPct}% Adds.` });
    }
    // Add-Status: gekillt / gebanished / ignoriert (rohe Zahlen)
    const addCurves = (w.curves && w.curves.addHp) || {};
    const TRIVIAL_RX = /lurker|sporebat|spitfire|earthbind|cyclone|totem|water elemental/i;
    let totalAdds = 0, killedAdds = 0, ccdAdds = 0, untouchedAdds = 0, barelyAdds = 0;
    for (const [baseName, insts] of Object.entries(addCurves)) {
      if (TRIVIAL_RX.test(baseName)) continue;
      for (const i of insts) {
        totalAdds++;
        if (i.cc) ccdAdds++;
        else if (i.untouched) untouchedAdds++;
        else if (i.barelyHit) barelyAdds++;
        else if (i.curve && i.curve.length && Math.min.apply(null, i.curve.map(p => p.val)) < 5) killedAdds++;
      }
    }
    if (totalAdds > 0) {
      const parts = [];
      if (killedAdds) parts.push(`${killedAdds} gekillt`);
      if (ccdAdds) parts.push(`${ccdAdds} gebanished/CC`);
      if (barelyAdds) parts.push(`${barelyAdds} 1-Hit`);
      if (untouchedAdds) parts.push(`${untouchedAdds} 0-Hits`);
      bullets.push({ icon: '👹', text: `Adds (${totalAdds}): ${parts.join(' · ')}.` });
    }
    // CC-Casts mit Quelle (Banish/Hibernate)
    const ccCasts = {};
    for (const insts of Object.values(addCurves)) {
      for (const i of insts) {
        if (!i.cc || i.ccBy == null) continue;
        const name = window._playerIdToName && window._playerIdToName[i.ccBy] || `id${i.ccBy}`;
        ccCasts[name] = (ccCasts[name] || 0) + i.cc;
      }
    }
    if (Object.keys(ccCasts).length) {
      const list = Object.entries(ccCasts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${escapeHtml(n)} ${c}×`).join(', ');
      bullets.push({ icon: '🔒', text: `Banish/CC-Casts: ${list}.` });
    }
    // Tote pro Quelle (top 3)
    if (w.deathEntries && w.deathEntries.length) {
      const bySource = {};
      for (const d of w.deathEntries) {
        const s = d.source || '?';
        bySource[s] = (bySource[s] || 0) + 1;
      }
      const top = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, c]) => `${escapeHtml(s)} ${c}×`).join(', ');
      bullets.push({ icon: '💀', text: `Tode (${w.totalDeaths}) — Quellen: ${top}.` });
    }
    return bullets;
  }

  // Text-Timeline aus Events: Phasen, Tode, Boss-Stuck, Bloodlust, Add-Wellen, etc.
  function buildWipeTimeline(w) {
    const ex = w.extended || {};
    const evs = [];
    evs.push({ sec: 0, icon: '🟢', text: '<strong>Pull</strong>' });
    // Bloodlust
    if (ex.cdUsage && ex.cdUsage.bloodlustTime != null) {
      evs.push({ sec: +ex.cdUsage.bloodlustTime, icon: '🚀', text: `<strong>Bloodlust/Heroism</strong>` });
    }
    // Phasen-Wechsel — bei Hydross/Morogrim/Vashj erweitern um erwartete Add-Spawns
    const bn = (w.bossName || w.fightName || '').toLowerCase();
    for (const p of (w.phaseTransitions || [])) {
      let extra = '';
      if (/hydross/.test(bn)) {
        const addType = /pure.*frost/i.test(p.label) ? 'Tainted Spawns' : 'Pure Spawns';
        const n = p.addCount || 4;
        extra = ` <small class="text-muted">→ ${n}× ${escapeHtml(addType)} spawnen</small>`;
      } else if (/morogrim/.test(bn) && /murloc/i.test(p.label)) {
        extra = ` <small class="text-muted">→ Murloc-Welle (×16)</small>`;
      } else if (/vashj/.test(bn) && /striders/i.test(p.label)) {
        extra = ` <small class="text-muted">→ Coilfang Striders + Tainted Elementals spawnen</small>`;
      } else if (/kael/.test(bn) && /advisors/i.test(p.label)) {
        extra = ` <small class="text-muted">→ 4 Advisors greifen an</small>`;
      }
      const bossNote = p.bossPct != null ? ` (Boss @ ${p.bossPct}%)` : '';
      evs.push({ sec: p.atSec, icon: '🌀', text: `Phase: <strong>${escapeHtml(p.label)}</strong>${bossNote}${extra}` });
    }
    // Erster Tod (mit Easter-Egg "Loooooooooooooser")
    if (w.deathEntries && w.deathEntries.length) {
      const first = w.deathEntries[0];
      const kb = first.killingBlow ? first.killingBlow.name : '?';
      const src = first.source || '?';
      const fdCss = classCssFromType(first.type);
      const nameHtml = `<span class="first-death first-death--loser"><span class="first-death-name ${fdCss}"><strong>${escapeHtml(first.name)}</strong></span><span class="first-death-gag" aria-hidden="true">Loooooooooooooser</span></span>`;
      evs.push({ sec: +first.sinceStartSec, icon: '💀', text: `Erster Tod: ${nameHtml} — ${escapeHtml(kb)} <small class="text-muted">von ${escapeHtml(src)}</small>` });
    }
    // Tank-Tode (separat hervorgehoben — easter-egg via Branding-Config)
    const tankDeathEggs = ((window._branding && window._branding.easterEggs) || [])
      .filter(e => e && e.type === 'tank-death-wobble');
    for (const td of ((ex.tankInfo && ex.tankInfo.deaths) || [])) {
      const egg = tankDeathEggs.find(e => (e.name || '').toLowerCase() === (td.name || '').toLowerCase());
      if (egg) {
        const nameHtml = `<span class="first-death egg-tank-death"><span class="first-death-name"><strong>${escapeHtml(td.name)}</strong></span><span class="first-death-gag" aria-hidden="true">${escapeHtml(egg.alt || egg.text || td.name)}</span></span>`;
        evs.push({ sec: td.atSec, icon: '🛡', text: `Tank ${nameHtml} stirbt` });
      } else {
        evs.push({ sec: td.atSec, icon: '🛡', text: `Tank <strong>${escapeHtml(td.name)}</strong> stirbt` });
      }
    }
    // Healer-OOM Zeitpunkte (erste Zeit wo Mana < 10%)
    for (const [hname, curve] of Object.entries((w.curves && w.curves.healerMana) || {})) {
      if (!curve.length) continue;
      const oom = curve.find(p => p.val < 10);
      if (oom) evs.push({ sec: oom.sec, icon: '🩹', text: `Healer <strong>${escapeHtml(hname)}</strong> geht OOM (<10% Mana)` });
    }
    // Boss-DMG-Stillstand
    const stuck = (w.encounterSignals || []).find(s => s.key === 'bossStuck');
    if (stuck) {
      const bh = (w.curves && w.curves.bossHp) || [];
      if (bh.length) evs.push({ sec: bh[bh.length - 1].sec, icon: '🛑', text: `Boss-Schaden stoppt — Mechanik blockiert` });
    }
    // Add-Wellen aus den HP-Kurven werden NICHT separat in Timeline gezeigt — sind durch Phase-Marker
    // schon abgedeckt ("→ 4× Tainted Spawns spawnen"). Außerdem ist die Bucketing-Aggregation ungenau, da
    // verzögerte Erst-Attacken die echte Spawn-Zeit verschleiern. Stattdessen findest Du alle Instanzen
    // im Add-Lifetimes-Detail und im Haupt-Chart als HP-Linien.
    // Vashj-Generator-Events in Timeline einbauen (aus encounterSignals.detail extrahieren)
    if (/vashj/i.test(bn)) {
      const genSig = (w.encounterSignals || []).find(s => s.key === 'vashjGenerators');
      if (genSig && genSig.detail) {
        const m = genSig.detail.match(/Generatoren zerstört bei: ([\d:, ]+)/);
        if (m) {
          const times = m[1].split(',').map(s => s.trim());
          times.forEach((t, i) => {
            const [mm, ss] = t.split(':').map(Number);
            const sec = mm * 60 + (ss || 0);
            evs.push({ sec, icon: '🛡', text: `<strong>Shield-Generator ${i + 1}/4 zerstört</strong>` });
          });
        }
      }
    }
    // Fight-Ende: Kill oder Wipe
    if (w.kill) {
      evs.push({ sec: +w.durationSec, icon: '✅', text: `<strong>Boss tot!</strong>` });
    } else if (w.lastDeathSec != null && w.deathEntries.length > 1) {
      evs.push({ sec: +w.lastDeathSec, icon: '🪦', text: `<strong>Wipe</strong> @ Boss ${w.bossPctAtEnd != null ? w.bossPctAtEnd + '%' : '?'}` });
    }
    evs.sort((a, b) => a.sec - b.sec);
    // Dedupe wenn gleiche sec+icon
    const seen = new Set();
    return evs.filter(e => {
      const k = `${Math.floor(e.sec)}|${e.icon}|${e.text.substring(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderSingleWipe(w, opts) {
    opts = opts || {};
    // Player-ID → Name Lookup für CC-Attribution etc.
    window._playerIdToName = window._playerIdToName || {};
    for (const p of (w.players || [])) {
      if (p.id != null && p.name) window._playerIdToName[p.id] = p.name;
    }
    const ex = w.extended || {};
    const dur = w.durationSec || 0;
    const bossLabel = w.bossPctAtEnd != null
      ? (w.bossPctAtEnd === 0 ? '✅ getötet' : `🔴 ${w.bossPctAtEnd}% übrig`)
      : '';

    let html = `<div class="wipe-card${w.kill ? ' wipe-card--kill' : ''}${opts.compact ? ' wipe-card--compact' : ''}">`;
    // === Header (im Compact-Mode auslassen, da übergeordnete Card sie schon hat) ===
    if (!opts.compact) {
      html += '<div class="wipe-head">';
      const killBadge = w.kill ? '<span class="kill-badge">✅ KILL</span>' : '';
      html += `<div class="wipe-title">${killBadge}<strong>${escapeHtml(w.bossName || w.fightName)}</strong></div>`;
      html += `<div class="wipe-meta">${fmtMmss(dur)} · ${w.totalDeaths} Tote · ${bossLabel}</div>`;
      html += '</div>';
    }

    // === Status-Line (kompakte Stat-Pills) + ausklappbare Details ===
    html += renderStatusLine(w);

    // === Haupt-Chart (vereinfacht: nur Boss + Raid + Marker) ===
    html += renderMainChart(w);

    // === Timeline ===
    const tl = buildWipeTimeline(w);
    if (tl.length) {
      html += '<div class="wipe-tl"><div class="wipe-tl-title">⏱ Timeline</div><ol class="wipe-tl-list">';
      for (const e of tl) {
        const cls = e.icon === '🪦' ? ' wipe-tl-end' : (e.icon === '🛡' ? ' wipe-tl-tank' : (e.icon === '🩹' ? ' wipe-tl-oom' : ''));
        html += `<li class="wipe-tl-row${cls}"><span class="wipe-tl-time">${fmtMmss(e.sec)}</span><span class="wipe-tl-icon">${e.icon}</span><span class="wipe-tl-text">${e.text}</span></li>`;
      }
      html += '</ol></div>';
    }

    // === Aufklappbare Details ===
    // 💚 Healer-Mana (Mini-Chart)
    const manaCurves = (w.curves && w.curves.healerMana) || {};
    if (Object.keys(manaCurves).length) {
      html += `<details class="wipe-det"><summary>💚 Healer-Mana-Verlauf</summary>${renderManaChart(w)}</details>`;
    }
    // 👹 Adds (Spawn-Timeline-Liste — HP-Kurven sind jetzt im Haupt-Chart)
    const addCurves = (w.curves && w.curves.addHp) || {};
    if (Object.keys(addCurves).length) {
      html += `<details class="wipe-det"><summary>👹 Add-Lifetimes (${Object.values(addCurves).reduce((s, a) => s + a.length, 0)} Adds)</summary>${renderAddTimelineBody(w)}</details>`;
    }
    // 📊 DPS / HPS / CDs
    html += renderDetailsRanking(w);
    // 💀 Tod-Liste
    if (w.deathEntries && w.deathEntries.length) {
      html += `<details class="wipe-det"><summary>💀 Tod-Liste (${w.deathEntries.length})</summary><table class="wipe-deaths-table"><thead><tr><th>Zeit</th><th>Spieler</th><th>Klasse</th><th>Killing Blow</th><th>Quelle</th></tr></thead><tbody>`;
      for (let i = 0; i < w.deathEntries.length; i++) {
        const d = w.deathEntries[i];
        const css = classCssFromType(d.type);
        const kb = d.killingBlow ? escapeHtml(d.killingBlow.name || `#${d.killingBlow.id}`) : '—';
        const src = d.source ? escapeHtml(d.source) : '<span class="text-muted">—</span>';
        let nameCell;
        if (i === 0) {
          nameCell = `<td class="${css} first-death first-death--loser"><span class="first-death-name">${escapeHtml(d.name)}</span><span class="first-death-gag" aria-hidden="true">Loooooooooooooser</span></td>`;
        } else {
          nameCell = `<td class="${css}">${escapeHtml(d.name)}</td>`;
        }
        html += `<tr><td>${fmtMmss(+d.sinceStartSec)}</td>${nameCell}<td class="${css}">${escapeHtml(classNameFromType(d.type))}</td><td>${kb}</td><td>${src}</td></tr>`;
      }
      html += '</tbody></table></details>';
    }
    html += '</div>';
    return html;
  }

  // Vereinfachter Haupt-Chart: nur Boss-HP + Raid-HP + Phasen + Tanks + Bloodlust + Tode
  function renderMainChart(w) {
    const dur = Math.max(1, w.durationSec || 1);
    const W = 820, H = 180;
    const PAD = { left: 36, right: 88, top: 12, bottom: 22 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = sec => PAD.left + (sec / dur) * innerW;
    const y = pct => PAD.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * innerH;
    const bossName = w.bossName || w.fightName || 'Boss';

    let svg = `<svg class="wipe-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    // Y-Grid
    for (const p of [0, 50, 100]) {
      svg += `<line x1="${PAD.left}" y1="${y(p)}" x2="${W - PAD.right}" y2="${y(p)}" stroke="#2a2a2a" stroke-dasharray="2,4"/>`;
      svg += `<text x="${PAD.left - 5}" y="${y(p) + 3}" text-anchor="end" fill="#666" font-size="9">${p}%</text>`;
    }
    // X-Ticks (mm:ss)
    const step = dur > 300 ? 60 : (dur > 120 ? 30 : 15);
    for (let s = 0; s <= dur; s += step) {
      svg += `<text x="${x(s)}" y="${H - PAD.bottom + 13}" text-anchor="middle" fill="#666" font-size="9">${fmtMmss(s)}</text>`;
    }
    // Phasen
    for (const ph of (w.phaseTransitions || [])) {
      svg += `<line x1="${x(ph.atSec)}" y1="${PAD.top}" x2="${x(ph.atSec)}" y2="${H - PAD.bottom}" stroke="#aa8844" stroke-dasharray="4,3" stroke-width="1.2"/>`;
      svg += `<text x="${x(ph.atSec) + 3}" y="${PAD.top + 9}" fill="#d4a25a" font-size="9">${escapeHtml(ph.label || '')}</text>`;
    }
    // Raid-HP Fill
    if (w.curves && w.curves.raidAvgHp && w.curves.raidAvgHp.length) {
      const pts = w.curves.raidAvgHp;
      let d = 'M' + pts.map(p => `${x(p.sec)},${y(p.val)}`).join(' L');
      d += ` L${x(pts[pts.length - 1].sec)},${y(0)} L${x(pts[0].sec)},${y(0)} Z`;
      svg += `<path d="${d}" fill="rgba(80,160,255,0.18)" stroke="#5095e8" stroke-width="1.3"/>`;
    }
    // Add-HP-Kurven (dünne Linien pro Instanz) — VOR Boss-HP, damit Boss-Linie drüber liegt.
    // Filter: nur echtes Environment-Trash raus, Waffen/Adds rein. Max 8 Add-Typen.
    const addCurvesRaw = (w.curves && w.curves.addHp) || {};
    const ENV_RX = /environment|nether vapor|water elemental|earth elemental/i;
    const addCurvesMain = {};
    const scored = Object.entries(addCurvesRaw)
      .filter(([n]) => !ENV_RX.test(n))
      .map(([n, insts]) => {
        let totalPts = 0;
        for (const i of insts) totalPts += (i.curve && i.curve.length) || 0;
        return { name: n, insts, score: totalPts };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    for (const r of scored) addCurvesMain[r.name] = r.insts;
    const ADD_COLORS_MAIN = ['#88ff88', '#ff88ff', '#ffaa66', '#88ccff', '#ffff66', '#dd6688', '#a0e8ff', '#ffc4a0'];
    // Spezifische Farben für bekannte Add-Typen (Phoenix = orange-fire)
    const ADD_COLOR_OVERRIDES = {
      'Phoenix': '#ff7733',
      'Nether Vapor': '#aa44ff',
      'Toxic Sporebat': '#bbff44',
      'Coilfang Strider': '#3399ff',
      'Tainted Elemental': '#88ff88',
      'Coilfang Elite': '#ff9966',
    };
    const addLegendMain = [];
    let addIdxMain = 0;
    for (const [baseName, instances] of Object.entries(addCurvesMain)) {
      const cc = ADD_COLOR_OVERRIDES[baseName] || ADD_COLORS_MAIN[addIdxMain % ADD_COLORS_MAIN.length];
      let killed = 0, untouched = 0;
      for (const inst of instances) {
        if (inst.untouched) {
          svg += `<line x1="${x(inst.spawnSec)}" y1="${y(100)}" x2="${x(inst.deathSec)}" y2="${y(100)}" stroke="#ff4040" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.55"/>`;
          svg += `<circle cx="${x(inst.spawnSec)}" cy="${y(100)}" r="2" fill="#ff4040"/>`;
          untouched++;
          continue;
        }
        if (!inst.curve || !inst.curve.length) continue;
        // Path bei Sprung >50% (Respawn/Rez wie Kael's Advisors) unterbrechen, sonst zeichnet's die Linie quer hoch
        let dpath = '', segStart = true;
        let prevVal = inst.curve[0].val;
        for (const p of inst.curve) {
          if (!segStart && p.val - prevVal > 50) {
            // Sprung erkannt: Sub-Segment beenden, neues starten
            dpath += ` M${x(p.sec)},${y(p.val)}`;
            // Marker für Respawn-Start
            svg += `<circle cx="${x(p.sec)}" cy="${y(p.val)}" r="1.8" fill="${cc}" opacity="0.85"/>`;
          } else {
            dpath += (segStart ? 'M' : ' L') + `${x(p.sec)},${y(p.val)}`;
          }
          segStart = false;
          prevVal = p.val;
        }
        svg += `<path d="${dpath}" stroke="${cc}" stroke-width="1" fill="none" opacity="0.65"/>`;
        svg += `<circle cx="${x(inst.curve[0].sec)}" cy="${y(inst.curve[0].val)}" r="1.8" fill="${cc}" opacity="0.85"/>`;
        // Tod-Marker pro Sub-Segment finden (Stelle wo val erstmals < 5)
        let prev = 200;
        for (const p of inst.curve) {
          if (prev >= 5 && p.val < 5) {
            killed++;
            svg += `<polygon points="${x(p.sec) - 2.5},${y(0) - 4} ${x(p.sec) + 2.5},${y(0) - 4} ${x(p.sec)},${y(0) + 1}" fill="${cc}"/>`;
          }
          prev = p.val;
        }
      }
      addLegendMain.push({ name: baseName, color: cc, killed, total: instances.length, untouched });
      addIdxMain++;
    }
    // Boss-HP
    if (w.curves && w.curves.bossHp && w.curves.bossHp.length) {
      const pts = w.curves.bossHp;
      const d = 'M' + pts.map(p => `${x(p.sec)},${y(p.val)}`).join(' L');
      svg += `<path d="${d}" stroke="#ff4040" stroke-width="2.4" fill="none"/>`;
      const last = pts[pts.length - 1];
      if (dur - last.sec >= 15) {
        svg += `<line x1="${x(last.sec)}" y1="${y(last.val)}" x2="${x(dur)}" y2="${y(last.val)}" stroke="#ff4040" stroke-width="2.4" stroke-dasharray="3,3"/>`;
        svg += `<text x="${(x(last.sec) + x(dur)) / 2}" y="${y(last.val) - 4}" text-anchor="middle" fill="#ff8888" font-size="10" font-weight="bold">${Math.round(dur - last.sec)}s STUCK</text>`;
      }
      svg += `<text x="${x(dur) + 4}" y="${y(last.val) + 3}" fill="#ff5050" font-size="10" font-weight="bold">${Math.round(last.val)}%</text>`;
    }
    // Bloodlust
    const blTime = w.extended && w.extended.cdUsage && w.extended.cdUsage.bloodlustTime;
    if (blTime != null) {
      svg += `<line x1="${x(+blTime)}" y1="${PAD.top}" x2="${x(+blTime)}" y2="${H - PAD.bottom}" stroke="#ff8800" stroke-width="1.5" opacity="0.7" stroke-dasharray="2,2"/>`;
      svg += `<text x="${x(+blTime)}" y="${PAD.top - 1}" text-anchor="middle" font-size="11">🚀</text>`;
    }
    // Vashj Shield-Generator-Dunks (aus encounterSignals)
    let genCount = 0;
    if (/vashj/i.test(bossName.toLowerCase())) {
      const genSig = (w.encounterSignals || []).find(s => s.key === 'vashjGenerators');
      if (genSig && genSig.detail) {
        const m = genSig.detail.match(/Generatoren zerstört bei: ([\d:, ]+)/);
        if (m) {
          const times = m[1].split(',').map(s => s.trim());
          for (const t of times) {
            const [mm, ss] = t.split(':').map(Number);
            const sec = mm * 60 + (ss || 0);
            genCount++;
            svg += `<line x1="${x(sec)}" y1="${PAD.top}" x2="${x(sec)}" y2="${H - PAD.bottom}" stroke="#22c55e" stroke-width="1.5" opacity="0.6" stroke-dasharray="2,3"/>`;
            svg += `<text x="${x(sec)}" y="${PAD.top + 10}" text-anchor="middle" font-size="11">🛡</text>`;
            svg += `<text x="${x(sec)}" y="${PAD.top + 20}" text-anchor="middle" font-size="8" fill="#22c55e" font-weight="bold">${genCount}</text>`;
          }
        }
      }
    }
    // Tank-Tode (über X-Achse)
    const tankDeaths = (w.extended && w.extended.tankInfo && w.extended.tankInfo.deaths) || [];
    for (const td of tankDeaths) {
      svg += `<text x="${x(td.atSec)}" y="${H - PAD.bottom - 4}" text-anchor="middle" font-size="14">🛡</text>`;
    }
    // Death-Marker — finde ersten Tod (chronologisch frühester)
    const _deathsParsed = (w.deathEntries || []).map(d => ({...d, _s: parseFloat(d.sinceStartSec)})).filter(d => isFinite(d._s));
    let _firstDeath = null;
    for (const d of _deathsParsed) { if (!_firstDeath || d._s < _firstDeath._s) _firstDeath = d; }
    for (const dE of _deathsParsed) {
      const s = dE._s;
      if (dE === _firstDeath) {
        const gagY = PAD.top + Math.round(innerH / 2);
        svg += `<g class="fd-trigger fd-trigger--loser">`;
        svg += `<rect x="${x(s) - 8}" y="${PAD.top}" width="16" height="${innerH + 12}" fill="transparent" pointer-events="all"/>`;
        svg += `<polygon points="${x(s) - 4},${H - PAD.bottom + 2} ${x(s) + 4},${H - PAD.bottom + 2} ${x(s)},${H - PAD.bottom - 5}" fill="#ff3333" stroke="#fbbf24" stroke-width="0.8"/>`;
        svg += `<text class="fd-gag" x="0" y="${gagY}" font-size="18" font-weight="800" fill="#ef4444" letter-spacing="2">Loooooooooooooser</text>`;
        svg += `</g>`;
      } else {
        svg += `<polygon points="${x(s) - 3},${H - PAD.bottom + 2} ${x(s) + 3},${H - PAD.bottom + 2} ${x(s)},${H - PAD.bottom - 3}" fill="#ff3333" opacity="0.7"/>`;
      }
    }
    // Legende
    svg += `<g transform="translate(${W - PAD.right + 5}, ${PAD.top + 2})">`;
    let ly = 0;
    svg += `<line x1="0" y1="${ly}" x2="16" y2="${ly}" stroke="#ff4040" stroke-width="2"/><text x="20" y="${ly + 3}" fill="#bbb" font-size="9">${escapeHtml(bossName.length > 14 ? bossName.slice(0, 13) + '…' : bossName)}</text>`;
    ly += 11;
    svg += `<rect x="0" y="${ly - 4}" width="16" height="6" fill="rgba(80,160,255,0.4)" stroke="#5095e8"/><text x="20" y="${ly + 1}" fill="#bbb" font-size="9">Raid-HP</text>`;
    ly += 11;
    // Adds-Legende (max 5 Typen)
    for (const a of addLegendMain.slice(0, 5)) {
      svg += `<line x1="0" y1="${ly}" x2="14" y2="${ly}" stroke="${a.color}" stroke-width="1.5"/>`;
      const nm = a.name.length > 13 ? a.name.slice(0, 12) + '…' : a.name;
      const extra = a.untouched > 0 ? ` <tspan fill="#ff5555">·${a.untouched}🆘</tspan>` : '';
      svg += `<text x="18" y="${ly + 3}" fill="${a.color}" font-size="9">${escapeHtml(nm)} <tspan fill="#888">${a.killed}/${a.total}</tspan>${extra}</text>`;
      ly += 11;
    }
    svg += `<polygon points="0,${ly} 6,${ly} 3,${ly + 6}" fill="#ff3333"/><text x="11" y="${ly + 6}" fill="#bbb" font-size="9">Tod</text>`;
    ly += 12;
    svg += `<text x="3.5" y="${ly}" text-anchor="middle" font-size="11">🛡</text><text x="14" y="${ly}" fill="#bbb" font-size="9">Tank-Tod</text>`;
    if (blTime != null) {
      ly += 12;
      svg += `<text x="3.5" y="${ly}" text-anchor="middle" font-size="11">🚀</text><text x="14" y="${ly}" fill="#bbb" font-size="9">Bloodlust</text>`;
    }
    if (genCount > 0) {
      ly += 12;
      svg += `<text x="3.5" y="${ly}" text-anchor="middle" font-size="11">🛡</text><text x="14" y="${ly}" fill="#22c55e" font-size="9">Generator (${genCount}/4)</text>`;
    }
    svg += `</g>`;
    svg += `</svg>`;
    return svg;
  }

  // Healer-Mana Mini-Chart (collapsible)
  function renderManaChart(w) {
    const dur = Math.max(1, w.durationSec || 1);
    const manaCurves = (w.curves && w.curves.healerMana) || {};
    const W = 780, H = 150;
    const PAD = { left: 36, right: 130, top: 8, bottom: 22 };
    const iW = W - PAD.left - PAD.right;
    const iH = H - PAD.top - PAD.bottom;
    const x = sec => PAD.left + (sec / dur) * iW;
    const y = pct => PAD.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * iH;
    let svg = `<svg class="wipe-chart-mini" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    for (const p of [0, 50, 100]) {
      svg += `<line x1="${PAD.left}" y1="${y(p)}" x2="${W - PAD.right}" y2="${y(p)}" stroke="#2a2a2a" stroke-dasharray="2,4"/>`;
      svg += `<text x="${PAD.left - 4}" y="${y(p) + 3}" text-anchor="end" fill="#666" font-size="9">${p}%</text>`;
    }
    const step = dur > 300 ? 60 : (dur > 120 ? 30 : 15);
    for (let s = 0; s <= dur; s += step) {
      svg += `<text x="${x(s)}" y="${H - PAD.bottom + 13}" text-anchor="middle" fill="#666" font-size="9">${fmtMmss(s)}</text>`;
    }
    const HEAL_COLORS = ['#5ed7ff', '#ff85c2', '#ffd24a', '#7eef82', '#c08aff'];
    let i = 0;
    for (const [name, pts] of Object.entries(manaCurves)) {
      if (!pts || !pts.length) { i++; continue; }
      const c = HEAL_COLORS[i % HEAL_COLORS.length];
      const d = 'M' + pts.map(p => `${x(p.sec)},${y(p.val)}`).join(' L');
      svg += `<path d="${d}" stroke="${c}" stroke-width="1.6" fill="none" opacity="0.9"/>`;
      const last = pts[pts.length - 1];
      const minVal = Math.min.apply(null, pts.map(p => p.val));
      svg += `<text x="${x(last.sec) + 4}" y="${y(last.val) + 3}" fill="${c}" font-size="10">${escapeHtml(name)} <tspan fill="#888">min ${Math.round(minVal)}%</tspan></text>`;
      i++;
    }
    svg += `</svg>`;
    return svg;
  }

  // Add-HP Mini-Chart (Spawn als Kreis, Tod als Dreieck) collapsible
  function renderAddChart(w) {
    const dur = Math.max(1, w.durationSec || 1);
    const addCurves = (w.curves && w.curves.addHp) || {};
    const W = 780, H = 160;
    const PAD = { left: 36, right: 130, top: 8, bottom: 22 };
    const iW = W - PAD.left - PAD.right;
    const iH = H - PAD.top - PAD.bottom;
    const x = sec => PAD.left + (sec / dur) * iW;
    const y = pct => PAD.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * iH;
    let svg = `<svg class="wipe-chart-mini" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    for (const p of [0, 50, 100]) {
      svg += `<line x1="${PAD.left}" y1="${y(p)}" x2="${W - PAD.right}" y2="${y(p)}" stroke="#2a2a2a" stroke-dasharray="2,4"/>`;
      svg += `<text x="${PAD.left - 4}" y="${y(p) + 3}" text-anchor="end" fill="#666" font-size="9">${p}%</text>`;
    }
    const step = dur > 300 ? 60 : (dur > 120 ? 30 : 15);
    for (let s = 0; s <= dur; s += step) {
      svg += `<text x="${x(s)}" y="${H - PAD.bottom + 13}" text-anchor="middle" fill="#666" font-size="9">${fmtMmss(s)}</text>`;
    }
    const ADD_COLORS = ['#88ff88', '#ff88ff', '#ffaa66', '#88ccff', '#ffff66', '#dd6688'];
    let idx = 0;
    const legends = [];
    for (const [baseName, instances] of Object.entries(addCurves)) {
      const c = ADD_COLORS[idx % ADD_COLORS.length];
      let killed = 0, untouched = 0;
      for (const inst of instances) {
        if (inst.untouched) {
          // Unangetastet → durchgezogene rote Linie bei 100% vom Spawn bis Fight-Ende
          untouched++;
          svg += `<line x1="${x(inst.spawnSec)}" y1="${y(100)}" x2="${x(inst.deathSec)}" y2="${y(100)}" stroke="#ff4040" stroke-width="2" stroke-dasharray="4,2" opacity="0.7"/>`;
          svg += `<circle cx="${x(inst.spawnSec)}" cy="${y(100)}" r="3" fill="#ff4040"/>`;
          svg += `<text x="${x(inst.spawnSec) + 5}" y="${y(100) - 2}" fill="#ff8888" font-size="9">🆘 NIE angegriffen</text>`;
          continue;
        }
        if (!inst.curve || !inst.curve.length) continue;
        const d = 'M' + inst.curve.map(p => `${x(p.sec)},${y(p.val)}`).join(' L');
        svg += `<path d="${d}" stroke="${c}" stroke-width="1.2" fill="none" opacity="0.8"/>`;
        svg += `<circle cx="${x(inst.curve[0].sec)}" cy="${y(inst.curve[0].val)}" r="2.5" fill="${c}" opacity="0.9"/>`;
        const minHp = Math.min.apply(null, inst.curve.map(p => p.val));
        if (minHp < 5) {
          killed++;
          const deathPt = inst.curve.find(p => p.val < 5) || inst.curve[inst.curve.length - 1];
          svg += `<polygon points="${x(deathPt.sec) - 3},${y(0) - 5} ${x(deathPt.sec) + 3},${y(0) - 5} ${x(deathPt.sec)},${y(0) + 1}" fill="${c}"/>`;
        }
      }
      legends.push({ name: baseName, color: c, killed, total: instances.length, untouched });
      idx++;
    }
    // Legende
    svg += `<g transform="translate(${W - PAD.right + 5}, ${PAD.top})">`;
    let ly = 0;
    for (const l of legends.slice(0, 7)) {
      svg += `<line x1="0" y1="${ly}" x2="14" y2="${ly}" stroke="${l.color}" stroke-width="1.5"/>`;
      const nm = l.name.length > 16 ? l.name.slice(0, 15) + '…' : l.name;
      const extra = l.untouched > 0 ? ` <tspan fill="#ff5555">·${l.untouched}🆘</tspan>` : '';
      svg += `<text x="18" y="${ly + 3}" fill="${l.color}" font-size="9">${escapeHtml(nm)} <tspan fill="#888">${l.killed}/${l.total}</tspan>${extra}</text>`;
      ly += 13;
    }
    svg += `</g>`;
    svg += `</svg>`;
    return svg;
  }

  // Add-Spawn/Death Liste (in same details als Add-Chart)
  function renderAddTimelineBody(w) {
    const addCurves = (w.curves && w.curves.addHp) || {};
    if (!Object.keys(addCurves).length) return '';
    const bn = (w.bossName || w.fightName || '').toLowerCase();
    const isHydross = /hydross/.test(bn);
    const isKael = /kael/.test(bn);
    const phases = w.phaseTransitions || [];
    const KAEL_ADVISOR_RX = /thaladred|sanguinar|capernian|telonicus/i;
    // Splitte HP-Kurve einer Add-Instance an Rez-Punkten (val<5 → val>80) in mehrere Lifespans
    function splitInstanceByRez(inst) {
      if (!inst.curve || inst.curve.length < 3) return [inst];
      const segments = [];
      let segStart = 0;
      let prev = inst.curve[0].val;
      for (let i = 1; i < inst.curve.length; i++) {
        const p = inst.curve[i];
        if (prev < 5 && p.val > 80) {
          // Rez gefunden: schließe vorheriges Segment ab, starte neues
          segments.push(inst.curve.slice(segStart, i));
          segStart = i;
        }
        prev = p.val;
      }
      segments.push(inst.curve.slice(segStart));
      if (segments.length < 2) return [inst];
      return segments.map((seg, idx) => {
        const start = seg[0]?.sec ?? inst.spawnSec;
        const end = seg[seg.length - 1]?.sec ?? start;
        const minHp = Math.min.apply(null, seg.map(p => p.val));
        return {
          ...inst,
          curve: seg,
          spawnSec: idx === 0 ? inst.spawnSec : start,
          lifetimeSec: Math.round(end - start),
          _segIndex: idx,
          _segTotal: segments.length,
          untouched: false, // gerezzte Advisors waren ja vorher tot, also nicht "nie angegriffen"
          _minHp: minHp,
        };
      });
    }
    const phaseLabelFor = (sec) => {
      if (!phases.length) return null;
      let cur = null;
      for (const p of phases) { if (p.atSec <= sec) cur = p; else break; }
      if (cur) return cur.label;
      // Vor dem ersten Phase-Marker = P1
      return isKael ? 'P1 (Solo Advisors)' : 'Start';
    };
    // Adds, die nicht tötbar sind (Umwelt-Hazards) — sollen nicht als "untouched/slacker" gewertet werden
    const UNKILLABLE_ADDS = /^(nether vapor|water spirit|elemental spirit|frost spirit)/i;
    const renderInst = (inst, baseName) => {
      const minHp = inst.curve && inst.curve.length ? Math.min.apply(null, inst.curve.map(p => p.val)) : null;
      let status;
      if (baseName && UNKILLABLE_ADDS.test(baseName)) {
        status = `<span class="add-environment">⚡ Umwelt-Add — nicht tötbar (Lifetime ${inst.lifetimeSec}s)</span>`;
      } else if (inst.cc) {
        const ccLabel = inst.ccAbility === 18647 || inst.ccAbility === 27559 ? 'gebanished' : 'CC angewendet';
        const ccBy = window._playerIdToName && window._playerIdToName[inst.ccBy] ? ` von <strong>${escapeHtml(window._playerIdToName[inst.ccBy])}</strong>` : '';
        const refreshNote = inst.cc > 1 ? ` (${inst.cc}× Refresh)` : '';
        status = `<span class="add-cc">🔒 ${ccLabel}${ccBy}${refreshNote}</span>`;
      } else if (inst.untouched) {
        status = `<span class="add-untouched">🆘 0 Hits — nie angegriffen</span>`;
      } else if (inst.barelyHit) {
        status = `<span class="add-barely">⚠ nur 1 AoE-Hit (min ${Math.round(minHp)}%) — kaum bekämpft</span>`;
      } else if (minHp != null && minHp < 5) {
        status = `🪦 nach <strong>${inst.lifetimeSec}s</strong>`;
      } else if (minHp != null) {
        status = `<span class="text-error">↻ überlebt (${inst.lifetimeSec}s, min ${Math.round(minHp)}%)</span>`;
      } else {
        status = '<span class="text-muted">?</span>';
      }
      return `<span class="ti-time">${fmtMmss(inst.spawnSec)}</span> ${status}`;
    };

    let html = '<div class="addtimeline-grid">';
    for (const [baseName, instancesRaw] of Object.entries(addCurves)) {
      // Bei Kael's Advisors: explodiere jede Instanz in Lifespans pro Rez
      let instances = instancesRaw;
      if (isKael && KAEL_ADVISOR_RX.test(baseName)) {
        instances = [];
        for (const inst of instancesRaw) instances.push(...splitInstanceByRez(inst));
      }
      const killed = instances.filter(i => i.curve && i.curve.length && Math.min.apply(null, i.curve.map(p => p.val)) < 5).length;
      const untouched = instances.filter(i => i.untouched).length;
      let header = `${escapeHtml(baseName)} <span class="text-muted">${killed}/${instances.length} getötet</span>`;
      if (untouched > 0) header += ` · <span class="text-error">${untouched} unangetastet</span>`;
      if (isHydross && /spawn of hydross/i.test(baseName)) {
        const waves = Math.ceil(instances.length / 4);
        header += ` <span class="text-muted">· ${waves}× Transition (4 pro Welle)</span>`;
      }
      html += `<div class="addtimeline-group"><strong>${header}</strong>`;
      // Bei Kael: gruppieren nach Phase (selbe Advisors spawnen in P2-Solo + P5-Allout)
      if (isKael && instances.length > 1 && phases.length) {
        const byPhase = new Map();
        for (const inst of instances) {
          const ph = phaseLabelFor(inst.spawnSec) || '— (vor P1)';
          if (!byPhase.has(ph)) byPhase.set(ph, []);
          byPhase.get(ph).push(inst);
        }
        for (const [ph, list] of byPhase.entries()) {
          html += `<div class="addtimeline-phase"><span class="addtimeline-phase-label">${escapeHtml(ph)}</span><ul>`;
          for (const inst of list) html += `<li>${renderInst(inst, baseName)}</li>`;
          html += '</ul></div>';
        }
      } else {
        html += '<ul>';
        for (const inst of instances) html += `<li>${renderInst(inst, baseName)}</li>`;
        html += '</ul>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // Details: DPS / HPS / CDs gesammelt in einem aufklappbaren Block
  function renderDetailsRanking(w) {
    const ex = w.extended || {};
    let html = '<details class="wipe-det"><summary>📊 DPS / HPS / Cooldowns</summary><div class="rank-cols">';
    const d = ex.dpsBreakdown;
    if (d && d.top5 && d.top5.length) {
      html += '<div class="rank-col"><strong>Top DPS</strong><ol>' +
        d.top5.map(p => `<li>${escapeHtml(p.name)} <span class="rank-val">${p.dps}</span></li>`).join('') + '</ol></div>';
    }
    if (d && d.topAddDPS) {
      const f = d.topAddDPS.filter(p => p.adds > 0);
      if (f.length) html += '<div class="rank-col"><strong>Top Add-DPS</strong><ol>' +
        f.slice(0, 5).map(p => `<li>${escapeHtml(p.name)} <span class="rank-val">${fmtNum(p.adds)}</span></li>`).join('') + '</ol></div>';
    }
    if (d && d.bottom5 && d.bottom5.length) {
      html += '<div class="rank-col"><strong>Bottom DDs</strong><ol>' +
        d.bottom5.map(p => `<li><span class="${classCssFromType(p.type)}">${escapeHtml(p.name)}</span> <span class="rank-val">${p.dps}</span></li>`).join('') + '</ol></div>';
    }
    if (ex.healingBreakdown && ex.healingBreakdown.length) {
      html += '<div class="rank-col"><strong>Healer</strong><ol>' +
        ex.healingBreakdown.slice(0, 5).map(h => `<li>${escapeHtml(h.name)} <span class="rank-val">${h.hps} hps, oh ${h.overhealPct}%</span></li>`).join('') + '</ol></div>';
    }
    if (ex.cdUsage && ex.cdUsage.used && Object.keys(ex.cdUsage.used).length) {
      const cds = Object.entries(ex.cdUsage.used).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<li>${escapeHtml(CD_LABELS[k] || k)} <span class="rank-val">×${v}</span></li>`).join('');
      html += `<div class="rank-col"><strong>CDs genutzt</strong><ol>${cds}</ol></div>`;
    }
    // DMG-Split + Avoidable + Cancelled-Casts als Footer
    let foot = '';
    if (d) {
      foot += `<div class="rank-foot"><div class="dmg-split-bar"><div class="dmg-bar-boss" style="width:${d.bossPct}%">${d.bossPct}% Boss · ${fmtNum(d.bossDmg)}</div>`;
      if (d.addsPct > 0) foot += `<div class="dmg-bar-adds" style="width:${d.addsPct}%">${d.addsPct}% Adds · ${fmtNum(d.addsDmg)}</div>`;
      foot += `</div></div>`;
    }
    if (w.avoidableHits > 0) {
      foot += `<div class="rank-foot text-muted">⚡ Avoidable-Hits: <strong>${w.avoidableHits}</strong> (${fmtNum(w.avoidableDamage)} dmg)</div>`;
    }
    if (ex.cancelledCasts && ex.cancelledCasts.topCancellers && ex.cancelledCasts.topCancellers[0] && ex.cancelledCasts.topCancellers[0].count > 5) {
      foot += `<div class="rank-foot text-muted">❌ Cast-Abbrüche: ` + ex.cancelledCasts.topCancellers.slice(0, 3).map(c => `${escapeHtml(c.name)} (${c.count}×)`).join(', ') + `</div>`;
    }
    html += '</div>' + foot + '</details>';
    return html;
  }

  function fmtNum(n) { return n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : n >= 1000 ? (n/1000).toFixed(0) + 'k' : String(n); }

  // ─── Elixier-Regeln Editor ───
  let _elixirPolicyState = null;     // { policy, observed }
  async function loadElixirPolicyEditor() {
    const host = $('#elixir-policy-editor');
    if (!host) return;
    try {
      const [polR, obsR] = await Promise.all([
        apiFetch('/api/admin/elixir-policy'),
        apiFetch('/api/admin/observed-elixirs'),
      ]);
      if (!polR.ok || !obsR.ok) { host.innerHTML = '<p class="text-muted">Fehler beim Laden.</p>'; return; }
      const pol = (await polR.json()).policy || {};
      const obs = await obsR.json();
      // Build global name->id lookup for backward-compat with old fightDetail strings
      window._elixirNameToId = {};
      for (const list of [obs.flasks, obs.battleElixirs, obs.guardianElixirs]) {
        for (const e of (list || [])) if (e.id != null) window._elixirNameToId[e.name] = e.id;
      }
      _elixirPolicyState = { policy: { ...pol }, observed: obs };
      renderElixirPolicyEditor();
    } catch (e) { host.innerHTML = '<p class="text-muted">Fehler: ' + escapeHtml(e.message) + '</p>'; }
    // Boss-Policy lädt parallel — gleiche Roles, eigene Save-Action
    loadBossPolicyEditor();
  }

  // ─── Boss-Sonderregeln Editor ───
  const KNOWN_BOSSES = [
    'Magtheridon', 'Gruul the Dragonkiller',
    'Hydross the Unstable', 'The Lurker Below', 'Leotheras the Blind',
    'Fathom-Lord Karathress', 'Morogrim Tidewalker', 'Lady Vashj',
    "Al'ar", 'Void Reaver', 'High Astromancer Solarian', "Kael'thas Sunstrider"
  ];
  function _bossPolicyState() { return window._bossPolicyRows || (window._bossPolicyRows = []); }
  async function loadBossPolicyEditor() {
    if (!$('#boss-policy-body')) return;
    try {
      const r = await apiFetch('/api/elixir-policy');
      const j = await r.json();
      const bp = j.bossPolicy || {};
      const rows = [];
      for (const boss of Object.keys(bp)) {
        for (const role of Object.keys(bp[boss] || {})) {
          const e = bp[boss][role] || {};
          rows.push({
            boss, role,
            flask: new Set(e.flaskAllowed || []),
            battle: new Set(e.battleAllowed || []),
            guardian: new Set(e.guardianAllowed || []),
          });
        }
      }
      window._bossPolicyRows = rows;
    } catch (_) { window._bossPolicyRows = []; }
    renderBossPolicyRows();
    const addBtn = $('#btn-boss-policy-add');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', () => {
        _bossPolicyState().push({ boss: KNOWN_BOSSES[0], role: 'Paladin:tank', flask: new Set(), battle: new Set(), guardian: new Set() });
        renderBossPolicyRows();
      });
    }
    const saveBtn = $('#btn-boss-policy-save');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', async () => {
        const status = $('#boss-policy-status');
        const out = {};
        for (const row of _bossPolicyState()) {
          if (!row.boss || !row.role) continue;
          const entry = {};
          if (row.flask.size) entry.flaskAllowed = [...row.flask];
          if (row.battle.size) entry.battleAllowed = [...row.battle];
          if (row.guardian.size) entry.guardianAllowed = [...row.guardian];
          if (!Object.keys(entry).length) continue;
          out[row.boss] = out[row.boss] || {};
          out[row.boss][row.role] = entry;
        }
        try {
          const resp = await apiFetch('/api/admin/boss-policy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bossPolicy: out }),
          });
          if (!resp.ok) { const j = await resp.json(); throw new Error(j.error || 'HTTP ' + resp.status); }
          window._bossPolicy = out;
          status.textContent = 'Gespeichert.';
        } catch (e) { status.textContent = 'Fehler: ' + e.message; }
      });
    }
  }
  function _bpCheckboxList(options, selected, cat, rowIdx) {
    if (!options || !options.length) return '<span class="text-muted" style="font-size:0.85em">—</span>';
    return `<div class="bp-checks">` + options.map(opt => {
      const checked = selected.has(opt.id) ? ' checked' : '';
      return `<label class="bp-check"><input type="checkbox"${checked} data-bp-cat="${cat}" data-bp-idx="${rowIdx}" data-bp-id="${opt.id}"> <span>${escapeHtml(opt.name)}</span></label>`;
    }).join('') + `</div>`;
  }
  function renderBossPolicyRows() {
    const tbody = $('#boss-policy-body');
    if (!tbody) return;
    const rows = _bossPolicyState();
    const roleOptions = Object.keys((_elixirPolicyState && _elixirPolicyState.policy) || {}).sort();
    if (!roleOptions.length) roleOptions.push('Paladin:tank');
    const obs = (_elixirPolicyState && _elixirPolicyState.observed) || {};
    const flasks = (obs.flasks || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const battles = (obs.battleElixirs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const guardians = (obs.guardianElixirs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Keine Sonderregeln definiert.</td></tr>'; return; }
    tbody.innerHTML = rows.map((row, i) => {
      const bossOpts = KNOWN_BOSSES.map(b => `<option value="${escapeHtml(b)}"${b === row.boss ? ' selected' : ''}>${escapeHtml(b)}</option>`).join('');
      const roleOpts = roleOptions.map(r => `<option value="${escapeHtml(r)}"${r === row.role ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
      return `<tr data-bp-row="${i}">
        <td><select class="penalty-input" data-bp-field="boss" data-bp-idx="${i}">${bossOpts}</select></td>
        <td><select class="penalty-input" data-bp-field="role" data-bp-idx="${i}">${roleOpts}</select></td>
        <td>${_bpCheckboxList(flasks, row.flask, 'flask', i)}</td>
        <td>${_bpCheckboxList(battles, row.battle, 'battle', i)}</td>
        <td>${_bpCheckboxList(guardians, row.guardian, 'guardian', i)}</td>
        <td><button class="penalty-btn penalty-btn--remove" data-bp-del="${i}">×</button></td>
      </tr>`;
    }).join('');
    // Boss/Role dropdowns
    tbody.querySelectorAll('select[data-bp-field]').forEach(el => {
      el.addEventListener('change', () => {
        const i = parseInt(el.getAttribute('data-bp-idx'), 10);
        const f = el.getAttribute('data-bp-field');
        if (rows[i]) rows[i][f] = el.value;
      });
    });
    tbody.querySelectorAll('input[type=checkbox][data-bp-cat]').forEach(cb => {
      const cat = cb.dataset.bpCat;
      const idx = parseInt(cb.dataset.bpIdx, 10);
      const id = parseInt(cb.dataset.bpId, 10);
      cb.addEventListener('change', () => {
        const row = rows[idx];
        if (!row) return;
        const set = row[cat];
        if (cb.checked) set.add(id); else set.delete(id);
      });
    });
    tbody.querySelectorAll('[data-bp-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-bp-del'), 10);
        rows.splice(i, 1);
        renderBossPolicyRows();
      });
    });
  }

  function renderElixirPolicyEditor() {
    const host = $('#elixir-policy-editor');
    if (!host || !_elixirPolicyState) return;
    const { policy, observed } = _elixirPolicyState;
    // Normalisieren + Duplikate entfernen — alte Cache-Daten haben „Druid:dps"
    // (= jetzt „Druid:feral") nebeneinander mit neuen Keys.
    const rolesRaw = observed.roles || [];
    const roles = [...new Set(rolesRaw.map(normalizeRoleKey))];
    if (!roles.length) { host.innerHTML = '<p class="text-muted">Noch keine Class:Spec-Daten beobachtet — erst nach einem analysierten Raid verfügbar.</p>'; return; }

    // Sort: by class then by spec priority (tank → healer → caster-dps → melee-dps)
    const specOrder = { tank: 1, healer: 2, balance: 3, elemental: 3, feral: 4, enhancement: 4, retribution: 4, dps: 5 };
    roles.sort((a, b) => {
      const [ca, sa] = a.split(':'); const [cb, sb] = b.split(':');
      if (ca !== cb) return ca.localeCompare(cb);
      return (specOrder[sa] || 9) - (specOrder[sb] || 9);
    });

    // Group roles by class for visual separation
    const grouped = new Map();
    for (const role of roles) {
      const [cls] = role.split(':');
      if (!grouped.has(cls)) grouped.set(cls, []);
      grouped.get(cls).push(role);
    }

    const SPEC_LABEL = { tank:'Tank', healer:'Heal', balance:'Balance', elemental:'Elemental', feral:'Feral', enhancement:'Enhancement', retribution:'Retribution', dps:'DPS' };
    const SPEC_CATEGORY = { tank:'tank', healer:'heal', balance:'caster', elemental:'caster', feral:'melee', enhancement:'melee', retribution:'melee', dps:'dps' };
    const CATEGORY_LABEL = { tank:'Tank', heal:'Heal', caster:'Caster-DPS', melee:'Melee-DPS', dps:'DPS' };

    // Lookup-Map: id → displayName (für Pill-Summary)
    function lookupName(id) {
      for (const list of [observed.flasks, observed.battleElixirs, observed.guardianElixirs]) {
        for (const it of (list || [])) if (it.id === id) return elixirDisplayName({ id: it.id, name: it.name });
      }
      return '#' + id;
    }

    let html = '<div class="elixir-policy-grid">';
    for (const [cls, clsRoles] of grouped) {
      const css = classCssFromType(cls);
      html += `<div class="elixir-class-section">`;
      html += `<div class="elixir-class-section__head ${css}">${escapeHtml(cls)}</div>`;
      html += `<div class="elixir-class-section__cards">`;
      for (const role of clsRoles) {
        const spec = role.split(':')[1] || '';
        const specLabel = SPEC_LABEL[spec] || spec;
        const cat = SPEC_CATEGORY[spec] || 'dps';
        const catLabel = CATEGORY_LABEL[cat];
        const p = policy[role] || { mode: 'any' };
        const modeBadge = p.mode === 'flask-only' ? 'Nur Flask'
                        : p.mode === 'whitelist' ? 'Whitelist'
                        : 'Any';
        // Pill-Summary für eingeklappte Sicht
        function pillsFor(field, label) {
          const ids = p[field] || [];
          if (!ids.length) return '';
          const names = ids.map(lookupName);
          return `<div class="elixir-pillrow"><span class="elixir-pillrow__label">${label}:</span>${names.map(n => `<span class="elixir-pill">${escapeHtml(n)}</span>`).join('')}</div>`;
        }
        const summaryHtml = p.mode === 'any'
          ? '<div class="elixir-card__summary text-muted">Any — jede Flask oder Battle+Guardian zählt.</div>'
          : `<div class="elixir-card__summary">${pillsFor('flaskAllowed','Flasks')}${pillsFor('battleAllowed','Battle')}${pillsFor('guardianAllowed','Guardian')}</div>`;
        html += `<div class="elixir-card${p.mode!=='any'?' elixir-card--active':''} is-collapsed" data-role="${escapeHtml(role)}">`;
        html += `<div class="elixir-card__head">`;
        html += `<div><div class="elixir-card__role ${css}">${escapeHtml(specLabel)}</div>`;
        html += `<div class="elixir-card__cat elixir-card__cat--${cat}">${catLabel}</div></div>`;
        html += `<div class="elixir-card__head-right"><span class="elixir-card__modebadge">${modeBadge}</span>`;
        html += `<button type="button" class="elixir-card__toggle" data-action="expand">Ändern</button></div>`;
        html += `</div>`;
        html += summaryHtml;
        // Edit-Bereich (initial hidden via is-collapsed)
        html += '<div class="elixir-card__edit">';
        html += '<div class="elixir-card__modes" role="radiogroup">';
        for (const [m, label] of [['any','Any'],['flask-only','Nur Flask'],['whitelist','Whitelist']]) {
          html += `<button type="button" class="elixir-mode-btn${p.mode===m?' is-active':''}" data-mode="${m}">${label}</button>`;
        }
        html += '</div>';
        html += `<div class="elixir-card__lists"${p.mode==='any'?' hidden':''}>`;
        for (const [label, items, field] of [
          ['Flasks', observed.flasks || [], 'flaskAllowed'],
          ['Battle-Elixiere', observed.battleElixirs || [], 'battleAllowed'],
          ['Guardian-Elixiere', observed.guardianElixirs || [], 'guardianAllowed'],
        ]) {
          const allow = new Set(p[field] || []);
          html += `<div class="elixir-list" data-field="${field}">`;
          html += `<div class="elixir-list__head"><strong>${label}</strong>`;
          html += `<button type="button" class="elixir-list__all">alle</button>`;
          html += `<button type="button" class="elixir-list__none">keine</button></div>`;
          html += `<div class="elixir-list__items">`;
          if (!items.length) html += '<span class="text-muted">—</span>';
          for (const it of items) {
            const isChk = it.id != null ? allow.has(it.id) : allow.has(it.name);
            const cnt = it.count > 99 ? '99+' : it.count;
            const idAttr = it.id != null ? `data-id="${it.id}"` : `data-name="${escapeHtml(it.name)}"`;
            const displayName = elixirDisplayName({ id: it.id, name: it.name });
            html += `<label class="elixir-chip${isChk?' is-checked':''}" title="${escapeHtml(displayName)}${it.id?' (Spell '+it.id+')':''} — ${it.count}x beobachtet">`;
            html += `<input type="checkbox" ${idAttr} ${isChk?'checked':''}>`;
            html += `<span class="elixir-chip__name">${escapeHtml(displayName)}</span>`;
            html += `<span class="elixir-chip__count">${cnt}</span></label>`;
          }
          html += '</div></div>';
        }
        html += '</div>'; // close lists
        html += '<div class="elixir-card__edit-foot"><button type="button" class="elixir-card__toggle" data-action="collapse">Fertig</button></div>';
        html += '</div>'; // close edit
        html += '</div>'; // close card
      }
      html += '</div></div>'; // close class-section__cards + class-section
    }
    html += '</div>';
    host.innerHTML = html;

    // Wire: collapse/expand toggle
    host.querySelectorAll('.elixir-card__toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.elixir-card');
        if (!card) return;
        if (btn.dataset.action === 'expand') card.classList.remove('is-collapsed');
        else card.classList.add('is-collapsed');
      });
    });

    // Wire interactions (mode-buttons + checkboxes)
    host.querySelectorAll('.elixir-card').forEach(card => {
      const modeBtns = card.querySelectorAll('.elixir-mode-btn');
      const lists = card.querySelector('.elixir-card__lists');
      const badge = card.querySelector('.elixir-card__modebadge');
      modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          modeBtns.forEach(b => b.classList.toggle('is-active', b === btn));
          const mode = btn.dataset.mode;
          if (lists) lists.hidden = (mode === 'any');
          card.classList.toggle('elixir-card--active', mode !== 'any');
          if (badge) badge.textContent = mode === 'flask-only' ? 'Nur Flask' : mode === 'whitelist' ? 'Whitelist' : 'Any';
        });
      });
      card.querySelectorAll('.elixir-chip input').forEach(cb => {
        cb.addEventListener('change', () => cb.closest('.elixir-chip').classList.toggle('is-checked', cb.checked));
      });
      card.querySelectorAll('.elixir-list__all').forEach(btn => btn.addEventListener('click', () => {
        btn.closest('.elixir-list').querySelectorAll('.elixir-chip input').forEach(cb => { cb.checked = true; cb.closest('.elixir-chip').classList.add('is-checked'); });
      }));
      card.querySelectorAll('.elixir-list__none').forEach(btn => btn.addEventListener('click', () => {
        btn.closest('.elixir-list').querySelectorAll('.elixir-chip input').forEach(cb => { cb.checked = false; cb.closest('.elixir-chip').classList.remove('is-checked'); });
      }));
    });
  }

  async function saveElixirPolicy() {
    const host = $('#elixir-policy-editor');
    if (!host) return;
    const policy = {};
    host.querySelectorAll('.elixir-card').forEach(card => {
      const role = card.dataset.role;
      const activeBtn = card.querySelector('.elixir-mode-btn.is-active');
      const mode = activeBtn ? activeBtn.dataset.mode : 'any';
      const entry = { mode };
      if (mode === 'whitelist' || mode === 'flask-only') {
        for (const field of ['flaskAllowed', 'battleAllowed', 'guardianAllowed']) {
          const list = card.querySelector(`.elixir-list[data-field="${field}"]`);
          if (!list) continue;
          const checked = [...list.querySelectorAll('.elixir-chip input:checked')].map(cb => {
            if (cb.dataset.id != null && cb.dataset.id !== '') return Number(cb.dataset.id);
            return cb.dataset.name; // legacy fallback: name string
          });
          if (checked.length) entry[field] = checked;
        }
      }
      if (mode !== 'any' || Object.keys(entry).length > 1) policy[role] = entry;
    });
    const statusEl = $('#elixir-policy-status');
    if (statusEl) statusEl.textContent = 'Speichern...';
    try {
      const resp = await apiFetch('/api/admin/elixir-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      });
      if (resp.ok) {
        window._elixirPolicy = policy;
        if (statusEl) statusEl.textContent = 'Gespeichert.';
      } else if (statusEl) statusEl.textContent = 'Fehler: HTTP ' + resp.status;
    } catch (e) { if (statusEl) statusEl.textContent = 'Fehler: ' + e.message; }
  }

  async function adminLogin() {
    const username = $('#admin-username').value.trim();
    const pw = $('#admin-password').value;
    const errEl = $('#admin-login-error');
    errEl.classList.add('hidden');

    try {
      const resp = await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pw })
      });
      if (!resp.ok) {
        errEl.classList.remove('hidden');
        return;
      }
      const data = await resp.json();
      if (data.csrf) window.__csrfToken = data.csrf;
      $('#admin-username').value = '';
      $('#admin-password').value = '';
      showAdminPanel(data.username, data.role);
    } catch (e) {
      errEl.textContent = 'Fehler: ' + e.message;
      errEl.classList.remove('hidden');
    }
  }

  async function adminRefreshAll() {
    modalConfirm('Alles neu laden', 'Alle Reports werden neu von WCL geholt und analysiert. Das kann mehrere Minuten dauern und verbraucht API-Budget.', () => {
      showModal('Sicher?', '<p>Wirklich <strong>alle Reports</strong> neu laden? Bitte nur im Notfall.</p>', [
        { label: 'Abbrechen' },
        { label: 'Ja, alles neu laden', danger: true, action: async () => {
          const btn = $('#btn-admin-refresh-all');
          if (btn) btn.disabled = true;
          try {
            const resp = await apiFetch('/api/admin/refresh-all', { method: 'POST' });
            if (resp.status === 401) { adminAuthenticated = false; return; }
            if (resp.ok) { setStatus('#admin-status', 'Guild-Refresh + Analyse gestartet...'); startPipelinePolling(); }
          } catch (e) { console.error(e); }
          if (btn) setTimeout(() => { btn.disabled = false; }, 5000);
        }},
      ]);
    });
  }

  async function loadAdminReports() {
    const container = $('#admin-reports-list');
    container.innerHTML = '<p class="text-muted">Lade Reports...</p>';

    try {
      const resp = await apiFetch('/api/admin/reports');
      if (resp.status === 401) {
        adminAuthenticated = false;
        $('#admin-login').classList.remove('hidden');
        $('#admin-reports').classList.add('hidden');
        return;
      }
      const data = await resp.json();
      let reports = data.reports || [];
      try {
        const sdResp = await apiFetch('/api/admin/start-date');
        if (sdResp.ok) {
          const sd = (await sdResp.json()).startDate;
          if (sd) {
            const cutoff = new Date(sd + 'T00:00:00').getTime();
            reports = reports.filter(r => r.start >= cutoff);
          }
        }
      } catch (e) {}

      if (!reports.length) { container.innerHTML = '<p class="text-muted">Keine Reports.</p>'; return; }

      let html = '';
      for (const r of reports) {
        const zone = CLA_DATA.zones[r.zone];
        const zoneName = zone ? zone.short || zone.name : '?';
        const zoneColor = zone ? zone.color : '#666';
        const dt = new Date(r.start);
        const date = dt.toLocaleDateString('de-DE');
        const day = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
        const time = dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

        const types = ['gear', 'buffs', 'consumables', 'spellranks'];
        const allDone = types.every(t => r.analysis[t]);
        const anyDone = types.some(t => r.analysis[t]);
        const doneCount = types.filter(t => r.analysis[t]).length;

        let statusHtml, statusCls;
        if (allDone) { statusHtml = 'KOMPLETT'; statusCls = 'ar-status--ok'; }
        else if (anyDone) { statusHtml = doneCount + '/4'; statusCls = 'ar-status--partial'; }
        else if (r.dataFetched) { statusHtml = 'DATEN DA'; statusCls = 'ar-status--pending'; }
        else { statusHtml = 'KEINE DATEN'; statusCls = 'ar-status--missing'; }

        if (r.reanalyzeStatus?.status === 'running') { statusHtml = 'ANALYSE...'; statusCls = 'ar-status--running'; }

        const wclUrl = `https://classic.warcraftlogs.com/reports/${r.id}`;
        const excludedCls = r.excluded ? ' ar-card--excluded' : '';

        html += `<div class="ar-card${excludedCls}" data-report-id="${r.id}">`;
        html += `<div class="ar-card__left" style="border-color:${zoneColor}">`;
        html += `<span class="ar-zone" style="color:${zoneColor}">${escapeHtml(zoneName)}</span>`;
        html += `<span class="ar-date">${date}</span>`;
        html += `<span class="ar-day">${day} ${time}</span>`;
        html += `</div>`;
        html += `<div class="ar-card__mid">`;
        html += `<a href="${wclUrl}" target="_blank" rel="noopener" class="ar-title">${escapeHtml(r.title || r.id)}</a>`;
        html += `<span class="ar-meta">Logger: <strong>${escapeHtml(r.owner || '?')}</strong> &middot; ${escapeHtml(r.id)}</span>`;
        html += `</div>`;
        html += `<div class="ar-card__right">`;
        html += `<span class="ar-status ${statusCls}">${statusHtml}</span>`;
        if (r.excluded) html += `<span class="ar-excluded-badge">AUSGESCHLOSSEN</span>`;
        html += `<div class="ar-actions">`;
        // Track-Selector: Auto / Aktuell / Altcontent
        const trackVal = r.trackOverride ? r.track : 'auto';
        const trackBadge = r.track === 'legacy' ? '🌙 Alt' : '🛡️ Aktuell';
        const trackTitle = r.trackOverride ? 'Manuell gesetzt' : 'Automatisch nach Wochentag';
        html += `<select class="btn btn-sm" data-code="${escapeHtml(r.id)}" data-action="track" title="${trackTitle}">`;
        html += `<option value="auto"${trackVal==='auto'?' selected':''}>Auto: ${trackBadge}</option>`;
        html += `<option value="current"${trackVal==='current'?' selected':''}>Aktuell</option>`;
        html += `<option value="legacy"${trackVal==='legacy'?' selected':''}>Altcontent</option>`;
        html += `</select>`;
        html += ` <button class="btn btn-sm ${r.excluded ? 'btn-include' : 'btn-exclude'}" data-code="${escapeHtml(r.id)}" data-action="toggle">${r.excluded ? 'Einschl.' : 'Ausschl.'}</button>`;
        html += ` <button class="btn btn-sm btn-secondary" data-code="${escapeHtml(r.id)}" data-action="reanalyze" title="Neu analysieren">&#x21BB;</button>`;
        html += `</div></div></div>`;
      }
      container.innerHTML = html;

      // Attach handlers
      container.querySelectorAll('button[data-action="toggle"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const code = btn.dataset.code;
          const doExclude = btn.classList.contains('btn-exclude');
          btn.disabled = true;
          try {
            const resp = await apiFetch('/api/admin/excluded', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reportCode: code, exclude: doExclude })
            });
            if (resp.ok) loadAdminReports();
          } catch (e) { console.error(e); }
          btn.disabled = false;
        });
      });

      container.querySelectorAll('select[data-action="track"]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const code = sel.dataset.code;
          const track = sel.value;
          sel.disabled = true;
          try {
            const resp = await apiFetch('/api/admin/report-track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reportCode: code, track })
            });
            if (resp.ok) loadAdminReports();
          } catch (e) { console.error(e); }
          sel.disabled = false;
        });
      });

      container.querySelectorAll('button[data-action="reanalyze"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const code = btn.dataset.code;
          const card = btn.closest('.ar-card');
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const resp = await apiFetch('/api/admin/reanalyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reportCode: code })
            });
            if (resp.ok) {
              // Show log panel below card
              let logPanel = card.querySelector('.ar-log');
              if (!logPanel) {
                logPanel = document.createElement('div');
                logPanel.className = 'ar-log';
                logPanel.innerHTML = '<div class="ar-log__header">ANALYSE-LOG</div><pre class="ar-log__content">Starte...</pre>';
                card.appendChild(logPanel);
              }
              pollReanalyzeLogs(code, logPanel.querySelector('.ar-log__content'), card);
            } else {
              const err = await resp.json();
              modalAlert('Fehler', err.error || 'Unbekannter Fehler');
            }
          } catch (e) { console.error(e); }
          btn.disabled = false;
          btn.innerHTML = '&#x21BB;';
        });
      });
    } catch (e) {
      container.innerHTML = `<p class="text-error">Fehler: ${escapeHtml(e.message)}</p>`;
    }
  }

  function pollReanalyzeLogs(code, logEl, card) {
    const interval = setInterval(async () => {
      try {
        const resp = await apiFetch(`/api/admin/reanalyze-log/${code}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const lines = (data.logs || []).map(l => {
          const t = new Date(l.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `[${t}] ${l.msg}`;
        });
        logEl.textContent = lines.join('\n') || 'Warte auf Ausgabe...';
        logEl.scrollTop = logEl.scrollHeight;

        // Update status badge
        const statusEl = card.querySelector('.ar-status');
        if (statusEl) {
          if (data.status === 'done') { statusEl.textContent = 'KOMPLETT'; statusEl.className = 'ar-status ar-status--ok'; }
          else if (data.status === 'error') { statusEl.textContent = 'FEHLER'; statusEl.className = 'ar-status ar-status--missing'; }
        }

        if (data.status !== 'running') {
          clearInterval(interval);
          logEl.parentElement.querySelector('.ar-log__header').textContent = data.status === 'done' ? 'ANALYSE ABGESCHLOSSEN' : 'ANALYSE FEHLGESCHLAGEN';
        }
      } catch (e) {}
    }, 2000);
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  }

  // ─── ADMIN: PENALTIES ───

  async function loadAdminPenalties() {
    const tbody = $('#admin-penalties-body');
    if (!tbody) return;
    // Load player names for autocomplete
    if (!window._acPlayerNames) {
      try {
        const resp = await apiFetch('/api/players');
        if (resp.ok) window._acPlayerNames = (await resp.json()).players || [];
      } catch (e) { /* ignore */ }
    }
    try {
      const resp = await apiFetch('/api/admin/penalties');
      if (!resp.ok) return;
      const data = await resp.json();
      const penalties = data.penalties || [];
      if (!penalties.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Keine Strafen eingetragen.</td></tr>';
        return;
      }
      tbody.innerHTML = penalties.map(p =>
        `<tr><td>${escapeHtml(p.player_name)}</td><td>${p.penalty_pct}%</td><td>${escapeHtml(p.reason || '—')}</td><td class="text-muted">${escapeHtml(p.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-penalty-remove="${escapeHtml(p.player_name)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-penalty-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/penalties', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName: btn.dataset.penaltyRemove, remove: true })
          });
          loadAdminPenalties();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function loadAdminExcused() {
    const tbody = $('#admin-excused-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/excused');
      if (!resp.ok) return;
      const data = await resp.json();
      const excused = data.excused || [];
      if (!excused.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine Eintraege.</td></tr>';
        return;
      }
      tbody.innerHTML = excused.map(e =>
        `<tr><td>${escapeHtml(e.raid_date)}</td><td>${escapeHtml(e.reason || '—')}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-excused-date="${escapeHtml(e.raid_date)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-excused-date]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/excused', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raidDate: btn.dataset.excusedDate, remove: true })
          });
          loadAdminExcused();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function loadAdminRevoked() {
    const tbody = $('#admin-revoked-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/penalties');
      if (!resp.ok) return;
      const data = await resp.json();
      const list = data.revoked || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Keine Eintraege.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(e =>
        `<tr><td>${escapeHtml(e.player_name)}</td><td>${escapeHtml(e.raid_date)}</td><td>${escapeHtml(e.reason || '—')}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-rv-name="${escapeHtml(e.player_name)}" data-rv-date="${escapeHtml(e.raid_date)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-rv-name]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/revoked', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName: btn.dataset.rvName, raidDate: btn.dataset.rvDate, remove: true })
          });
          loadAdminRevoked();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addRevoked() {
    const nameInput = $('#revoked-player');
    const dateInput = $('#revoked-date');
    const reasonInput = $('#revoked-reason');
    const name = nameInput.value.trim();
    const date = dateInput.value;
    if (!name || !date) return;
    try {
      await apiFetch('/api/admin/revoked', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, raidDate: date, reason: reasonInput.value.trim() })
      });
      nameInput.value = '';
      dateInput.value = '';
      reasonInput.value = '';
      loadAdminRevoked();
    } catch (e) { console.error(e); }
  }

  // ─── PLAYER DETAIL PAGE ───

  async function loadPlayerDetail(name) {
    const title = $('#player-detail-title');
    const content = $('#player-detail-content');
    title.innerHTML = `<span class="pd-name">${escapeHtml(name)}</span>`;
    content.innerHTML = '<p class="text-muted">Lade Spielerdaten...</p>';

    try {
      const resp = await apiFetch(`/api/player/${encodeURIComponent(name)}`);
      if (!resp.ok) { content.innerHTML = '<p class="text-error">Fehler beim Laden.</p>'; return; }
      const data = await resp.json();
      renderPlayerDetail(data, content, title);
    } catch (e) {
      content.innerHTML = `<p class="text-error">Fehler: ${escapeHtml(e.message)}</p>`;
    }
  }

  function renderPlayerDetail(data, container, titleEl) {
    const classCss = classCssFromType(data.class);
    titleEl.innerHTML = `<span class="pd-name ${classCss}">${escapeHtml(data.name)}</span><span class="pd-class ${classCss}">${escapeHtml(data.class)}</span>`;

    // Penalty/revoked badges
    let badges = '';
    if (data.penalty) badges += `<span class="penalty-badge">STRAFE: -${data.penalty.penalty_pct}%</span> `;
    if (data.revoked.length) badges += `<span class="penalty-badge">${data.revoked.length}x ABERKANNT</span> `;
    if (data.excused.length) badges += `<span class="excused-badge">${data.excused.length}x ENTSCHULDIGT</span> `;

    let html = badges ? `<div class="pd-badges">${badges}</div>` : '';

    // ── Attendance ──
    const attended = data.attendance.filter(a => a.present).length;
    const total = data.attendance.length;
    html += `<div class="pd-section"><div class="pd-section-title">Attendance <small class="text-muted">${attended}/${total} Raids</small></div>`;
    html += '<div class="pd-attend-grid">';
    for (const a of data.attendance) {
      const zone = CLA_DATA.zones[a.zone];
      const zoneShort = zone ? zone.short : '?';
      const zoneColor = zone ? zone.color : '#666';
      const revokedDate = data.revoked.find(r => r.raid_date === a.date);
      const excusedDate = data.excused.find(e => e.raid_date === a.date);
      let cls = a.present ? 'pd-att-present' : 'pd-att-absent';
      if (revokedDate) cls = 'pd-att-revoked';
      if (excusedDate) cls = 'pd-att-excused';
      const tip = `${a.date} — ${a.title || zoneShort}${revokedDate ? ' (ABERKANNT)' : ''}${excusedDate ? ' (ENTSCHULDIGT)' : ''}`;
      html += `<div class="pd-att-cell ${cls}" title="${escapeHtml(tip)}"><span class="pd-att-zone" style="color:${zoneColor}">${escapeHtml(zoneShort)}</span><span class="pd-att-date">${a.date.slice(5)}</span></div>`;
    }
    html += '</div></div>';

    // ── Buff Rates ──
    if (data.buffRates.length) {
      html += '<div class="pd-section"><div class="pd-section-title">Buff-Raten</div>';
      html += '<table class="pd-table"><thead><tr><th>Datum</th><th>Flask/Elixir</th><th>Food</th><th>Weapon</th></tr></thead><tbody>';
      for (const b of data.buffRates) {
        const fCls = b.flask >= 80 ? 'buff-ok' : b.flask >= 40 ? 'buff-partial' : 'buff-miss';
        const fdCls = b.food >= 80 ? 'buff-ok' : b.food >= 40 ? 'buff-partial' : 'buff-miss';
        const wCls = b.weapon >= 80 ? 'buff-ok' : b.weapon >= 40 ? 'buff-partial' : 'buff-miss';
        html += `<tr><td>${b.date}</td><td class="${fCls}">${b.flask}%</td><td class="${fdCls}">${b.food}%</td><td class="${wCls}">${b.weapon}%</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    // ── Performance ──
    if (data.performance.length) {
      html += '<div class="pd-section"><div class="pd-section-title">Performance</div>';
      html += '<table class="pd-table"><thead><tr><th>Datum</th><th>Boss</th><th>DPS</th><th>HPS</th></tr></thead><tbody>';
      for (const p of data.performance) {
        for (const f of p.fights) {
          html += `<tr><td>${p.date}</td><td>${escapeHtml(f.boss)}</td><td>${f.dps ? f.dps.toLocaleString('de-DE') : '—'}</td><td>${f.hps ? f.hps.toLocaleString('de-DE') : '—'}</td></tr>`;
        }
      }
      html += '</tbody></table></div>';
    }

    // ── Deaths ──
    if (data.deaths.length) {
      html += '<div class="pd-section"><div class="pd-section-title">Tode</div>';
      html += '<div class="pd-deaths">';
      for (const d of data.deaths) {
        html += `<div class="pd-death-entry"><span class="pd-death-date">${d.date}</span><span class="pd-death-count">${d.count}x</span></div>`;
      }
      html += '</div></div>';
    }

    // ── Gear Changes ──
    if (data.gearHistory.length) {
      html += '<div class="pd-section"><div class="pd-section-title">Gear-Aenderungen</div>';
      const SLOT_NAMES = { 0:'Kopf', 1:'Hals', 2:'Schulter', 4:'Brust', 5:'Taille', 6:'Beine', 7:'Fuesse', 8:'Handgelenke', 9:'Haende', 10:'Ring 1', 11:'Ring 2', 12:'Trinket 1', 13:'Trinket 2', 14:'Ruecken', 15:'Haupthand', 16:'Nebenhand', 17:'Distanz' };
      for (const g of data.gearHistory) {
        if (g.type === 'initial') continue; // Skip initial set
        if (!g.changes || !g.changes.length) continue;
        const wclLink = `https://classic.warcraftlogs.com/reports/${g.reportCode}#boss=-2&difficulty=0&type=summary`;
        html += `<div class="pd-gear-raid"><span class="pd-gear-date"><a href="${wclLink}" target="_blank" rel="noopener">${g.date} ↗</a></span>`;
        for (const c of g.changes) {
          const slot = SLOT_NAMES[c.slot] || `Slot ${c.slot}`;
          const oldName = c.oldItem ? c.oldItem.name : '—';
          const newName = c.newItem ? c.newItem.name : '—';
          if (c.enchantChange) {
            const ENCH_NAMES = {
              368:'12 Agility',369:'Bracers - 12 Intellect',664:'Stabilized Eternium Scope',684:'Gloves - 15 Strength',
              849:'2 Agility',851:'3 Spirit',866:'2 All Stats',911:'Minor Speed',
              1071:'6 Stamina',1144:'15 Spirit',1593:'Bracers - 12 AP',1594:'Gloves - 13 AP',
              1883:'3 Intellect',1885:'Bracers - 9 Strength',1886:'Bracers - 9 Stamina',
              1887:'7 Agility',1888:'5 All Resistances',1891:'4 All Stats',1900:'Crusader',
              2322:'Gloves - 5 Spell Power',2343:'Major Spellpower (40SP)',
              2504:'Major Spellpower (MH)',2505:'Major Healing (MH)',
              2523:'Stabilized Eternium Scope',2543:'Glyph (Haste)',2544:'Glyph (Spell)',
              2564:'15 Agility',2566:'Spellpower (Bracers)',
              2583:'Glyph of the Defender',2586:'Savage Armor Kit (Legs)',
              2589:'Glyph (Shadow/Stam)',2590:'Glyph (Int/Stam/Spirit)',2591:'Glyph (Int/Stam/Spell)',
              2604:'Scryer (Shoulder)',2605:'Scryer (Shoulder)',2606:'Aldor (Shoulder)',
              2613:'Gloves - 2% Threat',2614:'Gloves - Shadow Power',2617:'Spellpower (Bracers)',
              2621:'Subtlety (Cloak)',2622:'12 Dodge (Cloak)',
              2646:'25 Agility (MH)',2647:'Bracers - Brawn',2648:'Bracers - Fortitude',
              2649:'Bracers - Major Defense',2650:'Bracers - Spellpower',
              2654:'Shield - Intellect',2655:'Shield - Parry',2656:'Vitality (Boots)',
              2657:'Cat\'s Swiftness (Boots)',2659:'Chest - Major Health',2661:'Chest - 6 All Stats',
              2662:'Armor Kit',2667:'Greater Savagery (MH)',2669:'Major Spellpower (MH)',
              2670:'Greater Agility (MH)',2672:'Soulfrost (MH)',2673:'Mongoose',
              2721:'Greater Inscription (Scryer)',2722:'Adamantite Scope',
              2723:'Khorium Scope',2724:'Stabilized Eternium Scope',
              2745:'Silver Spellthread',2746:'Silver Spellthread',
              2747:'Mystic Spellthread',2748:'Runic Spellthread',
              2841:'Heavy Knothide Armor Kit',2928:'Ring - Spellpower',
              2929:'Ring - Striking',2930:'Ring - Stats',
              2934:'Blasting (Gloves)',2935:'Assault (Gloves)',2937:'Major Spellpower (Gloves)',
              2938:'Spell Penetration (Cloak)',2939:'Cat\'s Swiftness',2940:'Boar\'s Speed',
              2977:'Greater Inscription of Warding (Aldor)',2978:'Inscription of Warding (Aldor)',
              2979:'Greater Inscription of Faith (Aldor)',2980:'Inscription of Faith (Aldor)',
              2981:'Greater Inscription of Discipline (Aldor)',2982:'Inscription of Discipline (Aldor)',
              2983:'Greater Inscription of Vengeance (Aldor)',2986:'Inscription of Vengeance (Aldor)',
              2990:'Greater Inscription of the Knight (Scryer)',2991:'Inscription of the Knight (Scryer)',
              2992:'Greater Inscription of the Oracle (Scryer)',2994:'Greater Inscription of the Blade (Scryer)',
              2995:'Inscription of the Blade (Scryer)',2997:'Inscription of the Blade (Scryer)',
              2999:'Glyph of the Defender',3001:'Glyph of Renewal',3002:'Glyph of Power',
              3003:'Glyph of Ferocity',3010:'Cobrahide Leg Armor',3011:'Clefthide Leg Armor',
              3012:'Nethercobra Leg Armor',3013:'Nethercleft Leg Armor',
              3096:'Glyph of the Outcast',3150:'Restore Mana Prime',3229:'Lesser Ward (Shield)',3260:'Major Stamina (Gloves)',
              2503:'3 Defense Armor Kit',2792:'Knothide Armor Kit',
            };
            const fmtEnch = (item) => {
              if (!item?.permanentEnchant) return 'keins';
              return ENCH_NAMES[item.permanentEnchant] || item.permanentEnchantName || '#' + item.permanentEnchant;
            };
            html += `<div class="pd-gear-change"><span class="pd-gear-slot">${escapeHtml(slot)}</span>`;
            html += `<span class="text-muted">Enchant auf ${escapeHtml(c.newItem?.name || '')}:</span> <span class="text-muted">${escapeHtml(fmtEnch(c.oldItem))}</span> → <span class="buff-ok">${escapeHtml(fmtEnch(c.newItem))}</span></div>`;
          } else if (c.gemChange) {
            const oldGems = (c.oldItem?.gems || []).map(g => g.icon ? g.id : '?').join(', ') || 'keine';
            const newGems = (c.newItem?.gems || []).map(g => g.icon ? g.id : '?').join(', ') || 'keine';
            html += `<div class="pd-gear-change"><span class="pd-gear-slot">${escapeHtml(slot)}</span>`;
            html += `<span class="text-muted">Gems geaendert</span> (${escapeHtml(c.newItem?.name || '')})</div>`;
          } else {
            const oldLink = c.oldItem?.id ? `<a href="https://www.wowhead.com/tbc/item=${c.oldItem.id}" data-wowhead="item=${c.oldItem.id}">${escapeHtml(oldName)}</a>` : '—';
            const newLink = c.newItem?.id ? `<a href="https://www.wowhead.com/tbc/item=${c.newItem.id}" data-wowhead="item=${c.newItem.id}">${escapeHtml(newName)}</a>` : '—';
            html += `<div class="pd-gear-change"><span class="pd-gear-slot">${escapeHtml(slot)}</span>${oldLink} → ${newLink}</div>`;
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // ── Loot ──
    if (data.loot.length) {
      html += '<div class="pd-section"><div class="pd-section-title">Loot (TMB)</div>';
      html += '<table class="pd-table"><thead><tr><th>Item</th><th>Quelle</th><th>Datum</th></tr></thead><tbody>';
      for (const l of data.loot) {
        const itemLink = l.itemId ? `<a href="https://www.wowhead.com/tbc/item=${l.itemId}" data-wowhead="item=${l.itemId}">${escapeHtml(l.itemName || 'Item')}</a>` : escapeHtml(l.itemName || '?');
        html += `<tr><td>${itemLink}</td><td>${escapeHtml(l.source || '—')}</td><td>${escapeHtml(l.receivedAt || '—')}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
    try { window.$WowheadPower?.refreshLinks(); } catch (e) {}
  }

  // ─── ADMIN: ACTIONS TAB ───

  function wireActionButtons() {
    async function tmbLoad(endpoint, label, statusEl) {
      statusEl.textContent = label + ' wird geladen...';
      try {
        const resp = await apiFetch(endpoint + '?refresh=1');
        if (resp.ok) statusEl.textContent = label + ' geladen.';
        else statusEl.textContent = label + ' Fehler: ' + resp.status;
      } catch (e) { statusEl.textContent = 'Fehler: ' + e.message; }
      loadDataStatus();
    }

    const tmbStatus = $('#tmb-status');
    $('#btn-tmb-attendance')?.addEventListener('click', () => tmbLoad('/api/tmb/attendance', 'Attendance', tmbStatus));
    $('#btn-tmb-loot')?.addEventListener('click', () => tmbLoad('/api/tmb/loot', 'Loot', tmbStatus));
    $('#btn-tmb-raidgroups')?.addEventListener('click', () => tmbLoad('/api/tmb/raidgroups', 'Raidgroups', tmbStatus));
    $('#btn-tmb-all')?.addEventListener('click', async () => {
      tmbStatus.textContent = 'Lade alles...';
      for (const [ep, label] of [['/api/tmb/attendance','Attendance'],['/api/tmb/loot','Loot'],['/api/tmb/raidgroups','Raidgroups']]) {
        tmbStatus.textContent = label + ' wird geladen...';
        try { await apiFetch(ep + '?refresh=1'); } catch (e) {}
      }
      tmbStatus.textContent = 'Alles geladen.';
      loadDataStatus();
    });

    $('#btn-action-refresh-all')?.addEventListener('click', () => { adminRefreshAll(); startPipelinePolling(); });

    // Manueller Live-Ticker
    async function refreshLiveManualStatus() {
      try {
        const resp = await apiFetch('/api/admin/live/status');
        if (!resp.ok) return;
        const d = await resp.json();
        const startBtn = $('#btn-live-start'), stopBtn = $('#btn-live-stop'), statusEl = $('#live-manual-status');
        if (d.active && d.manualUntil) {
          if (startBtn) startBtn.style.display = 'none';
          if (stopBtn) stopBtn.style.display = '';
          const remaining = Math.max(0, Math.round((d.manualUntil - Date.now()) / 60000));
          if (statusEl) statusEl.textContent = `Aktiv — endet in ca. ${remaining} min (verlängert sich automatisch bei Log-Aktivität).`;
        } else {
          if (startBtn) startBtn.style.display = '';
          if (stopBtn) stopBtn.style.display = 'none';
          if (statusEl) statusEl.textContent = '';
        }
      } catch (e) {}
    }
    $('#btn-live-start')?.addEventListener('click', async () => {
      try {
        const resp = await apiFetch('/api/admin/live/start', { method: 'POST' });
        if (resp.ok) refreshLiveManualStatus();
      } catch (e) { console.error(e); }
    });
    $('#btn-live-stop')?.addEventListener('click', async () => {
      try {
        const resp = await apiFetch('/api/admin/live/stop', { method: 'POST' });
        if (resp.ok) refreshLiveManualStatus();
      } catch (e) { console.error(e); }
    });
    if (adminAuthenticated) refreshLiveManualStatus();
    setInterval(() => { if (adminAuthenticated) refreshLiveManualStatus(); }, 30 * 1000);

    $('#btn-elixir-policy-save')?.addEventListener('click', saveElixirPolicy);

    $('#btn-rebuild-progression')?.addEventListener('click', async () => {
      const el = $('#progression-rebuild-status');
      const btn = $('#btn-rebuild-progression');
      el.textContent = 'Spieler-Entwicklung wird neu gebaut...';
      if (btn) btn.disabled = true;
      try {
        const resp = await apiFetch('/api/admin/progression/rebuild', { method: 'POST' });
        if (resp.ok) {
          const d = await resp.json();
          el.textContent = 'Fertig — neu berechnet ' + new Date(d.computedAt).toLocaleTimeString('de-DE');
          loadDataStatus();
        } else {
          el.textContent = 'Fehler: HTTP ' + resp.status;
        }
      } catch (e) { el.textContent = 'Fehler: ' + e.message; }
      if (btn) btn.disabled = false;
    });

    $('#btn-clear-cache')?.addEventListener('click', () => {
      modalConfirm('WCL Cache loeschen', 'Alle gecachten API-Antworten werden geloescht. Danach werden Daten frisch von WCL geholt.', async () => {
        const el = $('#cache-status');
        el.textContent = 'Wird geloescht...';
        try {
          const resp = await apiFetch('/api/admin/clear-cache', { method: 'POST' });
          if (resp.ok) { const d = await resp.json(); el.textContent = d.deleted + ' Cache-Eintraege geloescht.'; loadSysinfo(); }
          else el.textContent = 'Fehler';
        } catch (e) { el.textContent = 'Fehler: ' + e.message; }
      });
    });
  }

  async function loadSysinfo() {
    const tbody = $('#admin-sysinfo-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/sysinfo');
      if (!resp.ok) return;
      const d = await resp.json();
      const oldest = d.oldestCache ? new Date(d.oldestCache).toLocaleDateString('de-DE') : '—';
      tbody.innerHTML = `
        <tr><td>API-Cache Eintraege</td><td>${d.cacheEntries}</td></tr>
        <tr><td>Aeltester Cache</td><td>${oldest}</td></tr>
        <tr><td>Analysierte Reports</td><td>${d.reportCount}</td></tr>
        <tr><td>Analyse-Ergebnisse</td><td>${d.analysisCount}</td></tr>
        <tr><td>Aktive Strafen</td><td>${d.penaltyCount}</td></tr>
      `;
    } catch (e) { console.error(e); }
  }

  function formatRelativeTime(ms) {
    if (ms == null) return '—';
    const abs = Math.abs(ms);
    const sec = Math.round(abs / 1000);
    if (sec < 60) return `${ms < 0 ? 'in ' : 'vor '}${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${ms < 0 ? 'in ' : 'vor '}${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${ms < 0 ? 'in ' : 'vor '}${h} h ${m} min`;
  }

  async function loadDataStatus() {
    const tbody = $('#data-status-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/data-status');
      if (!resp.ok) return;
      const d = await resp.json();
      const now = Date.now();
      const rows = [];
      for (const e of d.tmb) {
        const age = e.fetchedAt ? formatRelativeTime(now - e.fetchedAt) : '—';
        const next = d.tmbNextAutoRefreshAt ? formatRelativeTime(now - d.tmbNextAutoRefreshAt) : '—';
        rows.push(`<tr><td>${e.label}</td><td>${age}</td><td>${next}</td></tr>`);
      }
      const progAge = d.progression.computedAt ? formatRelativeTime(now - d.progression.computedAt) : '—';
      rows.push(`<tr><td>Spieler-Entwicklung (Cache)</td><td>${progAge}</td><td><span class="text-muted">on demand</span></td></tr>`);
      tbody.innerHTML = rows.join('');
    } catch (e) { console.error(e); }
  }

  const PIPELINE_STEP_LABELS = {
    'init': 'Initialisierung',
    'fetch-fights': 'Boss-Fights laden',
    'fetch-players': 'Spieler-Liste laden',
    'gear': 'Gear-Analyse',
    'buffs': 'Buff-Analyse',
    'consumables': 'Consumables-Analyse',
    'spellranks': 'Spell-Ranks-Analyse',
    'deaths': 'Deaths-Analyse',
    'dmgheal': 'Damage/Heal-Analyse',
    'damagetaken': 'Damage-Taken-Analyse',
    'drums': 'Drums-Analyse',
    'avoidable': 'Avoidable-Damage-Analyse',
  };

  let pipelinePollTimer = null;
  async function loadPipelineStatus() {
    const el = $('#pipeline-status');
    if (!el) return;
    try {
      const resp = await apiFetch('/api/admin/pipeline-status');
      if (!resp.ok) return;
      const s = await resp.json();
      if (s.phase === 'idle') {
        const ago = s.lastCompletedAt ? formatRelativeTime(Date.now() - s.lastCompletedAt) : '—';
        el.innerHTML = `<span class="text-muted">Inaktiv${s.lastCompletedAt ? ` &middot; letzter Lauf ${ago}` : ''}${s.error ? ` &middot; <span class="text-error">Fehler: ${escapeHtml(s.error)}</span>` : ''}</span>`;
        if (pipelinePollTimer) { clearInterval(pipelinePollTimer); pipelinePollTimer = null; }
      } else if (s.phase === 'fetch-reports') {
        el.innerHTML = `<strong>Hole Guild-Reports von WCL...</strong>`;
      } else if (s.phase === 'analyzing') {
        const stepLabel = PIPELINE_STEP_LABELS[s.currentStep] || s.currentStep || '...';
        const reportLabel = s.currentReport ? `${escapeHtml(s.currentReport.title || s.currentReport.code)}` : '';
        const progress = `${s.done + 1}/${s.total}`;
        el.innerHTML = `<strong>Report ${progress}:</strong> ${reportLabel} &mdash; <span class="text-muted">${stepLabel}</span>`;
      }
    } catch (e) { /* swallow */ }
  }
  function startPipelinePolling() {
    if (pipelinePollTimer) return;
    loadPipelineStatus();
    pipelinePollTimer = setInterval(loadPipelineStatus, 2000);
  }

  async function loadStartDate() {
    if (!adminAuthenticated) return;
    try {
      const resp = await apiFetch('/api/admin/start-date');
      if (!resp.ok) return;
      const data = await resp.json();
      const input = $('#setting-start-date');
      if (input && data.startDate) input.value = data.startDate;
    } catch (e) {}
  }

  async function saveStartDate() {
    const input = $('#setting-start-date');
    const status = $('#start-date-status');
    const date = input.value;
    if (!date) { status.textContent = 'Bitte Datum waehlen.'; return; }

    // First confirm
    modalConfirm('Startdatum setzen', `Reports vor dem ${date} werden ignoriert. Alte Daten werden aus der DB geloescht.`, () => {
      // Second confirm with text input
      showModal('Endgueltig bestaetigen', '<p>Alle Reports und Analysen <strong>vor dem ' + date + '</strong> werden unwiderruflich geloescht.</p><p>Bitte tippe <strong>JA ICH WILL</strong> ein:</p><input type="text" class="penalty-input" id="modal-confirm-text" placeholder="JA ICH WILL">', [
        { label: 'Abbrechen' },
        { label: 'Loeschen und setzen', danger: true, action: async () => {
          const typed = ($('#modal-confirm-text')?.value || '').trim();
          if (typed !== 'JA ICH WILL') { modalAlert('Abgebrochen', 'Bestaetigungstext stimmt nicht.'); return; }
          status.textContent = 'Wird gesetzt und bereinigt...';
          try {
            const resp = await apiFetch('/api/admin/start-date', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: date, purge: true }) });
            if (resp.ok) {
              const d = await resp.json();
              status.textContent = 'Startdatum gesetzt.' + (d.purged ? ' ' + d.purged + ' alte Eintraege geloescht.' : '');
              loadSysinfo();
            } else { status.textContent = 'Fehler.'; }
          } catch (e) { status.textContent = 'Fehler: ' + e.message; }
        }},
      ]);
    });
  }

  // ─── CUSTOM MODAL ───

  function showModal(title, bodyHtml, buttons) {
    const overlay = $('#cla-modal-overlay');
    $('#cla-modal-title').textContent = title;
    $('#cla-modal-body').innerHTML = bodyHtml;
    $('#cla-modal-actions').innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.primary ? 'btn btn-primary btn-sm' : 'btn btn-sm';
      if (b.danger) btn.style.cssText = 'border-color: var(--error); color: var(--error);';
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        if (b.action) b.action();
      });
      $('#cla-modal-actions').appendChild(btn);
    }
    overlay.classList.remove('hidden');
    // Focus first input if any
    const inp = $('#cla-modal-body input');
    if (inp) setTimeout(() => inp.focus(), 50);
    // Enter key on input triggers primary button
    if (inp) inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const primary = $('#cla-modal-actions .btn-primary');
        if (primary) primary.click();
      }
    });
  }

  function modalConfirm(title, message, onConfirm) {
    showModal(title, `<p>${message}</p>`, [
      { label: 'Abbrechen' },
      { label: 'Bestaetigen', danger: true, action: onConfirm },
    ]);
  }

  function modalPrompt(title, message, placeholder, onSubmit) {
    showModal(title, `<p>${message}</p><input type="password" class="penalty-input" placeholder="${escapeHtml(placeholder)}" id="modal-prompt-input"><div class="modal-hint">Mindestens 6 Zeichen</div>`, [
      { label: 'Abbrechen' },
      { label: 'Speichern', primary: true, action: () => {
        const val = $('#modal-prompt-input')?.value || '';
        if (val.length >= 6) onSubmit(val);
      }},
    ]);
  }

  function modalAlert(title, message) {
    showModal(title, `<p>${message}</p>`, [
      { label: 'OK', primary: true },
    ]);
  }

  // ─── ADMIN: CHANGELOG ───

  async function loadAdminChangelog() {
    const tbody = $('#admin-changelog-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/changelog');
      if (!resp.ok) return;
      const data = await resp.json();
      const entries = data.entries || [];
      if (!entries.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Noch keine Eintraege.</td></tr>'; return; }
      const actionLabels = {
        penalty_set: 'Strafe gesetzt', penalty_removed: 'Strafe entfernt',
        revoked_added: 'Raid aberkannt', revoked_removed: 'Aberkennung entfernt',
        excused_player_added: 'Abwesenheit eingetragen', excused_player_removed: 'Abwesenheit entfernt',
        raid_excluded: 'Raid ausgeschlossen', raid_unexcluded: 'Raid-Ausschluss entfernt',
        player_excluded: 'Spieler ausgeschlossen', player_unexcluded: 'Spieler eingeschlossen',
        joindate_set: 'Einstieg festgelegt', joindate_removed: 'Einstieg entfernt',
        report_excluded: 'Report ausgeblendet', report_included: 'Report eingeblendet',
        report_reanalyze: 'Report neu analysiert', refresh_all: 'Alles neu geladen',
        user_created: 'Benutzer erstellt', user_deleted: 'Benutzer geloescht',
        role_changed: 'Rolle geaendert', password_reset: 'Passwort zurueckgesetzt',
        password_changed: 'Passwort geaendert',
        bug_create: 'Bug gemeldet', bug_status: 'Bug-Status geaendert', bug_delete: 'Bug geloescht',
      };
      tbody.innerHTML = entries.map(e => {
        const dt = new Date(e.created_at);
        const ts = dt.toLocaleDateString('de-DE') + ' ' + dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const label = actionLabels[e.action] || e.action;
        return `<tr><td style="white-space:nowrap">${ts}</td><td>${escapeHtml(e.username)}</td><td>${escapeHtml(label)}</td><td class="text-muted">${escapeHtml(e.details || '')}</td></tr>`;
      }).join('');
    } catch (e) { console.error(e); }
  }

  // ─── ADMIN: USER MANAGEMENT ───

  async function loadAdminUsers() {
    const tbody = $('#admin-users-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/users');
      if (!resp.ok) return;
      const data = await resp.json();
      const users = data.users || [];
      tbody.innerHTML = users.map(u => {
        const created = new Date(u.created_at).toLocaleDateString('de-DE');
        const isProtected = u.username === 'admin';
        const roleLabel = u.role === 'superadmin' ? '<span class="role-super">Superadmin</span>' : '<span class="role-admin">Admin</span>';
        let actions = '';
        if (!isProtected) {
          actions += `<button class="btn btn-sm" data-user-role="${escapeHtml(u.username)}" data-cur-role="${u.role}">Rolle</button> `;
          actions += `<button class="btn btn-sm btn-danger" data-user-del="${escapeHtml(u.username)}">Loeschen</button> `;
          actions += `<button class="btn btn-sm" data-user-resetpw="${escapeHtml(u.username)}">PW Reset</button>`;
        }
        return `<tr><td>${escapeHtml(u.username)}</td><td>${roleLabel}</td><td>${created}</td><td>${actions}</td></tr>`;
      }).join('');
      // Wire buttons
      tbody.querySelectorAll('[data-user-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.userDel;
          modalConfirm('Benutzer loeschen', `"${name}" wirklich loeschen? Diese Aktion kann nicht rueckgaengig gemacht werden.`, async () => {
            await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, remove: true }) });
            loadAdminUsers();
          });
        });
      });
      tbody.querySelectorAll('[data-user-role]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.userRole;
          const newRole = btn.dataset.curRole === 'superadmin' ? 'admin' : 'superadmin';
          modalConfirm('Rolle aendern', `Rolle von "${name}" auf <strong>${newRole}</strong> aendern?`, async () => {
            await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, changeRole: true, role: newRole }) });
            loadAdminUsers();
          });
        });
      });
      tbody.querySelectorAll('[data-user-resetpw]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.userResetpw;
          modalPrompt('Passwort zuruecksetzen', `Neues Passwort fuer "${name}":`, 'Neues Passwort', async (newPw) => {
            await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, resetPassword: true, newPassword: newPw }) });
            modalAlert('Erledigt', 'Passwort wurde zurueckgesetzt.');
          });
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addAdminUser() {
    const username = $('#new-admin-username').value.trim();
    const password = $('#new-admin-password').value;
    const role = $('#new-admin-role').value;
    if (!username || password.length < 6) { modalAlert('Fehler', 'Benutzername und Passwort (min. 6 Zeichen) erforderlich.'); return; }
    try {
      const resp = await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) });
      if (resp.ok) { $('#new-admin-username').value = ''; $('#new-admin-password').value = ''; loadAdminUsers(); }
      else { const d = await resp.json(); modalAlert('Fehler', d.error || 'Unbekannter Fehler'); }
    } catch (e) { modalAlert('Fehler', e.message); }
  }

  // ─── ADMIN: EXCLUDED PLAYERS & JOIN DATES ───

  async function loadAdminExcludedPlayers() {
    const tbody = $('#admin-excluded-players-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/penalties');
      if (!resp.ok) return;
      const data = await resp.json();
      const list = data.excludedPlayers || [];
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine ausgeschlossenen Spieler.</td></tr>'; return; }
      tbody.innerHTML = list.map(e =>
        `<tr><td>${escapeHtml(e.player_name)}</td><td>${escapeHtml(e.reason || '—')}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-expl-remove="${escapeHtml(e.player_name)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-expl-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/excluded-players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: btn.dataset.explRemove, remove: true }) });
          loadAdminExcludedPlayers();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addExcludedPlayer() {
    const nameInput = $('#excluded-player-name');
    const reasonInput = $('#excluded-player-reason');
    const name = nameInput.value.trim();
    if (!name) return;
    await apiFetch('/api/admin/excluded-players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: name, reason: reasonInput.value.trim() }) });
    nameInput.value = ''; reasonInput.value = '';
    loadAdminExcludedPlayers();
  }

  async function loadAdminJoinDates() {
    const tbody = $('#admin-joindate-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/penalties');
      if (!resp.ok) return;
      const data = await resp.json();
      const list = data.joinDates || [];
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine Einstiegszeitpunkte festgelegt.</td></tr>'; return; }
      tbody.innerHTML = list.map(e =>
        `<tr><td>${escapeHtml(e.player_name)}</td><td>${escapeHtml(e.join_date)}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-jd-remove="${escapeHtml(e.player_name)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-jd-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/join-dates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: btn.dataset.jdRemove, remove: true }) });
          loadAdminJoinDates();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addJoinDate() {
    const nameInput = $('#joindate-player');
    const raidInput = $('#joindate-raid');
    const name = nameInput.value.trim();
    const date = raidInput.value;
    if (!name || !date) return;
    await apiFetch('/api/admin/join-dates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: name, joinDate: date }) });
    nameInput.value = ''; raidInput.value = '';
    loadAdminJoinDates();
  }

  // ─── ADMIN: PLAYER ROLES ───

  async function loadAdminPlayerRoles() {
    const tbody = $('#admin-playerroles-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/penalties');
      if (!resp.ok) return;
      const data = await resp.json();
      const list = data.playerRoles || [];
      window._playerRoleOverrides = {};
      for (const r of list) window._playerRoleOverrides[r.player_name] = r.role;
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Keine Rollen-Overrides.</td></tr>'; return; }
      const roleLabel = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };
      tbody.innerHTML = list.map(e =>
        `<tr><td>${escapeHtml(e.player_name)}</td><td>${roleLabel[e.role] || e.role}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-role-remove="${escapeHtml(e.player_name)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-role-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/player-roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: btn.dataset.roleRemove, remove: true }) });
          loadAdminPlayerRoles();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addPlayerRole() {
    const nameInput = $('#playerrole-name');
    const roleInput = $('#playerrole-role');
    const name = nameInput.value.trim();
    const role = roleInput.value;
    if (!name || !role) return;
    await apiFetch('/api/admin/player-roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: name, role }) });
    nameInput.value = '';
    loadAdminPlayerRoles();
  }

  // Player-raids data for dynamic dropdowns
  let _playerRaidsData = null;
  async function getPlayerRaids() {
    if (_playerRaidsData) return _playerRaidsData;
    try {
      const resp = await apiFetch('/api/player-raids');
      if (resp.ok) _playerRaidsData = (await resp.json()).playerRaids || {};
    } catch (e) {}
    return _playerRaidsData || {};
  }

  function updateRevokedDropdown(selectedName) {
    const nameInput = $('#revoked-player');
    const dateSelect = $('#revoked-date');
    if (!dateSelect || !_playerRaidsData) return;
    const name = selectedName || (nameInput ? nameInput.value.trim() : '');
    const raids = _playerRaidsData[name] || [];
    if (!raids.length) {
      dateSelect.innerHTML = '<option value="">Erst Spieler waehlen...</option>';
      return;
    }
    // Filter out globally excluded raids
    const excludedDates = new Set((window._raidDates || []).filter(d => d.excluded).map(d => d.date));
    const filtered = raids.filter(r => !excludedDates.has(r.date));
    const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
    dateSelect.innerHTML = '<option value="">Raid waehlen...</option>' +
      sorted.map(r => {
        const dt = new Date(r.date + 'T12:00:00');
        const day = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
        return `<option value="${r.date}">${r.date} (${day}) — ${escapeHtml(r.title)}</option>`;
      }).join('');
  }

  async function loadRaidDateDropdowns() {
    await getPlayerRaids();

    const selects = [...$$('.raid-date-select')];
    if (!selects.length || selects[0].options.length > 1) return;
    try {
      const resp = await apiFetch('/api/raid-dates');
      if (!resp.ok) return;
      const data = await resp.json();
      window._raidDates = data.dates || [];
      function raidOpts(dates) {
        return dates.map(d => {
          const dt = new Date(d.date + 'T12:00:00');
          const day = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
          return `<option value="${d.date}">${escapeHtml(d.date + ' (' + day + ') — ' + d.title)}</option>`;
        }).join('');
      }
      const activeOpts = raidOpts(window._raidDates.filter(d => !d.excluded));
      const allOpts = raidOpts(window._raidDates);
      for (const sel of selects) {
        sel.innerHTML = '<option value="">Raid waehlen...</option>' + activeOpts;
      }
      for (const sel of $$('.raid-date-select-all')) {
        sel.innerHTML = '<option value="">Raid waehlen...</option>' + allOpts;
      }
    } catch (e) { /* ignore */ }
  }

  async function loadAdminExcusedPlayers() {
    const tbody = $('#admin-excused-player-body');
    if (!tbody) return;
    try {
      const resp = await apiFetch('/api/admin/excused-player');
      if (!resp.ok) return;
      const data = await resp.json();
      const list = data.excusedPlayers || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Keine Eintraege.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(e =>
        `<tr><td>${escapeHtml(e.player_name)}</td><td>${escapeHtml(e.raid_date)}</td><td>${escapeHtml(e.reason || '—')}</td><td class="text-muted">${escapeHtml(e.created_by || '—')}</td>` +
        `<td><button class="btn btn-sm btn-danger" data-ep-name="${escapeHtml(e.player_name)}" data-ep-date="${escapeHtml(e.raid_date)}">Entfernen</button></td></tr>`
      ).join('');
      tbody.querySelectorAll('[data-ep-name]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await apiFetch('/api/admin/excused-player', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName: btn.dataset.epName, raidDate: btn.dataset.epDate, remove: true })
          });
          loadAdminExcusedPlayers();
        });
      });
    } catch (e) { console.error(e); }
  }

  async function addExcusedPlayer() {
    const nameInput = $('#excused-player-name');
    const dateInput = $('#excused-player-date');
    const reasonInput = $('#excused-player-reason');
    const name = nameInput.value.trim();
    const date = dateInput.value;
    if (!name || !date) return;
    try {
      await apiFetch('/api/admin/excused-player', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, raidDate: date, reason: reasonInput.value.trim() })
      });
      nameInput.value = '';
      dateInput.value = '';
      reasonInput.value = '';
      loadAdminExcusedPlayers();
    } catch (e) { console.error(e); }
  }

  async function addExcused() {
    const dateInput = $('#excused-date');
    const reasonInput = $('#excused-reason');
    const date = dateInput.value;
    if (!date) return;
    try {
      await apiFetch('/api/admin/excused', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raidDate: date, reason: reasonInput.value.trim() })
      });
      dateInput.value = '';
      reasonInput.value = '';
      loadAdminExcused();
    } catch (e) { console.error(e); }
  }

  async function addPenalty() {
    const nameInput = $('#penalty-player');
    const pctInput = $('#penalty-pct');
    const reasonInput = $('#penalty-reason');
    const name = nameInput.value.trim();
    const pct = parseInt(pctInput.value);
    if (!name || isNaN(pct) || pct < 0 || pct > 100) return;
    try {
      await apiFetch('/api/admin/penalties', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, penaltyPct: pct, reason: reasonInput.value.trim() })
      });
      nameInput.value = '';
      pctInput.value = '';
      reasonInput.value = '';
      loadAdminPenalties();
    } catch (e) { console.error(e); }
  }

  // ─── STATISTIK TAB ───

  async function loadAndRenderStats() {
    const container = $('#stats-results');
    const statusId = '#stats-status';
    if (!guildReports.length) { container.innerHTML = '<p class="text-muted">Keine Reports verfuegbar.</p>'; return; }

    // Filter 25-man TBC reports (exclude excluded reports)
    const reports25raw = guildReports
      .filter(r => { const z = CLA_DATA.zones[r.zone]; return z && z.tbc && z.size >= 25 && !r.excluded; })
      .sort((a, b) => (a.start || 0) - (b.start || 0));

    // Deduplicate: same day + same zone → keep longest report only
    const dedup = new Map(); // "YYYY-MM-DD|zoneId" → report
    for (const r of reports25raw) {
      const day = new Date(r.start).toISOString().slice(0, 10);
      const key = `${day}|${r.zone}`;
      const existing = dedup.get(key);
      if (!existing) { dedup.set(key, r); continue; }
      const durExisting = (existing.end || existing.start) - existing.start;
      const durNew = (r.end || r.start) - r.start;
      if (durNew > durExisting) dedup.set(key, r);
    }
    const reports25 = [...dedup.values()].sort((a, b) => (a.start || 0) - (b.start || 0));

    if (!reports25.length) {
      container.innerHTML = '<p class="text-muted">Keine 25er Reports gefunden.</p>';
      return;
    }

    container.innerHTML = '<p class="text-muted">Lade Statistiken...</p>';
    setStatus(statusId, 'Lade Stats-Bundle...');

    // Stats-Bundle in einem Call — server-side cached + invalidiert bei neuer Analyse
    let bundles = [];
    try {
      const resp = await apiFetch('/api/stats/bundle');
      if (resp.ok) {
        const j = await resp.json();
        bundles = j.bundles || [];
        // Filter wie reports25 (25er, dedupe per Tag+Zone)
        const wantIds = new Set(reports25.map(r => r.id));
        bundles = bundles.filter(b => wantIds.has(b.report.id));
      }
    } catch (e) { console.warn('stats bundle fetch:', e); }

    if (!bundles.length) {
      container.innerHTML = '<p class="text-muted">Keine analysierten Reports gefunden.</p>';
      hide(statusId);
      return;
    }

    // Build set of 25-man fight IDs per bundle (filter out 10-man fights like Karazhan)
    function get25FightIds(bundle) {
      const ids = new Set();
      for (const f of (bundle.fights || [])) {
        if (!f.size || f.size >= 25) ids.add(f.id);
      }
      return ids;
    }

    // Excluded players — filter from all stats
    const statsExcluded = window._excludedPlayerSet || new Set();

    // statsTable helper hochgezogen — Phoenix/Loot/Karma-Tabs werden früher gebaut als
    // die alte Position weiter unten erlaubte (TDZ-Crash sonst).
    const fmtK = n => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);
    let statsTableId = 0;
    function statsTable(title, headers, rows, topN = 5) {
      if (!rows.length) return '';
      const id = 'stats-expand-' + (statsTableId++);
      let h = `<div class="stats-section"><h4 class="stats-subtitle">${title}</h4>`;
      h += `<table class="results-table stats-table sortable-table"><thead><tr>${headers.map((th, ci) => `<th class="sortable-th" data-col="${ci}">${th}</th>`).join('')}</tr></thead><tbody>`;
      for (let i = 0; i < rows.length; i++) {
        const hiddenCls = i >= topN ? ` class="stats-hidden-row ${id} hidden"` : '';
        h += `<tr${hiddenCls}>${rows[i]}</tr>`;
      }
      h += '</tbody></table>';
      if (rows.length > topN) {
        h += `<button class="btn btn-sm stats-expand-btn" data-stats-expand="${id}">Alle ${rows.length} anzeigen &#9660;</button>`;
      }
      h += '</div>';
      return h;
    }

    // ── Aggregate deaths across all reports ──
    const deathsByPlayer = new Map(); // name -> { type, totalDeaths, fightDeaths: [{report, fight, deaths}] }
    const deathsByFight = new Map(); // fightName -> { totalDeaths, wipeDeaths, killDeaths, count }
    let totalReportsWithDeaths = 0;

    for (const { report, bundle } of bundles) {
      const deaths = bundle.analysis && bundle.analysis.deaths;
      if (!deaths || !deaths.length) continue;
      const fightIds25 = get25FightIds(bundle);
      totalReportsWithDeaths++;
      const date = CLA_DATA.formatDate ? CLA_DATA.formatDate(report.start) : new Date(report.start).toLocaleDateString('de-DE');
      for (const fight of deaths) {
        if (fight.fightId && !fightIds25.has(fight.fightId)) continue;
        // Per-boss aggregation
        if (!deathsByFight.has(fight.fightName)) deathsByFight.set(fight.fightName, { totalDeaths: 0, wipeDeaths: 0, killDeaths: 0, count: 0 });
        const bf = deathsByFight.get(fight.fightName);
        bf.count++;
        const fightTotal = fight.deaths.reduce((s, d) => s + d.deaths, 0);
        bf.totalDeaths += fightTotal;
        if (fight.kill) bf.killDeaths += fightTotal; else bf.wipeDeaths += fightTotal;

        for (const d of fight.deaths) {
          if (!d.deaths || statsExcluded.has(d.name)) continue;
          if (!deathsByPlayer.has(d.name)) deathsByPlayer.set(d.name, { type: d.type, totalDeaths: 0, fightDeaths: [] });
          const pd = deathsByPlayer.get(d.name);
          pd.totalDeaths += d.deaths;
          pd.fightDeaths.push({ date, fightName: fight.fightName, kill: fight.kill, deaths: d.deaths });
        }
      }
    }

    // ── Death-Causes aggregieren: (fightName, abilityName, playerName) → count ──
    const deathCauseAgg = new Map(); // key: fightName|abilityName → { fightName, abilityName, abilityGuid, victims: {player: count} }
    for (const { bundle } of bundles) {
      const deaths = bundle.analysis && bundle.analysis.deaths;
      if (!deaths || !deaths.length) continue;
      const fightIds25 = get25FightIds(bundle);
      const playerTypeMap = new Map();
      for (const fight of deaths) {
        for (const d of (fight.deaths || [])) if (d.type) playerTypeMap.set(d.name, d.type);
      }
      for (const fight of deaths) {
        if (fight.fightId && !fightIds25.has(fight.fightId)) continue;
        for (const c of (fight.causes || [])) {
          const key = fight.fightName + '|' + c.abilityName;
          if (!deathCauseAgg.has(key)) deathCauseAgg.set(key, { fightName: fight.fightName, abilityName: c.abilityName, abilityGuid: c.abilityGuid, victims: {}, types: {} });
          const agg = deathCauseAgg.get(key);
          for (const [name, n] of Object.entries(c.victims || {})) {
            if (statsExcluded.has(name)) continue;
            agg.victims[name] = (agg.victims[name] || 0) + n;
            if (playerTypeMap.get(name)) agg.types[name] = playerTypeMap.get(name);
          }
        }
      }
    }

    // Lowest Karma — Cataclysmic Bolt auf Karathress (random target, also reine Karma-Frage)
    const cataKey = 'Fathom-Lord Karathress|Cataclysmic Bolt';
    const cataAgg = deathCauseAgg.get(cataKey);
    if (cataAgg) {
      const victimsSorted = Object.entries(cataAgg.victims).sort((a, b) => b[1] - a[1]);
      const tableHtml = statsTable('☠️ Lowest Karma', ['#', 'Spieler', 'Tode'],
        victimsSorted.map(([name, count], i) => {
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          const css = classCssFromType(cataAgg.types[name] || '');
          return `<td${medal}>${i + 1}</td><td><span class="${css}">${renderPlayerName(name)}</span></td><td><strong>${count}</strong></td>`;
        })
      );
      const wrapped = tableHtml.replace('</h4>', `</h4><p class="text-muted" style="margin-top:-8px;margin-bottom:8px;font-size:0.78rem">Cataclysmic Bolt (Karathress) — pickt random Targets. Wer hier oben steht hat einfach beschissene Karma, niemand kann ausweichen.</p>`);
      groups.shame.push(wrapped);
    }

    // ── Aggregate consumables across all reports ──
    const consByPlayer = new Map(); // name -> { type, potCount, manaCount, healthCount, runeCount, engiCount, otherCount, fightCount, reportCount }

    for (const { bundle } of bundles) {
      const cons = bundle.analysis && bundle.analysis.consumables;
      if (!cons || !cons.length) continue;
      for (const p of cons) {
        if (statsExcluded.has(p.name)) continue;
        if (!consByPlayer.has(p.name)) consByPlayer.set(p.name, { type: p.type, potCount: 0, manaCount: 0, healthCount: 0, runeCount: 0, engiCount: 0, otherCount: 0, fightCount: 0, reportCount: 0 });
        const cp = consByPlayer.get(p.name);
        cp.potCount += p.potCount || 0;
        cp.manaCount += p.manaCount || 0;
        cp.healthCount += p.healthCount || 0;
        cp.runeCount += p.runeCount || 0;
        cp.engiCount += p.engiCount || 0;
        cp.otherCount += p.otherCount || 0;
        cp.fightCount += p.playerFightCount || 0;
        cp.reportCount++;
      }
    }

    // ── Aggregate wipes per boss ──
    const wipesByBoss = new Map();
    for (const { bundle } of bundles) {
      const fights = bundle.fights || [];
      for (const f of fights) {
        if (!f.name) continue;
        if (f.size && f.size < 25) continue;
        if (!wipesByBoss.has(f.name)) wipesByBoss.set(f.name, { kills: 0, wipes: 0 });
        const wb = wipesByBoss.get(f.name);
        if (f.kill) wb.kills++; else wb.wipes++;
      }
    }

    // ── Aggregate damage & healing across all reports ──
    const dmgByPlayer = new Map(); // name -> { type, totalDmg, totalDuration, fightCount, bestDps, bestDpsFight }
    const healByPlayer = new Map(); // name -> { type, totalHeal, totalDuration, fightCount, bestHps, bestHpsFight }

    for (const { bundle } of bundles) {
      const dh = bundle.analysis && bundle.analysis.dmgheal;
      if (!dh || !dh.length) continue;
      const fightIds25 = get25FightIds(bundle);
      for (const fight of dh) {
        if (fight.fightId && !fightIds25.has(fight.fightId)) continue;
        for (const d of (fight.damage || [])) {
          if (!d.total || statsExcluded.has(d.name)) continue;
          if (!dmgByPlayer.has(d.name)) dmgByPlayer.set(d.name, { type: d.type, totalDmg: 0, totalDuration: 0, fightCount: 0, bestDps: 0, bestDpsFight: '' });
          const pd = dmgByPlayer.get(d.name);
          pd.totalDmg += d.total;
          pd.totalDuration += fight.duration;
          pd.fightCount++;
          if (d.dps > pd.bestDps) { pd.bestDps = d.dps; pd.bestDpsFight = fight.fightName; }
        }
        for (const h of (fight.healing || [])) {
          if (!h.total || statsExcluded.has(h.name)) continue;
          if (!healByPlayer.has(h.name)) healByPlayer.set(h.name, { type: h.type, totalHeal: 0, totalDuration: 0, fightCount: 0, bestHps: 0, bestHpsFight: '' });
          const ph = healByPlayer.get(h.name);
          ph.totalHeal += h.total;
          ph.totalDuration += fight.duration;
          ph.fightCount++;
          if (h.hps > ph.bestHps) { ph.bestHps = h.hps; ph.bestHpsFight = fight.fightName; }
        }
      }
    }

    // ── Aggregate damage taken & healing received across all reports ──
    const dmgTakenByPlayer = new Map(); // name -> { type, totalDmgTaken, fightCount, tankFights, totalFights }
    const healReceivedByPlayer = new Map(); // name -> { type, totalHealReceived, fightCount, tankFights, totalFights }

    for (const { bundle } of bundles) {
      const dt = bundle.analysis && bundle.analysis.damagetaken;
      if (!dt || !dt.length) continue;
      const fightIds25 = get25FightIds(bundle);
      for (const fight of dt) {
        if (fight.fightId && !fightIds25.has(fight.fightId)) continue;
        for (const e of (fight.entries || [])) {
          if (!e.total || statsExcluded.has(e.name)) continue;
          if (!dmgTakenByPlayer.has(e.name)) dmgTakenByPlayer.set(e.name, { type: e.type, totalDmgTaken: 0, fightCount: 0, tankFights: 0, totalFights: 0 });
          const pd = dmgTakenByPlayer.get(e.name);
          pd.totalDmgTaken += e.total;
          pd.totalFights++;
          if (e.isTank) pd.tankFights++;
          pd.fightCount++;
        }
        for (const h of (fight.healReceived || [])) {
          if (!h.total || statsExcluded.has(h.name)) continue;
          if (!healReceivedByPlayer.has(h.name)) healReceivedByPlayer.set(h.name, { type: h.type, totalHealReceived: 0, fightCount: 0, tankFights: 0, totalFights: 0 });
          const ph = healReceivedByPlayer.get(h.name);
          ph.totalHealReceived += h.total;
          ph.totalFights++;
          if (h.isTank) ph.tankFights++;
          ph.fightCount++;
        }
      }
    }

    // ── Aggregate drums across all reports ──
    const drumsByPlayer = new Map(); // name -> { type, totalDrums, fightCount }

    for (const { bundle } of bundles) {
      const dr = bundle.analysis && bundle.analysis.drums;
      if (!dr || !dr.length) continue;
      const fightIds25 = get25FightIds(bundle);
      for (const fight of dr) {
        if (fight.fightId && !fightIds25.has(fight.fightId)) continue;
        for (const d of (fight.drums || [])) {
          if (!d.count || statsExcluded.has(d.name)) continue;
          if (!drumsByPlayer.has(d.name)) drumsByPlayer.set(d.name, { type: d.type, totalDrums: 0, fightCount: 0 });
          const pd = drumsByPlayer.get(d.name);
          pd.totalDrums += d.count;
          pd.fightCount++;
        }
      }
    }

    // ── Aggregate Consumes per Item-Name über alle Reports + Spieler ──
    // Flasks/Elixiere/Food: einmaliger Konsum hält 1–2h. Pro (report, player, name)
    // nur 1× zählen — sonst würden 9 Bosse × 25 Spieler eine einzige Flask-Runde
    // als 225 Anwendungen ausweisen.
    // Pots / Runes / Engi-Items / Sonstiges sind Single-Use → pro Fight zählen.
    const consumeName = (v) => elixirDisplayName(v) || null;
    const totalFlasks = new Map();
    const totalBattle = new Map();
    const totalGuardian = new Map();
    const totalFood = new Map();
    const totalConsItems = new Map(); // label -> { cat, count }
    let aggReportCount = 0;
    function bumpUnique(seenSet, map, reportCode, playerName, itemName) {
      if (!itemName) return;
      const key = `${reportCode}|${playerName}|${itemName}`;
      if (seenSet.has(key)) return;
      seenSet.add(key);
      map.set(itemName, (map.get(itemName) || 0) + 1);
    }
    const seenFlasks = new Set();
    const seenBattle = new Set();
    const seenGuardian = new Set();
    const seenFood = new Set();
    for (const { report, bundle } of bundles) {
      aggReportCount++;
      const reportCode = report.id;
      const buffs = bundle.analysis && bundle.analysis.buffs;
      if (buffs) for (const p of buffs) {
        if (statsExcluded.has(p.name)) continue;
        for (const fd of (p.fightDetails || [])) {
          if (!fd) continue;
          bumpUnique(seenFlasks, totalFlasks, reportCode, p.name, consumeName(fd.flask));
          bumpUnique(seenBattle, totalBattle, reportCode, p.name, consumeName(fd.battleElixir));
          bumpUnique(seenGuardian, totalGuardian, reportCode, p.name, consumeName(fd.guardianElixir));
          bumpUnique(seenFood, totalFood, reportCode, p.name, consumeName(fd.food));
        }
      }
      const cons = bundle.analysis && bundle.analysis.consumables;
      if (cons) for (const p of cons) {
        if (statsExcluded.has(p.name)) continue;
        for (const fd of (p.fightDetails || [])) {
          if (!fd || !fd.consumables) continue;
          for (const item of fd.consumables) {
            // Free-conjured Items (Healthstones/Mana-Gems) zählen nicht zum Σ-Genommen-Total
            if (isFreeConjured(item)) continue;
            const key = item.label;
            if (!totalConsItems.has(key)) totalConsItems.set(key, { cat: item.cat || 'other', count: 0 });
            totalConsItems.get(key).count += item.uses || 1;
          }
        }
      }
    }
    // Helpers für Cons-Statistik-Tabellen
    function consTable(title, map, isCategorized) {
      const arr = isCategorized
        ? [...map.entries()].map(([name, e]) => ({ name, cat: e.cat, count: e.count }))
        : [...map.entries()].map(([name, count]) => ({ name, count }));
      arr.sort((a, b) => b.count - a.count);
      if (!arr.length) return '';
      const headers = isCategorized ? ['Item', 'Kategorie', 'Gesamt'] : ['Item', 'Gesamt'];
      const rows = arr.map(r => isCategorized
        ? `<td>${escapeHtml(r.name)}</td><td><span class="cat-pill cat-${r.cat}">${r.cat}</span></td><td><strong>${r.count}</strong></td>`
        : `<td>${escapeHtml(r.name)}</td><td><strong>${r.count}</strong></td>`);
      return statsTable(title, headers, rows, 8);
    }

    // ── Render: Statistik nach Gruppen organisiert ──
    const groups = { shame: [], performance: [], survival: [], consumes: [], bosses: [] };

    // 🏆 Hall of Shame — Ashes of Al'ar Empfänger live aus TMB-Loot.
    // Spielernamen-Aliase kommen aus der instanz-spezifischen Branding-Config
    // (phoenixAliases-Setting, nicht im public Repo enthalten).
    const phxAliases = (window._branding && window._branding.phoenixAliases) || {};
    const phxLoot = ((window._tmbLoot && window._tmbLoot.loot) || []).filter(l => l.itemId === 32458);
    const phxAgg = new Map();
    for (const l of phxLoot) {
      const ex = phxAgg.get(l.character) || { count: 0, cls: l.class || '' };
      ex.count++;
      if (l.class) ex.cls = l.class;
      phxAgg.set(l.character, ex);
    }
    const phxSorted = [...phxAgg.entries()].sort((a, b) => b[1].count - a[1].count);
    if (phxSorted.length) {
      function phxName(realName, cls) {
        const css = classCssFromType(cls);
        const alias = phxAliases[realName];
        if (!alias) {
          // renderPlayerName liefert <a class="player-link">… — Klassen-Farbe ums Element packen
          return `<span class="${css}">${renderPlayerName(realName)}</span>`;
        }
        return `<a href="#player/${encodeURIComponent(realName)}" class="player-link ${css}">${escapeHtml(alias)}</a>`;
      }
      groups.shame.push(statsTable('Ashes of Al’ar wasted', ['#', 'Spieler', 'Counter'],
        phxSorted.map(([name, info], i) => {
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td>${phxName(name, info.cls)}</td><td><strong>${info.count}</strong></td>`;
        })
      ));
    }

    // 🧽 Loot-Schwamm — pro Char + pro Spieler (via TMB charToMember-Mapping)
    const lootByChar = new Map(); // char → { cls, main, off }
    for (const l of ((window._tmbLoot && window._tmbLoot.loot) || [])) {
      if (!l.character || statsExcluded.has(l.character)) continue;
      const ex = lootByChar.get(l.character) || { cls: l.class || '', main: 0, off: 0 };
      if (l.class) ex.cls = l.class;
      if (l.offspec) ex.off++; else ex.main++;
      lootByChar.set(l.character, ex);
    }
    // Pro Char
    const lootCharSorted = [...lootByChar.entries()].sort((a, b) => (b[1].main + b[1].off) - (a[1].main + a[1].off));
    if (lootCharSorted.length) {
      groups.shame.push(statsTable('Loot-Schwamm pro Char', ['#', 'Char', 'Mainspec', 'Offspec', 'Gesamt'],
        lootCharSorted.slice(0, 15).map(([name, info], i) => {
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          const css = classCssFromType(info.cls);
          return `<td${medal}>${i + 1}</td><td><span class="${css}">${renderPlayerName(name)}</span></td><td>${info.main}</td><td>${info.off}</td><td><strong>${info.main + info.off}</strong></td>`;
        })
      ));
    }
    // Pro Spieler (alle Chars eines Members aggregiert)
    const charToMember = (window._tmbRaidGroups && window._tmbRaidGroups.charToMember) || {};
    const lootByMember = new Map(); // member → { main, off, chars: Set }
    for (const [char, info] of lootByChar) {
      const member = charToMember[char] || char;
      const ex = lootByMember.get(member) || { main: 0, off: 0, chars: new Set() };
      ex.main += info.main;
      ex.off += info.off;
      ex.chars.add(char);
      lootByMember.set(member, ex);
    }
    const lootMemberSorted = [...lootByMember.entries()].sort((a, b) => (b[1].main + b[1].off) - (a[1].main + a[1].off));
    if (lootMemberSorted.length) {
      groups.shame.push(statsTable('Loot-Schwamm pro Spieler', ['#', 'Spieler', 'Chars', 'Mainspec', 'Offspec', 'Gesamt'],
        lootMemberSorted.slice(0, 15).map(([member, info], i) => {
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          const charsStr = [...info.chars].sort().join(', ');
          return `<td${medal}>${i + 1}</td><td><strong>${escapeHtml(member)}</strong></td><td><small class="text-muted">${escapeHtml(charsStr)}</small></td><td>${info.main}</td><td>${info.off}</td><td><strong>${info.main + info.off}</strong></td>`;
        })
      ));
    }

    // 🧪 Consumes-Übersicht (gesamtes Pool aller Reports, Slacker-Filter aktiv)
    const totalUses = [...totalFlasks.values(), ...totalBattle.values(), ...totalGuardian.values(), ...totalFood.values()].reduce((s,n)=>s+n, 0)
                    + [...totalConsItems.values()].reduce((s,e)=>s+e.count, 0);
    if (totalUses > 0) {
      groups.consumes.push(`<div class="stats-section stats-section--cons-overview"><h4 class="stats-subtitle">Übersicht</h4>` +
        `<p class="text-muted" style="margin-top:-4px">${totalUses.toLocaleString('de-DE')} Anwendungen über ${aggReportCount} Raids — aggregiert über alle Spieler.</p></div>`);
      groups.consumes.push(consTable('Flasks', totalFlasks, false));
      groups.consumes.push(consTable('Battle-Elixiere', totalBattle, false));
      groups.consumes.push(consTable('Guardian-Elixiere', totalGuardian, false));
      groups.consumes.push(consTable('Potions / Runes / Sonstige', totalConsItems, true));
    }

    // -- Floor Tank Award (deaths per raid attended) --
    const deathList = [...deathsByPlayer.entries()].sort((a, b) => b[1].totalDeaths - a[1].totalDeaths);
    const floorTanks = [...deathsByPlayer.entries()]
      .filter(([name]) => consByPlayer.has(name)) // must have attended raids
      .map(([name, d]) => {
        const raids = consByPlayer.get(name)?.reportCount || 1;
        return { name, type: d.type, totalDeaths: d.totalDeaths, raids, rate: d.totalDeaths / raids };
      })
      .filter(p => p.raids >= 2) // at least 2 raids
      .sort((a, b) => b.rate - a.rate);

    groups.survival.push(statsTable('Floor POV (Tode/Raid)', ['#', 'Spieler', 'Klasse', 'Tode/Raid', 'Tode', 'Raids'],
      floorTanks.map((p, i) => {
        const css = classCssFromType(p.type);
        const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
        return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.rate.toFixed(2)}</strong></td><td>${p.totalDeaths}</td><td>${p.raids}</td>`;
      })
    ));

    // -- Meiste Tode (absolut) --
    groups.survival.push(statsTable('Meiste Tode (gesamt)', ['#', 'Spieler', 'Klasse', 'Tode', 'Tode/Raid'],
      deathList.length ? deathList.map(([name, d], i) => {
        const css = classCssFromType(d.type);
        const perRaid = (d.totalDeaths / totalReportsWithDeaths).toFixed(1);
        const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
        return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(name)}</td><td class="${css}">${classNameFromType(d.type)}</td><td><strong>${d.totalDeaths}</strong></td><td>${perRaid}</td>`;
      }) : []
    ));

    // -- Tryhard Index (consumables per fight) --
    const tryhards = [...consByPlayer.entries()]
      .map(([name, c]) => {
        const total = c.potCount + c.manaCount + c.healthCount + c.runeCount + c.engiCount + c.otherCount;
        return { name, type: c.type, total, fightCount: c.fightCount, perFight: c.fightCount > 0 ? total / c.fightCount : 0 };
      })
      .filter(p => p.fightCount >= 3)
      .sort((a, b) => b.perFight - a.perFight);

    groups.consumes.push(statsTable('Tryhard-Index (Consumables/Fight)', ['#', 'Spieler', 'Klasse', 'Pro Fight', 'Gesamt', 'Fights'],
      tryhards.map((p, i) => {
        const css = classCssFromType(p.type);
        const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
        return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.perFight.toFixed(2)}</strong></td><td>${p.total}</td><td>${p.fightCount}</td>`;
      })
    ));

    // -- Meiste Consumables (absolut) --
    const consTotal = [...consByPlayer.entries()].map(([name, c]) => ({
      name, ...c,
      total: c.potCount + c.manaCount + c.healthCount + c.runeCount + c.engiCount + c.otherCount,
    })).sort((a, b) => b.total - a.total);

    // -- DPS Ranking (avg DPS across all fights) --
    const HEALER_TYPES = new Set(['Priest', 'Paladin', 'Druid', 'Shaman']);
    const dpsList = [...dmgByPlayer.entries()]
      .map(([name, d]) => ({ name, type: d.type, avgDps: d.totalDuration > 0 ? Math.round(d.totalDmg / d.totalDuration) : 0, totalDmg: d.totalDmg, fightCount: d.fightCount, bestDps: d.bestDps, bestFight: d.bestDpsFight }))
      .filter(p => p.fightCount >= 3 && p.avgDps > 100)
      .sort((a, b) => b.avgDps - a.avgDps);

    if (dpsList.length) {
      groups.performance.push(statsTable('DPS-Ranking (Durchschnitt)', ['#', 'Spieler', 'Klasse', 'Avg DPS', 'Best DPS', 'Best Fight', 'Fights', 'Damage gesamt'],
        dpsList.map((p, i) => {
          const css = classCssFromType(p.type);
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.avgDps.toLocaleString('de-DE')}</strong></td><td>${p.bestDps.toLocaleString('de-DE')}</td><td>${escapeHtml(p.bestFight)}</td><td>${p.fightCount}</td><td>${fmtK(p.totalDmg)}</td>`;
        })
      ));
    }

    // -- HPS Ranking --
    const hpsList = [...healByPlayer.entries()]
      .map(([name, h]) => ({ name, type: h.type, avgHps: h.totalDuration > 0 ? Math.round(h.totalHeal / h.totalDuration) : 0, totalHeal: h.totalHeal, fightCount: h.fightCount, bestHps: h.bestHps, bestFight: h.bestHpsFight }))
      .filter(p => p.fightCount >= 3 && p.avgHps > 100)
      .sort((a, b) => b.avgHps - a.avgHps);

    if (hpsList.length) {
      groups.performance.push(statsTable('HPS-Ranking (Durchschnitt)', ['#', 'Spieler', 'Klasse', 'Avg HPS', 'Best HPS', 'Best Fight', 'Fights', 'Healing gesamt'],
        hpsList.map((p, i) => {
          const css = classCssFromType(p.type);
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.avgHps.toLocaleString('de-DE')}</strong></td><td>${p.bestHps.toLocaleString('de-DE')}</td><td>${escapeHtml(p.bestFight)}</td><td>${p.fightCount}</td><td>${fmtK(p.totalHeal)}</td>`;
        })
      ));
    }

    // -- Mana Loch (most healing received, excluding tanks) --
    const manaLochList = [...healReceivedByPlayer.entries()]
      .filter(([, d]) => d.tankFights === 0 && d.fightCount >= 3) // exclude tanks, min 3 fights
      .map(([name, d]) => ({ name, type: d.type, totalHeal: d.totalHealReceived, fightCount: d.fightCount, perFight: Math.round(d.totalHealReceived / d.fightCount) }))
      .sort((a, b) => b.perFight - a.perFight);

    if (manaLochList.length) {
      groups.survival.push(statsTable('Mana Loch (Heilung/Fight, ohne Tanks)', ['#', 'Spieler', 'Klasse', 'Heal/Fight', 'Heilung gesamt', 'Fights'],
        manaLochList.map((p, i) => {
          const css = classCssFromType(p.type);
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${fmtK(p.perFight)}</strong></td><td>${fmtK(p.totalHeal)}</td><td>${p.fightCount}</td>`;
        })
      ));
    }

    // -- Schadensmagnet (most damage taken, excluding tanks) --
    // Same data as Mana Loch but sorted by per-fight damage taken
    const schadensmagnetList = [...dmgTakenByPlayer.entries()]
      .filter(([, d]) => d.tankFights === 0 && d.fightCount >= 3)
      .map(([name, d]) => ({ name, type: d.type, totalDmgTaken: d.totalDmgTaken, fightCount: d.fightCount, perFight: Math.round(d.totalDmgTaken / d.fightCount) }))
      .sort((a, b) => b.perFight - a.perFight);

    if (schadensmagnetList.length) {
      groups.survival.push(statsTable('Schadensmagnet (Damage/Fight, ohne Tanks)', ['#', 'Spieler', 'Klasse', 'Dmg/Fight', 'Damage gesamt', 'Fights'],
        schadensmagnetList.map((p, i) => {
          const css = classCssFromType(p.type);
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${fmtK(p.perFight)}</strong></td><td>${fmtK(p.totalDmgTaken)}</td><td>${p.fightCount}</td>`;
        })
      ));
    }

    // -- Bongo Master (most drum casts) --
    const bongoList = [...drumsByPlayer.entries()]
      .map(([name, d]) => ({ name, type: d.type, totalDrums: d.totalDrums, fightCount: d.fightCount }))
      .sort((a, b) => b.totalDrums - a.totalDrums);

    if (bongoList.length) {
      groups.consumes.push(statsTable('Bongo Master (Drums)', ['#', 'Spieler', 'Klasse', 'Drum Casts', 'Fights', 'Pro Fight'],
        bongoList.map((p, i) => {
          const css = classCssFromType(p.type);
          const perFight = p.fightCount > 0 ? (p.totalDrums / p.fightCount).toFixed(1) : '—';
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.totalDrums}</strong></td><td>${p.fightCount}</td><td>${perFight}</td>`;
        })
      ));
    }

    groups.consumes.push(statsTable('Meiste Consumables pro Spieler', ['#', 'Spieler', 'Klasse', 'Gesamt', 'Pots', 'Mana', 'Runes', 'Engi', 'Health', 'Pro Fight'],
      consTotal.map((c, i) => {
        const css = classCssFromType(c.type);
        const perFight = c.fightCount > 0 ? (c.total / c.fightCount).toFixed(1) : '—';
        const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
        return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(c.name)}</td><td class="${css}">${classNameFromType(c.type)}</td><td><strong>${c.total}</strong></td><td>${c.potCount}</td><td>${c.manaCount}</td><td>${c.runeCount}</td><td>${c.engiCount}</td><td>${c.healthCount}</td><td>${perFight}</td>`;
      })
    ));

    // -- Sapper-Meister (most engineering items) --
    const sapperList = [...consByPlayer.entries()]
      .filter(([, c]) => c.engiCount > 0)
      .map(([name, c]) => ({ name, type: c.type, engiCount: c.engiCount, fightCount: c.fightCount }))
      .sort((a, b) => b.engiCount - a.engiCount);

    if (sapperList.length) {
      groups.consumes.push(statsTable('Sapper-Meister (Engineering Items)', ['#', 'Spieler', 'Klasse', 'Engi Items', 'Pro Fight'],
        sapperList.map((p, i) => {
          const css = classCssFromType(p.type);
          const perFight = p.fightCount > 0 ? (p.engiCount / p.fightCount).toFixed(2) : '—';
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.engiCount}</strong></td><td>${perFight}</td>`;
        })
      ));
    }

    // -- Lebenswille (most health consumables: health pots + healthstones) --
    const survivalList = [...consByPlayer.entries()]
      .filter(([, c]) => c.healthCount > 0)
      .map(([name, c]) => ({ name, type: c.type, healthCount: c.healthCount, fightCount: c.fightCount }))
      .sort((a, b) => b.healthCount - a.healthCount);

    if (survivalList.length) {
      groups.consumes.push(statsTable('Lebenswille (Healing Pots & Healthstones)', ['#', 'Spieler', 'Klasse', 'Health Items', 'Pro Fight'],
        survivalList.map((p, i) => {
          const css = classCssFromType(p.type);
          const perFight = p.fightCount > 0 ? (p.healthCount / p.fightCount).toFixed(2) : '—';
          const medal = i < 3 ? ` class="stats-medal-${i + 1}"` : '';
          return `<td${medal}>${i + 1}</td><td class="${css}">${renderPlayerName(p.name)}</td><td class="${css}">${classNameFromType(p.type)}</td><td><strong>${p.healthCount}</strong></td><td>${perFight}</td>`;
        })
      ));
    }

    // -- Boss Kill/Wipe Ratio --
    const bossStats = [...wipesByBoss.entries()]
      .filter(([, v]) => v.wipes > 0 || v.kills > 0)
      .sort((a, b) => b[1].wipes - a[1].wipes);

    groups.bosses.push(statsTable('Boss Kill/Wipe Ratio', ['Boss', 'Kills', 'Wipes', 'Gesamt', 'Kill-Rate'],
      bossStats.map(([name, s]) => {
        const total = s.kills + s.wipes;
        const rate = total > 0 ? ((s.kills / total) * 100).toFixed(0) : '—';
        const rateClass = rate >= 90 ? 'buff-ok' : rate >= 50 ? 'buff-warn' : 'buff-miss';
        return `<td>${escapeHtml(name)}</td><td>${s.kills}</td><td>${s.wipes}</td><td>${total}</td><td><span class="${rateClass}">${rate}%</span></td>`;
      })
    ));

    // -- Tode pro Boss --
    const bossDeaths = [...deathsByFight.entries()].sort((a, b) => b[1].totalDeaths - a[1].totalDeaths);
    groups.bosses.push(statsTable('Tode pro Boss', ['Boss', 'Tode gesamt', 'Pulls', 'Tode/Pull'],
      bossDeaths.map(([name, s]) => {
        const perPull = s.count > 0 ? (s.totalDeaths / s.count).toFixed(1) : '—';
        return `<td>${escapeHtml(name)}</td><td>${s.totalDeaths}</td><td>${s.count}</td><td>${perPull}</td>`;
      })
    ));

    // Emit groups with section headers
    function emitGroup(title, icon, accent, tables) {
      const nonEmpty = tables.filter(t => t && t.trim());
      if (!nonEmpty.length) return '';
      return `<section class="stats-group stats-group--${accent}">` +
        `<h2 class="stats-group-title"><span class="stats-group-icon">${icon}</span>${title}</h2>` +
        `<div class="stats-group-body">${nonEmpty.join('')}</div></section>`;
    }
    let html = '';
    html += emitGroup('Hall of Shame', '&#127942;', 'shame', groups.shame);
    html += emitGroup('Performance', '&#9876;&#65039;', 'perf', groups.performance);
    html += emitGroup('Survival & Schaden', '&#128128;', 'survival', groups.survival);
    html += emitGroup('Consumes', '&#129514;', 'consumes', groups.consumes);
    html += emitGroup('Bosse', '&#128009;', 'bosses', groups.bosses);

    container.innerHTML = html;

    // Wire expand buttons
    container.querySelectorAll('.stats-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cls = btn.dataset.statsExpand;
        const rows = container.querySelectorAll(`.${cls}`);
        const hidden = rows[0]?.classList.contains('hidden');
        rows.forEach(r => r.classList.toggle('hidden', !hidden));
        btn.innerHTML = hidden ? `Top 5 anzeigen &#9650;` : `Alle ${rows.length + 5} anzeigen &#9660;`;
      });
    });

    // Wire sortable table headers
    function parseSortValue(text) {
      const t = text.trim().replace(/%$/, '');
      if (t === '—' || t === '') return -Infinity;
      // Handle k/M suffixes (e.g. "12k", "1.2M") — use comma as decimal here
      if (/^[\d.,]+[kK]$/.test(t)) return parseFloat(t.slice(0, -1).replace(',', '.')) * 1000;
      if (/^[\d.,]+M$/.test(t)) return parseFloat(t.slice(0, -1).replace(',', '.')) * 1000000;
      // German locale: 1.234 (thousands dot) → remove dots, replace comma with dot
      const num = parseFloat(t.replace(/\./g, '').replace(',', '.'));
      if (!isNaN(num)) return num;
      return t.toLowerCase();
    }
    container.querySelectorAll('.sortable-table').forEach(table => {
      const ths = table.querySelectorAll('th.sortable-th');
      let currentSort = { col: -1, asc: false };
      ths.forEach(th => {
        th.addEventListener('click', () => {
          const col = parseInt(th.dataset.col);
          const tbody = table.querySelector('tbody');
          const rows = [...tbody.querySelectorAll('tr')];
          const headerText = th.textContent.trim();
          const isRankCol = headerText === '#';
          if (isRankCol) return; // don't sort by rank column

          // Toggle direction
          const asc = currentSort.col === col ? !currentSort.asc : false;
          currentSort = { col, asc };

          // Update header indicators
          ths.forEach(h => { h.classList.remove('sort-asc', 'sort-desc'); });
          th.classList.add(asc ? 'sort-asc' : 'sort-desc');

          // Sort rows
          rows.sort((a, b) => {
            const aCell = a.children[col];
            const bCell = b.children[col];
            if (!aCell || !bCell) return 0;
            const aVal = parseSortValue(aCell.textContent);
            const bVal = parseSortValue(bCell.textContent);
            if (typeof aVal === 'number' && typeof bVal === 'number') return asc ? aVal - bVal : bVal - aVal;
            if (typeof aVal === 'string' && typeof bVal === 'string') return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            return 0;
          });

          // Re-number rank column and remove hidden state
          const hasRank = rows[0]?.children[0] && ths[0]?.textContent.trim() === '#';
          rows.forEach((row, i) => {
            row.classList.remove('hidden');
            if (hasRank) {
              const rankCell = row.children[0];
              // Preserve medal class for top 3
              rankCell.className = i < 3 ? `stats-medal-${i + 1}` : '';
              rankCell.textContent = i + 1;
            }
            tbody.appendChild(row);
          });

          // Update expand button to reflect expanded state
          const section = table.closest('.stats-section');
          const expandBtn = section?.querySelector('.stats-expand-btn');
          if (expandBtn) {
            expandBtn.innerHTML = `Top 5 anzeigen &#9650;`;
          }
        });
      });
    });

    setStatus(statusId, `Statistiken aus ${bundles.length} Reports geladen (${totalReportsWithDeaths} mit Todes-Daten).`);
    window._statsLoaded = true;
  }

  // ─── INIT ───

  function init() {
    initBranding();
    initTheme();
    initTabs();
    initSetup();
    initActions();
    initLiveTicker();
    initAdmin();
  }

  // Lädt App-Name + Gilden-Branding vom Server und befüllt Title/Header
  async function initBranding() {
    try {
      const res = await fetch('/api/branding');
      if (!res.ok) return;
      const b = await res.json();
      if (b.appName) {
        document.title = b.appName;
        const logo = document.getElementById('btn-home');
        if (logo) logo.textContent = b.appName;
      }
      window._branding = b;
    } catch (_) { /* fail silent — defaults bleiben */ }
    // Consumes-Scoring-Setting laden (welche IDs nicht in Σ Genommen zählen + Threshold %)
    try {
      const cs = await apiFetch('/api/consumes-scoring');
      if (cs.ok) {
        const j = await cs.json();
        if (Array.isArray(j.excludedIds)) window._consumesExcludedIds = j.excludedIds;
        if (Number.isFinite(j.thresholdPct)) window._consumesSlackerPct = j.thresholdPct;
      }
    } catch (_) { /* default fallback bleibt aktiv */ }
    // Scroll-Requirement-Overrides laden
    try {
      const sr = await apiFetch('/api/scroll-requirements');
      if (sr.ok) {
        const j = await sr.json();
        if (j.overrides && typeof j.overrides === 'object') window._scrollRequirementOverrides = j.overrides;
      }
    } catch (_) {}
  }

  // Generate girly mode particles
  function initGirlyParticles() {
    const rain = $('#girly-rain');
    const sparkles = $('#girly-sparkles');
    if (!rain || !sparkles) return;
    const colors = ['#ff69b4','#ff1493','#da70d6','#ff85c8','#ffa6d9','#e877b2','#ff4da6','#c964cf'];
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('span');
      d.className = 'g-drop';
      const c = colors[Math.floor(Math.random() * colors.length)];
      const size = 6 + Math.random() * 10;
      const shapes = ['50%', '50% 0 50% 50%', '2px'];
      d.style.cssText = `left:${Math.random()*100}%;animation-duration:${3+Math.random()*5}s;animation-delay:${-(Math.random()*8)}s;width:${size}px;height:${size}px;background:${c};border-radius:${shapes[Math.floor(Math.random()*3)]};opacity:0.7;`;
      rain.appendChild(d);
    }
    for (let i = 0; i < 30; i++) {
      const s = document.createElement('span');
      s.className = 'g-spark';
      const size = 3 + Math.random() * 6;
      const c = colors[Math.floor(Math.random() * colors.length)];
      s.style.cssText = `left:${Math.random()*95}%;top:${Math.random()*95}%;animation-delay:${-(Math.random()*3)}s;animation-duration:${1+Math.random()*2}s;width:${size}px;height:${size}px;background:${c};border-radius:50%;box-shadow:0 0 ${size*2}px ${c};`;
      sparkles.appendChild(s);
    }
  }

  // ─── BUG TRACKER ───

  async function loadBugTickets() {
    const container = $('#bugs-list');
    if (!container) return;
    try {
      const showClosed = $('#bugs-show-closed')?.checked;
      const resp = await apiFetch('/api/bugs' + (showClosed ? '?all=1' : ''));
      if (resp.status === 401) { container.innerHTML = '<p class="text-muted">Bitte zuerst im <a href="#admin">Admin-Bereich</a> einloggen.</p>'; return; }
      const data = await resp.json();
      renderBugTickets(data.tickets || []);
    } catch (e) {
      container.innerHTML = '<p class="text-error">Fehler beim Laden.</p>';
    }
  }

  function renderBugTickets(tickets) {
    const container = $('#bugs-list');
    if (!tickets.length) { container.innerHTML = '<p class="text-muted">Keine Tickets vorhanden.</p>'; return; }
    container.innerHTML = tickets.map(t => {
      const date = new Date(t.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const statusCls = t.status === 'open' ? 'badge-open' : t.status === 'wontfix' ? 'badge-wontfix' : 'badge-closed';
      const statusLabel = t.status === 'open' ? 'Offen' : t.status === 'wontfix' ? 'Won\'t Fix' : 'Erledigt';
      return `<div class="bug-ticket ${t.status !== 'open' ? 'bug-ticket-done' : ''}">
        <div class="bug-ticket-header">
          <strong>#${t.id}</strong>
          <span class="bug-status ${statusCls}">${statusLabel}</span>
          ${t.created_by ? `<span class="text-muted" style="font-size:.8rem">${escapeHtml(t.created_by)}</span>` : ''}
          <span class="text-muted" style="margin-left:auto;font-size:.8rem">${date}</span>
        </div>
        <div class="bug-ticket-title">${escapeHtml(t.title)}</div>
        ${t.description ? `<div class="bug-ticket-desc text-muted">${escapeHtml(t.description)}</div>` : ''}
        <div class="bug-ticket-actions">
          ${t.status === 'open' ? `<button class="btn btn-sm btn-success" onclick="window.__bugStatus(${t.id},'closed')">Erledigt</button>
          <button class="btn btn-sm" onclick="window.__bugStatus(${t.id},'wontfix')">Won't Fix</button>` :
          `<button class="btn btn-sm" onclick="window.__bugStatus(${t.id},'open')">Wieder oeffnen</button>`}
          ${adminRole === 'superadmin' ? `<button class="btn btn-sm btn-danger" onclick="window.__bugDelete(${t.id})">Loeschen</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  window.__bugStatus = async function(id, status) {
    await apiFetch('/api/bugs/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
    loadBugTickets();
  };

  window.__bugDelete = async function(id) {
    modalConfirm('Ticket loeschen', `Ticket #${id} wirklich loeschen?`, async () => {
      await apiFetch(`/api/bugs/${id}`, { method: 'DELETE' });
      loadBugTickets();
    });
  };

  async function submitBugTicket() {
    const titleEl = $('#bug-title');
    const descEl = $('#bug-desc');
    const title = titleEl.value.trim();
    if (!title) { titleEl.focus(); return; }
    await apiFetch('/api/bugs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description: descEl.value.trim() }) });
    titleEl.value = '';
    descEl.value = '';
    loadBugTickets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); initGirlyParticles(); });
  } else {
    init(); initGirlyParticles();
  }

})();
