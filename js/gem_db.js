/**
 * TBC Gem Database for CLA
 * Fixes two issues:
 * 1. Gem quality detection (itemLevel alone is unreliable - Ornate/Pearl gems have iLvl 60 but are epic/rare)
 * 2. Gem color detection for meta gem activation (icon-based detection is unreliable)
 *
 * Color codes: R=red, Y=yellow, B=blue, O=orange, G=green, P=purple, A=prismatic, M=meta
 */
const GEM_DB = (() => {
  // Gems where itemLevel-based quality detection is WRONG
  // Format: gemId → actual quality string
  const QUALITY_OVERRIDE = {
    // Ornate PvP gems (Honor Points) — iLvl 60 but EPIC quality
    28118: 'epic',   // Runed Ornate Ruby
    28119: 'epic',   // Smooth Ornate Dawnstone
    28120: 'epic',   // Gleaming Ornate Dawnstone
    28123: 'epic',   // Potent Ornate Topaz
    28362: 'epic',   // Bold Ornate Ruby
    28363: 'epic',   // Inscribed Ornate Topaz
    // Ornate PvP gems (Arena Points, patch 2.4.3)
    38545: 'epic',   // Bold Ornate Ruby
    38546: 'epic',   // Gleaming Ornate Dawnstone
    38547: 'epic',   // Inscribed Ornate Topaz
    38548: 'epic',   // Potent Ornate Topaz
    38549: 'epic',   // Runed Ornate Ruby
    38550: 'epic',   // Smooth Ornate Dawnstone
    // Shadow Pearl gems — iLvl 60 but RARE quality
    32833: 'rare',   // Shifting Shadow Pearl
    32834: 'rare',   // Glowing Shadow Pearl
    32835: 'rare',   // Sovereign Shadow Pearl
    32836: 'rare',   // Purified Shadow Pearl
    // Don Amancio's Heart — iLvl 60 but RARE quality
    30598: 'rare',   // Don Amancio's Heart (quest reward)
    30600: 'rare',   // Rina's Diminished Ruby (quest reward, if exists)
    30601: 'rare',   // Crimson Sun (BoP JC) — verify
  };

  // Gem ID → socket color code
  // R=red, Y=yellow, B=blue, O=orange, G=green, P=purple, A=prismatic, M=meta
  const COLOR_MAP = {
    // ── Common vendor gems (iLvl 55) ──
    28458:'R', 28459:'R', 28460:'R', 28461:'R', 28462:'R',  // Tourmaline (red)
    28463:'Y', 28467:'Y', 28469:'Y',                         // Amber (yellow)
    28464:'B', 28465:'B', 28466:'B', 28468:'B',              // Zircon (blue)

    // ── Uncommon gems (iLvl 60) ──
    // Blood Garnet (red)
    23094:'R', 23095:'R', 23096:'R', 23097:'R',
    // Flame Spessarite (orange)
    23098:'O', 23099:'O', 23100:'O', 23101:'O',
    // Deep Peridot (green)
    23103:'G', 23104:'G', 23105:'G', 23106:'G',
    // Shadow Draenite (purple)
    23107:'P', 23108:'P', 23109:'P', 23110:'P', 23111:'P',
    // Golden Draenite (yellow)
    23113:'Y', 23114:'Y', 23115:'Y', 23116:'Y',
    28290:'Y',  // Smooth Golden Draenite (additional vendor cut)
    // Azure Moonstone (blue)
    23117:'B', 23118:'B', 23119:'B', 23120:'B', 23121:'B',
    // Bloodstone (PvP Honor gem, red, uncommon)
    23110:'P', // already listed above

    // ── Rare gems (iLvl 70) ──
    // Living Ruby (red)
    24027:'R', 24028:'R', 24029:'R', 24030:'R', 24031:'R', 24032:'R', 24036:'R', 24047:'R',
    // Dawnstone (yellow)
    24048:'Y', 24050:'Y', 24051:'Y', 24052:'Y', 24053:'Y',
    // Star of Elune (blue)
    24033:'B', 24035:'B', 24037:'B', 24038:'B', 24039:'B',
    // Noble Topaz (orange)
    24058:'O', 24059:'O', 24060:'O', 24061:'O', 24062:'O',
    // Nightseye (purple)
    24054:'P', 24055:'P', 24056:'P', 24057:'P',
    // Talasite (green)
    24065:'G', 24066:'G', 24067:'G',
    // Shadow Pearl (purple, rare quality!)
    32833:'P', 32834:'P', 32835:'P', 32836:'P',
    // Don Amancio's Heart (red, rare quality!)
    30598:'R',

    // ── BoP JC-only gems (rare, iLvl 70) ──
    // Crimson Sun / Falling Star / etc.
    30546:'P', 30547:'O', 30548:'O', 30549:'P', 30550:'G',
    30551:'R', 30552:'Y', 30553:'Y', 30554:'P', 30555:'P', 30556:'O',
    30558:'R', 30559:'Y', 30560:'Y',
    30571:'B', 30572:'B', 30573:'P', 30574:'P',
    30575:'G', 30582:'B', 30583:'O', 30584:'O',
    30585:'G', 30586:'G', 30587:'O', 30588:'O',
    30589:'O', 30590:'O', 30591:'O', 30592:'G',
    30593:'G', 30594:'G', 30600:'R', 30601:'O', 30602:'P',
    30603:'P', 30604:'G', 30605:'G', 30606:'O',
    31860:'R', 31861:'B', 31862:'Y', 31863:'P', 31864:'G', 31865:'O',
    31866:'B', 31867:'O', 31868:'O', 31869:'Y',

    // ── Ornate PvP gems (epic, iLvl 60) ──
    28118:'R', 28119:'Y', 28120:'Y', 28123:'O',
    28362:'R', 28363:'O',
    38545:'R', 38546:'Y', 38547:'O', 38548:'O', 38549:'R', 38550:'Y',

    // ── Epic gems (iLvl 130) ──
    // Crimson Spinel (red)
    32193:'R', 32194:'R', 32195:'R', 32196:'R', 32197:'R', 32198:'R', 32199:'R',
    33131:'R', 33132:'R', 33133:'R', 33134:'R',
    // Empyrean Sapphire (blue)
    32200:'B', 32201:'B', 32202:'B', 32203:'B', 32204:'B',
    33135:'B', 33136:'B', 33137:'B',
    // Lionseye (yellow)
    32205:'Y', 32206:'Y', 32207:'Y', 32208:'Y', 32209:'Y', 32210:'Y',
    33138:'Y', 33139:'Y', 33140:'Y', 33141:'Y',
    // Pyrestone (orange)
    32217:'O', 32218:'O', 32219:'O', 32220:'O', 32221:'O', 32222:'O',
    33142:'O', 33143:'O', 33144:'O',
    // Shadowsong Amethyst (purple)
    32211:'P', 32212:'P', 32213:'P', 32214:'P', 32215:'P', 32216:'P',
    33145:'P', 33146:'P', 33147:'P',
    // Seaspray Emerald (green)
    32223:'G', 32224:'G', 32225:'G', 32226:'G',
    33148:'G', 33149:'G', 33150:'G', 33151:'G',

    // ── Meta gems ──
    25890:'M', 25893:'M', 25894:'M', 25895:'M', 25896:'M', 25897:'M',
    25898:'M', 25899:'M', 25901:'M',
    28556:'M', 28557:'M', 28585:'M',
    32409:'M', 32410:'M',
    34220:'M',
    35501:'M', 35503:'M',
    41285:'M', 41307:'M', 41333:'M', 41335:'M', 41339:'M',
    41376:'M', 41380:'M', 41389:'M', 41395:'M', 41396:'M',
    41397:'M', 41398:'M', 41400:'M', 41401:'M',

    // ── Prismatic gems ──
    // Prismatic Sphere, Void Star, Chromatic Sphere
    22459:'A', 22460:'A', 35489:'A',
    // Nightmare Tear etc. (WotLK but just in case)
    49110:'A',
  };

  // Color code → meta gem activation counts
  const COLOR_COUNTS = {
    'R': {r:1, y:0, b:0},
    'Y': {r:0, y:1, b:0},
    'B': {r:0, y:0, b:1},
    'O': {r:1, y:1, b:0},
    'G': {r:0, y:1, b:1},
    'P': {r:1, y:0, b:1},
    'A': {r:1, y:1, b:1},
    'M': {r:0, y:0, b:0},
  };

  // Fallback: determine color from icon texture name
  function colorFromIcon(icon) {
    if (!icon) return 'A';
    icon = icon.toLowerCase();

    // Meta
    if (icon.includes('diamond')) return 'M';

    // Orange (check before red/yellow since orange icons contain both)
    if (icon.includes('spessarite') || icon.includes('nobletopaz') ||
        icon.includes('pyrestone') || icon.includes('opal')) return 'O';

    // Purple
    if (icon.includes('ebondraenite') || icon.includes('shadowdraenite') ||
        icon.includes('nightseye') || icon.includes('amethyst') ||
        icon.includes('pearl')) return 'P';

    // Green
    if (icon.includes('peridot') || icon.includes('talasite') ||
        icon.includes('seaspray') || icon.includes('emerald')) return 'G';

    // Red
    if (icon.includes('bloodgem') || icon.includes('bloodgarnet') ||
        icon.includes('livingruby') || icon.includes('crimsonspinel') ||
        icon.includes('crimson') || icon.includes('tourmaline') ||
        icon.includes('ruby') || icon.includes('bloodstone')) return 'R';

    // Yellow
    if (icon.includes('goldendraenite') || icon.includes('dawnstone') ||
        icon.includes('lionseye') || icon.includes('amber') ||
        icon.includes('topaz')) return 'Y';

    // Blue
    if (icon.includes('azuremoonstone') || icon.includes('starofelune') ||
        icon.includes('empyrean') || icon.includes('sapphire') ||
        icon.includes('zircon')) return 'B';

    // Secondary keywords
    if (icon.includes('shadow') || icon.includes('night')) return 'P';
    if (icon.includes('blood') || icon.includes('fire') || icon.includes('flame')) return 'R';
    if (icon.includes('golden') || icon.includes('dawn') || icon.includes('sun')) return 'Y';
    if (icon.includes('azure') || icon.includes('star') || icon.includes('moon')) return 'B';
    if (icon.includes('green') || icon.includes('moss')) return 'G';

    return 'A'; // unknown → prismatic (safe default, counts for all colors)
  }

  return {
    /**
     * Get gem quality string: 'common', 'uncommon', 'rare', 'epic'
     * Uses override map for known exceptions, falls back to itemLevel
     */
    getQuality(gemId, itemLevel) {
      if (QUALITY_OVERRIDE[gemId]) return QUALITY_OVERRIDE[gemId];
      // Default itemLevel-based detection (works for most gems)
      if (!itemLevel || itemLevel < 60) return 'common';
      if (itemLevel <= 65) return 'uncommon';
      if (itemLevel < 100) return 'rare';
      return 'epic';
    },

    /**
     * Get gem color counts for meta gem activation {r, y, b}
     * Uses explicit map first, falls back to icon-based detection
     */
    getColorCounts(gemId, icon) {
      let code = COLOR_MAP[gemId];
      if (!code) code = colorFromIcon(icon);
      return COLOR_COUNTS[code] || {r:1, y:1, b:1};
    },

    /**
     * Get gem color code: R/Y/B/O/G/P/A/M
     */
    getColorCode(gemId, icon) {
      return COLOR_MAP[gemId] || colorFromIcon(icon);
    },

    /**
     * Check if gem is a meta gem
     */
    isMeta(gemId) {
      return COLOR_MAP[gemId] === 'M';
    },
  };
})();

window.GEM_DB = GEM_DB;
