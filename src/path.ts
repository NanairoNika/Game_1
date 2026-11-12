export type Pt = { x: number; y: number };

// 8 directions. Straight step costs 10, diagonal 14 (~10 * sqrt 2).
const DIRS = [
  { x: 0, y: 1, c: 10 },
  { x: 1, y: 0, c: 10 },
  { x: 0, y: -1, c: 10 },
  { x: -1, y: 0, c: 10 },
  { x: 1, y: 1, c: 14 },
  { x: 1, y: -1, c: 14 },
  { x: -1, y: 1, c: 14 },
  { x: -1, y: -1, c: 14 },
];

/**
 * Shortest path between two cells (Dijkstra), or null if blocked.
 * Enemies may move diagonally, but not between two walls touching at a corner:
 * a diagonal step needs both neighbouring straight cells to be free.
 */
export function shortestPath(
  cols: number,
  rows: number,
  blocked: (x: number, y: number) => boolean,
  from: Pt,
  to: Pt,
): Pt[] | null {
  const n = cols * rows;
  const dist = new Int32Array(n).fill(0x7fffffff);
  const prev = new Int32Array(n).fill(-1);
  const start = from.y * cols + from.x;
  const goal = to.y * cols + to.x;
  const heap = new MinHeap(n * 4);
  dist[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const [cur, d] = heap.pop();
    if (d !== dist[cur]) continue;
    if (cur === goal) break;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    for (const dir of DIRS) {
      const nx = cx + dir.x;
      const ny = cy + dir.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || blocked(nx, ny)) continue;
      if (dir.x && dir.y && (blocked(cx + dir.x, cy) || blocked(cx, cy + dir.y))) continue;
      const nd = d + dir.c;
      const ni = ny * cols + nx;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = cur;
        heap.push(ni, nd);
      }
    }
  }
  if (dist[goal] === 0x7fffffff) return null;
  const out: Pt[] = [];
  for (let c = goal; c !== -1; c = prev[c]) out.push({ x: c % cols, y: (c / cols) | 0 });
  return out.reverse();
}

/** Path through every waypoint in order, or null if any leg is blocked. */
export function fullPath(
  cols: number,
  rows: number,
  blocked: (x: number, y: number) => boolean,
  waypoints: Pt[],
): Pt[] | null {
  const out: Pt[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const leg = shortestPath(cols, rows, blocked, waypoints[i], waypoints[i + 1]);
    if (!leg) return null;
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out;
}

/** Length of a path in cells (diagonal steps count as ~1.41). */
export function pathLength(path: Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}

class MinHeap {
  private keys: Int32Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Int32Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(v: number, k: number) {
    if (this.size >= this.keys.length) {
      const nk = new Int32Array(this.keys.length * 2);
      const nv = new Int32Array(this.keys.length * 2);
      nk.set(this.keys);
      nv.set(this.vals);
      this.keys = nk;
      this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = k;
    this.vals[i] = v;
  }
  pop(): [number, number] {
    const v = this.vals[0];
    const k = this.keys[0];
    const lk = this.keys[--this.size];
    const lv = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lk) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = lk;
    this.vals[i] = lv;
    return [v, k];
  }
}
