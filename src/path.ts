export type Pt = { x: number; y: number };

const DIRS = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
];

/** Shortest 4-directional path between two cells, or null if blocked. */
export function bfs(
  cols: number,
  rows: number,
  blocked: (x: number, y: number) => boolean,
  from: Pt,
  to: Pt,
): Pt[] | null {
  const prev = new Int32Array(cols * rows).fill(-2);
  const start = from.y * cols + from.x;
  const goal = to.y * cols + to.x;
  const queue = [start];
  prev[start] = -1;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur === goal) break;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (prev[n] !== -2 || blocked(nx, ny)) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -2) return null;
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
    const leg = bfs(cols, rows, blocked, waypoints[i], waypoints[i + 1]);
    if (!leg) return null;
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out;
}
