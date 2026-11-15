import type { Species } from './data';

const RUN_KEY = 'gd.run.v1';
const BESTIARY_KEY = 'gd.bestiary.v1';
const META_KEY = 'gd.meta.v1';

export interface SavedCell {
  x: number;
  y: number;
  kind: 'mon' | 'hybrid' | 'sealed' | 'cocoon';
  sp?: Species;
  level?: number;
  hybrid?: string;
  /** true if this sealed block is a permanent map pillar */
  pillar?: boolean;
}

export interface RunSave {
  levelId?: string;
  wave: number;
  lives: number;
  gold: number;
  chance: number;
  cells: SavedCell[];
  /** indices into `cells` of creatures placed this round */
  fresh: number[];
  seenNotes?: number[];
  usedGadgets?: boolean;
}

export interface MetaSave {
  /** Best star rating (1..3) achieved per levelId */
  stars: Record<string, number>;
  /** Level IDs cleared in hardcore mode (no gadgets used) */
  hardcoreCleared: string[];
  /** Energy cores (premium currency earned from stars & bestiary) */
  cores: number;
  /** Lab upgrade levels */
  upgrades: Partial<Record<'firewall' | 'grant' | 'overclock' | 'salvage', number>>;
  /** Currently selected map id */
  currentLevel: string;
  /** Hardcore mode toggle (disables in-battle gadgets) */
  hardcore: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: game still works, just without saves */
  }
}

export const loadRun = () => read<RunSave>(RUN_KEY);
export const saveRun = (s: RunSave | null) => write(RUN_KEY, s);

export const loadBestiary = () => new Set(read<string[]>(BESTIARY_KEY) ?? []);
export const saveBestiary = (ids: Set<string>) => write(BESTIARY_KEY, [...ids]);

const MAZE_KEY = 'gd.maze.v1';

/** Index of the chosen maze blueprint, or -1 for none. */
export function loadMazeChoice(): number {
  try {
    const v = Number(localStorage.getItem(MAZE_KEY));
    return Number.isInteger(v) ? v : -1;
  } catch {
    return -1;
  }
}

export function saveMazeChoice(i: number) {
  try {
    localStorage.setItem(MAZE_KEY, String(i));
  } catch {
    /* ignore */
  }
}

const DEFAULT_META: MetaSave = {
  stars: {},
  hardcoreCleared: [],
  cores: 3,
  upgrades: {},
  currentLevel: 'doof',
  hardcore: false,
};

export function loadMeta(): MetaSave {
  const m = read<Partial<MetaSave>>(META_KEY);
  if (!m || typeof m !== 'object') return { ...DEFAULT_META, stars: {}, hardcoreCleared: [], upgrades: {} };
  return {
    stars: m.stars && typeof m.stars === 'object' ? m.stars : {},
    hardcoreCleared: Array.isArray(m.hardcoreCleared) ? m.hardcoreCleared : [],
    cores: typeof m.cores === 'number' && Number.isFinite(m.cores) ? m.cores : 3,
    upgrades: m.upgrades && typeof m.upgrades === 'object' ? m.upgrades : {},
    currentLevel: typeof m.currentLevel === 'string' ? m.currentLevel : 'doof',
    hardcore: !!m.hardcore,
  };
}

export const saveMeta = (m: MetaSave) => write(META_KEY, m);
