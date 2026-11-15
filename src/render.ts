import Phaser from 'phaser';
import { CELL_H, CELL_W, OBJ_H } from './data';

/**
 * Placeholder 3/4-view drawing. Every object stands on its cell's footprint and
 * rises OBJ_H pixels above it; the scene sorts objects by their bottom edge so
 * nearer things overlap farther ones.
 */
type G = Phaser.GameObjects.Graphics;

export type KillKind = 'blade' | 'fire' | 'acid' | 'tesla';

const INSET = 4;

function box(x0: number, y0: number) {
  const l = x0 + INSET;
  const r = x0 + CELL_W - INSET;
  const top = y0 + INSET;
  const bot = y0 + CELL_H - INSET;
  return { l, r, top, bot, w: r - l, h: bot - top, cx: x0 + CELL_W / 2 };
}

export function groundShadow(g: G, x: number, y: number, w: number, alpha = 0.3) {
  g.fillStyle(0x000000, alpha).fillEllipse(x, y, w, w * 0.38);
}

function eyes(g: G, x: number, y: number, r: number) {
  const ex = r * 0.38;
  const er = Math.max(2.5, r * 0.26);
  g.fillStyle(0xffffff)
    .fillCircle(x - ex, y - r * 0.15, er)
    .fillCircle(x + ex, y - r * 0.15, er);
  g.fillStyle(0x111111)
    .fillCircle(x - ex, y - r * 0.1, er * 0.5)
    .fillCircle(x + ex, y - r * 0.1, er * 0.5);
}

