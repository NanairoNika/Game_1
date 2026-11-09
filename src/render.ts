import Phaser from 'phaser';
import { CELL_H, CELL_W, OBJ_H } from './data';

/**
 * Placeholder 3/4-view drawing. Every object stands on its cell's footprint and
 * rises OBJ_H pixels above it; the scene sorts objects by their bottom edge so
 * nearer things overlap farther ones.
 */
type G = Phaser.GameObjects.Graphics;

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
export function creature(g: G, x: number, footY: number, r: number, color: number, opts: { spikes?: boolean; hurt?: number } = {}) {
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
  if (opts.hurt) g.fillStyle(0xff2020, opts.hurt * 0.8).fillCircle(x, cy, r);
  g.lineStyle(2, 0x000000, 0.35).strokeCircle(x, cy, r);
  eyes(g, x, cy, r);
}

/** Cage floor, tinted with the occupant's colour so species read at a glance. */
export function cageFloor(g: G, x0: number, y0: number, tint?: number) {
  const b = box(x0, y0);
  g.fillStyle(0x2c2822).fillRect(b.l, b.top, b.w, b.h);
  if (tint !== undefined) g.fillStyle(tint, 0.45).fillRect(b.l, b.top, b.w, b.h);
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
export function cageFront(g: G, x0: number, y0: number, frame: number, level = -1) {
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
}

/** Solid metal block. p in 0..1 is how far the plates have slid down. */
export function sealedBlock(g: G, x0: number, y0: number, p = 1) {
  const b = box(x0, y0);
  const topY = b.top - OBJ_H;
  const frontY = b.bot - OBJ_H;
  g.fillStyle(0x8d939b, p).fillRect(b.l, topY, b.w, b.h);
  g.fillStyle(0x596068).fillRect(b.l, frontY, b.w, OBJ_H * p);
  if (p < 1) return;
  g.lineStyle(2, 0x3e434a);
  g.strokeRect(b.l, topY, b.w, b.h + OBJ_H);
  g.lineBetween(b.l, frontY, b.r, frontY);
  g.lineBetween(b.cx, frontY, b.cx, b.bot);
  g.fillStyle(0xb8bec6);
  for (const x of [b.l + 4, b.r - 4]) for (const y of [topY + 4, frontY - 4, frontY + 4, b.bot - 4]) g.fillCircle(x, y, 1.6);
}

/** Blade dropping into the cage during the reject animation. t in 0..1. */
export function blade(g: G, x0: number, y0: number, t: number) {
  const b = box(x0, y0);
  const y = b.top - OBJ_H - 30 + (OBJ_H + 26) * Math.min(1, t * 1.4);
  g.fillStyle(0xd8dde4).fillTriangle(b.cx - 9, y - 12, b.cx + 9, y - 12, b.cx, y + 6);
  g.lineStyle(2, 0x3e434a).strokeTriangle(b.cx - 9, y - 12, b.cx + 9, y - 12, b.cx, y + 6);
}

export function enemyBody(g: G, x: number, footY: number, r: number, color: number) {
  groundShadow(g, x, footY, r * 2.2, 0.35);
  const cy = footY - r - 3;
  g.fillStyle(color).fillCircle(x, cy, r);
  g.lineStyle(2, 0x000000, 0.4).strokeCircle(x, cy, r);
  g.fillStyle(0xffe0a0)
    .fillCircle(x - r * 0.35, cy - r * 0.15, Math.max(1.8, r * 0.18))
    .fillCircle(x + r * 0.35, cy - r * 0.15, Math.max(1.8, r * 0.18));
}
