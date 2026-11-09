import type { Pt } from './path';

// ---- Board ----
export const COLS = 15;
export const ROWS = 20;
/** Cell footprint on screen: slightly squashed vertically for a 3/4 top-down view. */
export const CELL_W = 46;
export const CELL_H = 38;
/** Visual height of cages and sealed blocks above the ground. */
export const OBJ_H = 20;
export const GRID_X = (720 - COLS * CELL_W) / 2;
export const GRID_Y = 130;

/** Spawn -> checkpoints -> exit. Nothing can be placed on these cells. */
export const WAYPOINTS: Pt[] = [
  { x: 7, y: 0 },
  { x: 1, y: 5 },
  { x: 13, y: 10 },
  { x: 1, y: 15 },
  { x: 7, y: 19 },
];

export const PER_ROUND = 5;
export const TOTAL_WAVES = 20;
export const START_LIVES = 20;

// ---- Species ----
export const SPECIES = [
  'flamer',
  'jelly',
  'rotter',
  'swarmer',
  'spitter',
  'fanger',
  'darter',
  'howler',
] as const;
export type Species = (typeof SPECIES)[number];

export const LEVEL_NAMES = ['Детёныш', 'Молодой', 'Взрослый', 'Матёрый', 'Альфа'];
export const MAX_LEVEL = LEVEL_NAMES.length - 1;
const LEVEL_MULT = [1, 2.5, 6, 14, 32];

export interface Stats {
  name: string;
  desc: string;
  color: number;
  dmg: number;
  /** attacks per second */
  rate: number;
  /** in cells */
  range: number;
  /** splash radius in cells (50% damage) */
  splash?: number;
  /** slow fraction, 2 s */
  slow?: number;
  /** poison damage per second, 3 s */
  poison?: number;
  /** number of simultaneous targets */
  targets?: number;
  /** chance of double damage */
  crit?: number;
  /** attack speed bonus to allies within 2.5 cells */
  aura?: number;
}

export const BASE: Record<Species, Stats> = {
  flamer: { name: 'Жаровик', desc: 'Плюётся огнём по области', color: 0xe0403a, dmg: 12, rate: 0.8, range: 3, splash: 1.2 },
  jelly: { name: 'Студень', desc: 'Липкая слизь замедляет', color: 0x3f7fe8, dmg: 8, rate: 1, range: 3.5, slow: 0.3 },
  rotter: { name: 'Гнильник', desc: 'Отравляет', color: 0x4cb84a, dmg: 6, rate: 1, range: 3, poison: 5 },
  swarmer: { name: 'Роевик', desc: 'Атакует несколько целей', color: 0xf0b020, dmg: 7, rate: 1, range: 3, targets: 2 },
  spitter: { name: 'Плевун', desc: 'Бьёт очень далеко', color: 0x9a5fd8, dmg: 16, rate: 0.6, range: 5 },
  fanger: { name: 'Клыкач', desc: 'Критические укусы', color: 0xd8d0c0, dmg: 18, rate: 0.8, range: 3, crit: 0.25 },
  darter: { name: 'Шустрик', desc: 'Очень быстрые атаки', color: 0x40d8d0, dmg: 5, rate: 3, range: 2.5 },
  howler: { name: 'Ревун', desc: 'Вой ускоряет соседей', color: 0xf090c8, dmg: 6, rate: 1, range: 3, aura: 0.1 },
};

export function speciesStats(sp: Species, level: number): Stats {
  const b = BASE[sp];
  const m = LEVEL_MULT[level];
  return {
    ...b,
    name: `${b.name}: ${LEVEL_NAMES[level]}`,
    dmg: b.dmg * m,
    slow: b.slow && Math.min(0.6, b.slow + 0.06 * level),
    poison: b.poison && b.poison * m,
    targets: b.targets && b.targets + Math.floor(level / 2),
    crit: b.crit && b.crit + 0.03 * level,
    aura: b.aura && b.aura * (level + 1),
  };
}

// ---- Hybrids: secret crossbreeding rules the player discovers ----
export interface Hybrid {
  id: string;
  /** exact set of parents (order does not matter) */
  parents: { sp: Species; level: number }[];
  stats: Stats;
}

export const HYBRIDS: Hybrid[] = [
  {
    id: 'icehive',
    parents: [
      { sp: 'jelly', level: 0 },
      { sp: 'fanger', level: 0 },
      { sp: 'swarmer', level: 0 },
    ],
    stats: {
      name: 'Ледяной рой',
      desc: 'Замораживает до трёх целей, урон по области',
      color: 0xbfd4ff,
      dmg: 30,
      rate: 1.2,
      range: 4,
      slow: 0.4,
      targets: 3,
      splash: 0.8,
    },
  },
  {
    id: 'magmaserpent',
    parents: [
      { sp: 'flamer', level: 1 },
      { sp: 'flamer', level: 0 },
      { sp: 'spitter', level: 0 },
    ],
    stats: {
      name: 'Магмовый змей',
      desc: 'Мощные залпы по большой области',
      color: 0xff6a1a,
      dmg: 90,
      rate: 0.7,
      range: 4.5,
      splash: 1.5,
      crit: 0.2,
    },
  },
  {
    id: 'plaguehornet',
    parents: [
      { sp: 'rotter', level: 0 },
      { sp: 'howler', level: 0 },
      { sp: 'darter', level: 0 },
    ],
    stats: {
      name: 'Чумной шершень',
      desc: 'Быстро травит до четырёх целей',
      color: 0x0fa878,
      dmg: 18,
      rate: 2.5,
      range: 3.5,
      targets: 4,
      poison: 12,
    },
  },
  {
    id: 'stormlizard',
    parents: [
      { sp: 'darter', level: 1 },
      { sp: 'fanger', level: 1 },
    ],
    stats: {
      name: 'Грозовой ящер',
      desc: 'Молниеносные критические удары',
      color: 0x7ad0ff,
      dmg: 45,
      rate: 1.8,
      range: 3.5,
      crit: 0.35,
    },
  },
];

export function parentsText(h: Hybrid): string {
  return h.parents.map((p) => `${BASE[p.sp].name} (${LEVEL_NAMES[p.level]})`).join(' + ');
}

// ---- Quality odds (bought with gold) ----
export const QUALITY_ODDS = [
  [1, 0, 0, 0],
  [0.8, 0.2, 0, 0],
  [0.6, 0.3, 0.1, 0],
  [0.45, 0.35, 0.2, 0],
  [0.3, 0.4, 0.25, 0.05],
  [0.2, 0.35, 0.35, 0.1],
];
export const UPGRADE_COST = [20, 40, 70, 110, 160];

// ---- Waves ----
export function waveInfo(w: number) {
  const boss = w % 5 === 0;
  const fast = !boss && w % 3 === 0;
  return {
    boss,
    fast,
    count: boss ? 1 : 10,
    hp: Math.round(10 * Math.pow(1.3, w - 1) * (boss ? 12 : fast ? 0.7 : 1)),
    speed: boss ? 1.0 : fast ? 2.2 : 1.4,
    gold: boss ? 25 + w : 1 + Math.floor(w / 3),
  };
}