/** A round creature standing at (x, footY). */
export function creature(
  g: G,
  x: number,
  footY: number,
  r: number,
  color: number,
  opts: { spikes?: boolean; hurt?: number; hurtColor?: number } = {},
) {
  const cy = footY - r;
  if (opts.spikes) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 8;
      const rad = i % 2 ? r : r * 1.45;
      pts.push({ x: x + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
    g.fillStyle(0xffd84a).fillPoints(pts, true);
  }
  g.fillStyle(color).fillCircle(x, cy, r);
  if (opts.hurt) g.fillStyle(opts.hurtColor ?? 0xff2020, opts.hurt * 0.85).fillCircle(x, cy, r);
  g.lineStyle(2, 0x000000, 0.35).strokeCircle(x, cy, r);
  eyes(g, x, cy, r);
}

/** Cage floor, tinted with the occupant's colour so species read at a glance. */
export function cageFloor(g: G, x0: number, y0: number, tint?: number, residue?: KillKind, residueAmt = 0) {
  const b = box(x0, y0);
  g.fillStyle(0x2c2822).fillRect(b.l, b.top, b.w, b.h);
  if (tint !== undefined) g.fillStyle(tint, 0.45).fillRect(b.l, b.top, b.w, b.h);
  if (residue && residueAmt > 0) {
    const cy = (b.top + b.bot) / 2;
    if (residue === 'blade') {
      g.fillStyle(0xa81018, 0.85 * residueAmt)
        .fillEllipse(b.cx, cy + 2, b.w * 0.72 * residueAmt, b.h * 0.55 * residueAmt)
        .fillCircle(b.cx - 8, cy - 3, 4 * residueAmt)
        .fillCircle(b.cx + 9, cy + 4, 3.5 * residueAmt);
    } else if (residue === 'fire') {
      g.fillStyle(0x141010, 0.9 * residueAmt).fillEllipse(b.cx, cy + 2, b.w * 0.78, b.h * 0.62);
      g.fillStyle(0xff5a18, 0.75 * residueAmt)
        .fillCircle(b.cx - 5, cy + 2, 2.5)
        .fillCircle(b.cx + 6, cy - 1, 2);
    } else if (residue === 'acid') {
      g.fillStyle(0x32dc48, 0.78 * residueAmt).fillRect(b.l + 2, b.top + 2, b.w - 4, b.h - 4);
      g.fillStyle(0xa8ff90, 0.85 * residueAmt)
        .fillCircle(b.cx - 7, cy - 2, 2.8)
        .fillCircle(b.cx + 6, cy + 3, 3.2);
    } else if (residue === 'tesla') {
      g.fillStyle(0x1b2230, 0.85 * residueAmt).fillEllipse(b.cx, cy + 1, b.w * 0.7, b.h * 0.5);
    }
  }
}

/** Posts at the back of the cage: drawn before the monster inside. */
export function cageBack(g: G, x0: number, y0: number, frame: number) {
  const b = box(x0, y0);
  g.lineStyle(3, frame, 0.9);
  g.lineBetween(b.l, b.top, b.l, b.top - OBJ_H);
  g.lineBetween(b.r, b.top, b.r, b.top - OBJ_H);
  g.lineBetween(b.l, b.top - OBJ_H, b.r, b.top - OBJ_H);
}

/** Front bars and the top frame: drawn after the monster inside. */
export function cageFront(g: G, x0: number, y0: number, frame: number, level = -1, antiAir = false) {
  const b = box(x0, y0);
  const top = b.bot - OBJ_H;
  g.lineStyle(1.5, frame, 0.55);
  for (let i = 1; i < 4; i++) {
    const x = b.l + (b.w * i) / 4;
    g.lineBetween(x, b.bot, x, top);
  }
  g.lineStyle(3, frame);
  g.lineBetween(b.l, b.bot, b.l, top);
  g.lineBetween(b.r, b.bot, b.r, top);
  g.lineBetween(b.l, b.bot, b.r, b.bot);
  g.lineBetween(b.l, top, b.r, top);
  g.lineBetween(b.l, top, b.l, b.top - OBJ_H);
  g.lineBetween(b.r, top, b.r, b.top - OBJ_H);
  for (let i = 0; i <= level; i++) {
    g.fillStyle(0xffe27a).fillCircle(b.cx - (level * 6) / 2 + i * 6, b.bot - 3, 2.2);
  }
  if (antiAir) {
    // Small radar / anti-air dish on top-right corner of the cage
    const rx = b.r - 3;
    const ry = b.top - OBJ_H - 5;
    g.lineStyle(2, 0x70e8ff).lineBetween(rx, b.top - OBJ_H, rx, ry);
    g.fillStyle(0x70e8ff).fillCircle(rx, ry, 3.2);
    g.lineStyle(1.5, 0xffffff, 0.85).strokeCircle(rx, ry, 5);
  }
}

/** Solid metal block. p in 0..1 is how far the plates have slid down. */
export function sealedBlock(g: G, x0: number, y0: number, p = 1, pillar = false) {
  const b = box(x0, y0);
  const topY = b.top - OBJ_H;
  const frontY = b.bot - OBJ_H;
  const topCol = pillar ? 0x5c6878 : 0x8d939b;
  const frontCol = pillar ? 0x3b4452 : 0x596068;
  g.fillStyle(topCol, p).fillRect(b.l, topY, b.w, b.h);
  g.fillStyle(frontCol).fillRect(b.l, frontY, b.w, OBJ_H * p);
  if (p < 1) return;
  g.lineStyle(2, pillar ? 0x262c36 : 0x3e434a);
  g.strokeRect(b.l, topY, b.w, b.h + OBJ_H);
  g.lineBetween(b.l, frontY, b.r, frontY);
  g.lineBetween(b.cx, frontY, b.cx, b.bot);
  if (pillar) {
    // Hazard stripes on permanent lab pillars
    g.lineStyle(2, 0xe0a830, 0.65);
    g.lineBetween(b.l + 4, topY + 5, b.r - 4, frontY - 5);
    g.lineBetween(b.l + 4, frontY - 5, b.r - 4, topY + 5);
  } else {
    g.fillStyle(0xb8bec6);
    for (const x of [b.l + 4, b.r - 4])
      for (const y of [topY + 4, frontY - 4, frontY + 4, b.bot - 4]) g.fillCircle(x, y, 1.6);
  }
}

/** Diverse execution animations inside the cage during the reject phase. t in 0..1. */
export function killEffect(g: G, x0: number, y0: number, kind: KillKind, t: number) {
  const b = box(x0, y0);
  const footY = y0 + CELL_H / 2 + 5;
  if (kind === 'blade') {
    const drop = Math.min(1, t * 1.6);
    const y = b.top - OBJ_H - 28 + (OBJ_H + 26) * drop;
    // Heavy guillotine blade
    g.fillStyle(0xd8dde4).fillTriangle(b.cx - 11, y - 14, b.cx + 11, y - 14, b.cx, y + 7);
    g.lineStyle(2, 0x3e434a).strokeTriangle(b.cx - 11, y - 14, b.cx + 11, y - 14, b.cx, y + 7);
    if (t > 0.35) {
      // Blood droplets flying outward
      const sp = (t - 0.35) / 0.65;
      g.fillStyle(0xd81820, 1 - sp * 0.4);
      for (let i = 0; i < 6; i++) {
        const ang = -Math.PI * 0.85 + (i * Math.PI * 0.7) / 5;
        const dist = 4 + sp * 16;
        g.fillCircle(b.cx + Math.cos(ang) * dist, footY - 6 + Math.sin(ang) * dist * 0.7, 2.6 * (1 - sp * 0.3));
      }
    }
  } else if (kind === 'fire') {
    // Flamethrower jet from top of cage + rising fire tongues
    const p = Math.sin(t * Math.PI);
    g.fillStyle(0xff4518, 0.85).fillTriangle(b.cx - 4, b.top - OBJ_H, b.cx + 4, b.top - OBJ_H, b.cx, footY);
    for (let i = -1; i <= 1; i++) {
      const fx = b.cx + i * 7;
      const fh = 10 + p * 14 + (i === 0 ? 5 : 0);
      g.fillStyle(0xff6a10, 0.9).fillEllipse(fx, footY - fh * 0.45, 11, fh);
      g.fillStyle(0xffe040, 0.9).fillEllipse(fx, footY - fh * 0.35, 6, fh * 0.65);
    }
    if (t > 0.4) {
      const sm = (t - 0.4) / 0.6;
      g.fillStyle(0x282828, 0.55 * (1 - sm * 0.5)).fillCircle(b.cx, b.top - OBJ_H - sm * 10, 9);
    }
  } else if (kind === 'acid') {
    // Acid tank flooding inside the cage + bursting bubbles
    const h = Math.min(1, t * 1.3) * (OBJ_H + 6);
    g.fillStyle(0x30e848, 0.62).fillRect(b.l + 2, b.bot - h, b.w - 4, h);
    g.lineStyle(1.5, 0xa8ff98, 0.9).lineBetween(b.l + 2, b.bot - h, b.r - 2, b.bot - h);
    for (let i = 0; i < 4; i++) {
      const bx = b.l + 7 + i * 8;
      const by = b.bot - ((t * 35 + i * 9) % Math.max(4, h));
      g.fillStyle(0xb8ffa0, 0.9).fillCircle(bx, by, 2.2);
    }
  } else if (kind === 'tesla') {
    // High-voltage electric arcs between cage bars
    g.fillStyle(0x80ecff, 0.28 * Math.sin(t * Math.PI)).fillRect(b.l, b.bot - OBJ_H, b.w, OBJ_H);
    g.lineStyle(2.2, 0x90f4ff, 0.95);
    const seed = Math.floor(t * 24);
    for (let i = 0; i < 3; i++) {
      const sy = b.bot - 4 - i * 6;
      const midY = sy - 4 + ((seed + i * 3) % 9);
      g.beginPath();
      g.moveTo(b.l + 1, sy);
      g.lineTo(b.cx - 5, midY);
      g.lineTo(b.cx + 5, sy - 3 + ((seed + i) % 7));
      g.lineTo(b.r - 1, sy);
      g.strokePath();
    }
    g.fillStyle(0xffffff, 0.85).fillCircle(b.cx, footY - 8, 4 + (seed % 3));
  }
}

/** Entry breach / portal at waypoint S (index 0). */
export function spawnBreach(g: G, x0: number, y0: number, now: number) {
  const cx = x0 + CELL_W / 2;
  const cy = y0 + CELL_H / 2;
  const pulse = 0.85 + 0.15 * Math.sin(now * 0.006);
  g.fillStyle(0x2a1414).fillEllipse(cx, cy, CELL_W * 0.88, CELL_H * 0.8);
  g.lineStyle(2.5, 0xff5040, 0.9).strokeEllipse(cx, cy, CELL_W * 0.86 * pulse, CELL_H * 0.76 * pulse);
  g.fillStyle(0xff7850, 0.45).fillEllipse(cx, cy, CELL_W * 0.52 * pulse, CELL_H * 0.45 * pulse);
}

/** Data Terminal at intermediate waypoints (1, 2, 3) where enemies steal access codes. */
export function terminalNode(g: G, x0: number, y0: number, index: number, now: number) {
  const cx = x0 + CELL_W / 2;
  const cy = y0 + CELL_H / 2;
  // Floor pad
  g.fillStyle(0x1f3038).fillEllipse(cx, cy + 3, CELL_W * 0.84, CELL_H * 0.74);
  g.lineStyle(2, 0x48b8d8, 0.75).strokeEllipse(cx, cy + 3, CELL_W * 0.84, CELL_H * 0.74);
  // 3/4 Terminal desk / kiosk
  const tw = 24;
  const th = 16;
  const tx = cx - tw / 2;
  const ty = cy - th - 2;
  g.fillStyle(0x32404c).fillRect(tx, ty, tw, th);
  g.lineStyle(1.5, 0x1a2228).strokeRect(tx, ty, tw, th);
  // Glowing cyan screen
  g.fillStyle(0x122c38).fillRect(tx + 3, ty + 3, tw - 6, 9);
  const scan = ((now * 0.015 + index * 3) % 7) | 0;
  g.fillStyle(0x58f0ff, 0.9).fillRect(tx + 5, ty + 4 + (scan % 5), tw - 10, 2);
  // Blinking status LED on top
  const blink = Math.sin(now * 0.008 + index) > 0;
  g.fillStyle(blink ? 0xffd84a : 0x58f0ff).fillCircle(tx + tw - 4, ty - 2, 2.4);
}

/** Giant Supercomputer (Mainframe) at the final exit waypoint (E). */
export function mainframeCore(g: G, x0: number, y0: number, now: number) {
  const cx = x0 + CELL_W / 2;
  const cy = y0 + CELL_H / 2;
  const pulse = 0.75 + 0.25 * Math.sin(now * 0.008);
  // Armored floor platform
  g.fillStyle(0x281c38).fillEllipse(cx, cy + 4, CELL_W * 0.96, CELL_H * 0.86);
  g.lineStyle(2.5, 0xd868ff, 0.9).strokeEllipse(cx, cy + 4, CELL_W * 0.96, CELL_H * 0.86);
  // Mainframe server tower (wider and taller than normal terminals)
  const mw = 34;
  const mh = 24;
  const mx = cx - mw / 2;
  const my = cy - mh + 2;
  g.fillStyle(0x262a36).fillRect(mx, my, mw, mh);
  g.fillStyle(0x3c4254).fillRect(mx, my - 5, mw, 5);
  g.lineStyle(2, 0x151820).strokeRect(mx, my - 5, mw, mh + 5);
  // Dual glowing monitors + central data core
  g.fillStyle(0x142230)
    .fillRect(mx + 3, my + 3, 12, 9)
    .fillRect(mx + mw - 15, my + 3, 12, 9);
  g.fillStyle(0x68f8ff, 0.85 * pulse)
    .fillRect(mx + 5, my + 5, 8, 5)
    .fillRect(mx + mw - 13, my + 5, 8, 5);
  // Server rack lights at bottom
  for (let i = 0; i < 4; i++) {
    const on = ((Math.floor(now / 180) + i) % 2) === 0;
    g.fillStyle(on ? 0xff4868 : 0x50e888).fillCircle(mx + 6 + i * 7, my + 17, 1.8);
  }
  // Glowing energy orb on the roof
  g.fillStyle(0xe070ff, 0.9 * pulse).fillCircle(cx, my - 6, 4.5);
  g.lineStyle(1.5, 0xffffff, 0.8).strokeCircle(cx, my - 6, 5.5);
}

export function enemyBody(
  g: G,
  x: number,
  footY: number,
  r: number,
  color: number,
  opts: { flying?: boolean; regen?: boolean; split?: boolean; now?: number } = {},
) {
  const hover = opts.flying ? 20 + Math.sin((opts.now ?? 0) * 0.012 + x) * 2.5 : 3;
  groundShadow(g, x, footY, r * (opts.flying ? 1.7 : 2.2), opts.flying ? 0.25 : 0.35);
  const cy = footY - r - hover;
  if (opts.flying) {
    // Rotor wings / thrusters for flying drones
    g.fillStyle(0xc8ecff, 0.75)
      .fillEllipse(x - r * 1.15, cy - r * 0.4, r * 1.1, r * 0.42)
      .fillEllipse(x + r * 1.15, cy - r * 0.4, r * 1.1, r * 0.42);
    g.lineStyle(1.5, 0x40b8ff, 0.8)
      .strokeEllipse(x - r * 1.15, cy - r * 0.4, r * 1.1, r * 0.42)
      .strokeEllipse(x + r * 1.15, cy - r * 0.4, r * 1.1, r * 0.42);
  }
  g.fillStyle(color).fillCircle(x, cy, r);
  g.lineStyle(2, 0x000000, 0.4).strokeCircle(x, cy, r);
  if (opts.split) {
    // Segmented core indicator for splitter carriers
    g.fillStyle(0xffe060, 0.85)
      .fillCircle(x - r * 0.32, cy + r * 0.3, 2.2)
      .fillCircle(x + r * 0.32, cy + r * 0.3, 2.2)
      .fillCircle(x, cy + r * 0.42, 2.2);
  }
  if (opts.regen) {
    // Green bio-regeneration cross on forehead
    g.fillStyle(0x90ff98)
      .fillRect(x - 1.2, cy - r * 0.72, 2.4, 6)
      .fillRect(x - 3, cy - r * 0.72 + 1.8, 6, 2.4);
  }
  g.fillStyle(0xffe0a0)
    .fillCircle(x - r * 0.35, cy - r * 0.15, Math.max(1.8, r * 0.18))
    .fillCircle(x + r * 0.35, cy - r * 0.15, Math.max(1.8, r * 0.18));
}
