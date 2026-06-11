// kb/bossKB.js — Boss-Knowledge-Base fuer TBC-Classic-Fight-Diagnosen
//
// JEDE Spell-ID hier ist verifiziert:
//   'logs'     = als Killing-Ability in den eigenen WCL-Reports beobachtet (Ground Truth)
//   'research' = per tbc.wowhead.com/spell=ID aufgeloest, Name bestaetigt
//                (Agenten-Verifikation 2026-06-11: 165 geprueft, 23 verworfen)
// Verworfene IDs stehen als Kommentar an der jeweiligen Mechanik.
// Leere spellIds = Mechanik real, aber keine verifizierte ID -> Matching nur ueber Ability-Namen.

const BLAME = {
  PLAYER: 'player',         // individueller Movement-/Reaktionsfehler
  HEALER: 'healer',         // Heil-Assignment / Topping / Triage
  TANK: 'tank',             // Tank-Positionierung / Pickup / Swap
  ASSIGNMENT: 'assignment', // Raid-Zuteilung fehlte/versagte (Kicks, Totems, Kiter, Cubes)
  DPS: 'dps',               // Enrage / Soft-Enrage / Burn zu langsam
  RAIDLEAD: 'raidlead',     // Call/Timing des Leads (Transitions, Repositionierung)
  DISPEL: 'dispel',
  INTERRUPT: 'interrupt',
};

const SPECIAL = { MELEE: [1, -16], FALLING: [3], UNKNOWN: [0, null] };

