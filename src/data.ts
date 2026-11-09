import type { Pt } from './path';

// ---- Board ----
export const COLS = 15;
export const ROWS = 20;
export const CELL = 46;
export const GRID_X = (720 - COLS * CELL) / 2;
export const GRID_Y = 100;

/** Spawn -> checkpoints -> exit. Nothing can be built on these cells. */
export const WAYPOINTS: Pt[] = [
  { x: 7, y: 0 },
  { x: 1, y: 5 },
  { x: 13, y: 10 },
  { x: 1, y: 15 },
  { x: 7, y: 19 },
];

export const GEMS_PER_ROUND = 5;
export const TOTAL_WAVES = 20;
export const START_LIVES = 20;

// ---- Gems ----
export const GEM_TYPES = [
  'ruby',
  'sapphire',
  'emerald',
  'topaz',
  'amethyst',
  'diamond',
  'aquamarine',
  'opal',
] as const;
export type GemType = (typeof GEM_TYPES)[number];

export const LEVEL_NAMES = ['Осколок', 'Тусклый', 'Обычный', 'Чистый', 'Идеальный'];
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
  /** attack speed bonus to towers within 2.5 cells */
  aura?: number;
}

const BASE: Record<GemType, Stats> = {
  ruby: { name: 'Рубин', desc: 'Урон по области', color: 0xe0303a, dmg: 12, rate: 0.8, range: 3, splash: 1.2 },
  sapphire: { name: 'Сапфир', desc: 'Замедляет врагов', color: 0x2f6fe0, dmg: 8, rate: 1, range: 3.5, slow: 0.3 },
  emerald: { name: 'Изумруд', desc: 'Отравляет', color: 0x22b35a, dmg: 6, rate: 1, range: 3, poison: 5 },
  topaz: { name: 'Топаз', desc: 'Бьёт несколько целей', color: 0xf0b020, dmg: 7, rate: 1, range: 3, targets: 2 },
  amethyst: { name: 'Аметист', desc: 'Большая дальность', color: 0x9a4fd8, dmg: 16, rate: 0.6, range: 5 },
  diamond: { name: 'Алмаз', desc: 'Критические удары', color: 0xe8f4ff, dmg: 18, rate: 0.8, range: 3, crit: 0.25 },
  aquamarine: { name: 'Аквамарин', desc: 'Очень быстрые атаки', color: 0x40d8d0, dmg: 5, rate: 3, range: 2.5 },
  opal: { name: 'Опал', desc: 'Ускоряет соседние башни', color: 0xf0a0d0, dmg: 6, rate: 1, range: 3, aura: 0.1 },
};

export function gemStats(type: GemType, level: number): Stats {
  const b = BASE[type];
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

// ---- Recipes: built from gems placed in the same round ----
export interface Special {
  id: string;
  needs: { type: GemType; level: number }[];
  stats: Stats;
}

export const SPECIALS: Special[] = [
  {
    id: 'moonstone',
    needs: [
      { type: 'sapphire', level: 0 },
      { type: 'diamond', level: 0 },
      { type: 'topaz', level: 0 },
    ],
    stats: {
      name: 'Лунный камень',
      desc: 'Замедляет до трёх целей, урон по области',
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
    id: 'bloodamber',
    needs: [
      { type: 'ruby', level: 1 },
      { type: 'ruby', level: 0 },
      { type: 'amethyst', level: 0 },
    ],
    stats: {
      name: 'Кровавый янтарь',
      desc: 'Мощный удар по большой области',
      color: 0xff6a1a,
      dmg: 90,
      rate: 0.7,
      range: 4.5,
      splash: 1.5,
      crit: 0.2,
    },
  },
  {
    id: 'malachite',
    needs: [
      { type: 'emerald', level: 0 },
      { type: 'opal', level: 0 },
      { type: 'aquamarine', level: 0 },
    ],
    stats: {
      name: 'Малахит',
      desc: 'Быстро травит до четырёх целей',
      color: 0x0fa878,
      dmg: 18,
      rate: 2.5,
      range: 3.5,
      targets: 4,
      poison: 12,
    },
  },
];

export function specialRecipeText(s: Special): string {
  return s.needs.map((n) => `${BASE[n.type].name} (${LEVEL_NAMES[n.level]})`).join(' + ');
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
