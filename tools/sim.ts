/**
 * Headless balance simulator: plays many automatic runs using the same tables
 * (data/*.csv) and the same combat code as the game, then prints a report.
 *
 *   npm run sim                      — 300 runs per strategy on the first map
 *   npm run sim -- --runs 1000       — more runs
 *   npm run sim -- --map moreau      — another map (id from src/levels.ts)
 *   npm run sim -- --strategy hybrid — only one strategy (merge | hybrid | greedy)
 *   npm run sim -- --seed 42         — reproducible results
 */
import * as D from '../src/data';
import { Battle, type Fighter } from '../src/combat';
import { fullPath, type Pt } from '../src/path';
import { LEVELS } from '../src/levels';
import * as Rules from '../src/rules';

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const RUNS = Number(arg('runs', '300'));
const MAP = arg('map', LEVELS[0].id);
const ONLY = arg('strategy', '');
let seed = Number(arg('seed', String(Date.now() % 1e9)));

/** Small deterministic RNG (mulberry32) so results can be reproduced with --seed. */
function rng() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

if (D.DATA_ERRORS.length) {
  console.error('Ошибки в таблицах:\n' + D.DATA_ERRORS.map((e) => ' • ' + e).join('\n'));
  process.exit(1);
}
const level = LEVELS.find((l) => l.id === MAP);
if (!level) {
  console.error(`Нет карты «${MAP}». Есть: ${LEVELS.map((l) => l.id).join(', ')}`);
  process.exit(1);
}

// ---------- model ----------
type Cell = Rules.Creature & Fighter;
type Strategy = 'merge' | 'hybrid' | 'greedy';
const STRATEGY_NAMES: Record<Strategy, string> = {
  merge: 'Слияние одинаковых',
  hybrid: 'Охотник за гибридами',
  greedy: 'Оставлять сильнейшего',
};

interface RunResult {
  win: boolean;
  /** wave where the run was lost (or TOTAL_WAVES + 1 on win) */
  reached: number;
  lives: number;
  hybrids: Set<string>;
  /** damage share per unit name */
  dealt: Map<string, number>;
  /** lives lost per wave */
  leaks: number[];
}

function unitName(c: Rules.Creature) {
  return Rules.statsOf(c).name;
}