const bossKB = {

  // ===================== SSC =====================
  'Hydross the Unstable': {
    zone: 'SSC',
    mechanics: [
      { key: 'markFrost',  name: 'Mark of Hydross',  spellIds: [38215,38216,38217,38218,38231], idSource: 'research', avoidable: false, blame: [BLAME.RAIDLEAD, BLAME.HEALER],
        diagnosis: 'Tod mit Mark-Stufe ≥4 → Transition zu spät gecallt oder Heiler-Seite zu dünn — nie Spielerfehler.' },
      { key: 'markNature', name: 'Mark of Corruption', spellIds: [38219,38220,38221,38222,38230], idSource: 'research', avoidable: false, blame: [BLAME.RAIDLEAD, BLAME.HEALER],
        diagnosis: 'Wie Mark of Hydross, Natur-Seite — Heiler-Verteilung auf beide Seiten prüfen.' },
      { key: 'waterTomb',  name: 'Water Tomb', spellIds: [38235], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Mehrere im Tomb = Spread-Fehler; Einzeltod = Heiler-Reaktion zu langsam.' },
      { key: 'vileSludge', name: 'Vile Sludge', spellIds: [38246], idSource: 'research', avoidable: false, blame: [BLAME.DISPEL],
        diagnosis: 'Tod mit Sludge aktiv = Dispel-Versäumnis, nicht das Opfer.' },
    ],
    // 167 Melee-Tode (-16) = Top-Killer im eigenen Log!
    meleeDiagnosis: 'Tod <15s nach Phasenwechsel → Add-Pickup/Transition-Chaos (Tank/Raidlead); sonst Tank-Rotation bei hohen Marks prüfen.',
  },

  'The Lurker Below': {
    zone: 'SSC',
    mechanics: [
      { key: 'spout',  name: 'Spout',  spellIds: [37433], altIds: [37431], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Nicht untergetaucht — fast immer individueller Movement-Fehler. 8 Tode im eigenen Log.' },
      { key: 'whirl',  name: 'Whirl',  spellIds: [37660], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Ranged getroffen = stand zu nah; Melee-Tod = Melee nicht vorgeheilt.' },
      { key: 'geyser', name: 'Geyser', spellIds: [37478], idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'Geyser killt nur Vorgeschädigte → Plattform-Heilabdeckung prüfen.' },
      { key: 'waterBolt', name: 'Water Bolt', spellIds: [37138], idSource: 'research', avoidable: true, blame: [BLAME.TANK],
        diagnosis: 'Boss ohne Melee-Ziel (nach Spout) → Tank-Wiederaufnahme, nicht das Opfer.' },
    ],
    meleeDiagnosis: 'Tod in Submerge-Phase → Ambusher/Guardian-Assignment versagt (Spawn-Plattform-Zuteilung).',
  },

  'Leotheras the Blind': {
    zone: 'SSC',
    mechanics: [
      { key: 'whirlwind', name: 'Whirlwind', spellIds: [37641], altIds: [37640], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: '31 eigene Tode. Wiederholt derselbe Spieler = Movement-Problem; viele gleichzeitig = Spread-Problem.' },
      { key: 'chaosBlast', name: 'Chaos Blast', spellIds: [37674,37675], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT, BLAME.HEALER],
        diagnosis: 'Lock-Tank-Stacks zu hoch (2. Lock fehlt) oder Demo-Tank-Heilung dünn; Nicht-Tank-Tod = Threat-Fehler.' },
      { key: 'innerDemon', name: 'Insidious Whisper / Inner Demon', spellIds: [37676], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Eigenen Dämon nicht getötet — eindeutig individuell; Heiler brauchen Schadensplan.' },
      { key: 'madness', name: 'Consuming Madness', spellIds: [37749], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Folge des verkackten Inner-Demon-Checks — eindeutige Spielerschuld.' },
    ],
    meleeDiagnosis: 'Tod nach WW-Aggro-Reset = DD ohne Threat-Stopp; unter 15% = Split-Heilverteilung.',
  },

  'Fathom-Lord Karathress': {
    zone: 'SSC',
    mechanics: [
      { key: 'cataBolt', name: 'Cataclysmic Bolt', spellIds: [38441], idSource: 'both', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: '44 eigene Tode! Trifft 50% Max-HP → Opfer war unter 50% = Heiler-Thema; Häufung → HP-Pools/Stam-Food.' },
      { key: 'spitfire', name: 'Spitfire Totem', spellIds: [38236], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Totem-Kill-Squad versagt — nie Schuld des Opfers.' },
      { key: 'frostShock', name: 'Frost Shock (Tidalvess)', spellIds: [38234], idSource: 'research', avoidable: false, blame: [BLAME.HEALER, BLAME.TANK],
        diagnosis: 'Tidalvess-Tank-Spike → Heiler-Zuteilung/CDs.' },
      { key: 'tidalSurge', name: 'Tidal Surge', spellIds: [38358], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Zu eng bei Caribdis gestanden, Heiler mitgestunnt.' },
      { key: 'boltVolley', name: 'Water Bolt Volley', spellIds: [38335], idSource: 'research', avoidable: false, blame: [BLAME.INTERRUPT, BLAME.HEALER],
        diagnosis: 'Mit Healing-Wave-Durchlässen korrelieren → Interrupt-Rotation Caribdis.' },
      { key: 'cyclone', name: 'Summon Cyclone', spellIds: [38337], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Tornado nicht ausgewichen → Heilausfall in der Caribdis-Gruppe.' },
    ],
    mustInterrupt: [{ name: 'Healing Wave (Caribdis)', spellIds: [38330] }],
    meleeDiagnosis: '108 Melee-Tode: Quell-NPC prüfen — Guard-Tank tot (Heiler) vs. Pet-Tode (Sharkkis-Pet-Assignment).',
  },

  'Morogrim Tidewalker': {
    zone: 'SSC',
    mechanics: [
      { key: 'grave', name: 'Watery Grave', spellIds: [38049,37850,38023,38024,38025], idSource: 'research', avoidable: false, blame: [BLAME.HEALER, BLAME.ASSIGNMENT],
        diagnosis: 'Opfer kann nichts tun — dedizierte Grave-Heiler fehlen oder außer Reichweite.' },
      { key: 'tidalWave', name: 'Tidal Wave', spellIds: [37730], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Nicht-Tank frontal getroffen = Positionsfehler.' },
      { key: 'earthquake', name: 'Earthquake', spellIds: [37764], idSource: 'research', avoidable: false, blame: [BLAME.TANK, BLAME.ASSIGNMENT],
        diagnosis: 'Folgetode = Murloc-Pickup zu langsam, nicht das Opfer.' },
      { key: 'globule', name: 'Water Globule', spellIds: [] /* verworfen (Wowhead-Mismatch): 37871=Freeze */, idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.ASSIGNMENT],
        diagnosis: 'Nicht gekitet + Ranged-Kill-Assignment prüfen (nur <50% Boss-HP relevant).' },
    ],
    meleeDiagnosis: '28 Melee-Tode: Tod <10s nach Earthquake (37764-Cast in bossCasts) → Murloc-Welle = Pickup-Fail.',
  },

  'Lady Vashj': {
    zone: 'SSC',
    mechanics: [
      { key: 'forkedLightning', name: 'Forked Lightning', spellIds: [38145], idSource: 'logs', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: '27 eigene Tode (Top-Killer): Frontal-Kegel in P1/P3 — vor dem Boss gestanden.' },
      { key: 'shoot', name: 'Shoot/Multi-Shot (Entangle-Fenster)', spellIds: [38295], altIds: [38310] /* verworfen (Wowhead-Mismatch): 38316=Entangle */, idSource: 'both', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: '21 eigene Tode: Boss schießt Raid während Entangle → Heiler-Vorhalte fürs Entangle-Fenster.' },
      { key: 'staticCharge', name: 'Static Charge', spellIds: [38280], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.DISPEL],
        diagnosis: 'Umstehende tot = Träger nicht rausgelaufen; Träger allein tot = Heiler-Follow.' },
      { key: 'shockBlast', name: 'Shock Blast', spellIds: [38509], idSource: 'research', avoidable: false, blame: [BLAME.HEALER, BLAME.TANK],
        diagnosis: 'Tank nicht topped beim sichtbaren Cast → CD-Timing.' },
      { key: 'toxicSpores', name: 'Toxic Spores', spellIds: [38575], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.DPS],
        diagnosis: 'In der Fläche gestanden; Häufung spät in P3 = auch DPS-Thema.' },
      { key: 'poisonBolt', name: 'Poison Bolt (Tainted Elemental)', spellIds: [38253], idSource: 'research', avoidable: false, blame: [BLAME.DISPEL, BLAME.ASSIGNMENT],
        diagnosis: 'Poison-Cleanse-Assignment oder Elemental-Focus versagt.' },
      { key: 'persuasion', name: 'Persuasion (MC)', spellIds: [38511], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'CC auf MC-Ziel fehlte.' },
    ],
    meleeDiagnosis: 'P2-Tode mit Fear → Strider im Raid = Kiter-Fail (NPC 22056); sonst Naga-Pickup.',
  },

  // ===================== TK =====================
  "Al'ar": {
    zone: 'TK',
    mechanics: [
      { key: 'flamePatch', name: 'Flame Patch', spellIds: [35383], altIds: [35380], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Im Feuer gestanden — reiner Movement-Fehler.' },
      { key: 'flameBuffet', name: 'Flame Buffet', spellIds: [34121], idSource: 'research', avoidable: true, blame: [BLAME.TANK],
        diagnosis: 'Boss ohne Melee-Ziel → Plattform-Übergabe/Tank nach Dive Bomb zu langsam.' },
      { key: 'diveBomb', name: 'Dive Bomb', spellIds: [35181,35367], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Umstehende tot = Spread; Ziel selbst bei niedrigen HP = Raid nicht getoppt.' },
      { key: 'emberBlast', name: 'Ember Blast', spellIds: [34341], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Ember im Raid statt abseits gekillt.' },
      { key: 'meltArmor', name: 'Melt Armor + Charge', spellIds: [35410,35412], idSource: 'research', avoidable: false, blame: [BLAME.TANK, BLAME.HEALER],
        diagnosis: 'Tankwechsel nicht ausgeführt.' },
      { key: 'flameQuills', name: 'Flame Quills', spellIds: [34229], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Raummitte nicht verlassen.' },
    ],
  },

  'Void Reaver': {
    zone: 'TK',
    mechanics: [
      { key: 'pounding', name: 'Pounding', spellIds: [34164], altIds: [34162], idSource: 'both', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: '11 eigene Tode: für Melee NICHT ausweichbar → Melee-Gruppen-Heilung prüfen, nie Movement-Schuld.' },
      { key: 'arcaneOrb', name: 'Arcane Orb', spellIds: [34190], altIds: [34172], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: '7 eigene Tode: stehengeblieben oder <20m Spread.' },
      { key: 'knockAway', name: 'Knock Away (Folge-Aggro)', spellIds: [25778], altIds: [37102], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'DPS-Tod direkt danach = Threat ignoriert.' },
      { key: 'berserk', name: 'Berserk', spellIds: [26662], idSource: 'research', avoidable: true, blame: [BLAME.DPS],
        diagnosis: 'Tode nach 10 min = reines DPS-Problem.' },
    ],
  },

  'High Astromancer Solarian': {
    zone: 'TK',
    mechanics: [
      { key: 'arcaneMissiles', name: 'Arcane Missiles', spellIds: [39414], altIds: [33031], idSource: 'both', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: '10 eigene Tode: killt nur Untergeheilte → Raid-Topping.' },
      { key: 'wrath', name: 'Wrath of the Astromancer', spellIds: [42783,42784], altIds: [33044,33045], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Träger nicht raus / Fallschaden ohne Slowfall; Umstehende tot = Spread.' },
      { key: 'psychicScream', name: 'Psychic Scream + Void Bolt (P3)', spellIds: [34322,39329], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Fear Ward/Tremor auf Tank fehlte — klassische P3-Todesursache.' },
    ],
    mustInterrupt: [{ name: 'Great Heal (Solarium Priest)', spellIds: [33387] }],
  },

  "Kael'thas Sunstrider": {
    zone: 'TK',
    mechanics: [
      // ACHTUNG: Advisor-Abilities laufen im Log unter dem Kael-Encounter!
      { key: 'capernianFireball', name: 'Fireball (Capernian, P1/P3)', spellIds: [36971], idSource: 'both', avoidable: false, blame: [BLAME.ASSIGNMENT, BLAME.HEALER],
        diagnosis: '40 eigene Tode: Capernian braucht Warlock-Range-Tank; Random-Tode = Heiler-Triage P1/P3.' },
      { key: 'telonicusBomb', name: 'Bomb (Telonicus)', spellIds: [37036], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER, BLAME.TANK],
        diagnosis: '31 eigene Tode: Telonicus nicht abseits getankt oder im Bomb-AoE gestanden.' },
      { key: 'remoteToy', name: 'Remote Toy (Telonicus)', spellIds: [37027], idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'Toy-Träger (4s-Stun) nicht im Heiler-Fokus.' },
      { key: 'conflag', name: 'Conflagration (Capernian)', spellIds: [37018], idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'Disorient-DoT trifft Umstehende — Spread um Capernian.' },
      { key: 'arcaneBurst', name: 'Arcane Burst (Capernian)', spellIds: [36970], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Melee an Capernian = falsches Assignment.' },
      { key: 'psychicBlow', name: 'Psychic Blow (Thaladred)', spellIds: [36966], altIds: [] /* verworfen (Wowhead-Mismatch): 36965=Rend, 30225=Silence */, idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Gaze-Ziel nicht weggerannt.' },
      { key: 'pyroblast', name: 'Pyroblast (P4)', spellIds: [36819], idSource: 'research', avoidable: true, blame: [BLAME.DPS, BLAME.INTERRUPT],
        diagnosis: 'Shock Barrier (36815) nicht weggebrannt + Kick verpasst.' },
      { key: 'kaelFireball', name: 'Fireball (Kael, P4/P5)', spellIds: [36805], idSource: 'research', avoidable: true, blame: [BLAME.INTERRUPT],
        diagnosis: 'Kick-Rotation gerissen (Backup-Kicker bei MC fehlte).' },
      { key: 'flamestrike', name: 'Flamestrike', spellIds: [36735], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Im Flamestrike stehengeblieben.' },
      { key: 'mindControl', name: 'Mind Control', spellIds: [36797,36798], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'MC-Breaking-Plan (Infinity Blades) fehlte.' },
      { key: 'phoenixBurn', name: 'Phoenix Burn', spellIds: [36720,36721], altIds: [] /* verworfen (Wowhead-Mismatch): 36723=Phoenix */, idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Phoenix nicht gekitet / Ei nicht gekillt.' },
      { key: 'netherBeam', name: 'Nether Beam (P5)', spellIds: [35873], altIds: [35869], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Ketten-Tode = kein Spread während Gravity Lapse.' },
      { key: 'netherVapor', name: 'Nether Vapor (P5)', spellIds: [35858], altIds: [35865], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'In Wolken geflogen; reduziert Max-HP → als Mitverursacher werten.' },
      { key: 'gravityLapse', name: 'Gravity Lapse / Fallschaden', spellIds: [35941,34480,39432, ...SPECIAL.FALLING], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Falling-Tod nach Lapse-Ende = zu hoch geflogen.' },
    ],
    meleeDiagnosis: '114 Melee-Tode: per Phase trennen — P2 = Devastation/Waffen-Pickup, P3 = Advisor-Rez-Pickup, P4 = Threat.',
  },

  // ===================== Gruul / Mag =====================
  'High King Maulgar': {
    zone: "Gruul's Lair",
    mechanics: [
      { key: 'arcingSmash', name: 'Arcing Smash (Maulgar)', spellIds: [39144], idSource: 'logs', avoidable: true, blame: [BLAME.PLAYER, BLAME.TANK],
        diagnosis: '22 eigene Tode (Top-Killer): Frontal-Kegel — Nicht-Tanks standen vor Maulgar / Tank-Drehung.' },
      { key: 'whirlwind', name: 'Whirlwind (Maulgar)', spellIds: [33238,33239], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Melee nicht rausgelaufen.' },
      { key: 'mightyBlow', name: 'Mighty Blow + Flurry', spellIds: [33230,33232], idSource: 'research', avoidable: false, blame: [BLAME.HEALER, BLAME.TANK],
        diagnosis: 'Tank-Spike <50% (Flurry) — CD-Plan.' },
      { key: 'greaterFireball', name: 'Greater Fireball (Krosh)', spellIds: [33051], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Nicht-Mage getroffen = Mage-Tank-Fail; Mage tot = Spell Shield (33054) nicht erneuert.' },
      { key: 'blastWave', name: 'Blast Wave (Krosh)', spellIds: [33061], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Jemand stand <15m an Krosh.' },
      { key: 'arcaneExplosion', name: 'Arcane Explosion (Kiggler)', spellIds: [33237], altIds: [] /* verworfen (Wowhead-Mismatch): 33175=Arcane Shock, 33173=Greater Polymorph */, idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Kiggler muss auf Range getankt werden.' },
      { key: 'deathCoil', name: 'Death Coil / Dark Decay (Olm)', spellIds: [33130,33129], altIds: [] /* verworfen (Wowhead-Mismatch): 33131=Summon Wild Felhunter */, idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT, BLAME.HEALER],
        diagnosis: 'Warlock-Tank-Setup / Felhunter-Banish prüfen.' },
    ],
    mustInterrupt: [{ name: 'Prayer of Healing (Blindeye)', spellIds: [33152], altIds: [] /* verworfen (Wowhead-Mismatch): 33144=Heal, 33147=Greater Power Word: Shield */ }],
  },

  'Gruul the Dragonkiller': {
    zone: "Gruul's Lair",
    mechanics: [
      { key: 'shatter', name: 'Shatter', spellIds: [33671], altIds: [33654] /* verworfen (Wowhead-Mismatch): 33525=Ground Slam, 33652=Stoned, 33572=Gronn Lord's Grasp */, idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: '24 eigene Tode: nach Ground Slam nicht 15m+ gespreadet, bevor Stoned greift.' },
      { key: 'hurtfulStrike', name: 'Hurtful Strike', spellIds: [33813], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Melee-DPS war #2 Aggro statt OT.' },
      { key: 'caveIn', name: 'Cave In', spellIds: [36240], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'In der Steinzone stehengeblieben.' },
      { key: 'growth', name: 'Growth (Soft Enrage)', spellIds: [36300], idSource: 'research', avoidable: false, blame: [BLAME.DPS],
        diagnosis: 'Tank-Tode ab ~12-15 Stacks = DPS-Problem, kein Heiler-Fail. Stack-Zahl beim Wipe = Kern-Metrik.' },
      { key: 'reverberation', name: 'Reverberation (Silence)', spellIds: [36297], idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'HoTs/Shield müssen VOR dem Silence liegen — Vorhalte-Regel.' },
    ],
  },

  'Magtheridon': {
    zone: "Magtheridon's Lair",
    mechanics: [
      { key: 'blastNova', name: 'Blast Nova', spellIds: [30613], altIds: [30616], idSource: 'both', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: '151 eigene Tode — tödlichste Einzel-Ability ALLER Logs. Cube-Fail: Klicker tot/zu früh/doppelt/Mind Exhaustion (44032) ohne Backup. Prüfen: welcher Shadow-Grasp-Channel (30166/30410) fehlte.' },
      { key: 'cleave', name: 'Cleave', spellIds: [30619], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: '35 eigene Tode: Nicht-Tank vor dem Boss.' },
      { key: 'quake', name: 'Quake', spellIds: [30571], altIds: [30657,30658], idSource: 'research', avoidable: false, blame: [BLAME.PLAYER, BLAME.RAIDLEAD],
        diagnosis: 'Folge-Fails: in Blaze geworfen / Cube-Klick verpasst — Safe-Spots an der Wand.' },
      { key: 'blaze', name: 'Blaze', spellIds: [30541,30542], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Im Feuer stehengeblieben.' },
      { key: 'debris', name: 'Debris / Collapse (P3)', spellIds: [36449,30631,30632], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Initialer Kollaps: Raid muss VOR 30% topfit sein (Raidlead callt Stopp-DPS).' },
      { key: 'p1Channelers', name: 'P1: Shadow Bolt Volley / Fear', spellIds: [30510,30530], altIds: [39175,30528] /* verworfen (Wowhead-Mismatch): 30511=Burning Abyssal, 30531=Soul Transfer */, idSource: 'research', avoidable: true, blame: [BLAME.INTERRUPT, BLAME.ASSIGNMENT],
        diagnosis: 'P1-Tode = Kick-/CC-/Tremor-Fail.' },
    ],
    mustInterrupt: [{ name: 'Dark Mending (Channeler)', spellIds: [30528] }],
    meleeDiagnosis: '41 Melee-Tode: P1 = Channeler-/Abyssal-Pickup; P2+ = Fear ohne Tremor → Boss im Raid.',
  },

  // ===================== Karazhan =====================
  'Shade of Aran': {
    zone: 'Karazhan',
    mechanics: [
      { key: 'flameWreath', name: 'Flame Wreath', spellIds: [29947], altIds: [29946,30004], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Markierter hat sich bewegt/gesprungen — eindeutig. Klassiker: mit Arcane-Kombo verwechselt.' },
      { key: 'arcaneCombo', name: 'Arcane Explosion (Teleport-Kombo)', spellIds: [29973], altIds: [] /* verworfen (Wowhead-Mismatch): 30035=Mass Slow, 29991=Chains of Ice */, idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.DISPEL],
        diagnosis: 'Nicht rausgelaufen; Chains of Ice (29991) nicht dispellt.' },
      { key: 'blizzard', name: 'Circular Blizzard', spellIds: [29952], altIds: [29951], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Nicht mitgelaufen.' },
      { key: 'pyroblast', name: 'Pyroblast (nach Drink)', spellIds: [29978], altIds: [] /* verworfen (Wowhead-Mismatch): 29963=Mass Polymorph, 30024=Drink */, idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'Raid war vor/während Mass Polymorph nicht auf 100%.' },
      { key: 'waterBolt', name: 'Water Bolt (Elementare, 40%)', spellIds: [37054], idSource: 'logs', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: '5 eigene Tode: Elementare nicht gebanisht/gefocust.' },
      { key: 'nukes', name: 'Frostbolt/Fireball/Missiles', spellIds: [29954,29953,29955] /* verworfen (Wowhead-Mismatch): 29964=Dragon's Breath */, idSource: 'research', avoidable: false, blame: [BLAME.INTERRUPT, BLAME.HEALER],
        diagnosis: 'Kick-Rotation zu dünn oder Random-Triage zu langsam.' },
    ],
  },

  'Prince Malchezaar': {
    zone: 'Karazhan',
    mechanics: [
      { key: 'shadowNova', name: 'Enfeeble → Shadow Nova', spellIds: [30852], altIds: [30843], idSource: 'both', avoidable: true, blame: [BLAME.PLAYER, BLAME.RAIDLEAD],
        diagnosis: '8 eigene Tode: mit Enfeeble nicht aus 30m gelaufen — oder Camp von vornherein zu nah.' },
      { key: 'hellfire', name: 'Infernal Hellfire', spellIds: [30859], altIds: [39131] /* verworfen (Wowhead-Mismatch): 30834=Infernal Relay, 37277=Summon Infernal */, idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.RAIDLEAD],
        diagnosis: 'Tod an ALTEN Infernalen = immer Spielerfehler; P3-Häufung = Repositionierungs-Calls fehlen.' },
      { key: 'swp', name: 'Shadow Word: Pain', spellIds: [30854,30898], idSource: 'research', avoidable: true, blame: [BLAME.DISPEL],
        diagnosis: 'Magie-Dispel-Prio versäumt, kritisch mit Amplify in P3.' },
      { key: 'amplify', name: 'Amplify Damage (P3)', spellIds: [39095], idSource: 'research', avoidable: false, blame: [BLAME.HEALER],
        diagnosis: 'Amplify-Ziel nicht fokussiert/geschildet.' },
      { key: 'thrash', name: 'Thrash (P2)', spellIds: [12787], altIds: [] /* verworfen (Wowhead-Mismatch): 30901=Sunder Armor */, idSource: 'research', avoidable: false, blame: [BLAME.HEALER, BLAME.TANK],
        diagnosis: 'P2-Tank-Tod = 3er-Hit-Spike → CD-Plan + 2-3 Heiler.' },
    ],
    meleeDiagnosis: '18 Melee-Tode: in P2 = Thrash-Spike (Heiler/CDs), sonst Aggro.',
  },

  'Netherspite': {
    zone: 'Karazhan',
    mechanics: [
      { key: 'redBeam', name: 'Perseverence (rot)', spellIds: [30400], altIds: [30421], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.ASSIGNMENT],
        diagnosis: 'Tank-Tod = Stacks zu hoch (Rotation) ODER jemand lief durch den Beam und klaute den Buff.' },
      { key: 'blueBeam', name: 'Dominance (blau)', spellIds: [30402], altIds: [30423], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT, BLAME.HEALER],
        diagnosis: 'Blocker zu lange drin oder kein Heiler-Fokus.' },
      { key: 'greenBeam', name: 'Serenity (grün)', spellIds: [30401], altIds: [30422], idSource: 'research', avoidable: true, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Ungeblockt heilt den Boss → Enrage-Wipe ist dann KEIN DPS-Fail (Buff 30422 in Logs prüfen).' },
      { key: 'voidZone', name: 'Void Zone', spellIds: [37063], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Nicht (im Korridor seitlich) ausgewichen.' },
      { key: 'netherbreath', name: 'Netherbreath + Nether Burn', spellIds: [38523,30522], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER, BLAME.HEALER],
        diagnosis: 'Banish-Phase: Spread-Fail oder Raid nicht hochgeheilt.' },
      { key: 'enrage', name: 'Nether Infusion', spellIds: [38688], idSource: 'research', avoidable: false, blame: [BLAME.DPS, BLAME.ASSIGNMENT],
        diagnosis: 'Erst Portal-Buffs 30421/30422 prüfen, bevor DPS beschuldigt wird.' },
    ],
  },

  'Nightbane': {
    zone: 'Karazhan',
    mechanics: [
      { key: 'bellowingRoar', name: 'Bellowing Roar (Fear-Kombo)', spellIds: [36922], altIds: [39427], idSource: 'research', avoidable: false, blame: [BLAME.ASSIGNMENT],
        diagnosis: 'Tode <5s nach Roar = Fear-Counter (Berserker Rage/Ward/Tremor) fehlte.' },
      { key: 'charredEarth', name: 'Charred Earth', spellIds: [30129], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Im Feuer gestanden (oft reingefeart → mit Roar-Timing korrelieren).' },
      { key: 'breathCleave', name: 'Smoldering Breath / Cleave / Tail Sweep', spellIds: [30210,30131,25653], idSource: 'research', avoidable: true, blame: [BLAME.PLAYER],
        diagnosis: 'Front/Hinten gestanden — Melee seitlich.' },
      { key: 'airPhase', name: 'Rain of Bones / Smoking Blast / Barrage', spellIds: [37098,37057,30128,30282], idSource: 'research', avoidable: true, blame: [BLAME.HEALER, BLAME.PLAYER],
        diagnosis: 'Smoking-Blast-Tod = Heiler-Fokus-Fail; Barrage-Tod = zu weit weg statt gestackt.' },
      { key: 'searingCinders', name: 'Searing Cinders', spellIds: [30127], idSource: 'research', avoidable: false, blame: [BLAME.DISPEL],
        diagnosis: 'DoT nicht dispellt/gegengeheilt.' },
    ],
    meleeDiagnosis: '15 Melee-Tode: nach Roar = Boss drehte in den gefearten Raid (Fear-Plan), Luftphase = Skelett-Pickup.',
  },

  // Nur-Log-Einträge (keine Recherche, aber eigene Tode):
  'Moroes': { zone: 'Karazhan', mechanics: [], meleeDiagnosis: '13 Melee-Tode: Garrote-/Add-Tank-Zuteilung prüfen (Quell-NPC im Death-Event).' },
  'Maiden of Virtue': { zone: 'Karazhan', mechanics: [
    { key: 'holyWrath', name: 'Holy Wrath', spellIds: [32445], idSource: 'logs', avoidable: true, blame: [BLAME.PLAYER],
      diagnosis: 'Chain-Schaden eskaliert pro Sprung — Spread-Fail.' }] },
};

// ---- Reverse-Index für O(1)-Matching von killingBlow.id ----
function buildSpellIndex(kb) {
  const idx = new Map();
  for (const [boss, def] of Object.entries(kb)) {
    for (const m of def.mechanics || []) {
      for (const id of [...(m.spellIds || []), ...(m.altIds || [])]) {
        if (id != null && id > 3) idx.set(id, { boss, mechanic: m });
      }
    }
  }
  return idx;
}

module.exports = { bossKB, BLAME, SPECIAL, buildSpellIndex };


module.exports = { bossKB, BLAME, SPECIAL };
