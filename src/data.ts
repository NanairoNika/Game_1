import type { Pt } from './path';
import { TableReader } from './csv';
import monstersCsv from '../data/monsters.csv?raw';
import hybridsCsv from '../data/hybrids.csv?raw';
import enemiesCsv from '../data/enemies.csv?raw';
import wavesCsv from '../data/waves.csv?raw';
import mazesTxt from '../data/mazes.txt?raw';

// ---- Board ----
export const COLS = 15;
export const ROWS = 20;
/** Cell footprint on screen: slightly squashed vertically for a 3/4 top-down view. */
export const CELL_W = 46;
export const CELL_H = 38;
/** Visual height of cages and sealed blocks above the ground. */
export const OBJ_H = 20;
export const GRID_X = (720 - COLS * CELL_W) / 2;
export const GRID_Y = 170;

/** Spawn -> checkpoints -> exit. Nothing can be placed on these cells. */
export const WAYPOINTS: Pt[] = [
  { x: 7, y: 0 },
  { x: 1, y: 5 },
  { x: 13, y: 10 },
  { x: 1, y: 15 },
  { x: 7, y: 19 },
];

export const PER_ROUND = 5;
export const START_LIVES = 20;
/** Gold for clearing wave N is WAVE_BONUS_BASE + N. */
export const WAVE_BONUS_BASE = 5;

export const LEVEL_NAMES = ['Детёныш', 'Молодой', 'Взрослый', 'Матёрый', 'Альфа'];
export const MAX_LEVEL = LEVEL_NAMES.length - 1;

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

// =====================================================================
// Balance tables: /data/*.csv (see docs/data.md). Levels are 1-based in
// the tables and 0-based in code.
// =====================================================================

/** Problems found while reading the tables; the game shows them instead of starting. */
export const DATA_ERRORS: string[] = [];

export type Species = string;

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
  /** slow fraction 0..1, 2 s */
  slow?: number;
  /** poison damage per second, 3 s */
  poison?: number;
  /** number of simultaneous targets */
  targets?: number;
  /** chance of double damage 0..1 */
  crit?: number;
  /** attack speed bonus 0..1 to allies within 2.5 cells */
  aura?: number;
}

const STAT_COLS = ['damage', 'attack_speed', 'range'];

function readStats(t: TableReader, row: Parameters<TableReader['str']>[0], name: string, desc: string, color: number): Stats {
  const opt = (col: string, scale = 1) => {
    const v = t.num(row, col, 0);
    return v > 0 ? v * scale : undefined;
  };
  const slow = opt('slow', 0.01);
  if (slow !== undefined && slow >= 1) t.fail(row, 'slow', 'замедление должно быть меньше 100');
  return {
    name,
    desc,
    color,
    dmg: t.num(row, 'damage'),
    rate: t.num(row, 'attack_speed', undefined, 0.01),
    range: t.num(row, 'range', undefined, 0.5),
    splash: opt('splash'),
    slow,
    poison: opt('poison'),
    targets: opt('targets'),
    crit: opt('crit', 0.01),
    aura: opt('aura', 0.01),
  };
}

// ---- Monsters ----
export interface SpeciesInfo {
  id: Species;
  name: string;
  desc: string;
  color: number;
}

export const SPECIES: Species[] = [];
export const BASE: Record<Species, SpeciesInfo> = {};
const MONSTER_STATS = new Map<string, Stats>();

{
  const t = new TableReader('monsters.csv', monstersCsv, DATA_ERRORS, ['species', 'level', 'name', ...STAT_COLS]);
  for (const row of t.rows) {
    const sp = t.str(row, 'species');
    const level = t.num(row, 'level');
    if (!Number.isInteger(level) || level < 1 || level > LEVEL_NAMES.length) {
      t.fail(row, 'level', `нужно целое от 1 до ${LEVEL_NAMES.length}`);
      continue;
    }
    const name = t.str(row, 'name');
    const desc = t.str(row, 'description', false);
    const color = t.color(row, 'color');
    if (!BASE[sp]) {
      SPECIES.push(sp);
      BASE[sp] = { id: sp, name, desc, color };
    }
    const key = `${sp}:${level - 1}`;
    if (MONSTER_STATS.has(key)) t.fail(row, 'level', `${sp} уровня ${level} уже есть выше`);
    MONSTER_STATS.set(key, readStats(t, row, `${name}: ${LEVEL_NAMES[level - 1]}`, desc, color));
  }
  for (const sp of SPECIES)
    for (let l = 0; l < LEVEL_NAMES.length; l++)
      if (!MONSTER_STATS.has(`${sp}:${l}`)) DATA_ERRORS.push(`monsters.csv: у «${sp}» нет строки уровня ${l + 1}`);
  if (!SPECIES.length) DATA_ERRORS.push('monsters.csv: нет ни одного монстра');
}

