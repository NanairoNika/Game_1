import type { Species } from './data';

const RUN_KEY = 'gd.run.v1';
const BESTIARY_KEY = 'gd.bestiary.v1';

export interface SavedCell {
  x: number;
  y: number;
  kind: 'mon' | 'hybrid' | 'cocoon';
  sp?: Species;
  level?: number;
  hybrid?: string;
}

export interface RunSave {
  wave: number;
  lives: number;
  gold: number;
  chance: number;
  cells: SavedCell[];
  /** indices into `cells` of creatures placed this round */
  fresh: number[];
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
