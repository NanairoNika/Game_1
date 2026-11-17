/**
 * Wave combat simulation shared by the Phaser scene and the headless balance simulator.
 * Positions of enemies are in cell units, shots fly in screen pixels.
 * No Phaser imports here.
 */
import * as D from './data';
import type { Pt } from './path';

export interface Fighter {
  x: number;
  y: number;
  /** attack cooldown, seconds */
  cd: number;
  /** attack speed multiplier from auras and upgrades */
  auraMul: number;
  /** damage dealt (used by the simulator report) */
  dealt?: number;
}

export type Enemy = {
  fx: number;
  fy: number;
  seg: number;
  dist: number;
  hp: number;
  maxHp: number;
  speed: number;
  slowPct: number;
  slowUntil: number;
  poisonDps: number;
  poisonUntil: number;
  poisonSrc?: Fighter;
  def: D.EnemyDef;
  gold: number;
  dead: boolean;
};

export type Shot = { x: number; y: number; target: Enemy; tx: number; ty: number; stats: D.Stats; src: Fighter };

const SHOT_SPEED = 750;
/** Height (px) at which shots hit ground and flying enemies. */
export const GROUND_HIT_H = 12;
export const AIR_HIT_H = 22;

export function toPx(fx: number, fy: number, gridX = D.GRID_X, gridY = D.GRID_Y) {
  return { x: gridX + fx * D.CELL_W + D.CELL_W / 2, y: gridY + fy * D.CELL_H + D.CELL_H / 2 };
}

export class Battle {
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  clock = 0;
  waveTime = 0;
  spawnQueue: { t: number; g: D.SpawnGroup }[] = [];
  /** accumulated since last drain */
  goldEarned = 0;
  livesLost = 0;
  path: Pt[];
  airPath: Pt[];
  hpMul: number;
  gridX: number;
  gridY: number;
  private rng: () => number;

  constructor(
    path: Pt[],
    airPath: Pt[],
    hpMul = 1,
    rng: () => number = Math.random,
    gridX = D.GRID_X,
    gridY = D.GRID_Y,
  ) {
    this.path = path;
    this.airPath = airPath;
    this.hpMul = hpMul;
    this.rng = rng;
    this.gridX = gridX;
    this.gridY = gridY;
  }

  startWave(groups: D.SpawnGroup[]) {
    this.spawnQueue = [];
    for (const g of groups) for (let i = 0; i < g.count; i++) this.spawnQueue.push({ t: g.delay + i * g.interval, g });
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.waveTime = 0;
    this.shots = [];
  }

  get finished() {
    return this.spawnQueue.length === 0 && this.enemies.length === 0;
  }

  drainGold() {
    const g = this.goldEarned;
    this.goldEarned = 0;
    return g;
  }

  drainLives() {
    const l = this.livesLost;
    this.livesLost = 0;
    return l;
  }

  private route(e: Enemy) {
    return e.def.flying ? this.airPath : this.path;
  }

  step(dt: number, fighters: Fighter[], statsOf: (f: Fighter) => D.Stats) {
    this.clock += dt;
    this.waveTime += dt;

    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveTime) {
      const { g } = this.spawnQueue.shift()!;
      const hp = Math.max(1, Math.round(g.hp * this.hpMul));
      const route = g.enemy.flying ? this.airPath : this.path;
      this.enemies.push(this.makeEnemy(g.enemy, route[0].x, route[0].y, 0, 0, hp, g.gold));
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      const route = this.route(e);
      const slowed = this.clock < e.slowUntil ? 1 - e.slowPct : 1;
      let remaining = e.speed * slowed * dt;
      while (remaining > 0 && e.seg < route.length - 1) {
        const t = route[e.seg + 1];
        const d = Math.hypot(t.x - e.fx, t.y - e.fy);
        if (d <= remaining) {
          e.fx = t.x;
          e.fy = t.y;
          e.seg++;
          e.dist += d;
          remaining -= d;
        } else {
          e.fx += ((t.x - e.fx) / d) * remaining;
          e.fy += ((t.y - e.fy) / d) * remaining;
          e.dist += remaining;
          remaining = 0;
        }
      }
      if (e.seg >= route.length - 1) {
        e.dead = true;
        this.livesLost += e.def.livesCost;
        continue;
      }
      if (e.def.regen > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.def.regen * dt);
      if (this.clock < e.poisonUntil) this.damage(e, e.poisonDps * dt, false, e.poisonSrc);
    }

