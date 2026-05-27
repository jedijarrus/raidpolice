/**
 * Server-side pre-analyzer for CLA Web App
 * Runs all analyses (gear, buffs, consumables, spell ranks) for new reports.
 * Called periodically by server.js or via CLI: node preanalyze.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const cache = require('./db');

const WCL_API_BASE = 'https://fresh.warcraftlogs.com/v1';
const WCL_API_V2_BASE = 'https://fresh.warcraftlogs.com/api/v2/client';
const WCL_OAUTH_TOKEN_URL = 'https://fresh.warcraftlogs.com/oauth/token';
const CONCURRENCY = 3; // max parallel WCL requests (V1 REST has tight burst limits)
const MIN_REQUEST_INTERVAL_MS = 180; // ≤ ~330 req/min ≈ unter V1-Limit

// ─── WCL v2 API (GraphQL + OAuth) — nur für was v1 nicht kann (Mana-Kurven, Phasen, Talents) ───

let _v2Token = null;
let _v2TokenExpiryMs = 0;

async function getV2Token() {
  if (_v2Token && Date.now() < _v2TokenExpiryMs - 60000) return _v2Token;
  const clientId = cache.getSetting('wclV2ClientId');
  const clientSecret = cache.getSetting('wclV2ClientSecret');
  if (!clientId || !clientSecret) return null;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = 'grant_type=client_credentials';
  const u = new URL(WCL_OAUTH_TOKEN_URL);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks);
          if (!data.access_token) return reject(new Error('No access_token: ' + chunks));
          _v2Token = data.access_token;
          _v2TokenExpiryMs = Date.now() + (data.expires_in || 3600) * 1000;
          resolve(_v2Token);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// V2-Helper: holt alle Cast-Events für einen Fight mit Filter (pagination automatisch)
async function fetchCastEventsV2(reportCode, fightId, filterExpression) {
  const all = [];
  let startTime = null;
  while (true) {
    const query = startTime == null
      ? `query($c:String!,$f:Int!,$flt:String!) { reportData { report(code:$c) { events(dataType:Casts,fightIDs:[$f],hostilityType:Friendlies,filterExpression:$flt,limit:10000) { data nextPageTimestamp } } } }`
      : `query($c:String!,$f:Int!,$flt:String!,$s:Float!) { reportData { report(code:$c) { events(dataType:Casts,fightIDs:[$f],hostilityType:Friendlies,filterExpression:$flt,startTime:$s,limit:10000) { data nextPageTimestamp } } } }`;
    const variables = { c: reportCode, f: fightId, flt: filterExpression };
    if (startTime != null) variables.s = startTime;
    const data = await wclApiV2(query, variables);
    const evs = data?.reportData?.report?.events?.data || [];
    all.push(...evs);
    const next = data?.reportData?.report?.events?.nextPageTimestamp;
    if (!next || evs.length === 0) break;
    startTime = next;
  }
  return all;
}

async function wclApiV2(query, variables = {}) {
  const token = await getV2Token();
  if (!token) return null; // graceful degradation when no v2 credentials set
  const body = JSON.stringify({ query, variables });
  const u = new URL(WCL_API_V2_BASE);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(chunks);
          if (data.errors) return reject(new Error('v2 errors: ' + JSON.stringify(data.errors)));
          resolve(data.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Load browser data modules ───

function loadBrowserModule(filePath) {
  const code = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
  const window = {};
  new Function('window', code)(window);
  return window;
}

const { CLA_DATA } = loadBrowserModule('js/data.js');
const { CLA_GEAR } = loadBrowserModule('js/gear_data.js');
const { GEM_DB } = loadBrowserModule('js/gem_db.js');
const { CLA_SOCKETS } = loadBrowserModule('js/sockets_db.js');
const { SPELL_RANKS } = loadBrowserModule('js/spell_ranks.js');

// ─── Constants (from app.js) ───

const VALID_CLASSES = ['Druid','Hunter','Mage','Priest','Paladin','Rogue','Shaman','Warlock','Warrior'];

const BUFF_IDS = {
  battleElixir: [10667,10669,11334,11405,11406,11474,16323,16329,17038,17537,17538,17539,26276,28490,28491,28493,28497,28501,28503,33720,33721,33726,38954,45373,45374],
  guardianElixir: [10668,10692,10693,11348,11371,11374,11396,17535,24361,24363,24382,24383,24417,28502,28509,28514,30003,39625,39626,39627,39628],
  flask: [17626,17627,17628,17629,28518,28519,28520,28521,28540,40576,40577,40579,40580,40582,40586,40587,40588,40763,41604,41605,41606,41607,42735,46838,46840],
  foodBuff: [19705,19706,19708,19709,19710,19711,22730,22731,24799,24870,25660,25661,25694,25804,25941,33254,33256,33257,33259,33261,33263,33265,33268,35272,40323,42293,43730,43731,43733,43764,43771,44097,44098,44099,44100,44101,44102,44103,44104,44105,44106,45245,45619,46682,46687,46899,43722,21149],
  scrolls: [33077,33078,33079,33080,33081,33082,12174,8117,8116,8115,12176,8098,8097,8096,12175,8095,8094,8091,12177,8114,8113,8112,12178,8101,8100,8099,12179,8120,8119,8118],
  scrollRanks: {
    33077:{stat:'Agility',rank:'V',value:20},12174:{stat:'Agility',rank:'IV',value:17},8117:{stat:'Agility',rank:'III',value:13},8116:{stat:'Agility',rank:'II',value:9},8115:{stat:'Agility',rank:'I',value:5},
    33078:{stat:'Intellect',rank:'V',value:20},12176:{stat:'Intellect',rank:'IV',value:16},8098:{stat:'Intellect',rank:'III',value:12},8097:{stat:'Intellect',rank:'II',value:8},8096:{stat:'Intellect',rank:'I',value:4},
    33079:{stat:'Protection',rank:'V',value:300},12175:{stat:'Protection',rank:'IV',value:240},8095:{stat:'Protection',rank:'III',value:180},8094:{stat:'Protection',rank:'II',value:120},8091:{stat:'Protection',rank:'I',value:60},
    33080:{stat:'Spirit',rank:'V',value:30},12177:{stat:'Spirit',rank:'IV',value:15},8114:{stat:'Spirit',rank:'III',value:11},8113:{stat:'Spirit',rank:'II',value:7},8112:{stat:'Spirit',rank:'I',value:3},
    33081:{stat:'Stamina',rank:'V',value:20},12178:{stat:'Stamina',rank:'IV',value:16},8101:{stat:'Stamina',rank:'III',value:12},8100:{stat:'Stamina',rank:'II',value:8},8099:{stat:'Stamina',rank:'I',value:4},
    33082:{stat:'Strength',rank:'V',value:20},12179:{stat:'Strength',rank:'IV',value:17},8120:{stat:'Strength',rank:'III',value:13},8119:{stat:'Strength',rank:'II',value:9},8118:{stat:'Strength',rank:'I',value:5},
  },
  scrollBestRank: {Agility:33077,Intellect:33078,Protection:33079,Spirit:33080,Stamina:33081,Strength:33082},
  scrollRequired: {
    'Warrior:dps':['Agility','Strength'],'Rogue:dps':['Agility','Strength'],
    'Paladin:retribution':['Agility','Strength'],'Paladin:dps':['Agility','Strength'],
    'Druid:feral':['Agility','Strength'],'Druid:dps':['Agility','Strength'],
    'Druid:balance':[],'Druid:healer':[],
    'Shaman:enhancement':['Agility','Strength'],'Shaman:elemental':[],'Shaman:dps':['Agility','Strength'],
    'Hunter:dps':['Agility'],
    'Warrior:tank':['Agility','Strength','Protection'],'Paladin:tank':['Agility','Strength','Protection'],
    'Druid:tank':['Agility','Strength','Protection'],'HunterPet':['Agility','Strength'],
  },
  weaponEnhancement: [25122,25123,25121,25120,28017,28016,25119,29453,29452,22756,16138,12164,34340,34339,16622,12163,27187,27186,26891,26892,26969,27283,27282,26790,26786,26785,26884,25584,25583],
};

const BUFF_SETS = {
  flask: new Set(BUFF_IDS.flask),
  battleElixir: new Set(BUFF_IDS.battleElixir),
  guardianElixir: new Set(BUFF_IDS.guardianElixir),
  foodBuff: new Set(BUFF_IDS.foodBuff),
  scrolls: new Set(BUFF_IDS.scrolls),
  weaponEnhancement: new Set(BUFF_IDS.weaponEnhancement),
};

const TEMP_ENCHANT_NAMES = {
  2628:'Brilliant Wizard Oil',2678:'Superior Wizard Oil',2627:'Wizard Oil',2626:'Lesser Wizard Oil',2625:'Minor Wizard Oil',2624:'Minor Mana Oil',
  2629:'Brilliant Mana Oil',2677:'Superior Mana Oil',2623:'Lesser Mana Oil',2685:'Blessed Wizard Oil',
  2713:'Adamantite Sharpening Stone',2712:'Fel Sharpening Stone',2506:'Elemental Sharpening Stone',1643:'Dense Sharpening Stone',483:'Solid Sharpening Stone',2684:'Consecrated Sharpening Stone',
  2955:'Adamantite Weightstone',2954:'Fel Weightstone',1703:'Dense Weightstone',484:'Solid Weightstone',
  2639:'Windfury',2638:'Windfury',2636:'Windfury',
  2643:'Deadly Poison',2630:'Instant Poison',2641:'Crippling Poison',2640:'Mind-Numbing Poison',2642:'Wound Poison',2644:'Anesthetic Poison',
  3266:'Righteous Weapon Coating',3265:'Blessed Weapon Coating',3093:'Scourgebane',
};

const CONSUMABLE_BUFF_IDS = {
  destructionPotion:{ids:[28508],item:22839,label:'Destruction Potion',cat:'pot'},
  hastePotion:{ids:[28507],item:22838,label:'Haste Potion',cat:'pot'},
  insaneStrengthPotion:{ids:[28494],item:22828,label:'Insane Strength Potion',cat:'pot'},
  ironshieldPotion:{ids:[28515],item:22849,label:'Ironshield Potion',cat:'pot'},
  heroicPotion:{ids:[28506],item:22837,label:'Heroic Potion',cat:'pot'},
  felManaPotion:{ids:[38929],item:31677,label:'Fel Mana Potion',cat:'mana'},
  flameCap:{ids:[28714],item:22788,label:'Flame Cap',cat:'other'},
  nightmareSeed:{ids:[28726],item:22797,label:'Nightmare Seed',cat:'other'},
  magicResistancePotion:{ids:[11364],item:9036,label:'Magic Resistance Potion',cat:'other'},
  mightyRagePotion:{ids:[17528],item:13442,label:'Mighty Rage Potion',cat:'pot'},
  madAlchemistsPotion:{ids:[45051],item:34440,label:"Mad Alchemist's Potion",cat:'pot'},
};
const CONSUMABLE_BUFF_LOOKUP = {};
for (const [,def] of Object.entries(CONSUMABLE_BUFF_IDS)) {
  for (const id of def.ids) CONSUMABLE_BUFF_LOOKUP[id] = {label:def.label,cat:def.cat,item:def.item};
}

const CONSUMABLE_CAST_IDS = {
  superManaPotion:{ids:[28499],item:22832,label:'Super Mana Potion',cat:'mana'},
  superHealingPotion:{ids:[28495],item:22829,label:'Super Healing Potion',cat:'health'},
  bottledNethergonEnergy:{ids:[41618],item:32902,label:'Bottled Nethergon Energy',cat:'mana'},
  bottledNethergonVapor:{ids:[41620],item:32905,label:'Bottled Nethergon Vapor',cat:'health'},
  cenarionManaSalve:{ids:[41617],item:32903,label:'Cenarion Mana Salve',cat:'mana'},
  cenarionHealingSalve:{ids:[41619],item:32904,label:'Cenarion Healing Salve',cat:'health'},
  darkRune:{ids:[20520,27869],item:20520,label:'Dark Rune',cat:'rune'},
  demonicRune:{ids:[16666],item:12662,label:'Demonic Rune',cat:'rune'},
  masterHealthstone:{ids:[27235,27236,27237],item:22105,label:'Master Healthstone',cat:'health'},
  // Mana Gems (Mage): teilen sich CD mit Healthstones → unter 'health' gezählt
  manaEmerald:{ids:[27103],item:22044,label:'Mana Emerald',cat:'health'},
  manaRuby:{ids:[10058],item:8008,label:'Mana Ruby',cat:'health'},
  heavyNetherweaveBandage:{ids:[27031],item:21991,label:'Heavy Netherweave Bandage',cat:'health'},
  netherweaveBandage:{ids:[27030],item:21990,label:'Netherweave Bandage',cat:'health'},
  thistleTea:{ids:[9512],item:7676,label:'Thistle Tea',cat:'other'},
  freeActionPotion:{ids:[6615],item:5634,label:'Free Action Potion',cat:'pot'},
  livingActionPotion:{ids:[24364],item:20008,label:'Living Action Potion',cat:'pot'},
  superSapperCharge:{ids:[30486],item:23827,label:'Super Sapper Charge',cat:'engi'},
  goblinSapperCharge:{ids:[13241],item:10646,label:'Goblin Sapper Charge',cat:'engi'},
  adamantiteGrenade:{ids:[30217],item:23737,label:'Adamantite Grenade',cat:'engi'},
  felIronBomb:{ids:[30216],item:23736,label:'Fel Iron Bomb',cat:'engi'},
  denseDynamite:{ids:[23063],item:18641,label:'Dense Dynamite',cat:'engi'},
  gnomishFlameturret:{ids:[30526],item:23841,label:'Gnomish Flame Turret',cat:'engi'},
  netherweaveNet:{ids:[31367],item:24268,label:'Netherweave Net',cat:'engi'},
};
const CONSUMABLE_CAST_LOOKUP = {};
const CONSUMABLE_CAST_FILTER_IDS = [];
for (const [,def] of Object.entries(CONSUMABLE_CAST_IDS)) {
  for (const id of def.ids) {
    CONSUMABLE_CAST_LOOKUP[id] = {label:def.label,cat:def.cat,item:def.item};
    CONSUMABLE_CAST_FILTER_IDS.push(id);
  }
}

// ── Major Cooldowns (≥2 min) für DPS/Tank/Heal Tracking ──
const MAJOR_COOLDOWNS = {
  // Warrior
  recklessness:      { ids:[1719],          name:'Recklessness',         role:'dps',  cd:1800 },
  deathWish:         { ids:[12292],         name:'Death Wish',           role:'dps',  cd:180  },
  shieldWall:        { ids:[871],           name:'Shield Wall',          role:'tank', cd:1800 },
  lastStand:         { ids:[12975],         name:'Last Stand',           role:'tank', cd:480  },
  // Rogue
  adrenalineRush:    { ids:[13750],         name:'Adrenaline Rush',      role:'dps',  cd:300  },
  bladeFlurry:       { ids:[13877],         name:'Blade Flurry',         role:'dps',  cd:120  },
  coldBlood:         { ids:[14177],         name:'Cold Blood',           role:'dps',  cd:180  },
  preparation:       { ids:[14185],         name:'Preparation',          role:'dps',  cd:600  },
  // Hunter
  bestialWrath:      { ids:[19574],         name:'Bestial Wrath',        role:'dps',  cd:120  },
  rapidFire:         { ids:[3045],          name:'Rapid Fire',           role:'dps',  cd:300  },
  readiness:         { ids:[23989],         name:'Readiness',            role:'dps',  cd:300  },
  // Mage
  combustion:        { ids:[11129],         name:'Combustion',           role:'dps',  cd:180  },
  arcanePower:       { ids:[12042],         name:'Arcane Power',         role:'dps',  cd:180  },
  icyVeins:          { ids:[12472],         name:'Icy Veins',            role:'dps',  cd:180  },
  presenceOfMind:    { ids:[12043],         name:'Presence of Mind',     role:'dps',  cd:180  },
  coldSnap:          { ids:[11958],         name:'Cold Snap',            role:'dps',  cd:600  },
  evocation:         { ids:[12051],         name:'Evocation',            role:'dps',  cd:480  },
  // Priest
  innerFocus:        { ids:[14751],         name:'Inner Focus',          role:'any',  cd:180  },
  shadowfiend:       { ids:[34433],         name:'Shadowfiend',          role:'any',  cd:300  },
  powerInfusion:     { ids:[10060],         name:'Power Infusion',       role:'any',  cd:120  },
  painSuppression:   { ids:[33206],         name:'Pain Suppression',     role:'heal', cd:120  },
  devouringPlague:   { ids:[2944,19276,19277,19278,19279,19280,25467], name:'Devouring Plague', role:'dps', cd:180 },
  // Paladin
  avengingWrath:     { ids:[31884],         name:'Avenging Wrath',       role:'any',  cd:180  },
  divineFavor:       { ids:[20216],         name:'Divine Favor',         role:'heal', cd:120  },
  layOnHands:        { ids:[633,2800,10310,27154], name:'Lay on Hands',  role:'heal', cd:2400 },
  divineShield:      { ids:[642],           name:'Divine Shield',        role:'tank', cd:300  },
  divineProtection:  { ids:[498,5573],      name:'Divine Protection',    role:'tank', cd:300  },
  // Druid
  forceOfNature:     { ids:[33831],         name:'Force of Nature',      role:'dps',  cd:180  },
  naturesSwiftness:  { ids:[17116],         name:"Nature's Swiftness",   role:'any',  cd:180  },
  innervate:         { ids:[29166],         name:'Innervate',            role:'heal', cd:360  },
  tranquility:       { ids:[740,8918,9862,9863,26983], name:'Tranquility', role:'heal', cd:480 },
  rebirth:           { ids:[20484,20739,20740,20741,20742,20747,20748,26994], name:'Rebirth', role:'heal', cd:1200 },
  frenziedRegen:     { ids:[22842,22895,22896,26999], name:'Frenzied Regeneration', role:'tank', cd:180 },
  // Shaman
  elementalMastery:  { ids:[16166],         name:'Elemental Mastery',    role:'dps',  cd:180  },
  shamanisticRage:   { ids:[30823],         name:'Shamanistic Rage',     role:'dps',  cd:120  },
  manaTide:          { ids:[16190,17355,17354,39609], name:'Mana Tide Totem', role:'heal', cd:300 },
  // Racials
  bloodFury:         { ids:[20572,33697,33702], name:'Blood Fury',       role:'any',  cd:120  },
  berserking:        { ids:[26297],         name:'Berserking',           role:'any',  cd:180  },
  // Fear Ward (Priest base + Dwarf/Draenei racial) — 3 min CD, single-target Fear-Immunity
  fearWard:          { ids:[6346],          name:'Fear Ward',            role:'any',  cd:180  },
};
const MAJOR_CD_LOOKUP = {};
const MAJOR_CD_FILTER_IDS = [];
for (const [key, def] of Object.entries(MAJOR_COOLDOWNS)) {
  for (const id of def.ids) {
    MAJOR_CD_LOOKUP[id] = { key, name: def.name, role: def.role, cd: def.cd };
    MAJOR_CD_FILTER_IDS.push(id);
  }
}

// Live-Ticker Subset: nur CDs zwischen 2 und 8 Minuten (das was per-fight gepoppt werden sollte)
const LIVE_CD_KEYS = Object.entries(MAJOR_COOLDOWNS)
  .filter(([, def]) => def.cd >= 120 && def.cd <= 480)
  .map(([key]) => key);
const LIVE_CD_LOOKUP = {};
const LIVE_CD_FILTER_IDS = [];
for (const key of LIVE_CD_KEYS) {
  const def = MAJOR_COOLDOWNS[key];
  for (const id of def.ids) {
    LIVE_CD_LOOKUP[id] = { key, name: def.name, role: def.role, cd: def.cd };
    LIVE_CD_FILTER_IDS.push(id);
  }
}
// Pro Klasse:Spec → erwartete CD-Keys aus MAJOR_COOLDOWNS (für Slacker-Detection im Live-Ticker)
const LIVE_CD_ROLE_EXPECTATIONS = {
  'Warrior:dps':         ['deathWish'],
  'Warrior:tank':        ['lastStand'],
  'Rogue:dps':           ['adrenalineRush', 'bladeFlurry', 'coldBlood'],
  'Hunter:dps':          ['bestialWrath', 'rapidFire', 'readiness'],
  'Mage:dps':            ['combustion', 'arcanePower', 'icyVeins', 'presenceOfMind', 'evocation'],
  // Priest Shadow: Inner Focus (Disc 15pt) + Shadowfiend (Shadow 25pt). Devouring Plague nur Undead-Racial → nicht für Alliance erwartet, ist bei Castern Bonus.
  'Priest:dps':          ['innerFocus', 'shadowfiend'],
  // Priest Heal: Holy/CoH-Builds haben kein PI/PainSup/Shadowfiend (Disc-deep). Nur Inner Focus aus 15pt-Disc.
  // Disc-Healer hätten PI+PainSup, sind aber selten — under-flag statt over-flag.
  'Priest:healer':       ['innerFocus'],
  'Paladin:retribution': ['avengingWrath'],
  'Paladin:healer':      ['avengingWrath', 'divineFavor'],
  // Paladin Tank: kein Divine Shield/Protection (Aggro-Loss durch Forbearance). Avenging Wrath OK für Threat.
  'Paladin:tank':        ['avengingWrath'],
  'Druid:balance':       ['forceOfNature', 'naturesSwiftness'],
  'Druid:healer':        ['innervate', 'tranquility', 'naturesSwiftness'],
  'Druid:feral':         ['frenziedRegen'],
  'Shaman:elemental':    ['elementalMastery', 'naturesSwiftness'],
  // Enhancement: Shamanistic Rage (Enh-deep), KEIN Elemental Mastery (Elem-deep talent)
  'Shaman:enhancement':  ['shamanisticRage'],
  'Shaman:healer':       ['manaTide', 'naturesSwiftness'],
  // Warlock + Druid:cat hat keine 2-8min DPS-CDs → nicht ausgewertet
};

// ── ON-USE Trinkets: Spell-ID → {itemId, name} ──
const ONUSE_TRINKETS = {
  35166: { item: 29383, name: 'Bloodlust Brooch' },
  35163: { item: 29370, name: 'Icon of the Silver Crescent' },
  33807: { item: 28288, name: 'Abacus of Violent Odds' },
  35165: { item: 29376, name: 'Essence of the Martyr' },
  38332: { item: 28590, name: 'Ribbon of Sacrifice' },
  35337: { item: 29179, name: "Xi'ri's Gift" },
  28780: { item: 23047, name: 'Eye of the Dead' },
  33479: { item: 27891, name: 'Adamantine Figurine' },
  34519: { item: 28528, name: "Moroes' Lucky Pocket Watch" },
  33089: { item: 27529, name: 'Figurine of the Colossus' },
  31047: { item: 24128, name: 'Figurine - Nightseye Panther' },
  32367: { item: 25634, name: "Oshu'gun Relic" },
  31771: { item: 24376, name: 'Runed Fungalcap' },
  29601: { item: 28727, name: 'Pendant of the Violet Eye' },
  31039: { item: 24125, name: 'Figurine - Dawnstone Crab' },
  37877: { item: 30841, name: 'Lower City Prayerbook' },
  39200: { item: 25937, name: 'Terokkar Tablet of Precision' },
  33667: { item: 28041, name: "Bladefist's Breadth" },
  46567: { item: 23836, name: 'Goblin Rocket Launcher' },
  34210: { item: 28370, name: 'Bangle of Endless Blessings' },
  31794: { item: 24390, name: "Auslese's Light Channeler" },
  42292: { item: 28234, name: 'Medallion of the Alliance' },
  40729: { item: 32658, name: 'Badge of Tenacity' },
  35352: { item: 29181, name: 'Timelapse Shard' },
  28779: { item: 23046, name: 'The Restrained Essence of Sapphiron' },
  35169: { item: 29387, name: 'Gnomeregan Auto-Blocker 600' },
  // Neck / Back / Trinket Use-Items aus TBC
  40402: { item: 30665, name: 'Earring of Soulful Meditation' },
  38325: { item: 30620, name: 'Spyglass of the Hidden Fleet' },
  38351: { item: 30629, name: 'Scarab of Displacement' },
  // JC-Figurinen (TBC 2.4) — alle BoP, alle Trinket-Slot
  46784: { item: 35702, name: 'Figurine - Shadowsong Panther' },
  46782: { item: 35694, name: 'Figurine - Khorium Boar' },
  46783: { item: 35700, name: 'Figurine - Crimson Serpent' },
  46780: { item: 35693, name: 'Figurine - Empyrean Tortoise' },
  46785: { item: 35703, name: 'Figurine - Seaspray Albatross' },
  // Weitere Use-Items
  34106: { item: 28121, name: 'Icon of Unyielding Courage' },
  40538: { item: 32534, name: 'Brooch of the Immortal King' },
  39228: { item: 27770, name: 'Argussian Compass' },
  31040: { item: 24126, name: 'Figurine - Living Ruby Serpent' },
  34000: { item: 28223, name: "Arcanist's Stone" },
  // Weitere JC-Figurinen (TBC 2.0+)
  31038: { item: 24124, name: 'Figurine - Felsteel Boar' },
  31045: { item: 24127, name: 'Figurine - Talasite Owl' },
  33400: { item: 27828, name: 'Warp-Scarab Brooch' },
  36432: { item: 30340, name: "Starkiller's Bauble" },
  36347: { item: 30293, name: 'Heavenly Inspiration' },
  36372: { item: 30300, name: "Dabiri's Enigma" },
  // Hinweis: Scryer's Bloodgem (29132) teilt spell 35337 mit Xi'ri's Gift (Aldor-Variante) — schon getrackt
  // Dawnstone Crab (24125 → 31039) und Nightseye Panther (24128 → 31047) sind bereits oben gelistet
};
const ONUSE_TRINKET_SPELL_IDS = Object.keys(ONUSE_TRINKETS).map(Number);
const ONUSE_TRINKET_ITEM_TO_SPELL = {};
for (const [spellId, def] of Object.entries(ONUSE_TRINKETS)) {
  ONUSE_TRINKET_ITEM_TO_SPELL[def.item] = Number(spellId);
}

const UNCUT_GEMS = [23112,23436,23077,23441,23440,23117,23438,23437,23107,23079,21929,23439,32227,32229,32228,32231,32249,32230];
// Meta gem activation check: returns true if active
// Requirements from CLA GearIssues.gs config
const META_GEM_IDS = new Set([
  25890,25893,25894,25895,25896,25897,25898,25899,25901,
  28556,28557,32409,32410,32640,32641,34220,35501,35503,
  41285,41307,41333,41335,41339,41376,41380,41389,41395,41396,41397,41398,41400,41401,
]);
function isMetaGemActive(metaId, r, y, b) {
  switch (metaId) {
    case 25896: return b > 2;                     // 3+ blue
    case 25897: return r > b;                     // more red than blue
    case 32409: case 25899: case 25901: case 25890: case 32410:
      return r > 1 && b > 1 && y > 1;            // 2+ each
    case 25898: return b > 4;                     // 5+ blue
    case 25893: case 32640: return b > y;         // more blue than yellow
    case 34220: return b > 1;                     // 2+ blue
    case 25895: return r > y;                     // more red than yellow
    case 25894: case 28556: case 28557: return r > 0 && y > 1; // 1+ red, 2+ yellow
    case 32641: return y > 2;                     // 3+ yellow
    case 35503: return r > 2;                     // 3+ red
    case 35501: return b > 1 && y > 0;            // 2+ blue, 1+ yellow
    default: return true;                         // unknown → assume active
  }
}
const RIDING_ITEMS = [25549,25550,28281,28282,28283,32453,32458,33000];
const SLOWFALL_ITEMS = [36942,38258];
const DW_CAPABLE_CLASSES = ['Warrior','Rogue','Hunter','Shaman'];
const OH_WEAPON_ICON_RE = /^inv_(sword|mace|axe|weapon|knife|hammer|hand|staff)_/;
const EXCLUDED_WEAPON_ITEMS = [19022,19970,25978,6365,12225,6367,6366,6256];
const EXCLUDED_TEMP_ENCHANTS = [4264,263,264,265,266];
const WF_TOTEM_TEMP_ENCHANTS = [2639,2638,2636];
const WF_BUFF_AURAS = [25584,25583];
const WF_ATTACK_DAMAGE_IDS = [25584,25583]; // Windfury Attack Damage-Proc Spell-IDs
const MELEE_CLASSES = ['Warrior','Rogue','Paladin'];
const CASTER_CLASSES = ['Mage','Warlock','Priest'];
const SPELL_HIT_ENCHANTS = [3002,2935];
const MELEE_HIT_ENCHANTS = [3003,2658];

// ─── WCL API Client with caching ───

function wclFetch(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          const err = new Error('RATE_LIMITED');
          err.body = body.substring(0, 300);
          err.retryAfter = parseInt(res.headers['retry-after'] || '0', 10);
          reject(err);
        } else if (res.statusCode >= 400) {
          reject(new Error(`WCL API ${res.statusCode}: ${body.substring(0, 200)}`));
        } else {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

// Queue for rate-limited API calls
let activeRequests = 0;
let lastRequestStartedAt = 0;
const requestQueue = [];

function enqueueRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  while (activeRequests < CONCURRENCY && requestQueue.length > 0) {
    const since = Date.now() - lastRequestStartedAt;
    if (since < MIN_REQUEST_INTERVAL_MS) {
      setTimeout(processQueue, MIN_REQUEST_INTERVAL_MS - since);
      return;
    }
    const { fn, resolve, reject } = requestQueue.shift();
    activeRequests++;
    lastRequestStartedAt = Date.now();
    fn().then(resolve, reject).finally(() => {
      activeRequests--;
      processQueue();
    });
  }
}

async function wclApi(apiPath, params = {}, { nocache = false } = {}) {
  const apiKey = cache.getSetting('apiKey');
  if (!apiKey) throw new Error('No API key configured');

  params.api_key = apiKey;
  const qs = new URLSearchParams(params).toString();
  const url = `${WCL_API_BASE}${apiPath}?${qs}`;

  // Cache key (without api_key)
  const cacheParams = new URLSearchParams(params);
  cacheParams.delete('api_key');
  cacheParams.sort();
  const key = cache.cacheKey(apiPath, cacheParams.toString());

  // Check cache (skip for live ticker)
  if (!nocache) {
    const cached = cache.getCached(key);
    if (cached) {
      const ttl = cache.getTTL(apiPath);
      const age = Date.now() - cached.fetched_at;
      if (age < ttl) return JSON.parse(cached.response_json);
    }
  }

  // Fetch with rate limit queue + auto-retry on 429
  let body;
  let attempts = 0;
  while (true) {
    try {
      body = await enqueueRequest(() => wclFetch(url));
      break;
    } catch (e) {
      if (e.message !== 'RATE_LIMITED' || attempts >= 5) throw e;
      attempts++;
      const retryAfterMs = (e.retryAfter || 0) * 1000;
      const waitMs = Math.max(retryAfterMs, 30000 * attempts);
      console.log(`[WCL] Rate limited (attempt ${attempts}) body="${e.body || ''}" retryAfter=${e.retryAfter}, waiting ${waitMs/1000}s...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  cache.putCache(key, body);
  return JSON.parse(body);
}

// ─── Helper functions ───

function classNameFromType(type) {
  if (typeof type === 'string' && VALID_CLASSES.includes(type)) return type;
  return CLA_DATA.classNames[type] || (typeof type === 'string' ? type : 'Unknown');
}

function isValidClass(type) {
  return VALID_CLASSES.includes(classNameFromType(type));
}

function getPlayersFromSummary(summary) {
  const pd = summary.playerDetails || {};
  const all = [...(pd.tanks || []), ...(pd.healers || []), ...(pd.dps || [])];
  return all.filter(p => isValidClass(p.type));
}

function getPlayerDetailMap(summary) {
  if (!summary) return {};
  const pd = summary.playerDetails || {};
  const map = {};
  for (const arr of [pd.tanks, pd.healers, pd.dps]) {
    if (!arr) continue;
    for (const p of arr) map[p.name] = p;
  }
  return map;
}

function getPlayerFightRole(summary, playerName, playerType) {
  if (!summary || !summary.playerDetails) return playerType + ':dps';
  const pd = summary.playerDetails;
  if (pd.tanks && pd.tanks.some(p => p.name === playerName)) return playerType + ':tank';
  if (pd.healers && pd.healers.some(p => p.name === playerName)) return playerType + ':healer';
  const detail = getPlayerDetailMap(summary)[playerName];
  const spec = detail?.specs?.join?.(',') || detail?.icon || '';
  // Hybrid-Klassen: nach Caster/Melee differenzieren
  if (playerType === 'Shaman') {
    if (/enhancement/i.test(spec)) return 'Shaman:enhancement';
    if (/elemental/i.test(spec)) return 'Shaman:elemental';
    return 'Shaman:healer';
  }
  if (playerType === 'Druid') {
    if (/balance|moonkin/i.test(spec)) return 'Druid:balance';
    if (/restoration|resto/i.test(spec)) return 'Druid:healer';
    if (/feral|bear|cat/i.test(spec)) return 'Druid:feral';
    return 'Druid:feral';
  }
  if (playerType === 'Paladin') {
    if (/retribution|ret/i.test(spec)) return 'Paladin:retribution';
    if (/holy/i.test(spec)) return 'Paladin:healer';
    if (/protection/i.test(spec)) return 'Paladin:tank';
    return 'Paladin:retribution';
  }
  return playerType + ':dps';
}

function getMissingScrolls(scrollEntries, roleKey) {
  const required = BUFF_IDS.scrollRequired[roleKey];
  if (!required || !required.length) return [];
  const haveStats = new Set();
  for (const s of scrollEntries) {
    const info = BUFF_IDS.scrollRanks[s.spellId];
    if (info) haveStats.add(info.stat);
  }
  return required.filter(stat => !haveStats.has(stat));
}

function formatScrollWithRank(spellId) {
  const info = BUFF_IDS.scrollRanks[spellId];
  if (!info) return { label: 'Unknown Scroll', isMaxRank: false };
  const best = BUFF_IDS.scrollBestRank[info.stat];
  return { label: `${info.stat} ${info.rank} (+${info.value})`, isMaxRank: spellId === best };
}

function detectWeaponEnhancement(playerDetail, playerType, auras) {
  const result = { isDW: false, mh: null, oh: null };
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
    if (playerType === 'Hunter') {
      if (mhEnh && WF_TOTEM_TEMP_ENCHANTS.some(id => mhEnh === TEMP_ENCHANT_NAMES[id])) mhEnh = null;
      if (ohEnh && WF_TOTEM_TEMP_ENCHANTS.some(id => ohEnh === TEMP_ENCHANT_NAMES[id])) ohEnh = null;
    }
    result.isDW = hasMH && hasOH && DW_CAPABLE_CLASSES.includes(playerType) && ohIsWeapon;
    result.mh = mhEnh;
    result.oh = ohEnh;
  }
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

function hasWeaponEnh(weResult) {
  if (weResult.isDW) return !!(weResult.mh && weResult.oh);
  return !!(weResult.mh || weResult.oh);
}

function formatWeaponEnh(weResult) {
  if (weResult.isDW) return { isDW: true, mh: weResult.mh, oh: weResult.oh };
  return weResult.mh || weResult.oh || null;
}

function getHunterPetMap(rData) {
  if (!rData || !rData.friendlyPets) return {};
  const friendMap = {};
  for (const f of (rData.friendlies || [])) friendMap[f.id] = f;
  const result = {};
  for (const p of rData.friendlyPets) {
    const owner = friendMap[p.petOwner];
    if (!owner || owner.type !== 'Hunter') continue;
    if (!result[owner.name]) result[owner.name] = [];
    if (!result[owner.name].some(x => x.petName === p.name)) {
      result[owner.name].push({ petId: p.id, petName: p.name });
    }
  }
  return result;
}

function getGemColors(gemId, icon) {
  return GEM_DB.getColorCounts(gemId, icon);
}

// ─── Gear Analysis ───

function checkPlayerGear(playerData, className) {
  const ciGear = (playerData.combatantInfo && playerData.combatantInfo.gear) || playerData.gear || [];
  const issues = [];
  const gear = {};
  for (let gi = 0; gi < ciGear.length; gi++) {
    const g = ciGear[gi];
    if (!g) continue;
    gear[g.slot !== undefined ? g.slot : gi] = g;
  }
  const mainHand = gear[15], offHand = gear[16];
  const isTwoHand = mainHand && mainHand.id && (!offHand || !offHand.id);

  let redCount = 0, yellowCount = 0, blueCount = 0, metaGemId = null;
  for (let slot = 0; slot < 18; slot++) {
    const item = gear[slot];
    if (!item || !item.id) continue;
    for (const gem of (item.gems || [])) {
      if (!gem || !gem.id) continue;
      if (slot === 0 && META_GEM_IDS.has(gem.id)) { metaGemId = gem.id; continue; }
      const colors = getGemColors(gem.id, gem.icon);
      redCount += colors.r; yellowCount += colors.y; blueCount += colors.b;
    }
  }

  for (let slot = 0; slot < 18; slot++) {
    if (slot === 3) continue;
    const item = gear[slot];
    const slotName = CLA_DATA.gearSlots[slot] || `Slot ${slot}`;
    if (!item || !item.id) {
      if (slot === 16 && isTwoHand) continue;
      issues.push({ slot: slotName, itemId: 0, issue: 'Leerer Slot', severity: 'high' });
      continue;
    }
    const iid = item.id;
    const isExcluded = CLA_GEAR.isExcludedItem(iid);

    for (const gem of (item.gems || [])) {
      if (gem && gem.id && UNCUT_GEMS.includes(gem.id))
        issues.push({ slot: slotName, itemId: iid, issue: 'Ungeschliffener Edelstein', severity: 'high' });
    }
    // Always check all gem qualities — frontend filters by settings
    for (const gem of (item.gems || [])) {
      if (!gem || !gem.id || META_GEM_IDS.has(gem.id)) continue;
      const ql = GEM_DB.getQuality(gem.id, gem.itemLevel);
      if (ql === 'uncommon' || ql === 'common' || ql === 'rare')
        issues.push({ slot: slotName, itemId: iid, gemId: gem.id, issue: `Gem: ${ql}`, severity: 'medium', gemQuality: ql });
    }
    const expectedSockets = CLA_SOCKETS[iid] || 0;
    const actualGems = (item.gems || []).filter(g => g && g.id).length;
    if (expectedSockets > 0 && actualGems < expectedSockets)
      issues.push({ slot: slotName, itemId: iid, issue: `${expectedSockets - actualGems} leere Sockel`, severity: 'high' });
    if (RIDING_ITEMS.includes(iid))
      issues.push({ slot: slotName, itemId: iid, issue: 'Reit-Ausruestung', severity: 'high' });
    if (SLOWFALL_ITEMS.includes(iid))
      issues.push({ slot: slotName, itemId: iid, issue: 'Slowfall-Ausruestung', severity: 'medium' });

    const enchantableSlots = [0,2,4,6,7,8,9,14,15,16];
    if (enchantableSlots.includes(slot) && !isExcluded) {
      if (slot === 16) {
        const icon = (item.icon || '');
        if (DW_CAPABLE_CLASSES.includes(className) && OH_WEAPON_ICON_RE.test(icon)) {
          if (!item.permanentEnchant)
            issues.push({ slot: slotName, itemId: iid, issue: 'Fehlende Verzauberung', severity: 'high' });
          else {
            // Check with vanillaEnchants=false to get ALL bad enchants; tag vanilla ones
            const badName = CLA_GEAR.isEnchantBad(item.permanentEnchant, slot, className, null);
            if (badName) {
              const entry = CLA_GEAR.badEnchants.find(e => e.id === item.permanentEnchant && (e.slot === undefined || e.slot === slot));
              issues.push({ slot: slotName, itemId: iid, issue: badName, severity: 'medium', isVanillaEnchant: entry && !entry.tbc });
            }
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
  if (metaGemId && META_GEM_IDS.has(metaGemId)) {
    const headItem = gear[0];
    if (!isMetaGemActive(metaGemId, redCount, yellowCount, blueCount)) {
      // Build human-readable requirement description
      const reqDesc = {
        25896: '3+ Blue', 25897: 'mehr Red als Blue', 25898: '5+ Blue',
        25893: 'mehr Blue als Yellow', 32640: 'mehr Blue als Yellow',
        25895: 'mehr Red als Yellow', 34220: '2+ Blue',
        32409: '2+ R/Y/B', 25899: '2+ R/Y/B', 25901: '2+ R/Y/B', 25890: '2+ R/Y/B', 32410: '2+ R/Y/B',
        25894: '1+ Red, 2+ Yellow', 28556: '1+ Red, 2+ Yellow', 28557: '1+ Red, 2+ Yellow',
        32641: '3+ Yellow', 35503: '3+ Red', 35501: '2+ Blue, 1+ Yellow',
      }[metaGemId] || '?';
      issues.push({ slot: 'Head', itemId: headItem ? headItem.id : 0, issue: `Meta-Gem nicht aktiviert (braucht ${reqDesc}, hat R:${redCount} Y:${yellowCount} B:${blueCount})`, severity: 'high', metaGemId: metaGemId });
    }
  }
  // Disconnect-Detection: alle Slots leer → klassische "ich war nicht im Combat-Log"-Situation
  const emptySlotIssues = issues.filter(i => i.issue === 'Leerer Slot');
  const hasGear = Object.values(gear).some(g => g && g.id);
  if (!hasGear || emptySlotIssues.length >= 14) {
    return [{ slot: 'Alle', itemId: 0, issue: 'Disconnect (alle Slots leer)', severity: 'high', disconnect: true }];
  }
  return issues;
}

// ─── Analysis functions ───

// Settings hash is fixed — preanalyzer computes ALL issues, frontend filters by settings
function settingsHash() {
  return 'all';
}

async function analyzeGear(reportCode, bossFights, reportStartTs) {
  const playerMap = {};
  const gearCaptured = new Set();
  for (let fi = 0; fi < bossFights.length; fi++) {
    const f = bossFights[fi];
    const summary = await wclApi(`/report/tables/summary/${reportCode}`, { start: f.start_time, end: f.end_time, translate: true });
    const players = getPlayersFromSummary(summary);
    for (const p of players) {
      const className = classNameFromType(p.type);
      if (!playerMap[p.name]) playerMap[p.name] = { className, type: p.type, issueMap: {}, metaInactiveCount: 0, fightCount: 0, perFight: [] };
      // Capture gear snapshot (first fight only per player)
      if (!gearCaptured.has(p.name) && p.combatantInfo && p.combatantInfo.gear && p.combatantInfo.gear.length) {
        cache.putGearSnapshot(reportCode, p.name, className, JSON.stringify(p.combatantInfo.gear), reportStartTs || 0);
        gearCaptured.add(p.name);
      }
      const pm = playerMap[p.name];
      pm.fightCount++;
      const fightIssues = checkPlayerGear(p, className);
      const metaIdx = fightIssues.findIndex(i => i.issue.startsWith('Meta-Gem nicht aktiviert'));
      if (metaIdx >= 0) { pm.metaInactiveCount++; pm.metaDetail = fightIssues[metaIdx].issue; pm.metaGemId = fightIssues[metaIdx].metaGemId; fightIssues.splice(metaIdx, 1); }
      // Store per-fight issues with role
      const role = getPlayerFightRole(summary, p.name, p.type);
      pm.perFight.push({ fi, role, issues: fightIssues });
      for (const iss of fightIssues) {
        const key = iss.slot + '|' + iss.issue;
        if (!pm.issueMap[key]) pm.issueMap[key] = iss;
      }
    }
  }
  const results = [];
  for (const [name, pm] of Object.entries(playerMap)) {
    const issues = Object.values(pm.issueMap);
    if (pm.metaInactiveCount > 0) {
      const detail = pm.metaDetail ? ` — ${pm.metaDetail.replace('Meta-Gem nicht aktiviert ', '')}` : '';
      issues.push({ slot: 'Head', issue: `Meta-Gem nicht aktiviert (${pm.metaInactiveCount}/${pm.fightCount} Fights)${detail}`, severity: 'high', metaGemId: pm.metaGemId || null });
    }
    results.push({ name, type: pm.type, issues, issueCount: issues.length, perFight: pm.perFight });
  }
  return { results, showAll: false };
}

// Fights to exclude from buff analysis (unreliable buff data due to RP/air phases)
const BUFF_EXCLUDE_FIGHTS = /^(Opera Hall|Nightbane)$/i;

async function analyzeBuffs(reportCode, bossFights, playerList, reportData) {
  const totalFights = bossFights.length;
  const totalPlayers = playerList.length;

  // Fetch summaries (skip excluded fights)
  const summaries = [];
  for (const f of bossFights) {
    if (BUFF_EXCLUDE_FIGHTS.test(f.name)) { summaries.push(null); continue; }
    summaries.push(await wclApi(`/report/tables/summary/${reportCode}`, { start: f.start_time, end: f.end_time, translate: true }));
  }

  // Fetch buff data per player per fight (skip excluded fights)
  const buffData = [];
  for (let fi = 0; fi < totalFights; fi++) {
    buffData[fi] = [];
    if (BUFF_EXCLUDE_FIGHTS.test(bossFights[fi].name)) {
      for (const player of playerList) buffData[fi].push(null);
      continue;
    }
    for (const player of playerList) {
      const resp = await wclApi(`/report/tables/buffs/${reportCode}`, {
        start: bossFights[fi].start_time, end: bossFights[fi].end_time, sourceid: player.id, translate: true
      }).catch(() => ({ auras: [] }));
      buffData[fi].push(resp);
    }
  }

  // Report-wide buff fetch pro Spieler — fängt Flasks/Elixiere ab, deren Apply-Event
  // außerhalb des Reports liegt (WCL liefert dann 0-Uptime-Snapshot-Bands).
  // Buff-Dauer: Flasks halten 2h, Elixiere 1h, Food 1h. Wenn ein Band existiert
  // dessen START innerhalb der Buff-Dauer vor Fight-Start liegt, gilt der Buff
  // als aktiv — egal ob WCL die band end zwischenzeitlich abgebrochen hat.
  const BUFF_DURATION_MS = {
    flask: 120 * 60 * 1000,
    battleElixir: 60 * 60 * 1000,
    guardianElixir: 60 * 60 * 1000,
    foodBuff: 60 * 60 * 1000,
  };
  const wideBuffs = [];
  for (const player of playerList) {
    const resp = await wclApi(`/report/tables/buffs/${reportCode}`, {
      start: 0, end: 9999999999, sourceid: player.id, translate: true
    }).catch(() => ({ auras: [] }));
    wideBuffs.push(resp.auras || []);
  }
  function findInferredAura(playerIdx, guidSet, fight, durationMs) {
    const auras = wideBuffs[playerIdx] || [];
    for (const a of auras) {
      if (!guidSet.has(a.guid)) continue;
      for (const band of (a.bands || [])) {
        // Match wenn Band-Start innerhalb der Buff-Dauer vor Fight-Ende liegt
        // UND Band-Start ≤ Fight-Ende (band beginnt nicht erst nach Fight)
        if (band.startTime <= fight.end_time && band.startTime + durationMs >= fight.start_time) {
          return { id: a.guid, name: a.name };
        }
      }
    }
    return null;
  }

  // Spielmechanik: Flask + Battle/Guardian Elixir sind mutually exclusive.
  // Ein neueres Elixir-Trinken cancelt die laufende Flask (und umgekehrt).
  // Daher pro Fight die jüngsten Band-Starts vergleichen, statt nur "irgendein
  // Band in den letzten 2h gilt als aktiv".
  function getLatestConsume(playerIdx, guidSet, fight, durationMs) {
    const auras = wideBuffs[playerIdx] || [];
    let best = null;
    for (const a of auras) {
      if (!guidSet.has(a.guid)) continue;
      for (const band of (a.bands || [])) {
        if (band.startTime > fight.end_time) continue;
        if (band.startTime + durationMs < fight.start_time) continue;
        if (!best || band.startTime > best.time) {
          best = { time: band.startTime, id: a.guid, name: a.name };
        }
      }
    }
    return best;
  }
  function inferFlaskElixirState(playerIdx, fight) {
    const f = getLatestConsume(playerIdx, BUFF_SETS.flask, fight, BUFF_DURATION_MS.flask);
    const b = getLatestConsume(playerIdx, BUFF_SETS.battleElixir, fight, BUFF_DURATION_MS.battleElixir);
    const g = getLatestConsume(playerIdx, BUFF_SETS.guardianElixir, fight, BUFF_DURATION_MS.guardianElixir);
    // Flask gewinnt nur wenn sie strikt neuer als beide Elixiere ist (kein Elixir hat sie gecancelt)
    if (f && (!b || f.time >= b.time) && (!g || f.time >= g.time)) {
      return { flask: { id: f.id, name: f.name }, battleElixir: null, guardianElixir: null };
    }
    // Sonst: Battle und Guardian individuell — jeweils nur wenn nach der letzten Flask (oder ohne Flask)
    const battle = b && (!f || b.time > f.time) ? { id: b.id, name: b.name } : null;
    const guardian = g && (!f || g.time > f.time) ? { id: g.id, name: g.name } : null;
    return { flask: null, battleElixir: battle, guardianElixir: guardian };
  }

  // Hunter melee-weave + Windfury-Detection (report-wide, 1 Call pro Hunter).
  // Wenn ein Hunter Windfury-Attack-Damage-Events hat, hat er melee geweaved
  // UND WF war aktiv → Weapon-Enhancement-Check wird übersprungen.
  const hunterWeavesWf = new Set();
  for (let pi = 0; pi < totalPlayers; pi++) {
    const player = playerList[pi];
    if (player.type !== 'Hunter') continue;
    try {
      const resp = await wclApi(`/report/tables/damage-done/${reportCode}`, {
        start: 0, end: 9999999999, sourceid: player.id, translate: true
      }, { nocache: true });
      const entries = resp.entries || [];
      if (entries.some(e => WF_ATTACK_DAMAGE_IDS.includes(e.guid) && (e.total || 0) > 0)) {
        hunterWeavesWf.add(player.name);
      }
    } catch (_) {}
  }

  const results = [];
  for (let pi = 0; pi < totalPlayers; pi++) {
    const player = playerList[pi];
    const playerResult = {
      name: player.name, type: player.type,
      flask: 0, battleElixir: 0, guardianElixir: 0, flaskOrElixir: 0,
      foodBuff: 0, scrolls: 0, weaponEnhancement: 0,
      playerFightCount: 0, fightDetails: []
    };
    for (let fi = 0; fi < totalFights; fi++) {
      // Skip excluded fights — push null to preserve index alignment with bossFights
      if (BUFF_EXCLUDE_FIGHTS.test(bossFights[fi].name)) { playerResult.fightDetails.push(null); continue; }
      const auras = (buffData[fi][pi] || {}).auras || [];
      if (!auras.length) { playerResult.fightDetails.push(null); continue; }
      playerResult.playerFightCount++;
      const fightDetail = { flask: null, battleElixir: null, guardianElixir: null, food: null, scrolls: [] };

      // Direkt-Auren aus Fight-Snapshot
      let directFlask = null, directBattle = null, directGuardian = null;
      for (const a of auras) {
        if (!directFlask && BUFF_SETS.flask.has(a.guid)) directFlask = { id: a.guid, name: a.name };
        if (!directBattle && BUFF_SETS.battleElixir.has(a.guid)) directBattle = { id: a.guid, name: a.name };
        if (!directGuardian && BUFF_SETS.guardianElixir.has(a.guid)) directGuardian = { id: a.guid, name: a.name };
      }
      // Konsum-Timeline aus Report-wide Bands — Elixir cancelt Flask und umgekehrt
      const stateInf = inferFlaskElixirState(pi, bossFights[fi]);
      // Direkt > Inferenz, aber Inferenz respektiert die Cancel-Mechanik
      const flask = directFlask || stateInf.flask;
      const battleElixir = (!flask && (directBattle || stateInf.battleElixir)) || null;
      const guardianElixir = (!flask && (directGuardian || stateInf.guardianElixir)) || null;
      fightDetail.flask = flask;
      fightDetail.battleElixir = battleElixir;
      fightDetail.guardianElixir = guardianElixir;
      if (flask) { playerResult.flask++; playerResult.flaskOrElixir++; }
      else {
        if (battleElixir) playerResult.battleElixir++;
        if (guardianElixir) playerResult.guardianElixir++;
        if (battleElixir && guardianElixir) playerResult.flaskOrElixir++;
      }
      for (const a of auras) { if (BUFF_SETS.foodBuff.has(a.guid)) { playerResult.foodBuff++; fightDetail.food = { id: a.guid, name: a.name }; break; } }
      if (!fightDetail.food) {
        const inf = findInferredAura(pi, BUFF_SETS.foodBuff, bossFights[fi], BUFF_DURATION_MS.foodBuff);
        if (inf) { playerResult.foodBuff++; fightDetail.food = inf; }
      }

      const scrollEntries = [];
      for (const a of auras) {
        if (BUFF_SETS.scrolls.has(a.guid)) {
          const ri = formatScrollWithRank(a.guid);
          scrollEntries.push({ label: ri.label, isMaxRank: ri.isMaxRank, spellId: a.guid });
        }
      }
      playerResult.scrolls += scrollEntries.length;
      if (scrollEntries.some(s => !s.isMaxRank)) playerResult.hasLowRankScrolls = true;
      fightDetail.scrolls = scrollEntries;

      const roleKey = getPlayerFightRole(summaries[fi], player.name, player.type);
      const missingScrolls = getMissingScrolls(scrollEntries, roleKey);
      fightDetail.missingScrolls = missingScrolls;
      fightDetail.roleKey = roleKey;
      if (missingScrolls.length) playerResult.hasMissingScrolls = true;

      const weDetail = getPlayerDetailMap(summaries[fi])[player.name];
      const weResult = detectWeaponEnhancement(weDetail, player.type, auras);
      // Hunter mit Melee-Weave + WF: WE-Check entfällt
      const isWeavingHunter = player.type === 'Hunter' && hunterWeavesWf.has(player.name);
      if (hasWeaponEnh(weResult) || isWeavingHunter) playerResult.weaponEnhancement++;
      fightDetail.weaponEnh = isWeavingHunter ? { wfWeave: true } : formatWeaponEnh(weResult);

      playerResult.fightDetails.push(fightDetail);
    }
    results.push(playerResult);
  }

  // Pet-Scrolls deaktiviert: WCL-Logs nicht zuverlässig genug
  return results;
}

async function analyzeConsumables(reportCode, bossFights, playerList) {
  const totalFights = bossFights.length;
  const totalPlayers = playerList.length;

  // Fetch buff data per player per fight
  const buffData = [];
  for (let fi = 0; fi < totalFights; fi++) {
    buffData[fi] = [];
    for (const player of playerList) {
      const resp = await wclApi(`/report/tables/buffs/${reportCode}`, {
        start: bossFights[fi].start_time, end: bossFights[fi].end_time, sourceid: player.id, translate: true
      }).catch(() => ({ auras: [] }));
      buffData[fi].push(resp);
    }
  }

  // Fetch cast events per fight via V2 GraphQL (V1 hat 600 req/hr IP-Limit)
  const castData = [];
  const filterStr = `ability.id IN (${CONSUMABLE_CAST_FILTER_IDS.join(',')})`;
  for (const f of bossFights) {
    const castMap = new Map();
    let events = [];
    try {
      events = await fetchCastEventsV2(reportCode, f.id, filterStr);
    } catch (e) {
      console.warn(`[v2] cast events failed for fight ${f.id}: ${e.message}`);
    }
    for (const ev of events) {
      const gid = ev.abilityGameID;
      if (!gid) continue;
      const info = CONSUMABLE_CAST_LOOKUP[gid];
      if (!info) continue;
      const sid = ev.sourceID;
      if (!castMap.has(sid)) castMap.set(sid, {});
      const pm = castMap.get(sid);
      pm[gid] = (pm[gid] || 0) + 1;
    }
    const result = new Map();
    for (const [sid, spells] of castMap) {
      const consumables = [];
      for (const [gid, count] of Object.entries(spells)) {
        const info = CONSUMABLE_CAST_LOOKUP[Number(gid)];
        if (info) consumables.push({ label: info.label, cat: info.cat, uses: count, itemId: info.item, spellId: Number(gid) });
      }
      result.set(sid, consumables);
    }
    castData.push(result);
  }

  const results = [];
  for (let pi = 0; pi < totalPlayers; pi++) {
    const player = playerList[pi];
    const playerResult = {
      name: player.name, type: player.type,
      potCount: 0, manaCount: 0, healthCount: 0, runeCount: 0, engiCount: 0, otherCount: 0,
      playerFightCount: 0, fightDetails: []
    };
    for (let fi = 0; fi < totalFights; fi++) {
      const auras = (buffData[fi][pi] || {}).auras || [];
      const castCons = castData[fi].get(player.id) || [];
      if (!auras.length && !castCons.length) { playerResult.fightDetails.push(null); continue; }
      playerResult.playerFightCount++;

      const consumables = [];
      for (const a of auras) {
        const info = CONSUMABLE_BUFF_LOOKUP[a.guid];
        if (info) consumables.push({ label: info.label, cat: info.cat, uses: a.totalUses || (a.bands && a.bands.length) || 1, itemId: info.item, spellId: a.guid });
      }
      for (const c of castCons) consumables.push(c);

      const counts = { potCount: 0, manaCount: 0, healthCount: 0, runeCount: 0, engiCount: 0, otherCount: 0 };
      for (const c of consumables) {
        if (c.cat === 'pot') counts.potCount += c.uses;
        else if (c.cat === 'mana') counts.manaCount += c.uses;
        else if (c.cat === 'health') counts.healthCount += c.uses;
        else if (c.cat === 'rune') counts.runeCount += c.uses;
        else if (c.cat === 'engi') counts.engiCount += c.uses;
        else counts.otherCount += c.uses;
      }
      for (const k of Object.keys(counts)) playerResult[k] += counts[k];
      playerResult.fightDetails.push({ consumables });
    }
    results.push(playerResult);
  }
  return results;
}

async function analyzeSpellRanks(reportCode, bossFights, playerList) {
  const { LOWER_RANK_SPELLS } = SPELL_RANKS;
  const playerIssues = {};
  const playerRoles = {}; // name -> Set of roles seen across fights
  for (const f of bossFights) {
    const summary = await wclApi(`/report/tables/summary/${reportCode}`, {
      start: f.start_time, end: f.end_time, translate: true
    }).catch(() => null);
    for (const player of playerList) {
      const role = getPlayerFightRole(summary, player.name, player.type);
      if (!playerRoles[player.name]) playerRoles[player.name] = new Set();
      playerRoles[player.name].add(role);

      const castsResp = await wclApi(`/report/tables/casts/${reportCode}`, {
        start: f.start_time, end: f.end_time, sourceid: player.id, translate: true
      }).catch(() => ({ entries: [] }));
      for (const entry of (castsResp.entries || [])) {
        const lowerInfo = LOWER_RANK_SPELLS[entry.guid];
        if (lowerInfo && entry.total > 0) {
          const key = player.name;
          if (!playerIssues[key]) playerIssues[key] = { type: player.type, issues: [] };
          playerIssues[key].issues.push({
            spellName: lowerInfo.name, spellId: entry.guid, maxId: lowerInfo.maxId,
            rank: lowerInfo.rank, maxRank: lowerInfo.maxRank,
            casts: entry.total, fightName: f.name, fightKill: f.kill,
          });
        }
      }
    }
  }
  // Tag players with their detected role(s)
  for (const [name, data] of Object.entries(playerIssues)) {
    const roles = playerRoles[name];
    data.isHealer = roles && (roles.has(data.type + ':healer') || roles.has('Shaman:healer'));
  }
  return playerIssues;
}

// ─── Damage Taken Analysis (includes healing received) ───

async function analyzeDamageTaken(reportCode, bossFights, playerList) {
  const results = [];
  const idToPlayer = new Map();
  for (const p of playerList) idToPlayer.set(p.id, { name: p.name, type: p.type });
  for (const f of bossFights) {
    const [dtResp, summary] = await Promise.all([
      wclApi(`/report/tables/damage-taken/${reportCode}`, {
        start: f.start_time, end: f.end_time, translate: true
      }).catch(() => ({ entries: [] })),
      wclApi(`/report/tables/summary/${reportCode}`, {
        start: f.start_time, end: f.end_time, translate: true
      }).catch(() => null),
    ]);
    const tankNames = new Set();
    if (summary && summary.playerDetails && summary.playerDetails.tanks) {
      for (const t of summary.playerDetails.tanks) tankNames.add(t.name);
    }
    const entries = (dtResp.entries || []).filter(e => isValidClass(e.type)).map(e => ({
      name: e.name, id: e.id, type: e.type, total: e.total || 0,
      isTank: tankNames.has(e.name),
    }));

    // Fetch healing received by aggregating healing events by targetID
    const healReceived = new Map();
    let nextPage = null;
    do {
      const params = { start: f.start_time, end: f.end_time, translate: true };
      if (nextPage) params.start = nextPage;
      const resp = await wclApi(`/report/events/healing/${reportCode}`, params).catch(() => ({ events: [] }));
      for (const ev of (resp.events || [])) {
        const tid = ev.targetID;
        if (!tid) continue;
        const player = idToPlayer.get(tid);
        if (!player) continue;
        if (!healReceived.has(player.name)) healReceived.set(player.name, { name: player.name, type: player.type, total: 0, isTank: tankNames.has(player.name) });
        healReceived.get(player.name).total += (ev.amount || 0);
      }
      nextPage = resp.nextPageTimestamp || null;
    } while (nextPage);

    results.push({
      fightId: f.id, fightName: f.name, kill: f.kill,
      duration: (f.end_time - f.start_time) / 1000,
      entries,
      healReceived: [...healReceived.values()],
    });
  }
  return results;
}

// ─── Avoidable Damage Analysis ───

const AVOIDABLE_DAMAGE_IDS = [
  3, // Falling
  30004, 30859, 30852, 33061, // Kara
  33671, 36240, // Gruul
  30631, 36449, 30129, // Mag
  37433, 37284, 360327, // SSC
  34190, 36731, 36721, 36970, 38572, 38653, // TK
  34229,34269,34270,34271,34272,34273,34274,34275,34276,34277,34278,34279,
  34280,34281,34282,34283,34284,34285,34286,34287,34288,34289,34314,34315,34316, // Flame Quills
  34342, 35383, // Kael
  31258, 31944, 31969, 31436, // MH
  40948, 40018, 40832, 41541, 41481, 40265, 40276, // BT
  42052, 46931, 46264, 45915, 45996, 45885, // SW
  28863, 28865, // Void Zone generic
];

const AVOIDABLE_DEBUFF_IDS = [
  35859, 37749, 27243, 31302, 31341, 41410, 41032, 45717,
];

async function analyzeAvoidable(reportCode, bossFights, playerList) {
  const results = [];
  const idToPlayer = new Map();
  for (const p of playerList) idToPlayer.set(p.id, { name: p.name, type: p.type });

  const dmgFilter = `ability.id IN (${AVOIDABLE_DAMAGE_IDS.join(',')})`;
  const debuffFilter = `ability.id IN (${AVOIDABLE_DEBUFF_IDS.join(',')})`;

  for (const f of bossFights) {
    // Fetch avoidable damage events
    const playerDmg = new Map(); // name → { name, type, abilities: { abilityName → { total, hits } } }
    let nextPage = null;
    do {
      const params = { start: f.start_time, end: f.end_time, filter: dmgFilter, translate: true };
      if (nextPage) params.start = nextPage;
      const resp = await wclApi(`/report/events/damage-taken/${reportCode}`, params).catch(() => ({ events: [] }));
      for (const ev of (resp.events || [])) {
        const tid = ev.targetID;
        if (!tid) continue;
        const player = idToPlayer.get(tid);
        if (!player) continue;
        const abilityName = (ev.ability && ev.ability.name) || `Spell ${ev.ability && ev.ability.guid || '?'}`;
        if (!playerDmg.has(player.name)) playerDmg.set(player.name, { name: player.name, type: player.type, abilities: {} });
        const pd = playerDmg.get(player.name);
        if (!pd.abilities[abilityName]) pd.abilities[abilityName] = { total: 0, hits: 0, resists: 0 };
        const dmg = (ev.amount || 0) + (ev.absorbed || 0);
        pd.abilities[abilityName].total += dmg;
        pd.abilities[abilityName].hits++;
        if (dmg === 0) pd.abilities[abilityName].resists++;
      }
      nextPage = resp.nextPageTimestamp || null;
    } while (nextPage);

    // Fetch avoidable debuffs
    const playerDebuffs = new Map();
    nextPage = null;
    do {
      const params = { start: f.start_time, end: f.end_time, filter: debuffFilter, translate: true };
      if (nextPage) params.start = nextPage;
      const resp = await wclApi(`/report/events/debuffs/${reportCode}`, params).catch(() => ({ events: [] }));
      for (const ev of (resp.events || [])) {
        if (ev.type !== 'applydebuff') continue;
        const tid = ev.targetID;
        if (!tid) continue;
        const player = idToPlayer.get(tid);
        if (!player) continue;
        const debuffName = (ev.ability && ev.ability.name) || `Spell ${ev.ability && ev.ability.guid || '?'}`;
        if (!playerDebuffs.has(player.name)) playerDebuffs.set(player.name, { name: player.name, type: player.type, debuffs: {} });
        const pd = playerDebuffs.get(player.name);
        if (!pd.debuffs[debuffName]) pd.debuffs[debuffName] = 0;
        pd.debuffs[debuffName]++;
      }
      nextPage = resp.nextPageTimestamp || null;
    } while (nextPage);

    // Merge into result
    const players = [];
    const allNames = new Set([...playerDmg.keys(), ...playerDebuffs.keys()]);
    for (const name of allNames) {
      const dmg = playerDmg.get(name);
      const deb = playerDebuffs.get(name);
      const type = (dmg && dmg.type) || (deb && deb.type) || 'Unknown';
      const totalDmg = dmg ? Object.values(dmg.abilities).reduce((s, a) => s + a.total, 0) : 0;
      players.push({
        name, type,
        totalDamage: totalDmg,
        abilities: dmg ? dmg.abilities : {},
        debuffs: deb ? deb.debuffs : {},
      });
    }
    players.sort((a, b) => b.totalDamage - a.totalDamage);

    results.push({ fightId: f.id, fightName: f.name, kill: f.kill, players });
  }
  return results;
}

// ─── Drums Analysis ───

const DRUM_SPELL_IDS = [35478, 35476, 35475, 351355, 351358, 351360];

async function analyzeDrums(reportCode, bossFights, playerList) {
  const results = [];
  const drumFilter = `ability.id IN (${DRUM_SPELL_IDS.join(',')})`;
  const idToPlayer = new Map();
  for (const p of playerList) idToPlayer.set(p.id, { name: p.name, type: p.type });
  for (const f of bossFights) {
    const playerDrums = new Map();
    let nextPage = null;
    do {
      const params = { start: f.start_time, end: f.end_time, filter: drumFilter, translate: true };
      if (nextPage) params.start = nextPage;
      const resp = await wclApi(`/report/events/casts/${reportCode}`, params).catch(() => ({ events: [] }));
      for (const ev of (resp.events || [])) {
        const sid = ev.sourceID;
        if (!sid) continue;
        const player = idToPlayer.get(sid);
        if (!player) continue;
        if (!playerDrums.has(player.name)) playerDrums.set(player.name, { name: player.name, type: player.type, count: 0 });
        playerDrums.get(player.name).count++;
      }
      nextPage = resp.nextPageTimestamp || null;
    } while (nextPage);
    results.push({ fightId: f.id, fightName: f.name, kill: f.kill, drums: [...playerDrums.values()] });
  }
  return results;
}

// ─── Damage & Healing Analysis ───

async function analyzeDamageHealing(reportCode, bossFights) {
  const results = [];
  for (const f of bossFights) {
    const [dmgResp, healResp] = await Promise.all([
      wclApi(`/report/tables/damage-done/${reportCode}`, {
        start: f.start_time, end: f.end_time, translate: true
      }).catch(() => ({ entries: [] })),
      wclApi(`/report/tables/healing/${reportCode}`, {
        start: f.start_time, end: f.end_time, translate: true
      }).catch(() => ({ entries: [] })),
    ]);
    const duration = (f.end_time - f.start_time) / 1000; // seconds
    const damage = (dmgResp.entries || []).filter(e => isValidClass(e.type)).map(e => ({
      name: e.name, id: e.id, type: e.type, total: e.total || 0,
      dps: duration > 0 ? Math.round((e.total || 0) / duration) : 0,
    }));
    const healing = (healResp.entries || []).filter(e => isValidClass(e.type)).map(e => ({
      name: e.name, id: e.id, type: e.type, total: e.total || 0,
      hps: duration > 0 ? Math.round((e.total || 0) / duration) : 0,
    }));
    results.push({ fightId: f.id, fightName: f.name, kill: f.kill, duration, damage, healing });
  }
  return results;
}

// ─── Deaths Analysis ───

async function analyzeDeaths(reportCode, bossFights) {
  const results = [];
  for (const f of bossFights) {
    const resp = await wclApi(`/report/tables/deaths/${reportCode}`, {
      start: f.start_time, end: f.end_time
    }).catch(() => ({ entries: [] }));
    // Each entry in deaths table is a single death event — group by player
    const playerDeaths = new Map();
    for (const e of (resp.entries || [])) {
      if (!e.name || !isValidClass(e.type)) continue;
      if (!playerDeaths.has(e.name)) playerDeaths.set(e.name, { name: e.name, id: e.id, type: e.type, deaths: 0 });
      playerDeaths.get(e.name).deaths++;
    }
    results.push({ fightId: f.id, fightName: f.name, kill: f.kill, deaths: [...playerDeaths.values()] });
  }
  return results;
}

// ─── Wipe Analysis (Tier 1 + 2 + 3) ───

// Boss-specific helpers: phase detection, mechanic checks
const BOSS_ENRAGE_SECONDS = {
  'Magtheridon': 21 * 60,
  'Gruul the Dragonkiller': 5 * 60,        // grow stacks make it effective 5min
  'Hydross the Unstable': 10 * 60,
  'The Lurker Below': 10 * 60,
  'Leotheras the Blind': 10 * 60,
  'Fathom-Lord Karathress': 10 * 60,
  'Morogrim Tidewalker': 10 * 60,
  'Lady Vashj': 10 * 60,
  "Al'ar": 10 * 60,
  'Void Reaver': 5 * 60,
  'High Astromancer Solarian': 5 * 60,
  "Kael'thas Sunstrider": 10 * 60,
};

// Spells/abilities die "avoidable" sind (Boden-AoE, frontale Cones etc.) — siehe CLA_DATA.zones
function isAvoidableAbility(abilityId) {
  const ids = (CLA_DATA && CLA_DATA.avoidableDamage) || {};
  return !!ids[abilityId];
}

// Wichtige Cooldowns für Wipe-Analyse — wer hat was wann gepoppt
const WIPE_CD_IDS = {
  bloodlust: [2825],
  heroism: [32182],
  innervate: [29166],
  manaTide: [16190],
  shadowfiend: [34433],
  powerInfusion: [10060],
  divineShield: [642],
  divineProtection: [498],
  layOnHands: [10310, 27154],
  iceBlock: [27619, 45438],
  shieldWall: [871],
  lastStand: [12975],
  manaPot: [17531, 28499, 33448, 43186, 11904],
  demonicRune: [12662],
  darkRune: [27869],
  drumsBattle: [35476],
  drumsRest: [35478],
  drumsSpeed: [35475],
  drumsWar: [35474],
  drumsPanic: [35772],
};
const ALL_CD_IDS = Object.values(WIPE_CD_IDS).flat();

// Erweiterte Wipe-Datensätze via v2 (Damage-Split, Healing, CDs, Tank-Death, Add-Lifetimes, Pre-Pull)
async function fetchExtendedWipeData(reportCode, fightId, fightStart, fightEnd, bossActorId, players, tanks, summonsEvents, deathEntries, enemiesById) {
  const cdFilter = `ability.id IN (${ALL_CD_IDS.join(',')})`;
  let data;
  try {
    data = await wclApiV2(`
      query($code:String!, $f:Int!, $bossId:Int!, $cdFilter:String!) {
        reportData { report(code:$code) {
          dmgBoss: table(dataType: DamageDone, fightIDs:[$f], targetID: $bossId, hostilityType: Friendlies)
          dmgTotal: table(dataType: DamageDone, fightIDs:[$f], hostilityType: Friendlies)
          heal: table(dataType: Healing, fightIDs:[$f], hostilityType: Friendlies)
          cdEvents: events(dataType: Casts, fightIDs:[$f], hostilityType: Friendlies, filterExpression: $cdFilter, limit: 500) { data }
          enemyDeaths: events(dataType: Deaths, fightIDs:[$f], hostilityType: Enemies, limit: 500) { data }
          allCasts: events(dataType: Casts, fightIDs:[$f], hostilityType: Friendlies, limit: 4000) { data nextPageTimestamp }
        }}}
    `, { code: reportCode, f: fightId, bossId: bossActorId || 0, cdFilter });
  } catch (e) {
    console.warn(`[v2] extended wipe data failed for fight ${fightId}: ${e.message}`);
    return null;
  }
  if (!data || !data.reportData || !data.reportData.report) return null;
  const report = data.reportData.report;
  const durationSec = (fightEnd - fightStart) / 1000;

  // === 1. DPS-Breakdown: Boss vs Adds ===
  const dmgBoss = (report.dmgBoss && report.dmgBoss.data) || {};
  const dmgTotal = (report.dmgTotal && report.dmgTotal.data) || {};
  const bossEntries = dmgBoss.entries || [];
  const totalEntries = dmgTotal.entries || [];
  const bossByName = new Map(bossEntries.map(e => [e.name, e.total || 0]));
  const dpsPerPlayer = totalEntries.map(e => {
    const boss = bossByName.get(e.name) || 0;
    const total = e.total || 0;
    const adds = Math.max(0, total - boss);
    return {
      name: e.name, type: e.type, total, boss, adds,
      addPct: total > 0 ? Math.round((adds / total) * 100) : 0,
      dps: durationSec > 0 ? Math.round(total / durationSec) : 0,
    };
  }).sort((a, b) => b.total - a.total);
  const totalDmg = dpsPerPlayer.reduce((s, p) => s + p.total, 0);
  const totalBoss = dpsPerPlayer.reduce((s, p) => s + p.boss, 0);
  const totalAdds = dpsPerPlayer.reduce((s, p) => s + p.adds, 0);
  const top5 = dpsPerPlayer.slice(0, 5).map(p => ({ name: p.name, dps: p.dps, addPct: p.addPct }));
  const bottom5 = dpsPerPlayer.filter(p => p.type !== 'Druid' && p.type !== 'Priest' && p.type !== 'Paladin').slice(-5).map(p => ({ name: p.name, type: p.type, dps: p.dps }));
  const topAddDPS = [...dpsPerPlayer].sort((a, b) => b.adds - a.adds).slice(0, 5).map(p => ({ name: p.name, adds: p.adds }));
  const ignoredAdds = dpsPerPlayer.filter(p => p.boss > 50000 && p.adds < 5000 && (p.type === 'Mage' || p.type === 'Warlock' || p.type === 'Hunter' || p.type === 'Rogue'))
    .map(p => ({ name: p.name, type: p.type, addDmg: p.adds, bossDmg: p.boss }));

  // === 2. Healing-Breakdown ===
  // WCL-Quirk: in healing table ist `total` = effective healing, `overheal` = zusätzlich verschwendet.
  // raw = effective + overheal. overhealPct = overheal / raw.
  const healData = (report.heal && report.heal.data) || {};
  const healEntries = (healData.entries || []).map(e => {
    const eff = e.total || 0;
    const overheal = e.overheal || 0;
    const raw = eff + overheal;
    return {
      name: e.name, type: e.type,
      effHeal: eff,
      overheal,
      overhealPct: raw > 0 ? Math.round((overheal / raw) * 100) : 0,
      hps: durationSec > 0 ? Math.round(eff / durationSec) : 0,
    };
  }).sort((a, b) => b.effHeal - a.effHeal);

  // === 3. CD-Usage ===
  const cdEvents = (report.cdEvents && report.cdEvents.data) || [];
  const playerNameById = new Map(players.map(p => [p.id, p.name]));
  const cdUsage = { used: {}, byPlayer: {} };
  for (const ev of cdEvents) {
    const ability = ev.abilityGameID;
    // Welcher CD-Typ ist das?
    let cdType = null;
    for (const [k, ids] of Object.entries(WIPE_CD_IDS)) {
      if (ids.includes(ability)) { cdType = k; break; }
    }
    if (!cdType) continue;
    const playerName = playerNameById.get(ev.sourceID) || `id${ev.sourceID}`;
    cdUsage.used[cdType] = (cdUsage.used[cdType] || 0) + 1;
    cdUsage.byPlayer[playerName] = cdUsage.byPlayer[playerName] || {};
    cdUsage.byPlayer[playerName][cdType] = (cdUsage.byPlayer[playerName][cdType] || 0) + 1;
    // Timeline für Bloodlust/Heroism wichtig
    if (cdType === 'bloodlust' || cdType === 'heroism') {
      cdUsage.bloodlustTime = ((ev.timestamp - fightStart) / 1000).toFixed(0);
    }
  }
  // Healer ohne Mana-Pot/Innervate/Shadowfiend = critical slacker (Healer-Filter aus playerList.role)
  const healerSlackers = [];
  for (const h of (players || []).filter(p => p.role === 'healer')) {
    const usage = cdUsage.byPlayer[h.name] || {};
    const hasManaCd = (usage.manaPot || 0) + (usage.innervate || 0) + (usage.shadowfiend || 0) + (usage.manaTide || 0) + (usage.demonicRune || 0) + (usage.darkRune || 0);
    if (hasManaCd === 0 && durationSec > 60) {
      healerSlackers.push({ name: h.name, type: h.type, durationSec: Math.round(durationSec) });
    }
  }

  // === 4. Add-Lifetimes ===
  const enemyDeaths = (report.enemyDeaths && report.enemyDeaths.data) || [];
  const enemyDeathById = new Map();
  for (const ev of enemyDeaths) {
    if (ev.targetID != null) enemyDeathById.set(ev.targetID, ev.timestamp);
  }
  const addLifetimes = [];
  const addsAlive = []; // [{spawnSec, name, lifetimeSec}]
  for (const sev of (summonsEvents || [])) {
    const spawnTime = sev.timestamp;
    const targetId = sev.targetID;
    const name = (sev.ability && sev.ability.name) || (enemiesById.get(targetId) || 'unknown');
    const deathTime = enemyDeathById.get(targetId);
    const lifetimeSec = deathTime ? ((deathTime - spawnTime) / 1000) : ((fightEnd - spawnTime) / 1000);
    addLifetimes.push({
      spawnSec: +((spawnTime - fightStart) / 1000).toFixed(1),
      deathSec: deathTime ? +((deathTime - fightStart) / 1000).toFixed(1) : null,
      lifetimeSec: +lifetimeSec.toFixed(1),
      name,
      killed: !!deathTime,
    });
  }
  // Max gleichzeitig lebende Adds
  let maxConcurrent = 0;
  if (addLifetimes.length) {
    const eventsT = [];
    for (const a of addLifetimes) {
      eventsT.push({ t: a.spawnSec, d: +1 });
      if (a.deathSec != null) eventsT.push({ t: a.deathSec, d: -1 });
    }
    eventsT.sort((a, b) => a.t - b.t || b.d - a.d);
    let cur = 0;
    for (const e of eventsT) { cur += e.d; if (cur > maxConcurrent) maxConcurrent = cur; }
  }

  // === 5. Tank-Death ===
  const tankInfo = { tankNames: (tanks || []).map(t => t.name), deaths: [] };
  if (tanks && tanks.length) {
    for (const tn of tanks) {
      const d = (deathEntries || []).find(e => e.name === tn.name);
      if (d) {
        tankInfo.deaths.push({ name: tn.name, atSec: +((d.timestamp - fightStart) / 1000).toFixed(1) });
      }
    }
  }
  if (tankInfo.deaths.length && tankInfo.deaths[0].atSec < durationSec * 0.5) {
    tankInfo.earlyTankDeath = tankInfo.deaths[0];  // critical signal
  }

  // === 6. Cancelled Casts ===
  // begincast-Events ohne matching cast (innerhalb 10s) = cancelled
  const allCasts = (report.allCasts && report.allCasts.data) || [];
  const cancelledByPlayer = {};
  const beginCasts = allCasts.filter(e => e.type === 'begincast');
  const completedCasts = allCasts.filter(e => e.type === 'cast');
  for (const bc of beginCasts) {
    const completed = completedCasts.find(cc =>
      cc.sourceID === bc.sourceID &&
      cc.abilityGameID === bc.abilityGameID &&
      cc.timestamp >= bc.timestamp &&
      cc.timestamp - bc.timestamp < 10000);
    if (!completed) {
      const pn = playerNameById.get(bc.sourceID) || `id${bc.sourceID}`;
      cancelledByPlayer[pn] = (cancelledByPlayer[pn] || 0) + 1;
    }
  }
  const topCancellers = Object.entries(cancelledByPlayer).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  return {
    dpsBreakdown: {
      totalRaidDmg: totalDmg,
      bossDmg: totalBoss,
      addsDmg: totalAdds,
      bossPct: totalDmg > 0 ? Math.round((totalBoss / totalDmg) * 100) : 0,
      addsPct: totalDmg > 0 ? Math.round((totalAdds / totalDmg) * 100) : 0,
      top5,
      bottom5,
      topAddDPS,
      ignoredAdds,
    },
    healingBreakdown: healEntries.slice(0, 10),
    cdUsage: { ...cdUsage, healerSlackers },
    addLifetimes: {
      total: addLifetimes.length,
      maxConcurrent,
      avgLifetimeSec: addLifetimes.length ? +(addLifetimes.reduce((s, a) => s + a.lifetimeSec, 0) / addLifetimes.length).toFixed(1) : 0,
      killedCount: addLifetimes.filter(a => a.killed).length,
      escapedCount: addLifetimes.filter(a => !a.killed).length,
      timeline: addLifetimes.slice(0, 30),
    },
    tankInfo,
    cancelledCasts: { totalCancelled: beginCasts.length - completedCasts.length, topCancellers },
  };
}

// Pre-Pull-Buffs: events vor fight-start
async function fetchPrePullBuffs(reportCode, fightStart, players) {
  if (!players || !players.length) return [];
  const startBefore = Math.max(0, fightStart - 30000); // 30s vor Pull
  try {
    const data = await wclApiV2(`
      query($code:String!, $st:Float!, $et:Float!) {
        reportData { report(code:$code) {
          events(dataType: Buffs, startTime: $st, endTime: $et, hostilityType: Friendlies, limit: 1000) { data }
        }}}
    `, { code: reportCode, st: startBefore, et: fightStart });
    if (!data || !data.reportData || !data.reportData.report) return [];
    const evs = (data.reportData.report.events && data.reportData.report.events.data) || [];
    // Map player → Set<abilityID> aktiv bei Pull
    const buffsAtPull = new Map();
    for (const p of players) buffsAtPull.set(p.id, new Set());
    for (const ev of evs) {
      if (!buffsAtPull.has(ev.targetID)) continue;
      if (ev.type === 'applybuff') buffsAtPull.get(ev.targetID).add(ev.abilityGameID);
      else if (ev.type === 'removebuff') buffsAtPull.get(ev.targetID).delete(ev.abilityGameID);
    }
    return players.map(p => ({
      name: p.name, type: p.type,
      buffCount: (buffsAtPull.get(p.id) || new Set()).size,
    }));
  } catch (e) {
    console.warn(`[v2] pre-pull buffs failed: ${e.message}`);
    return [];
  }
}

// Phasen-Daten: explizite Phase-Transitions via Boss-HP-Schwellen ableiten
function derivePhaseTransitions(bossHpCurve, bossName) {
  if (!bossHpCurve.length) return [];
  // Encounter-spezifische Phasen-Schwellen (Boss-HP%)
  const PHASE_THRESHOLDS = {
    "Hydross the Unstable": [{ pct: 75, label: 'Pure→Frost' }, { pct: 50, label: 'Frost→Pure' }, { pct: 25, label: 'Pure→Frost' }],
    "The Lurker Below": [],
    "Leotheras the Blind": [{ pct: 15, label: 'Frenzy' }], // Demon-Phase ist recurring (~60s alle 60s), kein HP-Trigger
    "Fathom-Lord Karathress": [],
    "Morogrim Tidewalker": [{ pct: 25, label: 'Murloc-Welle' }], // Murlocs spawnen bei 75/50/25, nur 25% deutlich
    "Lady Vashj": [{ pct: 70, label: 'P2 (Striders)' }, { pct: 30, label: 'P3 (Elementals)' }],
    "Al'ar": [{ pct: 50, label: 'P2 (Quill)' }, { pct: 25, label: 'Soft-Enrage' }],
    "Void Reaver": [],
    "High Astromancer Solarian": [{ pct: 20, label: 'Solarian splittet (3 Klone)' }],
    "Kael'thas Sunstrider": [{ pct: 100, label: 'P4 (Kael)' }, { pct: 50, label: 'P5 (Flight)' }],
  };
  const thresholds = PHASE_THRESHOLDS[bossName] || [];
  const phases = [];
  for (const t of thresholds) {
    // finde ersten Punkt wo Boss-HP unter pct fällt
    const idx = bossHpCurve.findIndex(p => p.val <= t.pct);
    if (idx >= 0) phases.push({ atSec: bossHpCurve[idx].sec, label: t.label, bossPct: t.pct });
  }
  return phases;
}

// Reduziert eine zeitlich sortierte Punkt-Liste auf einen Punkt pro N-Sekunden-Bucket (letzter Wert gewinnt).
function downsampleCurve(points, bucketSec = 1) {
  if (!points.length) return [];
  const buckets = new Map();
  for (const p of points) {
    const b = Math.floor(p.sec / bucketSec);
    buckets.set(b, p.val);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .map(([b, v]) => ({ sec: b * bucketSec, val: +Number(v).toFixed(1) }));
}

// Boss-HP-Kurve: WCL invertiert in damage-taken die source/target-Parameter — wer Schaden NIMMT, ist
// per `sourceid` zu filtern (siehe v1-API-Docs). hitPoints/maxHitPoints liefert die HP des Damage-Empfängers.
async function fetchBossHpCurve(reportCode, fightStart, fightEnd, bossActorId) {
  if (!bossActorId) return [];
  const resp = await wclApi(`/report/events/damage-taken/${reportCode}`, {
    start: fightStart, end: fightEnd, sourceid: bossActorId, hostility: 1
  }).catch(() => ({ events: [] }));
  const pts = [];
  for (const ev of (resp.events || [])) {
    if (ev.hitPoints == null || ev.maxHitPoints == null || ev.maxHitPoints === 0) continue;
    pts.push({ sec: (ev.timestamp - fightStart) / 1000, val: (ev.hitPoints / ev.maxHitPoints) * 100 });
  }
  return downsampleCurve(pts, 1);
}

// ── Boss-Mechanik-Datenbank: aus echten TBC-Classic-Fresh Log-Daten verifizierte Spell-IDs ──
// Format: pro Boss → { mechName: { ids:[...], type:'dispel'|'interrupt'|'avoid'|'tank', label:'...' } }
const BOSS_MECHANICS = {
  'Hydross the Unstable': {
    'Mark of Hydross': { ids: [38215, 38216, 38217, 38218], type: 'tank', label: 'Mark of Hydross (Tank-Mark, Aura-Cross)' },
    'Water Tomb': { ids: [38235], type: 'survive', label: 'Water Tomb (Stun — heilen)' },
    'Vile Sludge': { ids: [38246], type: 'cleanse', label: 'Vile Sludge (Heilreduktion — cleansebar)' },
  },
  'The Lurker Below': {
    'Scalding Water': { ids: [37284], type: 'avoid', label: 'Scalding Water (Spout-Spur)' },
    'Spout': { ids: [37433], type: 'avoid', label: 'Spout (Hauptstrahl)' },
  },
  'Morogrim Tidewalker': {
    'Watery Grave': { ids: [37850, 38023, 38024, 38025], type: 'survive', label: 'Watery Grave (Teleport + DoT — durchheilen)' },
    'Tidal Wave': { ids: [37730], type: 'avoid', label: 'Tidal Wave (Frontal AoE)' },
    'Earthquake': { ids: [37367], type: 'avoid', label: 'Earthquake (Murloc-Phase)' },
  },
  'Fathom-Lord Karathress': {
    'Cataclysmic Bolt': { ids: [38441], type: 'interrupt', label: 'Cataclysmic Bolt (1-Shot wenn nicht gekickt)' },
    'Leeching Throw': { ids: [29436], type: 'cleanse', label: 'Leeching Throw (Caribdis Heal-Steal)' },
    'Earthbind': { ids: [3600], type: 'avoid', label: 'Earthbind Totem' },
    'Frost Shock': { ids: [38234], type: 'avoid', label: 'Frost Shock (Tidalvess)' },
  },
  'Leotheras the Blind': {
    'Insidious Whisper': { ids: [37676], type: 'kill-demon', label: 'Insidious Whisper (Inner Demon spawnt)' },
    'Chaos Blast': { ids: [37675], type: 'interrupt', label: 'Chaos Blast (Demon-Form)' },
    'Whirlwind': { ids: [37641], type: 'avoid', label: 'Whirlwind (Melee weg!)' },
  },
  'Lady Vashj': {
    'Static Charge': { ids: [38280], type: 'avoid', label: 'Static Charge (raus aus Raid!)' },
    'Entangle': { ids: [38316], type: 'survive', label: 'Entangle (Root)' },
    'Persuasion': { ids: [38511], type: 'dispel', label: 'Persuasion (Mind Control)' },
    'Shock Blast': { ids: [38509], type: 'survive', label: 'Shock Blast (random AoE)' },
    'Poison Bolt': { ids: [38253], type: 'cleanse', label: 'Poison Bolt (Coilfang Strider)' },
  },
  "Al'ar": {
    'Flame Buffet': { ids: [34121], type: 'tank', label: 'Flame Buffet (Tank-Stack-Debuff)' },
    'Melt Armor': { ids: [35410], type: 'tank', label: 'Melt Armor (Tank-Swap)' },
    'Flame Patch': { ids: [35383], type: 'avoid', label: 'Flame Patch (Ground-AoE)' },
  },
  'Void Reaver': {
    'Arcane Orb': { ids: [34190], type: 'avoid', label: 'Arcane Orb (Spread!)' },
    'Pounding': { ids: [34163], type: 'survive', label: 'Pounding (Knockback AoE)' },
  },
  'High Astromancer Solarian': {
    'Wrath of the Astromancer': { ids: [42783], type: 'survive', label: 'Wrath of the Astromancer (Bombe — spread positioning, läuft natürlich aus)' },
    'Psychic Scream': { ids: [34322], type: 'avoid', label: 'Psychic Scream (Priest-Add)' },
  },
  "Kael'thas Sunstrider": {
    'Pyroblast': { ids: [36819, 36971], type: 'interrupt', label: 'Pyroblast (Capernian, KICK!)' },
    'Bellowing Roar': { ids: [44863], type: 'survive', label: 'Bellowing Roar (Sanguinar Fear)' },
    'Mind Control': { ids: [36797], type: 'dispel', label: 'Mind Control (Capernian)' },
    'Gravity Lapse': { ids: [39432, 34480], type: 'survive', label: 'Gravity Lapse (P4 Mechanic)' },
    'Conflagration': { ids: [37018], type: 'avoid', label: 'Conflagration (Capernian)' },
    'Flame Strike': { ids: [36731], type: 'avoid', label: 'Flame Strike' },
    'Remote Toy': { ids: [37027], type: 'survive', label: 'Remote Toy (Telonicus)' },
    'Nether Vapor': { ids: [35859], type: 'avoid', label: 'Nether Vapor (P5)' },
  },
};

// Helper: Base-Name extrahieren — collapse "X 1", "X 2", "X 12", "X12", "X0" → "X"
function baseAddName(name) {
  return (name || '').replace(/\s*\d+$/, '').trim();
}

// Add-HP-Kurven: pro Instanz eine eigene HP-Kurve (via WCL `targetInstance` Feld). Pro Base-Actor wird EIN
// damage-taken-Event-Stream geholt und lokal per Instance gesplittet.
async function fetchAddHpCurves(reportCode, fightStart, fightEnd, addActors, bossActorId) {
  const PET_RX = /^environment$|water elemental|earth elemental|fire elemental|infernal|treant|gargoyle|imp|voidwalker|felguard|succubus|felhunter|wolf|cat|bear|raptor|spider|owl|boar|pet|totem|spirit/i;
  // Dedupe pro Base-Name (es kann pro Add-Typ nur EINEN actor.id geben — WCL kollabiert)
  const baseToActor = new Map();
  for (const a of (addActors || [])) {
    if (a.id === bossActorId) continue;
    if (PET_RX.test(a.name)) continue;
    const base = baseAddName(a.name);
    if (!baseToActor.has(base)) baseToActor.set(base, a);
  }
  if (!baseToActor.size) return {};
  // CC-Spell-IDs (Banish/Hibernate/Polymorph/Fear/Shackle/Cyclone etc.)
  const CC_ABILITY_IDS = [
    // Banish
    710, 18647, 27559,
    // Hibernate
    2637, 18657, 18658,
    // Polymorph (alle Ranks + Skins)
    118, 12824, 12825, 12826, 28272, 28271, 51514,
    // Fear (Warlock)
    5782, 6213, 6215,
    // Seduction (Succubus)
    6358,
    // Psychic Scream (Priest)
    8122, 8124, 10888, 10890,
    // Shackle Undead (Priest)
    9484, 9485, 10955,
    // Cyclone (Druid)
    33786,
    // Repentance (Paladin)
    20066, 20188, 20189, 20190, 20191, 20192,
    // Mind Control (Priest)
    605, 10911, 10912,
  ];
  // Parallel pro Add-Typ DREI Queries:
  // 1) damage-taken sourceid=X hostility=1 → HP-Kurve via targetInstance
  // 2) damage-done sourceid=X hostility=1 → alle Instanzen die jemals Schaden machten
  // 3) casts (gefiltert auf CC-IDs) targetid=X → wer wurde gebanished/CCed
  const ccFilter = `ability.id IN (${CC_ABILITY_IDS.join(',')})`;
  const results = await Promise.all([...baseToActor.entries()].map(async ([baseName, a]) => {
    const [hpResp, dmgResp, ccResp] = await Promise.all([
      wclApi(`/report/events/damage-taken/${reportCode}`, {
        start: fightStart, end: fightEnd, sourceid: a.id, hostility: 1
      }).catch(() => ({ events: [] })),
      wclApi(`/report/events/damage-done/${reportCode}`, {
        start: fightStart, end: fightEnd, sourceid: a.id, hostility: 1
      }).catch(() => ({ events: [] })),
      wclApi(`/report/events/casts/${reportCode}`, {
        start: fightStart, end: fightEnd, targetid: a.id, filter: ccFilter
      }).catch(() => ({ events: [] })),
    ]);
    // CC-Map: pro instance die ersten 3 CC-casts mit sourceID und ability
    const ccByInstance = new Map();
    for (const ev of (ccResp.events || [])) {
      if (ev.type !== 'cast') continue;
      const inst = ev.targetInstance || 1;
      if (!ccByInstance.has(inst)) ccByInstance.set(inst, []);
      ccByInstance.get(inst).push({
        sec: (ev.timestamp - fightStart) / 1000,
        abilityID: ev.abilityGameID,
        sourceID: ev.sourceID,
      });
    }
    // (1) HP-Kurven aus damage-taken (gefiltert auf den Add) → per targetInstance
    const hpByInstance = new Map();
    for (const ev of (hpResp.events || [])) {
      if (ev.hitPoints == null || ev.maxHitPoints == null || ev.maxHitPoints === 0) continue;
      const inst = ev.targetInstance || 1;
      if (!hpByInstance.has(inst)) hpByInstance.set(inst, []);
      hpByInstance.get(inst).push({ sec: (ev.timestamp - fightStart) / 1000, val: (ev.hitPoints / ev.maxHitPoints) * 100 });
    }
    // (2) Alle Instanzen die Schaden gemacht haben → per sourceInstance. Erstes-Hit-Timestamp = Spawn-Zeit-Schätzung.
    const firstAttackByInstance = new Map();
    for (const ev of (dmgResp.events || [])) {
      const inst = ev.sourceInstance || 1;
      const t = (ev.timestamp - fightStart) / 1000;
      if (!firstAttackByInstance.has(inst) || t < firstAttackByInstance.get(inst)) {
        firstAttackByInstance.set(inst, t);
      }
    }
    // Vereinige beide Quellen
    const allInstances = new Set([...hpByInstance.keys(), ...firstAttackByInstance.keys()]);
    const instances = [];
    for (const inst of allInstances) {
      const pts = (hpByInstance.get(inst) || []).sort((x, y) => x.sec - y.sec);
      const firstAttack = firstAttackByInstance.get(inst);
      let curve = [], spawnSec, deathSec, lifetimeSec, untouched = false, barelyHit = false;
      if (pts.length >= 2) {
        curve = downsampleCurve(pts, 1);
        spawnSec = +curve[0].sec.toFixed(1);
        deathSec = +curve[curve.length - 1].sec.toFixed(1);
        lifetimeSec = +(deathSec - spawnSec).toFixed(1);
      } else if (pts.length === 1) {
        // Genau 1 Damage-Event — Raid hat sie kaum getroffen (Streif-AoE). Zeig den 1 Punkt.
        const p = pts[0];
        curve = [{ sec: +p.sec.toFixed(1), val: +p.val.toFixed(1) }];
        spawnSec = firstAttack != null ? +Math.min(firstAttack, p.sec).toFixed(1) : +p.sec.toFixed(1);
        deathSec = +((fightEnd - fightStart) / 1000).toFixed(1);
        lifetimeSec = +(deathSec - spawnSec).toFixed(1);
        barelyHit = true;
      } else if (firstAttack != null) {
        // Instanz hat attackiert aber wurde nie gedps't
        spawnSec = +firstAttack.toFixed(1);
        deathSec = +((fightEnd - fightStart) / 1000).toFixed(1);
        lifetimeSec = +(deathSec - spawnSec).toFixed(1);
        untouched = true;
      } else {
        continue;
      }
      // CC-Status (Banish/Hibernate) → "untouched" ist gut wenn CC angewendet wurde
      const ccs = ccByInstance.get(inst) || [];
      const ccCount = ccs.length;
      instances.push({
        instance: `${baseName} ${inst}`,
        spawnSec, deathSec, lifetimeSec,
        curve,
        untouched, // 0 Damage-Events
        barelyHit, // genau 1 Event (Streif-AoE)
        cc: ccCount, // Anzahl CC-Casts
        ccBy: ccs.length ? ccs[0].sourceID : null,
        ccAbility: ccs.length ? ccs[0].abilityID : null,
      });
    }
    return { baseName, instances };
  }));
  // Filter Trash-Mass-Adds (>15 Instanzen pro Typ) + sortieren nach Spawn
  const grouped = {};
  for (const r of results) {
    if (!r.instances.length) continue;
    if (r.instances.length > 15) continue; // Mass-AoE-Trash
    grouped[r.baseName] = r.instances.sort((a, b) => a.spawnSec - b.spawnSec);
  }
  return grouped;
}

// Healer-Mana-Kurven via WCL v2 GraphQL (events Casts mit includeResources=true).
// Jeder Cast-Event liefert classResources[0] mit Mana-Stand des Casters. Da Healer mehrmals pro Sekunde
// casten, bekommen wir eine dichte Mana-Kurve ohne separate Resources-View.
// Fallback: leer wenn v2-Credentials fehlen (graceful degradation).
async function fetchHealerManaCurves(reportCode, fightStart, fightEnd, healers, fightId) {
  const out = {};
  if (!healers.length || fightId == null) return out;
  // Pro Healer einzelner GraphQL-Request (v2 erlaubt eine sourceID pro events-Query)
  const results = await Promise.all(healers.slice(0, 8).map(async h => {
    if (h.id == null) return { name: h.name, points: [] };
    try {
      const data = await wclApiV2(`
        query($code:String!, $f:Int!, $h:Int!) {
          reportData { report(code:$code) {
            events(dataType: Casts, fightIDs: [$f], sourceID: $h, hostilityType: Friendlies, includeResources: true, limit: 1000) {
              data
              nextPageTimestamp
            }
          }}
        }
      `, { code: reportCode, f: fightId, h: h.id });
      if (!data || !data.reportData || !data.reportData.report) return { name: h.name, points: [] };
      const events = (data.reportData.report.events && data.reportData.report.events.data) || [];
      const pts = [];
      for (const ev of events) {
        if (ev.type !== 'cast') continue;
        const cr = ev.classResources && ev.classResources[0];
        if (!cr) continue;
        // WCL TBC Classic Fresh: amount=max-mana, type=current-mana (verifiziert mit echten Daten).
        // resourceChangeType auf den Casts hat keine relevanz hier, classResources reicht.
        const cur = cr.type;
        const max = cr.amount;
        if (cur == null || max == null || max === 0) continue;
        pts.push({ sec: (ev.timestamp - fightStart) / 1000, val: (cur / max) * 100 });
      }
      return { name: h.name, points: downsampleCurve(pts, 2) };
    } catch (e) {
      console.warn(`[v2] mana curve for ${h.name} failed:`, e.message);
      return { name: h.name, points: [] };
    }
  }));
  for (const r of results) {
    if (r.points.length) out[r.name] = r.points;
  }
  return out;
}

// Raid-Durchschnitts-HP: tracke pro Spieler letzten bekannten HP-Stand aus damage-taken + healing Events.
async function fetchRaidHpCurve(reportCode, fightStart, fightEnd, players) {
  if (!players.length) return [];
  const playerIds = new Set(players.map(p => p.id));
  const [dmg, heal] = await Promise.all([
    wclApi(`/report/events/damage-taken/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 0 }).catch(() => ({ events: [] })),
    wclApi(`/report/events/healing/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 0 }).catch(() => ({ events: [] })),
  ]);
  // Merge + sort by timestamp
  const events = [];
  for (const ev of (dmg.events || [])) {
    if (!playerIds.has(ev.targetID)) continue;
    if (ev.hitPoints == null || ev.maxHitPoints == null) continue;
    events.push({ ts: ev.timestamp, id: ev.targetID, hp: ev.hitPoints, max: ev.maxHitPoints });
  }
  for (const ev of (heal.events || [])) {
    if (!playerIds.has(ev.targetID)) continue;
    if (ev.hitPoints == null || ev.maxHitPoints == null) continue;
    events.push({ ts: ev.timestamp, id: ev.targetID, hp: ev.hitPoints, max: ev.maxHitPoints });
  }
  events.sort((a, b) => a.ts - b.ts);
  // State: id → {hp, max}. Default: 100% bis erstes Event.
  const state = new Map();
  for (const id of playerIds) state.set(id, null);
  const buckets = new Map();
  for (const ev of events) {
    state.set(ev.id, { hp: ev.hp, max: ev.max });
    let sum = 0, n = 0;
    for (const [, s] of state) {
      if (s && s.max > 0) { sum += s.hp / s.max; n++; }
      else if (!s) { sum += 1; n++; } // unbekannt = 100%
    }
    const sec = Math.floor((ev.ts - fightStart) / 1000);
    buckets.set(sec, (sum / n) * 100);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => ({ sec: s, val: +v.toFixed(1) }));
}

async function analyzeWipeForFight(reportCode, f, playerList) {
  const fightStart = f.start_time;
    const fightEnd = f.end_time;
    const durationSec = (fightEnd - fightStart) / 1000;

    // === Wipe-only Daten parallel ziehen (interrupts/dispels/summons/begincast/enemies/enemyDeaths) ===
    const [deathsResp, interruptsResp, dispelsResp, summonsResp, begincastResp, summaryResp, enemyDeathsRaw] = await Promise.all([
      wclApi(`/report/tables/deaths/${reportCode}`, { start: fightStart, end: fightEnd }).catch(() => ({ entries: [] })),
      wclApi(`/report/events/interrupts/${reportCode}`, { start: fightStart, end: fightEnd }).catch(() => ({ events: [] })),
      wclApi(`/report/events/dispels/${reportCode}`, { start: fightStart, end: fightEnd }).catch(() => ({ events: [] })),
      wclApi(`/report/events/summons/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 1 }).catch(() => ({ events: [] })),
      wclApi(`/report/events/casts/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 1 }).catch(() => ({ events: [] })),
      wclApi(`/report/tables/summary/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 1 }).catch(() => ({ enemies: [] })),
      wclApi(`/report/tables/deaths/${reportCode}`, { start: fightStart, end: fightEnd, hostility: 1 }).catch(() => ({ entries: [] })),
    ]);
    // Pro Enemy zählen wie oft Actor mit diesem Namen gestorben ist (Adds) + Actor-IDs sammeln.
    // Wichtig: enemyActors enthält BEIDE — Adds die starben UND Adds die überlebten (aus summaryResp).
    const PLAYER_TYPES = new Set(['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid','DeathKnight']);
    const enemyDeathsByName = new Map();
    const enemyActorById = new Map(); // id → {id, name}
    for (const ed of (enemyDeathsRaw.entries || [])) {
      const n = ed.name || '';
      if (!n) continue;
      enemyDeathsByName.set(n, (enemyDeathsByName.get(n) || 0) + 1);
      if (ed.id != null) enemyActorById.set(ed.id, { id: ed.id, name: n });
    }
    // WCL v1 summary kollabiert Add-Instanzen zu EINER Zeile (z.B. "Tainted Spawn of Hydross" 1 Eintrag statt 4).
    // Für individuelle Add-HP-Kurven brauchen wir alle Actor-IDs einzeln — v2 masterData liefert das.
    const NPC_TYPES = new Set(['Boss', 'NPC']);
    // v2-Call für masterData (gibt alle Actors mit IDs+Namen pro Report, fight-unabhängig)
    let v2Actors = null;
    try {
      const md = await wclApiV2(`
        query($code:String!) {
          reportData { report(code:$code) {
            masterData { actors(type: "NPC") { id name gameID subType } }
          }}}
      `, { code: reportCode });
      v2Actors = md && md.reportData && md.reportData.report && md.reportData.report.masterData && md.reportData.report.masterData.actors;
    } catch (e) { console.warn('[v2] masterData failed:', e.message); }
    if (v2Actors) {
      // Filtere auf NPC-Aktor-IDs die im Fight aktiv waren — Heuristik: jeder mit Name aus enemyDeathsByName-Base oder summaryResp.damageDone-Base
      const activeBaseNames = new Set();
      for (const n of enemyDeathsByName.keys()) activeBaseNames.add(n.replace(/\s*\d+$/, '').trim());
      for (const a of (summaryResp.damageDone || [])) {
        if (NPC_TYPES.has(a.type)) activeBaseNames.add((a.name || '').replace(/\s*\d+$/, '').trim());
      }
      for (const a of v2Actors) {
        if (a.id == null || !a.name) continue;
        if (a.subType && /Pet|Totem/i.test(a.subType)) continue;
        const base = (a.name || '').replace(/\s*\d+$/, '').trim();
        if (!activeBaseNames.has(base)) continue;
        if (!enemyActorById.has(a.id)) enemyActorById.set(a.id, { id: a.id, name: a.name });
      }
    } else {
      // Fallback: aus damageDone (collapsed)
      for (const a of (summaryResp.damageDone || [])) {
        if (a.id == null || !a.name) continue;
        if (!NPC_TYPES.has(a.type)) continue;
        if (!enemyActorById.has(a.id)) enemyActorById.set(a.id, { id: a.id, name: a.name });
      }
    }
    const enemyActors = [...enemyActorById.values()];

    // Summary-Response: composition=Spieler mit role, damageDone=alle Actors (inkl. Boss+Adds als type=Boss/NPC).
    // Wir bauen enemiesById aus damageDone+damageTaken (alles was nicht "Player"-Klasse ist).
    const enemiesById = new Map();
    const collectFromActors = arr => {
      for (const a of (arr || [])) {
        if (a.id == null) continue;
        if (PLAYER_TYPES.has(a.type)) continue; // Player skippen
        if (a.type === 'Pet') continue;
        enemiesById.set(a.id, a.name || '?');
      }
    };
    collectFromActors(summaryResp.damageDone);
    collectFromActors(summaryResp.damageTaken);
    // Boss-Actor-ID: type='Boss' und Name **exakt** = fight.name (sonst matchen Adds wie "Pure Spawn of Hydross")
    let bossActorId = null;
    const fightNameLc = (f.name || '').toLowerCase();
    const checkBoss = (arr) => {
      for (const a of (arr || [])) {
        if (a.type !== 'Boss') continue;
        if ((a.name || '').toLowerCase() === fightNameLc) return a.id;
      }
      return null;
    };
    bossActorId = checkBoss(summaryResp.damageTaken) || checkBoss(summaryResp.damageDone);
    // Fallback: type='Boss' Actor mit dem höchsten erlittenen Schaden (vermutlich der echte Boss)
    if (!bossActorId) {
      let bestDmg = -1;
      for (const a of (summaryResp.damageTaken || [])) {
        if (a.type !== 'Boss') continue;
        if ((a.total || 0) > bestDmg) { bestDmg = a.total || 0; bossActorId = a.id; }
      }
    }

    // Healer aus composition (mit specs.role==='healer') — überschreibt späteren Klassen-Fallback
    const healersFromComp = (summaryResp.composition || [])
      .filter(p => (p.specs || []).some(s => s.role === 'healer'))
      .map(p => ({ id: p.id, name: p.name, type: p.type }));
    // Tanks aus composition (specs.role==='tank')
    const tanksFromComp = (summaryResp.composition || [])
      .filter(p => (p.specs || []).some(s => s.role === 'tank'))
      .map(p => ({ id: p.id, name: p.name, type: p.type }));

    const deathEntries = (deathsResp.entries || []).filter(e => e.name && isValidClass(e.type));
    // Sort by timestamp
    deathEntries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const firstDeathTime = deathEntries.length ? deathEntries[0].timestamp : null;
    // Cluster: wie viele Tode innerhalb 10s des ersten Todes?
    const CLUSTER_WINDOW_MS = 10 * 1000;
    let clusterCount = 0;
    let lastDeathTime = null;
    if (firstDeathTime != null) {
      for (const e of deathEntries) {
        if (e.timestamp - firstDeathTime <= CLUSTER_WINDOW_MS) clusterCount++;
        lastDeathTime = e.timestamp;
      }
    }

    // Boss-HP: WCL liefert bossPercentage direkt am fight-Objekt (skaliert ×100)
    let bossPctAtEnd = null;
    if (f.bossPercentage != null) {
      bossPctAtEnd = Math.round(f.bossPercentage / 100 * 10) / 10;
    } else if (f.fightPercentage != null) {
      bossPctAtEnd = Math.round(f.fightPercentage / 100 * 10) / 10;
    }

    // Enrage-Status
    const enrageSec = BOSS_ENRAGE_SECONDS[f.name] || null;
    const reachedEnrage = enrageSec && durationSec >= enrageSec;

    // === Tier 2: Killing-Blows + Avoidable Damage ===
    // Aus deathEntries die killingBlow-Info extrahieren (falls vorhanden)
    const killingBlows = []; // {playerName, abilityName, abilityId, sourceName, time}
    for (const e of deathEntries) {
      const kb = e.killingBlow || e.ability;
      if (!kb) continue;
      killingBlows.push({
        playerName: e.name,
        playerType: e.type,
        abilityId: kb.guid || kb.id || null,
        abilityName: kb.name || null,
        sourceName: e.killingSource || e.attacker || null,
        time: e.timestamp,
        sinceFightStartSec: ((e.timestamp - fightStart) / 1000).toFixed(1),
      });
    }
    // Most common killer ability
    const abilityCount = new Map();
    for (const kb of killingBlows) {
      if (!kb.abilityName) continue;
      const key = kb.abilityName;
      abilityCount.set(key, (abilityCount.get(key) || 0) + 1);
    }
    const topKillers = [...abilityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    // Avoidable damage taken (gesamt + pro Spieler — wer stand wieviel in Mist)
    let avoidableHits = 0;
    let avoidableDamage = 0;
    const avoidablePerPlayer = {}; // targetID → { hits, damage }
    try {
      const filterStr = 'ability.id IN (' + Object.keys((CLA_DATA && CLA_DATA.avoidableDamage) || {}).join(',') + ')';
      if (filterStr && filterStr.length > 20) {
        const ev = await wclApi(`/report/events/damage-taken/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: filterStr
        }).catch(() => ({ events: [] }));
        for (const e of (ev.events || [])) {
          avoidableHits++;
          avoidableDamage += (e.amount || 0);
          const tid = e.targetID;
          if (tid != null && e.targetIsFriendly) {
            const p = avoidablePerPlayer[tid] || { hits: 0, damage: 0 };
            p.hits++;
            p.damage += (e.amount || 0);
            avoidablePerPlayer[tid] = p;
          }
        }
      }
    } catch (_) {}

    // === Tier 3: Healer-Mana + Phase + Encounter-Spezifisch ===
    let healerManaSnapshot = null;
    try {
      // Mana-Resources der Healer am Fight-Ende (oder kurz davor)
      const healerNames = (playerList || []).filter(p => p.type === 'Priest' || p.type === 'Druid' || p.type === 'Shaman' || p.type === 'Paladin').slice(0, 10).map(p => p.id);
      if (healerNames.length) {
        // Heuristik: einfach den letzten 30s-Slice analysieren
        const sliceStart = Math.max(fightStart, fightEnd - 30000);
        const resourcesResp = await wclApi(`/report/tables/resources/${reportCode}`, {
          start: sliceStart, end: fightEnd, sourceid: healerNames.join(',')
        }).catch(() => ({ entries: [] }));
        const lowManaHealers = [];
        for (const e of (resourcesResp.entries || [])) {
          // Manche WCL-Versionen liefern minResources or so — wir nehmen was wir bekommen
          if (e.minResources != null && e.maxResources && e.maxResources > 0) {
            const pct = (e.minResources / e.maxResources) * 100;
            if (pct < 20) lowManaHealers.push({ name: e.name, type: e.type, manaPct: Math.round(pct) });
          }
        }
        healerManaSnapshot = { sliceSec: 30, lowManaHealers };
      }
    } catch (_) {}

    // === Encounter-spezifische Signale ===
    const encounterSignals = [];

    // Helper: zähle Enemy-Deaths per Name-Pattern (Instanz-Nummern „Pure Spawn of Hydross 1/2" werden mitgezählt).
    function countEnemyDeaths(regex) {
      let n = 0;
      for (const [name, c] of enemyDeathsByName) {
        if (regex.test(name)) n += c;
      }
      return n;
    }
    // Kompatibilität: liefert flache Liste mit Death-Counts pro unique-Name (für Encounter-Signale-Code der enemies-Array nutzt)
    async function getEnemies() {
      const out = [];
      for (const [name, totalDeaths] of enemyDeathsByName) {
        out.push({ name, totalDeaths });
      }
      return out;
    }

    if (/hydross/i.test(f.name)) {
      // Hydross Adds: "Pure Spawn of Hydross" (Frost→Nature-Transition) und "Tainted Spawn of Hydross" (Nature→Frost-Transition).
      // 4 Adds pro Cross → normal 4-8 Adds bei 1-2 Transitions.
      const enemies = await getEnemies();
      let pureSpawns = 0, taintedSpawns = 0;
      for (const e of enemies) {
        if (/pure spawn of hydross/i.test(e.name || '')) pureSpawns += (e.totalDeaths || 0);
        if (/tainted spawn of hydross/i.test(e.name || '')) taintedSpawns += (e.totalDeaths || 0);
      }
      const totalAdds = pureSpawns + taintedSpawns;
      encounterSignals.push({ key: 'hydrossAdds', label: 'Adds getötet (Pure/Tainted)', value: totalAdds, detail: `${pureSpawns} Pure + ${taintedSpawns} Tainted` });
      if (totalAdds > 8) {
        encounterSignals.push({ key: 'hydrossTooManyAdds', label: '⚠ Boss zu oft über die Aura gezogen', value: `${totalAdds} Adds (>8)` });
      }
    }
    if (/lurker/i.test(f.name)) {
      // Spout-Treffer als Avoidable
      try {
        const ev = await wclApi(`/report/events/damage-taken/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 37433 OR ability.id = 38187'
        }).catch(() => ({ events: [] }));
        encounterSignals.push({ key: 'spoutHits', label: 'Spout-Treffer', value: (ev.events || []).length });
      } catch (_) {}
    }
    if (/leotheras/i.test(f.name)) {
      // Inner Demons (Insidious Whisper) — wenn nicht getötet, killt den Spieler
      const enemies = await getEnemies();
      let innerDemons = 0, demonKills = 0;
      for (const e of enemies) {
        if (/inner demon/i.test(e.name || '')) { innerDemons++; demonKills += (e.totalDeaths || 0); }
      }
      encounterSignals.push({ key: 'innerDemons', label: 'Inner Demons gespawnt', value: innerDemons });
      if (innerDemons > 0) encounterSignals.push({ key: 'innerDemonsKilled', label: 'Inner Demons getötet', value: `${demonKills}/${innerDemons}` });
    }
    if (/karathress|fathom-lord/i.test(f.name)) {
      // Reihenfolge der Council-Tode prüfen
      const enemies = await getEnemies();
      const council = ['Caribdis', 'Tidalvess', 'Sharkkis', 'Karathress'];
      const order = [];
      for (const e of enemies) {
        const match = council.find(c => (e.name || '').includes(c));
        if (match && (e.totalDeaths || 0) > 0) order.push(match);
      }
      if (order.length) encounterSignals.push({ key: 'councilOrder', label: 'Tot-Reihenfolge', value: order.join(' → ') });
    }
    if (/morogrim/i.test(f.name)) {
      const enemies = await getEnemies();
      let murlocs = 0;
      for (const e of enemies) {
        if (/murloc|tidewalker.*lurker/i.test(e.name || '')) murlocs += (e.totalDeaths || 0);
      }
      encounterSignals.push({ key: 'murlocsKilled', label: 'Murloc-Adds getötet', value: murlocs });
    }
    if (/vashj/i.test(f.name)) {
      // Tainted Core Wurf-Casts (Spell-ID unbestätigt — probiert mehrere bekannte Kandidaten)
      let coreThrows = 0;
      try {
        const ev = await wclApi(`/report/events/casts/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id IN (38082, 38234, 38233, 38264, 38222, 39288)'
        }).catch(() => ({ events: [] }));
        coreThrows = (ev.events || []).length;
      } catch (_) {}
      encounterSignals.push({ key: 'coreThrows', label: 'Tainted-Core-Würfe (Cast-Events)', value: coreThrows });
      const enemies = await getEnemies();
      let striders = 0, elementals = 0, sporebats = 0;
      for (const e of enemies) {
        if (/coilfang strider/i.test(e.name || '')) striders += (e.totalDeaths || 0);
        if (/tainted elemental/i.test(e.name || '')) elementals += (e.totalDeaths || 0);
        if (/spore bat/i.test(e.name || '')) sporebats += (e.totalDeaths || 0);
      }
      encounterSignals.push({
        key: 'vashjAdds',
        label: 'Striders / Tainted-Elementals / Sporebats',
        value: `${striders} / ${elementals} / ${sporebats}`,
        detail: 'Tainted-Elementals droppen Cores für Shield-Generatoren. Sporebats kommen erst P3.',
      });
    }
    if (/magtheridon/i.test(f.name)) {
      try {
        const ev = await wclApi(`/report/events/casts/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 30410'
        }).catch(() => ({ events: [] }));
        const cubeUses = (ev.events || []).length;
        encounterSignals.push({ key: 'cubeClicks', label: 'Cube-Klicks (channel)', value: cubeUses });
        if (cubeUses < 5) encounterSignals.push({ key: 'tooFewCubes', label: '⚠ Zu wenig Cube-Klicks (<5)', value: cubeUses });
      } catch (_) {}
    }
    if (/al'?ar/i.test(f.name)) {
      const enemies = await getEnemies();
      let embers = 0;
      for (const e of enemies) {
        if (/ember of al/i.test(e.name || '') || /flame patch/i.test(e.name || '')) embers += (e.totalDeaths || 0);
      }
      encounterSignals.push({ key: 'embersKilled', label: 'Embers getötet', value: embers });
      // Phase 2 erreicht?
      if (bossPctAtEnd != null && bossPctAtEnd < 50) {
        encounterSignals.push({ key: 'alarPhase2', label: 'Phase 2 erreicht', value: 'ja' });
      } else if (bossPctAtEnd != null) {
        encounterSignals.push({ key: 'alarPhase2', label: 'Phase 2 erreicht', value: 'nein — bei ' + bossPctAtEnd + '%' });
      }
    }
    if (/void reaver/i.test(f.name)) {
      // Arcane Orb hits — spell 34190
      try {
        const ev = await wclApi(`/report/events/damage-taken/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 34190'
        }).catch(() => ({ events: [] }));
        encounterSignals.push({ key: 'arcaneOrbHits', label: 'Arcane-Orb-Treffer', value: (ev.events || []).length });
      } catch (_) {}
    }
    if (/solarian/i.test(f.name)) {
      // Wrath of the Astromancer (40300) deaths
      try {
        const ev = await wclApi(`/report/events/damage-taken/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 40300'
        }).catch(() => ({ events: [] }));
        encounterSignals.push({ key: 'wrathHits', label: 'Wrath of the Astromancer Hits', value: (ev.events || []).length });
      } catch (_) {}
      // Split phase erreicht? Boss < 20%
      if (bossPctAtEnd != null) {
        encounterSignals.push({ key: 'solarianSplit', label: 'Split-Phase erreicht', value: bossPctAtEnd <= 20 ? 'ja' : 'nein — bei ' + bossPctAtEnd + '%' });
      }
    }
    if (/kael.?thas/i.test(f.name)) {
      // Phasen-Detection via Boss-HP-Schwellen
      let phaseReached = '?';
      if (bossPctAtEnd != null) {
        if (bossPctAtEnd <= 0) phaseReached = '5 (Kill)';
        else if (bossPctAtEnd <= 50) phaseReached = '5 (Flieg-Phase)';
        else if (bossPctAtEnd < 100) phaseReached = '4 (Kael selbst)';
        else phaseReached = '1-3 (Waffen/Advisor)';
      }
      encounterSignals.push({ key: 'kaelPhase', label: 'Phase erreicht', value: phaseReached });
      // Pyroblast (36819) Casts gegen den Raid
      try {
        const ev = await wclApi(`/report/events/casts/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 36819 AND source.disposition = "enemy"'
        }).catch(() => ({ events: [] }));
        encounterSignals.push({ key: 'kaelPyroblasts', label: 'Pyroblast-Casts ungestört', value: (ev.events || []).length });
      } catch (_) {}
      // Gravity Lapse Falls
      try {
        const ev = await wclApi(`/report/events/damage-taken/${reportCode}`, {
          start: fightStart, end: fightEnd, filter: 'ability.id = 36486 OR ability.id = 35966'
        }).catch(() => ({ events: [] }));
        if ((ev.events || []).length > 0) encounterSignals.push({ key: 'kaelGravityFalls', label: 'Gravity-Lapse-Fall-Schäden', value: (ev.events || []).length });
      } catch (_) {}
    }

    // === Generische Signale aus Wipe-only Streams ===
    // Tod-Klassifikation: Boss-Melee vs Add-Tode vs Fall vs Mechanik-Spell
    let bossMeleeDeaths = 0, addDeaths = 0, fallDeaths = 0, mechanicDeaths = 0;
    const ADD_RX = /spawn|elemental|murloc|demon|phoenix|ember|strider|sporebat|priestess|caribdis|sharkkis|tidalvess|seer|astromancer|solarium|advisor|capernian|sanguinar|thaladred|telonicus|kael.*phoenix/i;
    for (const d of deathEntries) {
      const kbName = (d.killingBlow && d.killingBlow.name) || '';
      const lastEvent = (d.events || []).find(ev => ev.type === 'damage' && ev.sourceIsFriendly === false);
      // Source kann aus enemiesById (named enemies) ODER aus damage.sources[0].name (Trash-Adds) kommen
      let srcName = lastEvent && enemiesById.get(lastEvent.sourceID);
      if (!srcName) {
        const aggSources = (d.damage && d.damage.sources) || [];
        srcName = aggSources.length ? aggSources[0].name : null;
      }
      if (/falling/i.test(kbName)) { fallDeaths++; continue; }
      if (kbName === 'Melee' || kbName === 'Shoot' || !kbName) {
        if (srcName && ADD_RX.test(srcName)) addDeaths++;
        else bossMeleeDeaths++;
      } else {
        mechanicDeaths++;
      }
    }
    if (deathEntries.length > 0) {
      const parts = [];
      if (bossMeleeDeaths) parts.push(`${bossMeleeDeaths}× Boss-Melee`);
      if (addDeaths) parts.push(`${addDeaths}× Adds`);
      if (mechanicDeaths) parts.push(`${mechanicDeaths}× Mechanik-Spell`);
      if (fallDeaths) parts.push(`${fallDeaths}× Fall`);
      encounterSignals.push({ key: 'deathBreakdown', label: 'Tode nach Ursache', value: parts.join(', ') });
    }

    // Interrupts / Dispels Quote
    if ((interruptsResp.events || []).length > 0) {
      encounterSignals.push({ key: 'interrupts', label: 'Interrupts gesamt', value: (interruptsResp.events || []).length });
    }
    if ((dispelsResp.events || []).length > 0) {
      encounterSignals.push({ key: 'dispels', label: 'Dispels gesamt', value: (dispelsResp.events || []).length });
    }
    // Adds-Timeline (Summons)
    if ((summonsResp.events || []).length > 0) {
      const firstSummonSec = ((summonsResp.events[0].timestamp - fightStart) / 1000).toFixed(0);
      encounterSignals.push({ key: 'summonsTotal', label: 'Add-Spawns gesamt', value: (summonsResp.events || []).length, detail: `erster bei ${firstSummonSec}s` });
    }

    // Boss-spezifische Auswertungen mit neuen Daten:
    // Magtheridon Blast Nova (30616) — completed casts = wipe-grund
    if (/magtheridon/i.test(f.name)) {
      const blastNovas = (begincastResp.events || []).filter(ev => ev.ability && ev.ability.guid === 30616 && ev.type === 'cast').length;
      const blastNovaKicks = (interruptsResp.events || []).filter(ev => ev.extraAbility && ev.extraAbility.guid === 30616).length;
      if (blastNovas + blastNovaKicks > 0) {
        encounterSignals.push({ key: 'magBlastNova', label: 'Blast Nova durchgelaufen / gekickt', value: `${blastNovas} / ${blastNovaKicks}` });
      }
    }
    // Solarian Wrath of the Astromancer (42783 debuff) — dispels needed
    if (/solarian/i.test(f.name)) {
      const wrathDispels = (dispelsResp.events || []).filter(ev => ev.extraAbility && /wrath of the astromancer/i.test(ev.extraAbility.name || '')).length;
      if (wrathDispels > 0) {
        encounterSignals.push({ key: 'wrathDispels', label: 'Wrath of the Astromancer dispelled', value: wrathDispels });
      }
    }
    // Leotheras Inner Demon — wenn nicht alle ihren Demon killen
    if (/leotheras/i.test(f.name)) {
      const innerDemonSummons = (summonsResp.events || []).filter(ev => ev.ability && /inner demon/i.test(ev.ability.name || '')).length;
      if (innerDemonSummons > 0) {
        encounterSignals.push({ key: 'innerDemonSummons', label: 'Inner Demons spawned (Summon-Events)', value: innerDemonSummons });
      }
    }

    // === Kurven: Boss-HP, Healer-Mana, Raid-Avg-HP ===
    // Healer: zuerst composition aus Summary nutzen (Spec-aware), sonst Klassen-Fallback
    const healers = healersFromComp.length ? healersFromComp
      : (playerList || []).filter(p => p.type === 'Priest' || p.type === 'Druid' || p.type === 'Shaman' || p.type === 'Paladin');
    const allPlayers = (summaryResp.composition && summaryResp.composition.length)
      ? summaryResp.composition.map(p => ({
          id: p.id, name: p.name, type: p.type,
          role: (p.specs && p.specs[0] && p.specs[0].role) || null,
        }))
      : (playerList || []);
    const [bossHpCurve, healerManaCurves, raidHpCurve, addHpCurves, extendedData, prePullBuffs] = await Promise.all([
      fetchBossHpCurve(reportCode, fightStart, fightEnd, bossActorId),
      fetchHealerManaCurves(reportCode, fightStart, fightEnd, healers, f.id),
      fetchRaidHpCurve(reportCode, fightStart, fightEnd, allPlayers),
      fetchAddHpCurves(reportCode, fightStart, fightEnd, enemyActors, bossActorId),
      fetchExtendedWipeData(reportCode, f.id, fightStart, fightEnd, bossActorId, allPlayers, tanksFromComp, summonsResp.events || [], deathEntries, enemiesById),
      fetchPrePullBuffs(reportCode, fightStart, allPlayers),
    ]);
    // ── Boss-Critical-Mechanics: pro Mechanik Counter "applied" vs "handled" ──
    const bossMech = BOSS_MECHANICS[f.name];
    if (bossMech) {
      try {
        // Hole alle Debuff-Events für diesen Fight + Dispels + Interrupts (haben wir teils schon)
        const ddata = await wclApiV2(`
          query($code:String!, $f:Int!) {
            reportData { report(code:$code) {
              dApplied: events(dataType: Debuffs, fightIDs:[$f], hostilityType: Friendlies, limit: 5000) { data }
            }}}
        `, { code: reportCode, f: f.id });
        const debuffEvents = ((ddata && ddata.reportData && ddata.reportData.report && ddata.reportData.report.dApplied && ddata.reportData.report.dApplied.data) || []);
        for (const [mname, mech] of Object.entries(bossMech)) {
          const ids = new Set(mech.ids);
          let applied = 0, removedByDispel = 0, expired = 0, naturalRemove = 0, hits = 0;
          // Sammle apply/remove Events
          const applyTimes = {}; // (targetID,abilityID) → applyTime
          for (const ev of debuffEvents) {
            if (!ids.has(ev.abilityGameID)) continue;
            const key = `${ev.targetID}|${ev.abilityGameID}`;
            if (ev.type === 'applydebuff' || ev.type === 'applybuff') {
              applied++;
              applyTimes[key] = ev.timestamp;
            } else if (ev.type === 'removedebuff' || ev.type === 'removebuff') {
              naturalRemove++;
            } else if (ev.type === 'damage') {
              hits++;
            }
          }
          // Match dispels gegen apply-Events
          for (const ev of (dispelsResp.events || [])) {
            const ea = ev.extraAbility;
            if (ea && ids.has(ea.guid)) removedByDispel++;
          }
          // Match interrupts
          let interrupts = 0, completedCasts = 0;
          for (const ev of (interruptsResp.events || [])) {
            const ea = ev.extraAbility;
            if (ea && ids.has(ea.guid)) interrupts++;
          }
          for (const ev of (begincastResp.events || [])) {
            if (ev.type === 'cast' && ids.has(ev.abilityGameID)) completedCasts++;
          }
          // Render-Wert je nach Type
          if (mech.type === 'interrupt') {
            // Für Interrupt-Mechs: applied-Debuff zählt als „durchgelaufen" (Cast nicht gekickt)
            const completedTotal = Math.max(applied, completedCasts);
            const total = completedTotal + interrupts;
            if (total > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `🎯 ${mname}`,
                value: `${interrupts}× gekickt / ${completedTotal}× durchgelaufen`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'dispel') {
            if (applied > 0) {
              const failed = applied - removedByDispel;
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `🩹 ${mname}`,
                value: `${removedByDispel}/${applied} dispelled${failed > 0 ? ` · ${failed} durchgelaufen` : ''}`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'cleanse') {
            if (applied > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `🧪 ${mname}`,
                value: `${applied}× applied · ${removedByDispel}× cleansed`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'avoid') {
            if (hits > 0 || applied > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `💢 ${mname}`,
                value: `${Math.max(hits, applied)}× getroffen`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'tank') {
            if (applied > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `🛡 ${mname}`,
                value: `${applied}× applied`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'survive') {
            if (applied > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `⚡ ${mname}`,
                value: `${applied}×`,
                detail: mech.label,
              });
            }
          } else if (mech.type === 'kill-demon') {
            if (applied > 0) {
              encounterSignals.push({
                key: `mech-${mname}`,
                label: `👹 ${mname}`,
                value: `${applied}× Demons spawned`,
                detail: mech.label,
              });
            }
          }
        }
      } catch (e) {
        console.warn(`[mech] ${f.name}: ${e.message}`);
      }
    }

    // Vashj-P2 Auswertung: Magic Barrier (38112) auf Vashj — 4× applybuff (4 Generatoren up), removebuff = 1 Generator zerstört
    if (/vashj/i.test(f.name)) {
      const inP2 = (f.bossPercentage != null && f.bossPercentage / 100 <= 70) || (bossPctAtEnd != null && bossPctAtEnd <= 70);
      let taintedKilled = 0;
      for (const [bn, insts] of Object.entries(addHpCurves || {})) {
        if (!/tainted elemental/i.test(bn)) continue;
        for (const i of insts) {
          if (i.curve && i.curve.length && Math.min.apply(null, i.curve.map(p => p.val)) < 5) taintedKilled++;
        }
      }
      // Magic Barrier (38112) Events auf Vashj
      let generatorsDown = 0, barrierEvents = [];
      try {
        const bData = await wclApiV2(`
          query($code:String!, $f:Int!) {
            reportData { report(code:$code) {
              events(dataType: Buffs, fightIDs:[$f], filterExpression: "ability.id = 38112", hostilityType: Enemies, limit: 200) { data }
            }}}
        `, { code: reportCode, f: f.id });
        const evs = ((bData && bData.reportData && bData.reportData.report && bData.reportData.report.events && bData.reportData.report.events.data) || []);
        for (const ev of evs) {
          if (ev.type === 'removebuff') {
            generatorsDown++;
            barrierEvents.push((ev.timestamp - fightStart) / 1000);
          }
        }
      } catch (_) {}
      const fmtMmss = (s) => { const n = Math.max(0, Math.floor(s)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; };
      if (inP2) {
        const detail = barrierEvents.length
          ? `${taintedKilled} Tainted Elementals gekillt = ${taintedKilled} Cores droppt. Generatoren zerstört bei: ${barrierEvents.map(t => fmtMmss(t)).join(', ')}.`
          : `${taintedKilled} Tainted Elementals gekillt aber kein Generator zerstört.`;
        encounterSignals.push({
          key: 'vashjGenerators',
          label: 'Shield-Generatoren zerstört',
          value: `${generatorsDown} / 4`,
          detail,
        });
      }
    }

    let phaseTransitions = derivePhaseTransitions(bossHpCurve, f.name);
    // Für Hydross: echte Transitionen aus Add-Spawn-Clustern (HP-Schwellen passen nicht — Stance-Wechsel
    // wird durch Spieler-Pull-Position bestimmt). Cluster brauchen ≥3 Adds um als Transition zu zählen
    // (verzögerte Einzel-Spawns sonst als false-positive).
    if (/hydross/i.test(f.name) && addHpCurves) {
      const real = [];
      for (const [baseName, instances] of Object.entries(addHpCurves)) {
        if (!/spawn of hydross/i.test(baseName)) continue;
        const sorted = [...instances].sort((a, b) => a.spawnSec - b.spawnSec);
        // Cluster bilden mit 10s gap (echte Spawn-Welle: alle innerhalb weniger Sekunden)
        const clusters = [];
        let cur = [];
        for (const inst of sorted) {
          if (cur.length === 0 || inst.spawnSec - cur[cur.length - 1].spawnSec <= 10) {
            cur.push(inst);
          } else {
            clusters.push(cur);
            cur = [inst];
          }
        }
        if (cur.length) clusters.push(cur);
        // Nur Cluster mit ≥3 Adds zählen als echte Transition (kleinere sind verzögerte Spawns/Artefakte)
        for (const cluster of clusters) {
          if (cluster.length < 3) continue;
          real.push({
            atSec: Math.round(cluster[0].spawnSec),
            label: /tainted/i.test(baseName) ? 'Pure→Frost' : 'Frost→Pure',
            bossPct: null,
            addCount: cluster.length,
          });
        }
      }
      real.sort((a, b) => a.atSec - b.atSec);
      if (real.length) phaseTransitions = real;
    }
    // Für Solarian: Wellen-Marker aus Add-Spawn-Zeiten
    if (/solarian/i.test(f.name) && addHpCurves) {
      const extra = [];
      for (const [baseName, instances] of Object.entries(addHpCurves)) {
        if (!/solarium/i.test(baseName)) continue;
        if (!instances.length) continue;
        const sorted = [...instances].sort((a, b) => a.spawnSec - b.spawnSec);
        const firstSpawn = sorted[0].spawnSec;
        const shortName = /agent/i.test(baseName) ? 'Solarium Agents' : 'Solarium Priests';
        extra.push({ atSec: Math.round(firstSpawn), label: `${shortName} (${instances.length}×)`, bossPct: null });
      }
      if (extra.length) {
        phaseTransitions = (phaseTransitions || []).concat(extra).sort((a, b) => a.atSec - b.atSec);
      }
    }
    // Für Kael: P2-Waffen + P3-Advisors + P3-Rez aus Add-HP-Kurven ableiten
    if (/kael/i.test(f.name) && addHpCurves) {
      const WEAPON_RX = /staff of disintegration|infinity blades|warp slicer|cosmic infuser|phaseshift bulwark|devastation|netherstrand longbow/i;
      const ADVISOR_RX = /thaladred|sanguinar|capernian|telonicus/i;
      let firstWeapon = null, firstAdvisor = null;
      const rezTimes = [];
      for (const [baseName, instances] of Object.entries(addHpCurves)) {
        if (WEAPON_RX.test(baseName)) {
          for (const inst of instances) {
            if (firstWeapon == null || inst.spawnSec < firstWeapon) firstWeapon = inst.spawnSec;
          }
        }
        if (ADVISOR_RX.test(baseName)) {
          for (const inst of instances) {
            if (firstAdvisor == null || inst.spawnSec < firstAdvisor) firstAdvisor = inst.spawnSec;
            // Rez-Erkennung: Sprung 0→80%+ innerhalb der Kurve
            if (!inst.curve || inst.curve.length < 3) continue;
            let prev = inst.curve[0].val;
            for (const p of inst.curve) {
              if (prev < 5 && p.val > 80) { rezTimes.push(p.sec); break; }
              prev = p.val;
            }
          }
        }
      }
      const extra = [];
      if (firstWeapon != null) extra.push({ atSec: Math.round(firstWeapon), label: 'P2 (Waffen)', bossPct: null });
      if (firstAdvisor != null && (firstWeapon == null || firstAdvisor - firstWeapon > 10)) {
        extra.push({ atSec: Math.round(firstAdvisor), label: 'P3 (Advisors)', bossPct: null });
      }
      if (rezTimes.length) extra.push({ atSec: Math.round(Math.min.apply(null, rezTimes)), label: 'P3 (Advisor-Rez)', bossPct: null });
      if (extra.length) {
        phaseTransitions = (phaseTransitions || []).concat(extra).sort((a, b) => a.atSec - b.atSec);
      }
    }

    // Boss-Stillstand: letzter Damage-Hit auf Boss vs Fight-Ende
    // Nur als „Mechanik-Block" werten wenn Raid zur Stuck-Zeit noch lebend war (Raid-HP > 30%) UND ≥45s stuck.
    // Sonst ist es nur der „Wipe-Tail" (alle tot, niemand mehr da der hittet).
    let bossStuckSec = 0;
    let bossStuckAtPct = null;
    if (bossHpCurve.length) {
      const lastHit = bossHpCurve[bossHpCurve.length - 1];
      const stuck = durationSec - lastHit.sec;
      // Was war die Raid-HP zur Stuck-Start-Zeit?
      let raidHpAtStuck = 100;
      if (raidHpCurve && raidHpCurve.length) {
        for (const p of raidHpCurve) {
          if (p.sec >= lastHit.sec) break;
          raidHpAtStuck = p.val;
        }
      }
      if (stuck >= 45 && raidHpAtStuck > 30) {
        bossStuckSec = Math.round(stuck);
        bossStuckAtPct = lastHit.val;
        encounterSignals.push({
          key: 'bossStuck',
          label: '⚠ Boss-DMG-Stillstand',
          value: `${bossStuckSec}s bei ${bossStuckAtPct.toFixed(1)}%`,
          detail: `Boss hat letzte ${bossStuckSec}s keinen Schaden mehr genommen, Raid-HP zur Zeit ${Math.round(raidHpAtStuck)}%.`,
        });
      }
    }

    // === Headline-Diagnose (mit erweiterten Daten) ===
    let headline = '';
    const oomHealers = [];
    for (const [hn, curve] of Object.entries(healerManaCurves || {})) {
      const minMana = Math.min(...curve.map(p => p.val));
      if (minMana < 10) oomHealers.push({ name: hn, minPct: Math.round(minMana) });
    }
    const tankDeaths = (extendedData && extendedData.tankInfo && extendedData.tankInfo.deaths) || [];
    const ignoredAdds = (extendedData && extendedData.dpsBreakdown && extendedData.dpsBreakdown.ignoredAdds) || [];
    const healerSlackers = (extendedData && extendedData.cdUsage && extendedData.cdUsage.healerSlackers) || [];

    // Boss-Stillstand check
    const stuckSig = encounterSignals.find(s => s.key === 'bossStuck');
    if (deathEntries.length === 0) {
      headline = 'Kein Spielertod registriert — vermutlich Soft-Reset oder Player-Drop.';
    } else if (reachedEnrage) {
      headline = `Enrage erreicht (${Math.round(durationSec)}s vs ${enrageSec}s). Boss noch bei ${bossPctAtEnd != null ? bossPctAtEnd + '%' : '?'} HP.`;
    } else if (stuckSig && parseInt(stuckSig.value) > 60) {
      headline = `Boss stand ${stuckSig.value} ohne Schaden zu nehmen — Mechanik (Shield/Phase) blockiert.` +
        (oomHealers.length ? ` Zusätzlich: ${oomHealers.length} Healer OOM.` : '');
    } else if (tankDeaths.length) {
      // Tank-Tod ist quasi immer Wipe-Grund — egal wann er stirbt
      const t = tankDeaths[0];
      const more = tankDeaths.length > 1 ? ` (+${tankDeaths.length - 1} weitere Tanks)` : '';
      headline = `Tank ${t.name} stirbt bei ${Math.round(t.atSec)}s${more} — Boss tankt jetzt den Raid.`;
    } else if (oomHealers.length >= 2) {
      const names = oomHealers.map(h => `${h.name} (${h.minPct}%)`).join(', ');
      headline = `Healer OOM: ${names}. Heilkette gebrochen.`;
    } else if (clusterCount >= 5) {
      const topAbility = topKillers[0];
      headline = `Mass-Wipe: ${clusterCount} Tote in 10s` + (topAbility ? `, Haupt-Killer: ${topAbility.name}` : '') + `. Boss @ ${bossPctAtEnd != null ? bossPctAtEnd + '%' : '?'}`;
    } else if (ignoredAdds.length >= 3) {
      headline = `Adds ignoriert: ${ignoredAdds.length} DDs haben Boss gefocust statt Adds. Add-Wipe.`;
    } else if (firstDeathTime && (lastDeathTime - firstDeathTime) > 30000) {
      headline = `Slow Bleed: Tode über ${Math.round((lastDeathTime - firstDeathTime) / 1000)}s verteilt.` +
        (oomHealers.length ? ` Healer ${oomHealers[0].name} ging auf ${oomHealers[0].minPct}%.` : '') +
        (healerSlackers.length ? ` ${healerSlackers.length} Healer ohne Mana-CD.` : '');
    } else {
      const topAbility = topKillers[0];
      headline = `Kaskade: erster Tod nach ${((firstDeathTime - fightStart) / 1000).toFixed(0)}s` + (topAbility ? `, Top-Killer: ${topAbility.name}` : '') + `. Boss @ ${bossPctAtEnd != null ? bossPctAtEnd + '%' : '?'}`;
    }

  return {
    fightId: f.id, fightName: f.name, durationSec: Math.round(durationSec),
    enrageSec, reachedEnrage,
    bossPctAtEnd,
    totalDeaths: deathEntries.length,
    firstDeathSec: firstDeathTime != null ? ((firstDeathTime - fightStart) / 1000).toFixed(1) : null,
    lastDeathSec: lastDeathTime != null ? ((lastDeathTime - fightStart) / 1000).toFixed(1) : null,
    clusterCount,
    deathEntries: deathEntries.map(e => {
      const sources = (e.damage && e.damage.sources) || [];
      const aggSource = sources.length ? (sources[0].name || null) : null;
      // Killing-Source = Actor der den letzten Damage-Event vor Tod gemacht hat.
      // Fallback: damage.sources[0].name (aggregiert), wenn sourceID nicht in enemiesById ist.
      let killingSource = null;
      const lastEvent = (e.events || []).find(ev => ev.type === 'damage' && ev.sourceIsFriendly === false);
      if (lastEvent && lastEvent.sourceID != null && enemiesById.has(lastEvent.sourceID)) {
        killingSource = enemiesById.get(lastEvent.sourceID);
      }
      const finalSource = killingSource || aggSource;
      return {
        name: e.name, type: e.type, time: e.timestamp,
        sinceStartSec: ((e.timestamp - fightStart) / 1000).toFixed(1),
        killingBlow: (e.killingBlow || e.ability) ? { id: (e.killingBlow || e.ability).guid || (e.killingBlow || e.ability).id || null, name: (e.killingBlow || e.ability).name || null } : null,
        source: finalSource,
      };
    }),
    topKillers,
    avoidableHits, avoidableDamage, avoidablePerPlayer,
    healerManaSnapshot,
    encounterSignals,
    headline,
    // Wipe-only zusätzliche Streams (nur bei Wipes geholt)
    interrupts: {
      total: (interruptsResp.events || []).length,
      byAbility: aggregateInterruptsByAbility(interruptsResp.events || []),
    },
    dispels: {
      total: (dispelsResp.events || []).length,
      byAbility: aggregateInterruptsByAbility(dispelsResp.events || []),
    },
    summons: {
      total: (summonsResp.events || []).length,
      timeline: (summonsResp.events || []).slice(0, 50).map(ev => ({
        sec: ((ev.timestamp - fightStart) / 1000).toFixed(1),
        ability: ev.ability && ev.ability.name,
        targetName: enemiesById.get(ev.targetID) || null,
      })),
    },
    bossCasts: aggregateBossCastsByAbility(begincastResp.events || []),
    bossName: f.name,
    players: (allPlayers || []).map(p => ({ id: p.id, name: p.name, type: p.type })),
    curves: {
      bossHp: bossHpCurve,
      healerMana: healerManaCurves,
      raidAvgHp: raidHpCurve,
      addHp: addHpCurves,
    },
    extended: extendedData || null,
    prePullBuffs: prePullBuffs || [],
    phaseTransitions,
  };
}

// Aggregiert Interrupts/Dispels/Casts nach Ability-Name → Count
function aggregateInterruptsByAbility(events) {
  const map = new Map();
  for (const ev of events) {
    const ab = ev.extraAbility || ev.ability;
    if (!ab) continue;
    const key = ab.name || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
}

function aggregateBossCastsByAbility(events) {
  const map = new Map();
  for (const ev of events) {
    if (ev.sourceIsFriendly) continue;
    const ab = ev.ability;
    if (!ab) continue;
    const key = ab.name || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));
}

// Major Cooldown Usage — pro Spieler/Fight + spec-aware "eligibleFights" (Fight zählt nur wenn CD im Role-Pool)
async function analyzeCooldownUsage(reportCode, bossFights, playerList) {
  if (!MAJOR_CD_FILTER_IDS.length) return { players: [], fights: [], cdDefs: {} };
  const filterStr = `ability.id IN (${MAJOR_CD_FILTER_IDS.join(',')})`;
  const fightMeta = bossFights.map(f => ({ id: f.id, name: f.name, kill: !!f.kill }));
  // total: { cdKey: cast count }
  // eligibleFights: { cdKey: anzahl Fights wo Spieler in role mit diesem CD im Pool war }
  const players = playerList.map(p => ({
    id: p.id, name: p.name, type: p.type,
    total: {}, perFight: {}, eligibleFights: {}, rolesByFight: {}
  }));
  const byId = new Map(players.map(p => [p.id, p]));

  // Fetch summaries pro Fight parallel (für Role-Detection)
  const summaries = await Promise.all(bossFights.map(f =>
    wclApi(`/report/tables/summary/${reportCode}`, {
      start: f.start_time, end: f.end_time, translate: true
    }).catch(() => null)
  ));

  for (let fi = 0; fi < bossFights.length; fi++) {
    const f = bossFights[fi];
    const summary = summaries[fi];
    // Role pro Spieler in diesem Fight + eligibleFights für expected CDs erhöhen
    for (const p of players) {
      const role = summary ? getPlayerFightRole(summary, p.name, p.type) : null;
      if (!role) continue;
      p.rolesByFight[f.id] = role;
      const expected = LIVE_CD_ROLE_EXPECTATIONS[role] || [];
      for (const k of expected) {
        p.eligibleFights[k] = (p.eligibleFights[k] || 0) + 1;
      }
    }
    // Cast events
    let events = [];
    try {
      events = await fetchCastEventsV2(reportCode, f.id, filterStr);
    } catch (e) {
      console.warn(`[v2] CD events failed for fight ${f.id}: ${e.message}`);
      continue;
    }
    for (const ev of events) {
      const gid = ev.abilityGameID;
      const info = MAJOR_CD_LOOKUP[gid];
      if (!info) continue;
      const p = byId.get(ev.sourceID);
      if (!p) continue;
      p.total[info.key] = (p.total[info.key] || 0) + 1;
      if (!p.perFight[f.id]) p.perFight[f.id] = {};
      p.perFight[f.id][info.key] = (p.perFight[f.id][info.key] || 0) + 1;
      // Wenn ein CD gecastet wurde der im Pool-Mapping NICHT für aktuelle role steht,
      // ist es ein "extra" — eligibleFights nicht erhöhen, casts zählen wir trotzdem.
    }
  }
  const cdDefs = {};
  for (const [key, def] of Object.entries(MAJOR_COOLDOWNS)) cdDefs[key] = { name: def.name, role: def.role, cd: def.cd, spellId: def.ids[0] };
  return { players, fights: fightMeta, cdDefs };
}

// Trinket-Usage: zähle Casts der ON-USE Trinket-Spells pro Spieler pro Fight
async function analyzeTrinketUsage(reportCode, bossFights, playerList) {
  if (!ONUSE_TRINKET_SPELL_IDS.length) return { players: [], fights: [] };
  const filterStr = `ability.id IN (${ONUSE_TRINKET_SPELL_IDS.join(',')})`;
  const fightMeta = bossFights.map(f => ({ id: f.id, name: f.name, kill: !!f.kill }));
  // playerIdx → { name, type, total: {spellId: count}, perFight: {fightId: {spellId: count}} }
  const players = playerList.map(p => ({ id: p.id, name: p.name, type: p.type, total: {}, perFight: {} }));
  const byId = new Map(players.map(p => [p.id, p]));
  for (const f of bossFights) {
    let events = [];
    try {
      events = await fetchCastEventsV2(reportCode, f.id, filterStr);
    } catch (e) {
      console.warn(`[v2] trinket events failed for fight ${f.id}: ${e.message}`);
      continue;
    }
    for (const ev of events) {
      const gid = ev.abilityGameID;
      const def = ONUSE_TRINKETS[gid];
      if (!def) continue;
      const sid = ev.sourceID;
      const p = byId.get(sid);
      if (!p) continue;
      p.total[gid] = (p.total[gid] || 0) + 1;
      if (!p.perFight[f.id]) p.perFight[f.id] = {};
      p.perFight[f.id][gid] = (p.perFight[f.id][gid] || 0) + 1;
    }
  }
  // Trinket-Definitionen mit ausliefern für Frontend-Render
  const trinketDefs = {};
  for (const [spellId, def] of Object.entries(ONUSE_TRINKETS)) trinketDefs[spellId] = def;
  return { players, fights: fightMeta, trinketDefs };
}

async function analyzeWipes(reportCode, bossFights, playerList) {
  const results = [];
  // Analysiere ALLE Boss-Fights (wipes + kills) — Kill-Daten sind nützlich für Vergleich/Progression.
  for (const f of bossFights) {
    try {
      const w = await analyzeWipeForFight(reportCode, f, playerList);
      w.kill = !!f.kill;
      results.push(w);
    } catch (e) {
      console.error(`[PRE] Fight-Analyse für ${f.name} fehlgeschlagen:`, e.message);
    }
  }
  return results;
}

// ─── Main orchestration ───

async function processReport(reportCode) {
  const sh = settingsHash();
  const hasCached = (type) => !!cache.getAnalysis(reportCode, type, sh);
  const existingReportData = cache.getReportData(reportCode);
  const hasReportData = !!existingReportData;
  reportStep({ reportCode, step: 'init' });

  // Every analysis below depends on bossFights.length. If an earlier run cached
  // these while the raid was still in progress, later runs must invalidate and
  // recompute — otherwise cached analyses stay frozen on a subset of fights.
  const PER_FIGHT_TYPES = ['gear', 'buffs', 'consumables', 'spellranks',
                           'deaths', 'dmgheal', 'damagetaken', 'drums', 'avoidable', 'wipes',
                           'trinkets', 'cooldowns'];

  // Check for report growth before anything else (live logging / in-progress raid)
  let reportDataPrefetched = null;
  if (hasReportData) {
    reportDataPrefetched = await wclApi(`/report/fights/${reportCode}`);
    const growthZone = CLA_DATA.zones[reportDataPrefetched.zone];
    const growthSize = growthZone ? growthZone.size : 0;
    const currentFights = (reportDataPrefetched.fights || []).filter(f => {
      if (!f.boss || f.boss <= 0) return false;
      if (!growthSize) return true;
      return growthSize >= 25 ? (f.size || 0) >= 25 : (f.size || 0) < 25;
    });
    const storedFights = JSON.parse(existingReportData.fights_json || '[]');
    if (currentFights.length > storedFights.length) {
      console.log(`[PRE] ${reportCode}: report grew (${storedFights.length} → ${currentFights.length} fights), invalidating all per-fight analyses`);
      const fightsData = currentFights.map(f => ({ id: f.id, boss: f.boss, name: f.name, start_time: f.start_time, end_time: f.end_time, kill: f.kill, size: f.size, bossPercentage: f.bossPercentage, fightPercentage: f.fightPercentage }));
      const reportMeta = { title: reportDataPrefetched.title, zone: reportDataPrefetched.zone, start: reportDataPrefetched.start, end: reportDataPrefetched.end, owner: reportDataPrefetched.owner };
      cache.putReportData(reportCode, JSON.stringify(fightsData), existingReportData.players_json || '[]', JSON.stringify(reportMeta));
      const d = cache.getDb();
      for (const type of PER_FIGHT_TYPES) {
        d.prepare("DELETE FROM report_analysis WHERE report_code = ? AND analysis_type = ?").run(reportCode, type);
      }
    }
  }

  const needGear = !hasCached('gear');
  const needBuffs = !hasCached('buffs');
  const needCons = !hasCached('consumables');
  const needSpellRanks = !hasCached('spellranks');
  const needDeaths = !hasCached('deaths');
  const needDmgHeal = !hasCached('dmgheal');
  const needDmgTaken = !hasCached('damagetaken');
  const needDrums = !hasCached('drums');
  const needAvoidable = !hasCached('avoidable');
  const needWipes = !hasCached('wipes');
  const needTrinkets = !hasCached('trinkets');
  const needCooldowns = !hasCached('cooldowns');

  if (!needGear && !needBuffs && !needCons && !needSpellRanks && !needDeaths && !needDmgHeal && !needDmgTaken && !needDrums && !needAvoidable && !needWipes && !needTrinkets && !needCooldowns && hasReportData) {
    return false; // already fully analyzed and report has not grown
  }

  console.log(`[PRE] Analyzing ${reportCode} (gear:${needGear} buffs:${needBuffs} cons:${needCons} spells:${needSpellRanks} deaths:${needDeaths} dmgheal:${needDmgHeal} dmgtaken:${needDmgTaken} drums:${needDrums} avoidable:${needAvoidable} wipes:${needWipes} trinkets:${needTrinkets} cooldowns:${needCooldowns})`);

  // Reuse prefetched data if available; otherwise fetch fresh (bypass cache for never-analyzed reports)
  reportStep({ reportCode, step: 'fetch-fights' });
  const reportData = reportDataPrefetched || await wclApi(`/report/fights/${reportCode}`, {}, { nocache: !hasReportData });
  // WCL reports sometimes contain mixed 10er + 25er content (split log nights).
  // The report is classified by its primary zone, so only keep fights matching
  // that raid size — otherwise Karazhan fights leak into a 25er report.
  const reportZone = CLA_DATA.zones[reportData.zone];
  const reportSize = reportZone ? reportZone.size : 0;
  const bossFights = (reportData.fights || []).filter(f => {
    if (!f.boss || f.boss <= 0) return false;
    if (!reportSize) return true; // unknown zone, keep everything
    return reportSize >= 25 ? (f.size || 0) >= 25 : (f.size || 0) < 25;
  });
  if (!bossFights.length) {
    console.log(`[PRE] ${reportCode}: no boss fights, skipping`);
    return false;
  }

  // Get player list from casts table
  reportStep({ reportCode, step: 'fetch-players' });
  const castsTable = await wclApi(`/report/tables/casts/${reportCode}`, { start: 0, end: 999999999999, translate: true });
  const playerList = (castsTable.entries || []).filter(e => isValidClass(e.type) && e.total > 20);
  if (!playerList.length) {
    console.log(`[PRE] ${reportCode}: no players found, skipping`);
    return false;
  }

  console.log(`[PRE] ${reportCode}: ${bossFights.length} fights, ${playerList.length} players`);

  // Store report metadata for frontend consumption
  const reportMeta = {
    title: reportData.title, zone: reportData.zone,
    start: reportData.start, end: reportData.end, owner: reportData.owner,
    friendlies: reportData.friendlies || [], friendlyPets: reportData.friendlyPets || [],
  };
  const fightsData = bossFights.map(f => ({
    id: f.id, boss: f.boss, name: f.name,
    start_time: f.start_time, end_time: f.end_time,
    kill: f.kill, size: f.size,
    bossPercentage: f.bossPercentage, fightPercentage: f.fightPercentage,
  }));
  const playersData = playerList.map(p => ({ id: p.id, name: p.name, type: p.type, total: p.total }));
  cache.putReportData(reportCode, JSON.stringify(fightsData), JSON.stringify(playersData), JSON.stringify(reportMeta));

  // Run analyses sequentially to avoid overwhelming the API
  if (needGear) {
    reportStep({ reportCode, step: 'gear' });
    try {
      const result = await analyzeGear(reportCode, bossFights, reportData.start);
      cache.putAnalysis(reportCode, 'gear', sh, JSON.stringify(result));
      console.log(`[PRE] ${reportCode}: gear done (${result.results.length} players)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: gear failed:`, e.message); }
  }

  if (needBuffs) {
    reportStep({ reportCode, step: 'buffs' });
    try {
      const result = await analyzeBuffs(reportCode, bossFights, playerList, reportData);
      cache.putAnalysis(reportCode, 'buffs', sh, JSON.stringify(result));
      console.log(`[PRE] ${reportCode}: buffs done (${result.length} players)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: buffs failed:`, e.message); }
  }

  if (needCons) {
    reportStep({ reportCode, step: 'consumables' });
    try {
      const result = await analyzeConsumables(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'consumables', sh, JSON.stringify(result));
      console.log(`[PRE] ${reportCode}: consumables done (${result.length} players)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: consumables failed:`, e.message); }
  }

  if (needSpellRanks) {
    reportStep({ reportCode, step: 'spellranks' });
    try {
      const result = await analyzeSpellRanks(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'spellranks', sh, JSON.stringify(result));
      const issueCount = Object.keys(result).length;
      console.log(`[PRE] ${reportCode}: spellranks done (${issueCount} players with issues)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: spellranks failed:`, e.message); }
  }

  if (needDeaths) {
    reportStep({ reportCode, step: 'deaths' });
    try {
      const result = await analyzeDeaths(reportCode, bossFights);
      cache.putAnalysis(reportCode, 'deaths', sh, JSON.stringify(result));
      const totalDeaths = result.reduce((s, f) => s + f.deaths.reduce((s2, d) => s2 + d.deaths, 0), 0);
      console.log(`[PRE] ${reportCode}: deaths done (${totalDeaths} total deaths)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: deaths failed:`, e.message); }
  }

  if (needDmgHeal) {
    reportStep({ reportCode, step: 'dmgheal' });
    try {
      const result = await analyzeDamageHealing(reportCode, bossFights);
      cache.putAnalysis(reportCode, 'dmgheal', sh, JSON.stringify(result));
      console.log(`[PRE] ${reportCode}: dmgheal done (${result.length} fights)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: dmgheal failed:`, e.message); }
  }

  if (needDmgTaken) {
    reportStep({ reportCode, step: 'damagetaken' });
    try {
      const result = await analyzeDamageTaken(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'damagetaken', sh, JSON.stringify(result));
      const totalEntries = result.reduce((s, f) => s + f.entries.length, 0);
      console.log(`[PRE] ${reportCode}: damagetaken done (${totalEntries} entries)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: damagetaken failed:`, e.message); }
  }

  if (needDrums) {
    reportStep({ reportCode, step: 'drums' });
    try {
      const result = await analyzeDrums(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'drums', sh, JSON.stringify(result));
      const totalDrums = result.reduce((s, f) => s + f.drums.reduce((s2, d) => s2 + d.count, 0), 0);
      console.log(`[PRE] ${reportCode}: drums done (${totalDrums} total casts)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: drums failed:`, e.message); }
  }

  if (needAvoidable) {
    reportStep({ reportCode, step: 'avoidable' });
    try {
      const result = await analyzeAvoidable(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'avoidable', sh, JSON.stringify(result));
      const totalHits = result.reduce((s, f) => s + f.players.reduce((s2, p) => s2 + Object.values(p.abilities).reduce((s3, a) => s3 + a.hits, 0), 0), 0);
      console.log(`[PRE] ${reportCode}: avoidable done (${totalHits} total hits)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: avoidable failed:`, e.message); }
  }

  if (needWipes) {
    reportStep({ reportCode, step: 'wipes' });
    try {
      const result = await analyzeWipes(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'wipes', sh, JSON.stringify(result));
      console.log(`[PRE] ${reportCode}: wipes done (${result.length} wipes)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: wipes failed:`, e.message); }
  }

  if (needTrinkets) {
    reportStep({ reportCode, step: 'trinkets' });
    try {
      const result = await analyzeTrinketUsage(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'trinkets', sh, JSON.stringify(result));
      const totalCasts = result.players.reduce((s, p) => s + Object.values(p.total).reduce((s2, v) => s2 + v, 0), 0);
      console.log(`[PRE] ${reportCode}: trinkets done (${totalCasts} total casts)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: trinkets failed:`, e.message); }
  }

  if (needCooldowns) {
    reportStep({ reportCode, step: 'cooldowns' });
    try {
      const result = await analyzeCooldownUsage(reportCode, bossFights, playerList);
      cache.putAnalysis(reportCode, 'cooldowns', sh, JSON.stringify(result));
      const totalCasts = result.players.reduce((s, p) => s + Object.values(p.total).reduce((s2, v) => s2 + v, 0), 0);
      console.log(`[PRE] ${reportCode}: cooldowns done (${totalCasts} total casts)`);
    } catch (e) { console.error(`[PRE] ${reportCode}: cooldowns failed:`, e.message); }
  }

  // Invalidate aggregated views that depend on this report's analysis
  try { require('./progression').invalidate(); } catch (_) {}

  return true;
}

async function checkAndAnalyzeNewReports() {
  const guildName = cache.getSetting('guildName');
  const serverName = cache.getSetting('serverName');
  const region = cache.getSetting('region') || cache.getSetting('serverRegion');
  if (!guildName || !serverName || !region) {
    console.log('[PRE] Guild not configured, skipping');
    return;
  }

  console.log(`[PRE] Checking for new reports for ${guildName}...`);
  reportStep({ phase: 'fetch-reports' });

  try {
    const reports = await wclApi(`/reports/guild/${encodeURIComponent(guildName)}/${encodeURIComponent(serverName)}/${encodeURIComponent(region)}`);

    // Manuelle Reports mergen, damit sie beim Refresh nicht aus dem Cache verschwinden
    try {
      const manuals = cache.getManualReports();
      const known = new Set(reports.map(r => r.id));
      for (const m of manuals) {
        if (!known.has(m.report_code)) {
          reports.unshift({
            id: m.report_code,
            title: m.title || m.report_code,
            owner: m.owner || null,
            zone: m.zone_id || 0,
            start: m.start_ts || 0,
            end: m.end_ts || 0,
            manual: true,
          });
        }
      }
    } catch (_) {}

    // Store guild reports for frontend
    const guildKey = `${guildName}/${serverName}/${region}`;
    cache.putGuildReportsCache(guildKey, JSON.stringify(reports));

    // Only process reports from the last 14 days (or from start date if configured)
    const startDateStr = cache.getSetting('reportStartDate');
    const cutoff = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : Date.now() - 14 * 24 * 60 * 60 * 1000;
    const excluded = new Set(cache.getExcludedReports());

    const recentReports = reports
      .filter(r => r.start >= cutoff && !excluded.has(r.id))
      .sort((a, b) => b.start - a.start);

    console.log(`[PRE] Found ${recentReports.length} recent reports`);
    reportStep({ phase: 'analyzing', total: recentReports.length, done: 0 });

    let done = 0;
    for (const report of recentReports) {
      reportStep({ phase: 'analyzing', total: recentReports.length, done, currentReport: { code: report.id, title: report.title, zone: report.zone, start: report.start } });
      try {
        const analyzed = await processReport(report.id);
        if (analyzed) {
          console.log(`[PRE] Completed analysis for ${report.id} (${report.title})`);
        }
      } catch (e) {
        if (e.message === 'RATE_LIMITED') {
          console.log('[PRE] Rate limited, stopping for now');
          reportStep({ phase: 'idle', error: 'Rate limited' });
          return;
        }
        console.error(`[PRE] Error processing ${report.id}:`, e.message);
      }
      done++;
      reportStep({ phase: 'analyzing', total: recentReports.length, done });
    }

    console.log('[PRE] Check complete');
    reportStep({ phase: 'idle' });
  } catch (e) {
    if (e.message === 'RATE_LIMITED') {
      console.log('[PRE] Rate limited, will retry next cycle');
      reportStep({ phase: 'idle', error: 'Rate limited' });
      return;
    }
    console.error('[PRE] Error:', e.message);
    reportStep({ phase: 'idle', error: e.message });
  }
}

// ─── Live Fight Analysis (single fight, no DB writes) ───

// Namens-Overrides für WCL-mislabeled Buffs (gleich wie Frontend)
const ELIXIR_NAME_OVERRIDES = {
  28509: 'Elixir of Major Mageblood',     // WCL: „Greater Versatility"
  28519: 'Flask of Mighty Restoration',    // WCL: „Mighty Versatility"
};
function liveDisplayName(id, fallback) {
  return ELIXIR_NAME_OVERRIDES[id] || fallback;
}

// ── Elixier-Policy für Live-Ticker (analog zu progression.js) ──
function liveNormalizeRoleKey(rk) {
  if (!rk) return rk;
  if (rk === 'Druid:dps') return 'Druid:feral';
  if (rk === 'Shaman:dps') return 'Shaman:enhancement';
  if (rk === 'Paladin:dps') return 'Paladin:retribution';
  return rk;
}
function liveLoadPolicy() {
  try { return JSON.parse(cache.getSetting('elixirPolicy') || '{}') || {}; } catch (_) { return {}; }
}
function liveLoadBossPolicy() {
  try { return JSON.parse(cache.getSetting('bossPolicy') || '{}') || {}; } catch (_) { return {}; }
}
function liveResolvePolicy(roleKey, bossName, basePolicy, bossPolicy) {
  const role = liveNormalizeRoleKey(roleKey);
  const base = (role && basePolicy && basePolicy[role]) || { mode: 'any' };
  if (!bossName || !bossPolicy) return base;
  const extra = (bossPolicy[bossName] || {})[role];
  if (!extra) return base;
  return {
    mode: base.mode,
    flaskAllowed: [ ...(base.flaskAllowed || []), ...(extra.flaskAllowed || []) ],
    battleAllowed: [ ...(base.battleAllowed || []), ...(extra.battleAllowed || []) ],
    guardianAllowed: [ ...(base.guardianAllowed || []), ...(extra.guardianAllowed || []) ],
  };
}
function liveWhitelistMatches(allowedIds, id) {
  if (id == null) return false;
  if (!Array.isArray(allowedIds) || !allowedIds.length) return false;
  return allowedIds.includes(id);
}
function liveIsFlaskOrElixirOk(roleKey, flaskId, battleId, guardianId, policy, bossName, bossPolicy) {
  const pol = liveResolvePolicy(roleKey, bossName, policy, bossPolicy);
  if (pol.mode === 'flask-only') return flaskId != null && liveWhitelistMatches(pol.flaskAllowed, flaskId);
  if (pol.mode === 'whitelist') {
    if (flaskId != null && liveWhitelistMatches(pol.flaskAllowed, flaskId)) return true;
    const bOk = battleId != null && liveWhitelistMatches(pol.battleAllowed, battleId);
    const gOk = guardianId != null && liveWhitelistMatches(pol.guardianAllowed, guardianId);
    return !!(bOk && gOk);
  }
  return flaskId != null || (battleId != null && guardianId != null);
}

async function analyzeLiveFight(reportCode, fight, reportStart) {
  const livePolicy = liveLoadPolicy();
  const liveBossPolicy = liveLoadBossPolicy();
  // Fetch summary (has gear data + player list)
  const summary = await wclApi(`/report/tables/summary/${reportCode}`, {
    start: fight.start_time, end: fight.end_time, translate: true
  });
  const players = getPlayersFromSummary(summary);
  if (!players.length) return { slackers: { buffs: [], spellranks: [] }, consumables: [], gearIssues: [], totalPlayers: 0 };

  // Fetch buffs for all players in parallel
  const buffResults = await Promise.all(players.map(p =>
    wclApi(`/report/tables/buffs/${reportCode}`, {
      start: fight.start_time, end: fight.end_time, sourceid: p.id, translate: true
    }).catch(() => ({ auras: [] }))
  ));
  // Report-wide buffs pro Spieler — Fallback für vor-Report-applied Flasks/Elixiere.
  // nocache, weil sich Bands während laufendem Raid ändern (neue Fights = neue Bands).
  const wideBuffResults = await Promise.all(players.map(p =>
    wclApi(`/report/tables/buffs/${reportCode}`, {
      start: 0, end: 9999999999, sourceid: p.id, translate: true
    }, { nocache: true }).catch(() => ({ auras: [] }))
  ));
  const LIVE_BUFF_DURATION_MS = {
    flask: 120 * 60 * 1000,
    battleElixir: 60 * 60 * 1000,
    guardianElixir: 60 * 60 * 1000,
    foodBuff: 60 * 60 * 1000,
  };
  function liveInferAura(playerIdx, guidSet, durationMs) {
    const auras = wideBuffResults[playerIdx]?.auras || [];
    for (const a of auras) {
      if (!guidSet.has(a.guid)) continue;
      for (const band of (a.bands || [])) {
        if (band.startTime <= fight.end_time && band.startTime + durationMs >= fight.start_time) {
          return { id: a.guid, name: a.name };
        }
      }
    }
    return null;
  }
  // Jüngsten Konsum-Band-Start im erlaubten Zeitfenster suchen — für Flask/Elixir Cancel-Mechanik
  function liveLatestConsume(playerIdx, guidSet, durationMs) {
    const auras = wideBuffResults[playerIdx]?.auras || [];
    let best = null;
    for (const a of auras) {
      if (!guidSet.has(a.guid)) continue;
      for (const band of (a.bands || [])) {
        if (band.startTime > fight.end_time) continue;
        if (band.startTime + durationMs < fight.start_time) continue;
        if (!best || band.startTime > best.time) best = { time: band.startTime, id: a.guid, name: a.name };
      }
    }
    return best;
  }
  function liveInferFlaskElixir(playerIdx) {
    const f = liveLatestConsume(playerIdx, BUFF_SETS.flask, LIVE_BUFF_DURATION_MS.flask);
    const b = liveLatestConsume(playerIdx, BUFF_SETS.battleElixir, LIVE_BUFF_DURATION_MS.battleElixir);
    const g = liveLatestConsume(playerIdx, BUFF_SETS.guardianElixir, LIVE_BUFF_DURATION_MS.guardianElixir);
    if (f && (!b || f.time >= b.time) && (!g || f.time >= g.time)) {
      return { flask: { id: f.id, name: f.name }, battleElixir: null, guardianElixir: null };
    }
    return {
      flask: null,
      battleElixir: b && (!f || b.time > f.time) ? { id: b.id, name: b.name } : null,
      guardianElixir: g && (!f || g.time > f.time) ? { id: g.id, name: g.name } : null,
    };
  }

  // Fetch casts for all players (for spell ranks)
  const castResults = await Promise.all(players.map(p =>
    wclApi(`/report/tables/casts/${reportCode}`, {
      start: fight.start_time, end: fight.end_time, sourceid: p.id, translate: true
    }).catch(() => ({ entries: [] }))
  ));

  // Hunter Melee-Weave + WF Detection — pro Hunter ein damage-done Call für den Fight.
  // WF-Attack-Damage = Hunter swingt Melee UND WF-Totem droppt für ihn.
  const liveHunterWeaves = new Set();
  await Promise.all(players.map(async (p, idx) => {
    if (p.type !== 'Hunter') return;
    try {
      const dd = await wclApi(`/report/tables/damage-done/${reportCode}`, {
        start: fight.start_time, end: fight.end_time, sourceid: p.id, translate: true
      }, { nocache: true });
      const entries = dd.entries || [];
      if (entries.some(e => WF_ATTACK_DAMAGE_IDS.includes(e.guid) && (e.total || 0) > 0)) {
        liveHunterWeaves.add(p.name);
      }
    } catch (_) {}
  }));

  // Fetch consumable + trinket-use + major-CD cast events via V2 (combined filter)
  const combinedFilterIds = [...CONSUMABLE_CAST_FILTER_IDS, ...ONUSE_TRINKET_SPELL_IDS, ...LIVE_CD_FILTER_IDS];
  const filterStr = `ability.id IN (${combinedFilterIds.join(',')})`;
  const castConsMap = new Map();
  const trinketCastMap = new Map(); // sourceID -> {spellId: count}
  const cdCastMap = new Map();      // sourceID -> {cdKey: count}
  let castEvents = [];
  try {
    castEvents = await fetchCastEventsV2(reportCode, fight.id, filterStr);
  } catch (e) {
    console.warn(`[v2] live cast events failed: ${e.message}`);
  }
  for (const ev of castEvents) {
    const gid = ev.abilityGameID;
    if (!gid) continue;
    const sid = ev.sourceID;
    const consInfo = CONSUMABLE_CAST_LOOKUP[gid];
    if (consInfo) {
      if (!castConsMap.has(sid)) castConsMap.set(sid, {});
      const pm = castConsMap.get(sid);
      pm[gid] = (pm[gid] || 0) + 1;
      continue;
    }
    if (ONUSE_TRINKETS[gid]) {
      if (!trinketCastMap.has(sid)) trinketCastMap.set(sid, {});
      const tm = trinketCastMap.get(sid);
      tm[gid] = (tm[gid] || 0) + 1;
      continue;
    }
    const cdInfo = LIVE_CD_LOOKUP[gid];
    if (cdInfo) {
      if (!cdCastMap.has(sid)) cdCastMap.set(sid, {});
      const cm = cdCastMap.get(sid);
      cm[cdInfo.key] = (cm[cdInfo.key] || 0) + 1;
    }
  }

  const buffSlackers = [];
  const spellrankSlackers = [];
  const gearIssues = [];
  const consumables = []; // per-player consumable usage
  const { LOWER_RANK_SPELLS } = SPELL_RANKS;

  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    const auras = buffResults[pi].auras || [];
    const className = classNameFromType(p.type);
    const role = getPlayerFightRole(summary, p.name, p.type);
    const isHealer = role.endsWith(':healer');

    // ── Buff/Consume Issues ──
    const buffIssues = [];

    // Flask / Elixir — Policy-aware. Game-Mechanik: Elixir cancelt Flask und umgekehrt.
    let flaskId = null, flaskName = null;
    let battleId = null, battleName = null;
    let guardianId = null, guardianName = null;
    for (const a of auras) { if (BUFF_SETS.flask.has(a.guid)) { flaskId = a.guid; flaskName = a.name; break; } }
    for (const a of auras) { if (BUFF_SETS.battleElixir.has(a.guid)) { battleId = a.guid; battleName = a.name; break; } }
    for (const a of auras) { if (BUFF_SETS.guardianElixir.has(a.guid)) { guardianId = a.guid; guardianName = a.name; break; } }
    // Inferenz nur wenn Direkt-Auren keine konkurrierenden Buffs aufzeigen,
    // und die Konsum-Timeline (jüngster Band-Start gewinnt) respektieren
    if (flaskId == null && battleId == null && guardianId == null) {
      const st = liveInferFlaskElixir(pi);
      if (st.flask) { flaskId = st.flask.id; flaskName = st.flask.name; }
      if (st.battleElixir) { battleId = st.battleElixir.id; battleName = st.battleElixir.name; }
      if (st.guardianElixir) { guardianId = st.guardianElixir.id; guardianName = st.guardianElixir.name; }
    } else {
      // Direkt-Auren existieren teilweise — Flask-Inferenz unterdrücken wenn Elixir direkt gesehen
      if (flaskId == null && battleId == null && guardianId == null) {
        const inf = liveInferAura(pi, BUFF_SETS.flask, LIVE_BUFF_DURATION_MS.flask);
        if (inf) { flaskId = inf.id; flaskName = inf.name; }
      }
      if (battleId == null && flaskId == null) {
        const inf = liveInferAura(pi, BUFF_SETS.battleElixir, LIVE_BUFF_DURATION_MS.battleElixir);
        if (inf) { battleId = inf.id; battleName = inf.name; }
      }
      if (guardianId == null && flaskId == null) {
        const inf = liveInferAura(pi, BUFF_SETS.guardianElixir, LIVE_BUFF_DURATION_MS.guardianElixir);
        if (inf) { guardianId = inf.id; guardianName = inf.name; }
      }
    }
    const flaskOk = liveIsFlaskOrElixirOk(role, flaskId, battleId, guardianId, livePolicy, fight && fight.name, liveBossPolicy);
    if (!flaskOk) {
      const fName = liveDisplayName(flaskId, flaskName);
      const bName = liveDisplayName(battleId, battleName);
      const gName = liveDisplayName(guardianId, guardianName);
      if (fName) buffIssues.push({ cat: 'Flask', text: `${fName} (Policy-Verstoss)`, policy: true, parts: [{ text: fName, spellId: flaskId }] });
      else if (bName && gName) buffIssues.push({ cat: 'Flask', text: `${bName} + ${gName} (Policy-Verstoss)`, policy: true, parts: [{ text: bName, spellId: battleId }, { text: gName, spellId: guardianId }] });
      else if (bName) buffIssues.push({ cat: 'Flask', text: `Nur ${bName} (kein Guardian)`, policy: true, parts: [{ text: bName, spellId: battleId }] });
      else if (gName) buffIssues.push({ cat: 'Flask', text: `Nur ${gName} (kein Battle)`, policy: true, parts: [{ text: gName, spellId: guardianId }] });
      else buffIssues.push({ cat: 'Flask', text: 'Fehlt' });
    }

    // Food
    let food = false;
    for (const a of auras) { if (BUFF_SETS.foodBuff.has(a.guid)) { food = true; break; } }
    // Fallback: Food vor Report-Start gegessen → via Report-wide Bands inferieren
    if (!food && liveInferAura(pi, BUFF_SETS.foodBuff, LIVE_BUFF_DURATION_MS.foodBuff)) food = true;
    if (!food) buffIssues.push({ cat: 'Food', text: 'Fehlt' });

    // Weapon Enhancement — Hunter mit Melee-Weave + WF braucht keinen Stein
    const weDetail = getPlayerDetailMap(summary)[p.name];
    const weResult = detectWeaponEnhancement(weDetail, p.type, auras);
    const isWeavingHunter = p.type === 'Hunter' && liveHunterWeaves.has(p.name);
    const weaponOk = hasWeaponEnh(weResult) || isWeavingHunter;
    if (!weaponOk) {
      if (weResult.isDW) {
        const parts = [];
        if (!weResult.mh) parts.push('MH');
        if (!weResult.oh) parts.push('OH');
        buffIssues.push({ cat: 'Weapon', text: parts.join('+') + ' fehlt' });
      } else {
        buffIssues.push({ cat: 'Weapon', text: 'Fehlt' });
      }
    }

    // Scrolls
    const scrollEntries = [];
    for (const a of auras) {
      if (BUFF_SETS.scrolls.has(a.guid)) {
        const ri = formatScrollWithRank(a.guid);
        scrollEntries.push({ label: ri.label, isMaxRank: ri.isMaxRank, spellId: a.guid });
      }
    }
    const missingScrolls = getMissingScrolls(scrollEntries, role);
    // Low rank scrolls
    const lowRankScrolls = scrollEntries.filter(s => !s.isMaxRank);

    // Pet-Scrolls deaktiviert (Logs nicht zuverlässig)

    const scrollIssueTexts = [];
    if (missingScrolls.length) scrollIssueTexts.push(missingScrolls.join(', ') + ' fehlt');
    if (lowRankScrolls.length) scrollIssueTexts.push(lowRankScrolls.map(s => s.label).join(', '));
    if (scrollIssueTexts.length) {
      buffIssues.push({ cat: 'Scrolls', text: scrollIssueTexts.join('; ') });
    }

    if (buffIssues.length) {
      buffSlackers.push({ name: p.name, type: p.type, issues: buffIssues });
    }

    // ── Consumable Usage ──
    const playerCons = { pot: 0, mana: 0, health: 0, rune: 0, engi: 0, other: 0, items: [] };
    // Buff-based consumables
    for (const a of auras) {
      const info = CONSUMABLE_BUFF_LOOKUP[a.guid];
      if (info) {
        const uses = a.totalUses || (a.bands && a.bands.length) || 1;
        playerCons[info.cat] = (playerCons[info.cat] || 0) + uses;
        playerCons.items.push({ label: info.label, cat: info.cat, uses, itemId: info.item, spellId: a.guid });
      }
    }
    // Cast-based consumables
    const castSpells = castConsMap.get(p.id) || {};
    for (const [gid, count] of Object.entries(castSpells)) {
      const info = CONSUMABLE_CAST_LOOKUP[Number(gid)];
      if (info) {
        playerCons[info.cat] = (playerCons[info.cat] || 0) + count;
        playerCons.items.push({ label: info.label, cat: info.cat, uses: count, itemId: info.item, spellId: Number(gid) });
      }
    }
    const totalUses = playerCons.pot + playerCons.mana + playerCons.health + playerCons.rune + playerCons.engi + playerCons.other;
    consumables.push({ name: p.name, type: p.type, isHealer, ...playerCons, total: totalUses });

    // ── Spell Rank Issues ──
    const spellIssues = [];
    for (const entry of (castResults[pi].entries || [])) {
      const lowerInfo = LOWER_RANK_SPELLS[entry.guid];
      if (lowerInfo && entry.total > 0) {
        spellIssues.push({
          spellName: lowerInfo.name, spellId: entry.guid, maxId: lowerInfo.maxId,
          rank: lowerInfo.rank, maxRank: lowerInfo.maxRank, casts: entry.total,
        });
      }
    }
    if (spellIssues.length) {
      spellrankSlackers.push({ name: p.name, type: p.type, isHealer, issues: spellIssues });
    }

    // ── Gear Issues ──
    const playerGearIssues = checkPlayerGear(p, className);
    if (playerGearIssues.length) {
      gearIssues.push({ name: p.name, type: p.type, issues: playerGearIssues });
    }
  }

  // Sort
  buffSlackers.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  spellrankSlackers.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  gearIssues.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  consumables.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Build trinket usage + slacker list pro Spieler für diesen Fight
  const trinketUsage = [];
  const trinketSlackers = [];
  for (const p of players) {
    const tm = trinketCastMap.get(p.id) || {};
    // Equipped on-use trinkets (slot 12/13)
    const gear = (p.combatantInfo && p.combatantInfo.gear) || [];
    const equipped = [];
    for (const slotIdx of [12, 13]) {
      const item = gear[slotIdx];
      if (!item || !item.id) continue;
      const useSpell = ONUSE_TRINKET_ITEM_TO_SPELL[item.id];
      if (!useSpell) continue;
      const uses = tm[useSpell] || 0;
      const def = ONUSE_TRINKETS[useSpell] || { item: item.id, name: 'Unknown' };
      equipped.push({ spellId: useSpell, itemId: item.id, name: def.name, uses });
    }
    // Used items (auch wenn nicht in equipped — z.B. wenn gear-snapshot fehlt)
    const usedItems = Object.entries(tm).map(([spellId, count]) => {
      const def = ONUSE_TRINKETS[spellId] || { item: 0, name: 'Unknown' };
      return { spellId: Number(spellId), itemId: def.item, name: def.name, uses: count };
    });
    if (usedItems.length) {
      usedItems.sort((a, b) => b.uses - a.uses);
      const total = usedItems.reduce((s, i) => s + i.uses, 0);
      trinketUsage.push({ name: p.name, type: p.type, items: usedItems, total });
    }
    // Slacker: equipped on-use trinket aber nicht benutzt
    const unused = equipped.filter(e => e.uses === 0);
    if (unused.length) trinketSlackers.push({ name: p.name, type: p.type, unused });
  }
  trinketUsage.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  trinketSlackers.sort((a, b) => b.unused.length - a.unused.length || a.name.localeCompare(b.name));

  // Build CD usage + slacker list pro Spieler für diesen Fight (2-8 min CDs)
  const cdUsage = [];
  const cdSlackers = [];
  for (const p of players) {
    const role = getPlayerFightRole(summary, p.name, p.type);
    const expected = LIVE_CD_ROLE_EXPECTATIONS[role] || [];
    const cm = cdCastMap.get(p.id) || {};
    const usedKeys = Object.keys(cm);
    if (usedKeys.length > 0) {
      const items = usedKeys.map(k => {
        const def = MAJOR_COOLDOWNS[k] || { name: k, ids: [] };
        return { key: k, name: def.name, spellId: def.ids[0] || 0, uses: cm[k] };
      }).sort((a, b) => b.uses - a.uses);
      const total = items.reduce((s, i) => s + i.uses, 0);
      cdUsage.push({ name: p.name, type: p.type, role, items, total });
      continue;
    }
    // Niemand gecastet → Slacker check (nur wenn role-mäßig erwartet)
    if (expected.length > 0) {
      const missing = expected.map(k => {
        const def = MAJOR_COOLDOWNS[k] || { name: k, ids: [] };
        return { key: k, name: def.name, spellId: def.ids[0] || 0 };
      });
      cdSlackers.push({ name: p.name, type: p.type, role, missing });
    }
  }
  cdUsage.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  cdSlackers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    slackers: { buffs: buffSlackers, spellranks: spellrankSlackers },
    consumables,
    gearIssues,
    trinketUsage,
    trinketSlackers,
    cdUsage,
    cdSlackers,
    totalPlayers: players.length,
  };
}

// ─── Progress reporter (set by server.js to surface pipeline state) ───

let progressReporter = () => {};
function setProgressReporter(fn) { progressReporter = typeof fn === 'function' ? fn : () => {}; }
function reportStep(state) { try { progressReporter(state); } catch (_) {} }

// ─── Exports & CLI ───

module.exports = {
  checkAndAnalyzeNewReports, processReport, analyzeLiveFight, wclApi, classNameFromType, isValidClass, CLA_DATA, setProgressReporter,
  // Tracking-Config Read-Only Dumps (für Admin-UI)
  getTrackingConfig: () => ({
    consumableBuffs: CONSUMABLE_BUFF_IDS,
    consumableCasts: CONSUMABLE_CAST_IDS,
    onuseTrinkets: ONUSE_TRINKETS,
    majorCooldowns: MAJOR_COOLDOWNS,
    liveCdRoleExpectations: LIVE_CD_ROLE_EXPECTATIONS,
    buffSetIds: BUFF_IDS,
  }),
};

// Run directly: node preanalyze.js
if (require.main === module) {
  checkAndAnalyzeNewReports().then(() => {
    console.log('[PRE] Done');
    process.exit(0);
  }).catch(e => {
    console.error('[PRE] Fatal:', e);
    process.exit(1);
  });
}