function playRun(strategy: Strategy): RunResult {
  const grid: (Cell | null)[][] = Array.from({ length: D.ROWS }, () => Array<Cell | null>(D.COLS).fill(null));
  const isWp = (x: number, y: number) => level!.waypoints.some((w) => w.x === x && w.y === y);
  const blocked = (x: number, y: number) => grid[y][x] !== null;
  const pathNow = () => fullPath(D.COLS, D.ROWS, blocked, level!.waypoints);
  for (const o of level!.obstacles) if (!isWp(o.x, o.y)) grid[o.y][o.x] = { x: o.x, y: o.y, kind: 'sealed', cd: 0, auraMul: 1 };

  let lives = D.START_LIVES;
  let gold = 0;
  let chance = 0;
  const hybrids = new Set<string>();
  const dealt = new Map<string, number>();
  const leaks: number[] = [];
  let path = pathNow()!;

  const fighters = () => {
    const out: Cell[] = [];
    for (const row of grid) for (const c of row) if (c && c.kind !== 'sealed') out.push(c);
    return out;
  };

  /** Cells next to the current path, ordered by how many path cells are in range 2.5. */
  const candidateCells = (): Pt[] => {
    const onPath = new Set(path.map((p) => p.y * D.COLS + p.x));
    const out: { p: Pt; score: number }[] = [];
    for (let y = 0; y < D.ROWS; y++)
      for (let x = 0; x < D.COLS; x++) {
        if (grid[y][x] || isWp(x, y)) continue;
        let score = 0;
        for (const p of path) if (Math.hypot(p.x - x, p.y - y) <= 2.5) score++;
        // standing on the path lengthens the maze — bots like that a bit
        if (onPath.has(y * D.COLS + x)) score += 3;
        out.push({ p: { x, y }, score: score + rng() * 2 });
      }
    return out.sort((a, b) => b.score - a.score).map((o) => o.p);
  };

  for (let wave = 1; wave <= D.TOTAL_WAVES; wave++) {
    // --- buy breed chance when affordable (keep a small reserve) ---
    while (chance < D.UPGRADE_COST.length && gold >= D.UPGRADE_COST[chance] + 5) {
      gold -= D.UPGRADE_COST[chance];
      chance++;
    }

    // --- build: place up to 5 ---
    const fresh: Cell[] = [];
    for (const p of candidateCells()) {
      if (fresh.length >= D.PER_ROUND) break;
      const c: Cell = { x: p.x, y: p.y, kind: 'mon', sp: Rules.randomSpecies(rng), level: Rules.rollLevel(chance, rng), cd: 0, auraMul: 1 };
      grid[p.y][p.x] = c;
      const np = pathNow();
      if (!np) {
        grid[p.y][p.x] = null;
        continue;
      }
      path = np;
      fresh.push(c);
    }

    // --- choose / cross ---
    if (fresh.length) {
      const { keep, partners } = decide(strategy, fresh, hybrids);
      const res = partners.length ? Rules.crossResult([keep, ...partners]) : null;
      if (res && 'hybrid' in res) {
        keep.kind = 'hybrid';
        keep.hybrid = res.hybrid.id;
        keep.sp = undefined;
        keep.level = undefined;
        hybrids.add(res.hybrid.id);
      } else if (res) {
        keep.level = res.level;
      }
      for (const c of fresh) if (c !== keep) {
        c.kind = 'sealed';
        c.sp = undefined;
        c.level = undefined;
      }
    }

    // --- auras ---
    const all = fighters();
    for (const u of all) u.auraMul = 1;
    for (const src of all) {
      const a = Rules.statsOf(src).aura;
      if (a) for (const u of all) if (u !== src && Math.hypot(u.x - src.x, u.y - src.y) <= 2.5) u.auraMul += a;
    }

    // --- wave ---
    const battle = new Battle(path, level!.waypoints, level!.hpMul, rng);
    battle.startWave(D.WAVES[wave - 1]);
    let lost = 0;
    let guard = 0;
    while (!battle.finished && guard++ < 60 * 60 * 10) {
      battle.step(1 / 30, all, (f) => Rules.statsOf(f as Cell));
      lost += battle.drainLives();
      if (lives - lost <= 0) break;
    }
    gold += battle.drainGold() + D.WAVE_BONUS_BASE + wave;
    lives -= lost;
    leaks.push(lost);
    for (const u of all) {
      const n = unitName(u);
      dealt.set(n, (dealt.get(n) ?? 0) + (u.dealt ?? 0));
      u.dealt = 0;
    }
    if (lives <= 0) return { win: false, reached: wave, lives: 0, hybrids, dealt, leaks };
  }
  return { win: true, reached: D.TOTAL_WAVES + 1, lives, hybrids, dealt, leaks };
}