export function speciesStats(sp: Species, level: number): Stats {
  return MONSTER_STATS.get(`${sp}:${level}`)!;
}

// ---- Hybrids ----
export interface Hybrid {
  id: string;
  /** exact set of parents (order does not matter), level 0-based */
  parents: { sp: Species; level: number }[];
  stats: Stats;
}

export const HYBRIDS: Hybrid[] = [];

{
  const t = new TableReader('hybrids.csv', hybridsCsv, DATA_ERRORS, ['id', 'name', 'parent_1', 'parent_2', ...STAT_COLS]);
  for (const row of t.rows) {
    const id = t.str(row, 'id');
    if (HYBRIDS.some((h) => h.id === id)) t.fail(row, 'id', `«${id}» уже есть выше`);
    const parents: Hybrid['parents'] = [];
    for (let i = 1; i <= 4; i++) {
      const col = `parent_${i}`;
      const v = row.get(col);
      if (!v) continue;
      const m = /^([a-z0-9_]+)\s*[:\s]\s*(\d+)$/i.exec(v);
      if (!m) {
        t.fail(row, col, `«${v}»: нужно вид:уровень, например jelly:1`);
        continue;
      }
      const sp = m[1];
      const level = Number(m[2]);
      if (!BASE[sp]) t.fail(row, col, `нет такого вида «${sp}» в monsters.csv`);
      if (level < 1 || level > LEVEL_NAMES.length) t.fail(row, col, `уровень ${level} вне 1–${LEVEL_NAMES.length}`);
      parents.push({ sp, level: level - 1 });
    }
    if (parents.length < 2) t.fail(row, 'parent_1', 'нужно минимум 2 родителя');
    HYBRIDS.push({ id, parents, stats: readStats(t, row, t.str(row, 'name'), t.str(row, 'description', false), t.color(row, 'color')) });
  }
  const seen = new Map<string, string>();
  for (const h of HYBRIDS) {
    const key = h.parents.map((p) => `${p.sp}:${p.level}`).sort().join('+');
    if (seen.has(key)) DATA_ERRORS.push(`hybrids.csv: у «${h.id}» и «${seen.get(key)}» одинаковые родители`);
    seen.set(key, h.id);
  }
}

export function parentsText(h: Hybrid): string {
  return h.parents.map((p) => `${BASE[p.sp]?.name ?? p.sp} (${LEVEL_NAMES[p.level]})`).join(' + ');
}

// ---- Enemies ----
export interface EnemyDef {
  id: string;
  name: string;
  desc: string;
  /** cells per second */
  speed: number;
  livesCost: number;
  /** 0..1, reduces hit damage (not poison) */
  armor: number;
  immuneSlow: boolean;
  immunePoison: boolean;
  size: number;
  color: number;
}

export const ENEMIES: Record<string, EnemyDef> = {};

{
  const t = new TableReader('enemies.csv', enemiesCsv, DATA_ERRORS, ['id', 'name', 'speed', 'lives_cost']);
  for (const row of t.rows) {
    const id = t.str(row, 'id');
    if (ENEMIES[id]) t.fail(row, 'id', `«${id}» уже есть выше`);
    const armor = t.num(row, 'armor', 0);
    if (armor >= 100) t.fail(row, 'armor', 'броня должна быть меньше 100');
    ENEMIES[id] = {
      id,
      name: t.str(row, 'name'),
      desc: t.str(row, 'description', false),
      speed: t.num(row, 'speed', undefined, 0.05),
      livesCost: t.num(row, 'lives_cost', 1),
      armor: armor / 100,
      immuneSlow: t.bool(row, 'immune_slow'),
      immunePoison: t.bool(row, 'immune_poison'),
      size: t.num(row, 'size', 10, 3),
      color: t.color(row, 'color'),
    };
  }
}

