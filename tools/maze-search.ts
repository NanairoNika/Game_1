/**
 * Maze optimizer: searches for wall layouts that make every leg of the enemy route
 * pass through a "kill zone" around one focus cell, and keep the route long.
 *
 *   node --experimental-strip-types tools/maze-search.ts <budget> <focusX> <focusY> [iterations] [seed] [fixed.txt]
 *
 * fixed.txt: output of a previous run; its walls stay in place (used to grow a maze in stages).
 *
 * Prints the best layout as a grid: X = build here, @ = focus (build the strongest monster here).
 */
import { readFileSync } from 'node:fs';
import { fullPath, type Pt } from '../src/path.ts';

// Keep in sync with src/data.ts
const COLS = 15;
const ROWS = 20;
const WAYPOINTS: Pt[] = [
  { x: 7, y: 0 },
  { x: 1, y: 5 },
  { x: 13, y: 10 },
  { x: 1, y: 15 },
  { x: 7, y: 19 },
];
const ZONE_R = 3;

const budget = Number(process.argv[2] ?? 70);
const focus = { x: Number(process.argv[3] ?? 7), y: Number(process.argv[4] ?? 10) };
const iterations = Number(process.argv[5] ?? 300000);
let seed = Number(process.argv[6] ?? 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const isWp = (x: number, y: number) => WAYPOINTS.some((w) => w.x === x && w.y === y);
const inZone = (p: Pt) => Math.hypot(p.x - focus.x, p.y - focus.y) <= ZONE_R;

export function evaluate(blocked: Uint8Array) {
  const legs: Pt[][] = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const leg = fullPath(COLS, ROWS, (x, y) => blocked[y * COLS + x] === 1, [WAYPOINTS[i], WAYPOINTS[i + 1]]);
    if (!leg) return null;
    legs.push(leg);
  }
  let len = 0;
  let zone = 0;
  let legsIn = 0;
  for (const leg of legs) {
    len += leg.length - 1;
    const z = leg.filter(inZone).length;
    zone += z;
    if (z > 0) legsIn++;
  }
  return { len, zone, legsIn, score: len + 3 * zone + 40 * legsIn };
}

const free: number[] = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!isWp(x, y)) free.push(y * COLS + x);
const focusIdx = focus.y * COLS + focus.x;

const fixed = new Uint8Array(COLS * ROWS);
fixed[focusIdx] = 1;
if (process.argv[7]) {
  const grid = readFileSync(process.argv[7], 'utf8').trim().split('\n').slice(1);
  grid.forEach((line, y) => [...line].forEach((ch, x) => { if (ch === 'X' || ch === '@') fixed[y * COLS + x] = 1; }));
}
let cur = fixed.slice();
let count = cur.reduce((a, b) => a + b, 0);
let curEval = evaluate(cur)!;
let best = cur.slice();
let bestEval = curEval;

for (let it = 0; it < iterations; it++) {
  const T = 30 * Math.pow(0.5 / 30, it / iterations);
  const next = cur.slice();
  let nextCount = count;
  const r = rand();
  const pick = () => free[Math.floor(rand() * free.length)];
  if (r < 0.45 && count < budget) {
    const c = pick();
    if (next[c]) continue;
    next[c] = 1;
    nextCount++;
  } else if (r < 0.6) {
    const c = pick();
    if (!next[c] || fixed[c]) continue;
    next[c] = 0;
    nextCount--;
  } else {
    // move a wall to a nearby cell
    const c = pick();
    if (!next[c] || fixed[c]) continue;
    const dx = Math.floor(rand() * 5) - 2;
    const dy = Math.floor(rand() * 5) - 2;
    const nx = (c % COLS) + dx;
    const ny = Math.floor(c / COLS) + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || isWp(nx, ny)) continue;
    const n = ny * COLS + nx;
    if (next[n]) continue;
    next[c] = 0;
    next[n] = 1;
  }
  const e = evaluate(next);
  if (!e) continue;
  if (e.score >= curEval.score || rand() < Math.exp((e.score - curEval.score) / T)) {
    cur = next;
    count = nextCount;
    curEval = e;
    if (e.score > bestEval.score) {
      best = next.slice();
      bestEval = e;
    }
  }
}

// Prune walls that do not help: remove any non-fixed wall whose removal keeps the score.
for (let changed = true; changed; ) {
  changed = false;
  for (let c = 0; c < best.length; c++) {
    if (!best[c] || fixed[c]) continue;
    best[c] = 0;
    const e = evaluate(best);
    if (e && e.score >= bestEval.score) {
      bestEval = e;
      changed = true;
    } else best[c] = 1;
  }
}

const empty = evaluate(new Uint8Array(COLS * ROWS))!;
let used = 0;
const lines: string[] = [];
for (let y = 0; y < ROWS; y++) {
  let line = '';
  for (let x = 0; x < COLS; x++) {
    const wi = WAYPOINTS.findIndex((w) => w.x === x && w.y === y);
    if (wi >= 0) line += wi === 0 ? 'S' : wi === WAYPOINTS.length - 1 ? 'E' : String(wi);
    else if (y * COLS + x === focusIdx) line += '@';
    else if (best[y * COLS + x]) line += 'X';
    else line += '.';
    if (best[y * COLS + x]) used++;
  }
  lines.push(line);
}
console.log(JSON.stringify({ budget, focus, used, ...bestEval, emptyLen: empty.len, emptyZone: empty.zone }));
console.log(lines.join('\n'));