/** Bot decision for the choose phase. */
function decide(strategy: Strategy, fresh: Cell[], known: Set<string>): { keep: Cell; partners: Cell[] } {
  const strongest = () => fresh.reduce((a, b) => (Rules.power(Rules.statsOf(b)) > Rules.power(Rules.statsOf(a)) ? b : a));

  if (strategy !== 'greedy') {
    // Best "same species & age" group
    const groups = new Map<string, Cell[]>();
    for (const c of fresh) {
      const k = `${c.sp}:${c.level}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    let bestMerge: Cell[] | null = null;
    for (const g of groups.values()) if (g.length >= 2 && g[0].level! < D.MAX_LEVEL && (!bestMerge || g.length > bestMerge.length)) bestMerge = g;

    // Any hybrid recipe that matches a subset of fresh
    let bestHybrid: { keep: Cell; partners: Cell[]; pw: number } | null = null;
    if (strategy === 'hybrid') {
      for (const h of D.HYBRIDS) {
        const pool = [...fresh];
        const picked: Cell[] = [];
        const ok = h.parents.every((need) => {
          const i = pool.findIndex((p) => !need.hybrid && p.sp === need.sp && p.level === need.level);
          if (i < 0) return false;
          picked.push(pool.splice(i, 1)[0]);
          return true;
        });
        if (!ok) continue;
        const pw = Rules.power(h.stats) * (known.has(h.id) ? 1 : 1.5);
        if (!bestHybrid || pw > bestHybrid.pw) bestHybrid = { keep: picked[0], partners: picked.slice(1), pw };
      }
    }
    if (bestHybrid) return { keep: bestHybrid.keep, partners: bestHybrid.partners };
    if (bestMerge) return { keep: bestMerge[0], partners: bestMerge.slice(1, 4) };
  }
  return { keep: strongest(), partners: [] };
}

// ---------- run & report ----------
const strategies: Strategy[] = ONLY ? [ONLY as Strategy] : ['merge', 'hybrid', 'greedy'];
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

console.log(`\nСимуляция баланса · карта «${level.title}» (ХП ×${level.hpMul}) · ${RUNS} партий на стратегию · seed ${seed}\n`);

const t0 = Date.now();
for (const st of strategies) {
  const results: RunResult[] = [];
  for (let i = 0; i < RUNS; i++) results.push(playRun(st));

  const wins = results.filter((r) => r.win);
  const lostAt = new Array(D.TOTAL_WAVES + 2).fill(0);
  for (const r of results) if (!r.win) lostAt[r.reached]++;
  const leakSum = new Array(D.TOTAL_WAVES).fill(0);
  const leakCnt = new Array(D.TOTAL_WAVES).fill(0);
  for (const r of results) r.leaks.forEach((l, i) => ((leakSum[i] += l), leakCnt[i]++));
  const dealt = new Map<string, number>();
  for (const r of results) for (const [k, v] of r.dealt) dealt.set(k, (dealt.get(k) ?? 0) + v);
  const totalDealt = [...dealt.values()].reduce((a, b) => a + b, 0);
  const hyb = new Map<string, number>();
  for (const r of results) for (const h of r.hybrids) hyb.set(h, (hyb.get(h) ?? 0) + 1);

  console.log(`=== ${STRATEGY_NAMES[st]} (${st}) ===`);
  console.log(
    `Победы: ${wins.length}/${RUNS} (${pct(wins.length, RUNS)})` +
      (wins.length ? ` · средние жизни у победителей: ${(wins.reduce((a, r) => a + r.lives, 0) / wins.length).toFixed(1)}` : ''),
  );
  console.log('\nВолна | дошли | проигрыш тут | ср. утечка жизней');
  let alive = RUNS;
  for (let w = 1; w <= D.TOTAL_WAVES; w++) {
    const reached = alive;
    alive -= lostAt[w];
    const avgLeak = leakCnt[w - 1] ? leakSum[w - 1] / leakCnt[w - 1] : 0;
    const flag = lostAt[w] / Math.max(1, reached) > 0.25 ? '  ⚠ стена' : avgLeak < 0.05 && reached === RUNS ? '' : '';
    console.log(`${pad(String(w), 5)} | ${pad(String(reached), 5)} | ${pad(String(lostAt[w]), 12)} | ${avgLeak.toFixed(2)}${flag}`);
  }

  console.log('\nДоля урона (топ-12):');
  [...dealt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([n, v]) => console.log(`  ${pad(n, 30)} ${pct(v, totalDealt)}`));

  if (hyb.size) {
    console.log('\nКак часто выводили гибриды:');
    for (const h of D.HYBRIDS) console.log(`  ${pad(h.stats.name, 26)} ${pct(hyb.get(h.id) ?? 0, RUNS)}`);
  }
  console.log('');
}
console.log(`Готово за ${((Date.now() - t0) / 1000).toFixed(1)} с.\n`);