    for (const u of fighters) {
      u.cd -= dt;
      if (u.cd > 0) continue;
      u.cd = 0;
      const s = statsOf(u);
      const targets = this.enemies
        .filter((e) => !e.dead && (!e.def.flying || s.antiAir) && Math.hypot(e.fx - u.x, e.fy - u.y) <= s.range)
        .sort((a, b) => b.dist - a.dist)
        .slice(0, s.targets ?? 1);
      if (!targets.length) continue;
      const c = toPx(u.x, u.y, this.gridX, this.gridY);
      for (const e of targets)
        this.shots.push({ x: c.x, y: c.y - D.OBJ_H, target: e, tx: e.fx, ty: e.fy, stats: s, src: u });
      u.cd = 1 / (s.rate * u.auraMul);
    }

    const shotStep = SHOT_SPEED * dt;
    this.shots = this.shots.filter((sh) => {
      if (!sh.target.dead) {
        sh.tx = sh.target.fx;
        sh.ty = sh.target.fy;
      } else if (!sh.stats.splash) {
        return false;
      }
      const tp = toPx(sh.tx, sh.ty, this.gridX, this.gridY);
      const dx = tp.x - sh.x;
      const dy = tp.y - (sh.target.def.flying ? AIR_HIT_H : GROUND_HIT_H) - sh.y;
      const d = Math.hypot(dx, dy);
      if (d <= shotStep + 6) {
        this.hit(sh);
        return false;
      }
      sh.x += (dx / d) * shotStep;
      sh.y += (dy / d) * shotStep;
      return true;
    });

    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  private hit(sh: Shot) {
    const s = sh.stats;
    const e = sh.target;
    let dmg = s.dmg;
    if (s.crit && this.rng() < s.crit) dmg *= 2;
    if (!e.dead) {
      if (s.slow && !e.def.immuneSlow) {
        e.slowPct = Math.max(this.clock < e.slowUntil ? e.slowPct : 0, s.slow);
        e.slowUntil = this.clock + 2;
      }
      if (s.poison && !e.def.immunePoison) {
        if (this.clock >= e.poisonUntil || s.poison >= e.poisonDps) {
          e.poisonDps = s.poison;
          e.poisonSrc = sh.src;
        }
        e.poisonUntil = this.clock + 3;
      }
    }
    if (s.splash) {
      for (const o of this.enemies) {
        if (o !== e && !o.dead && (!o.def.flying || s.antiAir) && Math.hypot(o.fx - sh.tx, o.fy - sh.ty) <= s.splash)
          this.damage(o, dmg * 0.5, true, sh.src);
      }
    }
    if (!e.dead) this.damage(e, dmg, true, sh.src);
  }

  /** Armor reduces hits but not poison. Splitters release children on death. */
  private damage(e: Enemy, d: number, isHit: boolean, src?: Fighter) {
    if (e.dead) return;
    const real = isHit ? d * (1 - e.def.armor) : d;
    if (src) src.dealt = (src.dealt ?? 0) + Math.min(real, Math.max(0, e.hp));
    e.hp -= real;
    if (e.hp > 0) return;
    e.dead = true;
    this.goldEarned += e.gold;
    const child = e.def.splitInto ? D.ENEMIES[e.def.splitInto] : undefined;
    if (!child) return;
    const childHp = Math.max(5, Math.round(e.maxHp * 0.28));
    for (let i = 0; i < e.def.splitCount; i++) {
      const jitter = (i - (e.def.splitCount - 1) / 2) * 0.18;
      this.enemies.push(this.makeEnemy(child, e.fx + jitter, e.fy + jitter, e.seg, e.dist, childHp, 1));
    }
  }

  private makeEnemy(def: D.EnemyDef, fx: number, fy: number, seg: number, dist: number, hp: number, gold: number): Enemy {
    return {
      fx,
      fy,
      seg,
      dist,
      hp,
      maxHp: hp,
      speed: def.speed,
      slowPct: 0,
      slowUntil: 0,
      poisonDps: 0,
      poisonUntil: 0,
      def,
      gold,
      dead: false,
    };
  }
}