// ---- Waves ----
export interface SpawnGroup {
  enemy: EnemyDef;
  count: number;
  hp: number;
  gold: number;
  /** seconds from wave start to the first spawn of this group */
  delay: number;
  /** seconds between spawns */
  interval: number;
}

/** WAVES[n - 1] is the list of groups of wave n. */
export const WAVES: SpawnGroup[][] = [];

{
  const t = new TableReader('waves.csv', wavesCsv, DATA_ERRORS, ['wave', 'enemy', 'count', 'hp']);
  for (const row of t.rows) {
    const w = t.num(row, 'wave');
    if (!Number.isInteger(w) || w < 1) {
      t.fail(row, 'wave', 'нужно целое число от 1');
      continue;
    }
    const id = t.str(row, 'enemy');
    const enemy = ENEMIES[id];
    if (!enemy) {
      t.fail(row, 'enemy', `нет врага «${id}» в enemies.csv`);
      continue;
    }
    (WAVES[w - 1] ??= []).push({
      enemy,
      count: t.num(row, 'count', undefined, 1),
      hp: t.num(row, 'hp', undefined, 1),
      gold: t.num(row, 'gold', 0),
      delay: t.num(row, 'delay', 0),
      interval: t.num(row, 'interval', 1, 0.05),
    });
  }
  for (let i = 0; i < WAVES.length; i++) if (!WAVES[i]) DATA_ERRORS.push(`waves.csv: пропущена волна ${i + 1}`);
  if (!WAVES.length) DATA_ERRORS.push('waves.csv: нет ни одной волны');
}

export const TOTAL_WAVES = WAVES.length;

// ---- Maze blueprints (data/mazes.txt) ----
export interface Maze {
  name: string;
  desc: string;
  /** cell index (y * COLS + x) -> build stage 1..3 */
  cells: Map<number, number>;
  focus: Pt | null;
  stages: number;
}

export const MAZES: Maze[] = [];

{
  const file = 'mazes.txt';
  const lines = mazesTxt.replace(/^﻿/, '').split(/\r?\n/);
  let cur: { name: string; desc: string; line: number; rows: string[] } | null = null;
  const finish = () => {
    if (!cur) return;
    const { name, desc, line, rows } = cur;
    if (rows.length !== ROWS) {
      DATA_ERRORS.push(`${file}, схема «${name}» (строка ${line}): ${rows.length} строк вместо ${ROWS}`);
      return;
    }
    const maze: Maze = { name, desc, cells: new Map(), focus: null, stages: 1 };
    rows.forEach((row, y) => {
      if (row.length !== COLS) DATA_ERRORS.push(`${file}, схема «${name}»: в строке поля ${y + 1} ${row.length} символов вместо ${COLS}`);
      [...row].forEach((ch, x) => {
        const wp = WAYPOINTS.some((w) => w.x === x && w.y === y);
        if (ch === 'o' || ch === 'о') {
          if (!wp) DATA_ERRORS.push(`${file}, схема «${name}»: «o» в клетке ${x + 1},${y + 1}, а контрольной точки там нет`);
          return;
        }
        if (wp && ch !== '.') DATA_ERRORS.push(`${file}, схема «${name}»: клетка ${x + 1},${y + 1} — контрольная точка, там должно быть «o»`);
        if (ch === '.' || wp) return;
        if (ch === '@') {
          maze.focus = { x, y };
          maze.cells.set(y * COLS + x, 1);
        } else if (/[1-9]/.test(ch)) {
          maze.cells.set(y * COLS + x, Number(ch));
          maze.stages = Math.max(maze.stages, Number(ch));
        } else DATA_ERRORS.push(`${file}, схема «${name}»: непонятный символ «${ch}» в клетке ${x + 1},${y + 1}`);
      });
    });
    MAZES.push(maze);
  };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('===')) {
      finish();
      const [name, desc = ''] = l.slice(3).split('|').map((t) => t.trim());
      cur = { name: name || `Схема ${MAZES.length + 1}`, desc, line: i + 1, rows: [] };
    } else if (l && !l.startsWith('#') && cur) cur.rows.push(l);
  });
  finish();
}
