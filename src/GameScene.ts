import Phaser from 'phaser';
import * as D from './data';
import { fullPath, type Pt } from './path';
import { loadBestiary, loadRun, saveBestiary, saveRun, type RunSave } from './save';
import * as R from './render';

type Unit = {
  x: number;
  y: number;
  kind: 'mon' | 'hybrid' | 'sealed';
  sp?: D.Species;
  level?: number;
  hybrid?: string;
  cd: number;
  auraMul: number;
  /** scene time (ms) when the reject-and-seal animation starts */
  sealAt?: number;
};

type Enemy = {
  /** position in cell units */
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
  boss: boolean;
  fast: boolean;
  dead: boolean;
};

type Shot = { x: number; y: number; target: Enemy; stats: D.Stats };
type Phase = 'build' | 'choose' | 'sealing' | 'wave' | 'over' | 'win';
type ButtonSpec = { label: string; cb: () => void; color: number };

const PANEL_Y = D.GRID_Y + D.ROWS * D.CELL_H + 12;
/** reject animation: blade, then plates */
const KILL_MS = 380;
const SEAL_MS = 420;
const SEAL_STAGGER = 130;

export class GameScene extends Phaser.Scene {
  private grid!: (Unit | null)[][];
  private path!: Pt[];
  private phase!: Phase;
  private wave!: number;
  private lives!: number;
  private gold!: number;
  private chance!: number;
  private speed!: number;
  private clock!: number;
  private fresh!: Unit[];
  private selected!: Unit | null;
  private crossing!: boolean;
  private partners!: Unit[];
  private enemies!: Enemy[];
  private shots!: Shot[];
  private toSpawn!: number;
  private spawnTimer!: number;
  private curWave!: ReturnType<typeof D.waveInfo>;
  private bestiary!: Set<string>;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private sealEnd = 0;

  private boardG!: Phaser.GameObjects.Graphics;
  private dynG!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private msg!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private speedLabel!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.GameObject[] = [];
  private flashTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('game');
  }

  create() {
    this.grid = Array.from({ length: D.ROWS }, () => Array<Unit | null>(D.COLS).fill(null));
    this.phase = 'build';
    this.wave = 1;
    this.lives = D.START_LIVES;
    this.gold = 0;
    this.chance = 0;
    this.speed = 1;
    this.clock = 0;
    this.fresh = [];
    this.selected = null;
    this.crossing = false;
    this.partners = [];
    this.enemies = [];
    this.shots = [];
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.buttons = [];
    this.overlay = [];
    this.bestiary = loadBestiary();

    const resumed = this.restore();
    this.path = this.computePath()!;
    this.recalcAuras();

    this.boardG = this.add.graphics();
    this.dynG = this.add.graphics();

    D.WAYPOINTS.forEach((w, i) => {
      const c = this.center(w);
      const label = i === 0 ? 'S' : i === D.WAYPOINTS.length - 1 ? 'E' : String(i);
      this.add.text(c.x, c.y, label, { fontSize: '22px', fontStyle: 'bold', color: '#2a1d05' }).setOrigin(0.5);
    });

    this.hud = this.add.text(20, 18, '', { fontSize: '25px', color: '#f2ead0', fontStyle: 'bold', lineSpacing: 6 });
    this.topButton(505, 'Бестиарий', 160, () => this.openBestiary());
    this.speedLabel = this.topButton(650, 'x1', 100, () => {
      this.speed = this.speed >= 3 ? 1 : this.speed + 1;
      this.speedLabel.setText(`x${this.speed}`);
    });

    this.msg = this.add.text(20, PANEL_Y + 12, '', {
      fontSize: '27px',
      fontStyle: 'bold',
      color: '#ffe9a8',
      wordWrap: { width: 680 },
    });
    this.info = this.add.text(20, PANEL_Y + 54, '', {
      fontSize: '21px',
      color: '#cfd8c8',
      wordWrap: { width: 680 },
      lineSpacing: 4,
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p));
    // debug hook for automated tests
    (window as unknown as { __phase: () => Phase }).__phase = () => this.phase;

    this.refresh();
    if (resumed) this.toast(`Игра продолжена: волна ${this.wave}`, '#ffe9a8');
  }

  // ---------- save / load ----------
  private persist() {
    if (this.phase !== 'build' && this.phase !== 'choose') return;
    const cells: RunSave['cells'] = [];
    const fresh: number[] = [];
    for (const row of this.grid)
      for (const u of row) {
        if (!u) continue;
        if (this.fresh.includes(u)) fresh.push(cells.length);
        cells.push({ x: u.x, y: u.y, kind: u.kind, sp: u.sp, level: u.level, hybrid: u.hybrid });
      }
    saveRun({ wave: this.wave, lives: this.lives, gold: this.gold, chance: this.chance, cells, fresh });
  }

  private restore() {
    const s = loadRun();
    if (!s) return false;
    this.wave = s.wave;
    this.lives = s.lives;
    this.gold = s.gold;
    this.chance = s.chance;
    s.cells.forEach((c, i) => {
      const u: Unit = { ...c, kind: c.kind === 'cocoon' ? 'sealed' : c.kind, cd: 0, auraMul: 1 };
      this.grid[c.y][c.x] = u;
      if (s.fresh.includes(i)) this.fresh.push(u);
    });
    if (this.fresh.length >= D.PER_ROUND) this.phase = 'choose';
    return true;
  }

  private newGame() {
    saveRun(null);
    this.scene.restart();
  }

  // ---------- helpers ----------
  /** Screen position of the centre of a cell, or of a fractional cell position. */
  private center(p: Pt) {
    return this.toPx(p.x, p.y);
  }

  private toPx(fx: number, fy: number) {
    return { x: D.GRID_X + fx * D.CELL_W + D.CELL_W / 2, y: D.GRID_Y + fy * D.CELL_H + D.CELL_H / 2 };
  }

  private origin(p: Pt) {
    return { x: D.GRID_X + p.x * D.CELL_W, y: D.GRID_Y + p.y * D.CELL_H };
  }

  private isWaypoint(x: number, y: number) {
    return D.WAYPOINTS.some((w) => w.x === x && w.y === y);
  }

  private computePath() {
    return fullPath(D.COLS, D.ROWS, (x, y) => this.grid[y][x] !== null, D.WAYPOINTS);
  }

  private stats(u: Unit): D.Stats {
    if (u.kind === 'hybrid') return D.HYBRIDS.find((h) => h.id === u.hybrid)!.stats;
    return D.speciesStats(u.sp!, u.level!);
  }

  private fighters() {
    const out: Unit[] = [];
    for (const row of this.grid) for (const u of row) if (u && u.kind !== 'sealed') out.push(u);
    return out;
  }

  private rollLevel() {
    const odds = D.QUALITY_ODDS[this.chance];
    let r = Math.random();
    for (let i = 0; i < odds.length; i++) {
      r -= odds[i];
      if (r < 0) return i;
    }
    return 0;
  }

  private flash(text: string) {
    this.msg.setText(text).setColor('#ff7a6a');
    this.flashTimer?.remove();
    this.flashTimer = this.time.delayedCall(1300, () => this.refresh());
  }

  private toast(text: string, color: string) {
    const t = this.add
      .text(360, D.GRID_Y + (D.ROWS * D.CELL_H) / 2, text, {
        fontSize: '34px',
        fontStyle: 'bold',
        color,
        align: 'center',
        backgroundColor: '#000000aa',
        padding: { x: 18, y: 12 },
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 600, onComplete: () => t.destroy() });
  }

  // ---------- input ----------
  private onTap(p: Phaser.Input.Pointer) {
    if (this.overlay.length || this.phase === 'sealing') return;
    const cx = Math.floor((p.x - D.GRID_X) / D.CELL_W);
    let cy = Math.floor((p.y - D.GRID_Y) / D.CELL_H);
    // Cages rise above their cell. Outside the build phase, a tap on an empty cell
    // that is visually covered by the cage below selects that cage.
    if (this.phase !== 'build' && cx >= 0 && cx < D.COLS && cy >= 0 && cy < D.ROWS - 1 && !this.grid[cy][cx]) {
      const coveredFrom = D.GRID_Y + (cy + 1) * D.CELL_H - D.OBJ_H;
      if (p.y >= coveredFrom && this.grid[cy + 1][cx]) cy++;
    }
    if (cx < 0 || cy < 0 || cx >= D.COLS || cy >= D.ROWS) return;
    const u = this.grid[cy][cx];

    if (this.phase === 'build' && !u) {
      this.tryPlace(cx, cy);
      return;
    }
    if (this.phase === 'choose' && this.crossing) {
      if (!u || u === this.selected || !this.fresh.includes(u)) return;
      const i = this.partners.indexOf(u);
      if (i >= 0) this.partners.splice(i, 1);
      else if (this.partners.length < 3) this.partners.push(u);
      this.refresh();
      return;
    }
    this.selected = u && u.kind !== 'sealed' ? u : null;
    this.refresh();
  }

  private tryPlace(x: number, y: number) {
    if (this.isWaypoint(x, y)) return this.flash('Здесь селить нельзя');
    const u: Unit = {
      x,
      y,
      kind: 'mon',
      sp: D.SPECIES[Math.floor(Math.random() * D.SPECIES.length)],
      level: this.rollLevel(),
      cd: 0,
      auraMul: 1,
    };
    this.grid[y][x] = u;
    const p = this.computePath();
    if (!p) {
      this.grid[y][x] = null;
      return this.flash('Нельзя полностью перекрыть путь!');
    }
    this.path = p;
    this.fresh.push(u);
    this.selected = u;
    if (this.fresh.length >= D.PER_ROUND) {
      this.phase = 'choose';
      this.selected = null;
    }
    this.refresh();
  }

  // ---------- choose phase ----------
  /** Result of crossing the given parents, or null if nothing happens. */
  private crossResult(parents: Unit[]): { level: number } | { hybrid: D.Hybrid } | null {
    const first = parents[0];
    if (parents.every((p) => p.kind === 'mon' && p.sp === first.sp && p.level === first.level)) {
      const up = parents.length >= 4 ? 2 : 1;
      if (first.level! >= D.MAX_LEVEL) return null;
      return { level: Math.min(D.MAX_LEVEL, first.level! + up) };
    }
    for (const h of D.HYBRIDS) {
      if (h.parents.length !== parents.length) continue;
      const pool = [...parents];
      const ok = h.parents.every((need) => {
        const i = pool.findIndex((p) => p.kind === 'mon' && p.sp === need.sp && p.level === need.level);
        if (i < 0) return false;
        pool.splice(i, 1);
        return true;
      });
      if (ok) return { hybrid: h };
    }
    return null;
  }

  private doCross() {
    const sel = this.selected!;
    const res = this.crossResult([sel, ...this.partners]);
    if (!res) {
      this.toast('Скрещивание не удалось.\nПотомство не выжило', '#ff9a8a');
      return this.keep(sel);
    }
    if ('hybrid' in res) {
      const isNew = !this.bestiary.has(res.hybrid.id);
      if (isNew) {
        this.bestiary.add(res.hybrid.id);
        saveBestiary(this.bestiary);
      }
      sel.kind = 'hybrid';
      sel.hybrid = res.hybrid.id;
      sel.sp = undefined;
      sel.level = undefined;
      this.toast(`${isNew ? 'Новый вид!\n' : ''}${res.hybrid.stats.name}`, '#ffd84a');
    } else {
      sel.level = res.level;
      this.toast(`${D.BASE[sel.sp!].name}: ${D.LEVEL_NAMES[res.level]}`, '#a8f0ff');
    }
    this.keep(sel);
  }

  private keep(sel: Unit) {
    const now = this.time.now;
    let i = 0;
    for (const u of this.fresh) {
      if (u === sel) continue;
      u.kind = 'sealed';
      u.sealAt = now + i++ * SEAL_STAGGER;
    }
    this.sealEnd = now + (i - 1) * SEAL_STAGGER + KILL_MS + SEAL_MS + 150;
    this.fresh = [];
    this.selected = null;
    this.crossing = false;
    this.partners = [];
    this.recalcAuras();
    this.phase = 'sealing';
    this.refresh();
  }

  private finishSealing() {
    for (const row of this.grid)
      for (const u of row)
        if (u && u.kind === 'sealed') {
          u.sealAt = undefined;
          u.sp = undefined;
          u.level = undefined;
        }
    this.startWave();
  }

  private recalcAuras() {
    const all = this.fighters();
    for (const u of all) u.auraMul = 1;
    for (const src of all) {
      const a = this.stats(src).aura;
      if (!a) continue;
      for (const u of all) {
        if (u !== src && Math.hypot(u.x - src.x, u.y - src.y) <= 2.5) u.auraMul += a;
      }
    }
  }

  // ---------- waves ----------
  private startWave() {
    this.phase = 'wave';
    this.curWave = D.waveInfo(this.wave);
    this.toSpawn = this.curWave.count;
    this.spawnTimer = 0;
    this.refresh();
  }

  private endWave() {
    this.gold += 5 + this.wave;
    this.wave++;
    this.shots = [];
    this.phase = this.wave > D.TOTAL_WAVES ? 'win' : 'build';
    if (this.phase === 'win') saveRun(null);
    this.refresh();
  }

  update(_t: number, deltaMs: number) {
    if (this.phase === 'sealing' && this.time.now >= this.sealEnd) this.finishSealing();
    if (this.phase === 'wave' && !this.overlay.length) {
      let left = (Math.min(deltaMs, 100) / 1000) * this.speed;
      while (left > 0 && this.phase === 'wave') {
        const dt = Math.min(left, 1 / 60);
        this.step(dt);
        left -= dt;
      }
      this.updateHud();
    }
    this.drawDynamic();
  }

  private step(dt: number) {
    this.clock += dt;
    const w = this.curWave;

    this.spawnTimer -= dt;
    if (this.toSpawn > 0 && this.spawnTimer <= 0) {
      this.enemies.push({
        fx: this.path[0].x,
        fy: this.path[0].y,
        seg: 0,
        dist: 0,
        hp: w.hp,
        maxHp: w.hp,
        speed: w.speed,
        slowPct: 0,
        slowUntil: 0,
        poisonDps: 0,
        poisonUntil: 0,
        boss: w.boss,
        fast: w.fast,
        dead: false,
      });
      this.toSpawn--;
      this.spawnTimer = w.fast ? 0.5 : 0.9;
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      const slowed = this.clock < e.slowUntil ? 1 - e.slowPct : 1;
      let remaining = e.speed * slowed * dt;
      while (remaining > 0 && e.seg < this.path.length - 1) {
        const t = this.path[e.seg + 1];
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
      if (e.seg >= this.path.length - 1) {
        e.dead = true;
        this.lives -= e.boss ? 3 : 1;
        continue;
      }
      if (this.clock < e.poisonUntil) this.damage(e, e.poisonDps * dt);
    }

    for (const u of this.fighters()) {
      u.cd -= dt;
      if (u.cd > 0) continue;
      u.cd = 0;
      const s = this.stats(u);
      const targets = this.enemies
        .filter((e) => !e.dead && Math.hypot(e.fx - u.x, e.fy - u.y) <= s.range)
        .sort((a, b) => b.dist - a.dist)
        .slice(0, s.targets ?? 1);
      if (!targets.length) continue;
      const c = this.center(u);
      for (const e of targets) this.shots.push({ x: c.x, y: c.y - D.OBJ_H, target: e, stats: s });
      u.cd = 1 / (s.rate * u.auraMul);
    }

    const shotSpeed = 750 * dt;
    this.shots = this.shots.filter((sh) => {
      if (sh.target.dead) return false;
      const tp = this.toPx(sh.target.fx, sh.target.fy);
      const dx = tp.x - sh.x;
      const dy = tp.y - 12 - sh.y;
      const d = Math.hypot(dx, dy);
      if (d <= shotSpeed + 6) {
        this.hit(sh);
        return false;
      }
      sh.x += (dx / d) * shotSpeed;
      sh.y += (dy / d) * shotSpeed;
      return true;
    });

    this.enemies = this.enemies.filter((e) => !e.dead);

    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'over';
      saveRun(null);
      this.refresh();
      return;
    }
    if (this.toSpawn === 0 && this.enemies.length === 0) this.endWave();
  }

  private hit(sh: Shot) {
    const s = sh.stats;
    const e = sh.target;
    let dmg = s.dmg;
    if (s.crit && Math.random() < s.crit) dmg *= 2;
    if (s.slow) {
      e.slowPct = Math.max(this.clock < e.slowUntil ? e.slowPct : 0, s.slow);
      e.slowUntil = this.clock + 2;
    }
    if (s.poison) {
      e.poisonDps = Math.max(this.clock < e.poisonUntil ? e.poisonDps : 0, s.poison);
      e.poisonUntil = this.clock + 3;
    }
    if (s.splash) {
      for (const o of this.enemies) {
        if (o !== e && !o.dead && Math.hypot(o.fx - e.fx, o.fy - e.fy) <= s.splash) this.damage(o, dmg * 0.5);
      }
    }
    this.damage(e, dmg);
  }

  private damage(e: Enemy, d: number) {
    if (e.dead) return;
    e.hp -= d;
    if (e.hp <= 0) {
      e.dead = true;
      this.gold += this.curWave.gold;
    }
  }

  // ---------- UI ----------
  private updateHud() {
    this.hud.setText(
      `Волна ${Math.min(this.wave, D.TOTAL_WAVES)}/${D.TOTAL_WAVES}\nЖизни ${this.lives} · Золото ${this.gold}`,
    );
  }

  private topButton(x: number, label: string, w: number, cb: () => void) {
    const bg = this.add.rectangle(x, 50, w, 60, 0x3a4a30).setStrokeStyle(2, 0x8fa870).setInteractive();
    const t = this.add.text(x, 50, label, { fontSize: '24px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    bg.on('pointerdown', cb);
    return t;
  }

  private layoutButtons(specs: ButtonSpec[]) {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    if (!specs.length) return;
    const gap = 10;
    const w = (680 - gap * (specs.length - 1)) / specs.length;
    const y = 1280 - 60;
    specs.forEach((s, i) => {
      const x = 20 + i * (w + gap) + w / 2;
      const bg = this.add.rectangle(x, y, w, 84, s.color).setStrokeStyle(3, 0xf0e0a0).setInteractive();
      const tx = this.add
        .text(x, y, s.label, {
          fontSize: specs.length > 2 ? '22px' : '26px',
          fontStyle: 'bold',
          color: '#fff',
          align: 'center',
          wordWrap: { width: w - 12 },
        })
        .setOrigin(0.5);
      bg.on('pointerdown', () => s.cb());
      this.buttons.push(bg, tx);
    });
  }

  private oddsText() {
    return D.QUALITY_ODDS[this.chance]
      .map((p, i) => (p > 0 ? `${D.LEVEL_NAMES[i]} ${Math.round(p * 100)}%` : ''))
      .filter(Boolean)
      .join(' · ');
  }

  private statsText(u: Unit) {
    const s = this.stats(u);
    const parts = [`Урон ${Math.round(s.dmg)}`, `Скорость ${(s.rate * u.auraMul).toFixed(1)}/с`, `Дальность ${s.range}`];
    if (s.splash) parts.push(`Область ${s.splash}`);
    if (s.slow) parts.push(`Замедление ${Math.round(s.slow * 100)}%`);
    if (s.poison) parts.push(`Яд ${Math.round(s.poison)}/с`);
    if (s.targets) parts.push(`Цели ${s.targets}`);
    if (s.crit) parts.push(`Крит ${Math.round(s.crit * 100)}%`);
    if (s.aura) parts.push(`Вой +${Math.round(s.aura * 100)}% скорости`);
    return `${s.name}. ${s.desc}\n${parts.join(' · ')}`;
  }

  private refresh() {
    this.flashTimer?.remove();
    this.flashTimer = undefined;
    this.msg.setColor('#ffe9a8');
    const specs: ButtonSpec[] = [];
    const sel = this.selected;
    let info = sel ? this.statsText(sel) : '';

    switch (this.phase) {
      case 'build': {
        this.msg.setText(`Подселите монстров: ${this.fresh.length}/${D.PER_ROUND}`);
        if (!sel) info = `Нажмите на пустую клетку. Шансы: ${this.oddsText()}`;
        if (this.chance < D.UPGRADE_COST.length) {
          const cost = D.UPGRADE_COST[this.chance];
          specs.push({
            label: `Шанс породы +1\n(${cost} золота)`,
            color: this.gold >= cost ? 0x7a5a1a : 0x3a3a3a,
            cb: () => {
              if (this.gold < cost) return this.flash('Не хватает золота');
              this.gold -= cost;
              this.chance++;
              this.refresh();
            },
          });
        }
        break;
      }
      case 'choose': {
        const isFresh = !!sel && this.fresh.includes(sel);
        if (this.crossing && isFresh) {
          this.msg.setText('Выберите партнёров для скрещивания');
          const names = this.partners.map((p) => this.stats(p).name);
          info = `${this.stats(sel!).name}\n× ${names.length ? names.join(', ') : '(нажмите на новых монстров)'}`;
          if (this.partners.length)
            specs.push({ label: `Скрестить (${this.partners.length + 1})`, color: 0x7a2a7a, cb: () => this.doCross() });
          specs.push({
            label: 'Отмена',
            color: 0x4a4a4a,
            cb: () => {
              this.crossing = false;
              this.partners = [];
              this.refresh();
            },
          });
          break;
        }
        this.msg.setText('Оставьте одного. Остальных запечатают');
        if (!isFresh) {
          info =
            'Нажмите на одного из новых монстров (подсвечены жёлтым).\nОдинаковые монстры дают более сильного потомка. Разные виды могут дать гибрид, но правила придётся найти самому.';
          break;
        }
        specs.push({ label: 'Оставить', color: 0x4c6a2e, cb: () => this.keep(sel!) });
        specs.push({
          label: 'Скрестить…',
          color: 0x7a2a7a,
          cb: () => {
            this.crossing = true;
            this.partners = [];
            this.refresh();
          },
        });
        break;
      }
      case 'sealing':
        this.msg.setText('Клетки запечатываются…');
        info = '';
        break;
      case 'wave': {
        const w = D.waveInfo(this.wave);
        this.msg.setText(`Волна ${this.wave}${w.boss ? ': БОСС!' : w.fast ? ': быстрые враги' : ''}`);
        if (!sel) info = `Открыто гибридов: ${this.bestiary.size}/${D.HYBRIDS.length}`;
        break;
      }
      case 'over':
        this.msg.setText(`Поражение на волне ${this.wave}`);
        info = `Открыто гибридов: ${this.bestiary.size}/${D.HYBRIDS.length}. Бестиарий сохраняется между забегами`;
        specs.push({ label: 'Заново', color: 0x8a2a2a, cb: () => this.newGame() });
        break;
      case 'win':
        this.msg.setText('Победа! Все волны отбиты');
        info = `Осталось жизней: ${this.lives}`;
        specs.push({ label: 'Заново', color: 0x4c6a2e, cb: () => this.newGame() });
        break;
    }
    this.info.setText(info);
    this.info.setY(this.msg.y + this.msg.height + 8);
    this.layoutButtons(specs);
    this.updateHud();
    this.drawBoard();
    this.persist();
  }

  // ---------- bestiary ----------
  private openBestiary() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x0b0f0b, 0.96).setInteractive().setDepth(100);
    const lines: string[] = ['ВИДЫ'];
    for (const sp of D.SPECIES) lines.push(`• ${D.BASE[sp].name}: ${D.BASE[sp].desc.toLowerCase()}`);
    lines.push('', `ГИБРИДЫ (${this.bestiary.size}/${D.HYBRIDS.length})`);
    for (const h of D.HYBRIDS) {
      if (this.bestiary.has(h.id)) lines.push(`• ${h.stats.name} = ${D.parentsText(h)}`);
      else lines.push(`• ??? (родителей: ${h.parents.length})`);
    }
    lines.push(
      '',
      'ПРАВИЛА',
      'Если скрестить одинаковых монстров (тот же вид и возраст), потомок будет старше: 2–3 родителя дают +1, 4 родителя дают +2.',
    );
    const text = this.add
      .text(30, 40, lines.join('\n'), { fontSize: '23px', color: '#e8e0c8', wordWrap: { width: 660 }, lineSpacing: 6 })
      .setDepth(101);
    const close = this.add.rectangle(200, 1210, 340, 80, 0x4c6a2e).setStrokeStyle(3, 0xf0e0a0).setInteractive().setDepth(101);
    const closeT = this.add
      .text(200, 1210, 'Закрыть', { fontSize: '26px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    const reset = this.add.rectangle(545, 1210, 290, 80, 0x6a2a2a).setStrokeStyle(3, 0xf0e0a0).setInteractive().setDepth(101);
    const resetT = this.add
      .text(545, 1210, 'Новая игра', { fontSize: '26px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    this.overlay = [bg, text, close, closeT, reset, resetT];
    const closeAll = () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    };
    close.on('pointerdown', closeAll);
    reset.on('pointerdown', () => {
      closeAll();
      this.newGame();
    });
  }

  // ---------- drawing ----------
  /** Ground layer: tiles, path, waypoints, cell highlights. Redrawn on state changes. */
  private drawBoard() {
    const g = this.boardG;
    g.clear();
    const W = D.COLS * D.CELL_W;
    const H = D.ROWS * D.CELL_H;
    g.fillStyle(0x16221a).fillRect(D.GRID_X - 6, D.GRID_Y - 6, W + 12, H + 12);
    for (let y = 0; y < D.ROWS; y++)
      for (let x = 0; x < D.COLS; x++) {
        g.fillStyle((x + y) % 2 ? 0x2a3d2c : 0x26382a);
        g.fillRect(D.GRID_X + x * D.CELL_W, D.GRID_Y + y * D.CELL_H, D.CELL_W, D.CELL_H);
      }

    g.lineStyle(14, 0x7a5f36, 0.5);
    g.beginPath();
    this.path.forEach((p, i) => {
      const c = this.center(p);
      if (i === 0) g.moveTo(c.x, c.y);
      else g.lineTo(c.x, c.y);
    });
    g.strokePath();

    for (const w of D.WAYPOINTS) {
      const c = this.center(w);
      g.fillStyle(0x000000, 0.3).fillEllipse(c.x, c.y + 3, D.CELL_W * 0.86, D.CELL_H * 0.8);
      g.fillStyle(0xd9b13b).fillEllipse(c.x, c.y, D.CELL_W * 0.82, D.CELL_H * 0.74);
    }

    for (const u of this.fresh) {
      const o = this.origin(u);
      const col = this.partners.includes(u) ? 0xff5ad8 : 0xffe066;
      g.fillStyle(col, 0.28).fillRect(o.x + 1, o.y + 1, D.CELL_W - 2, D.CELL_H - 2);
      g.lineStyle(3, col).strokeRect(o.x + 1, o.y + 1, D.CELL_W - 2, D.CELL_H - 2);
    }
    if (this.selected) {
      const o = this.origin(this.selected);
      g.lineStyle(3, 0xffffff).strokeRect(o.x, o.y, D.CELL_W, D.CELL_H);
    }
  }

  private drawUnit(g: Phaser.GameObjects.Graphics, u: Unit, now: number) {
    const o = this.origin(u);
    const foot = o.y + D.CELL_H / 2 + 5;
    const cx = o.x + D.CELL_W / 2;

    if (u.kind === 'sealed') {
      const t = u.sealAt === undefined ? Infinity : now - u.sealAt;
      if (t >= KILL_MS + SEAL_MS) return R.sealedBlock(g, o.x, o.y, 1);
      // still animating: cage with the doomed monster, blade, then plates
      R.cageFloor(g, o.x, o.y, u.sp && t < KILL_MS ? D.BASE[u.sp].color : undefined);
      R.cageBack(g, o.x, o.y, 0x8a8f96);
      if (t < KILL_MS && u.sp) {
        const k = Math.max(0, t) / KILL_MS;
        const r = this.monsterRadius(u.level ?? 0) * (1 - 0.7 * k);
        R.creature(g, cx, foot, r, D.BASE[u.sp].color, { hurt: k });
      }
      R.cageFront(g, o.x, o.y, 0x8a8f96);
      if (t < KILL_MS) R.blade(g, o.x, o.y, Math.max(0, t) / KILL_MS);
      else R.sealedBlock(g, o.x, o.y, (t - KILL_MS) / SEAL_MS);
      return;
    }

    const hybrid = u.kind === 'hybrid';
    const frame = hybrid ? 0xd9b13b : 0x9aa0a8;
    R.cageFloor(g, o.x, o.y, hybrid ? this.stats(u).color : D.BASE[u.sp!].color);
    R.cageBack(g, o.x, o.y, frame);
    if (hybrid) R.creature(g, cx, foot, 12, this.stats(u).color, { spikes: true });
    else R.creature(g, cx, foot, this.monsterRadius(u.level!), D.BASE[u.sp!].color);
    R.cageFront(g, o.x, o.y, frame, hybrid ? -1 : u.level!);
  }

  private monsterRadius(level: number) {
    return D.CELL_W * (0.22 + 0.03 * level);
  }

  /** Object layer: cages and enemies sorted by depth, then shots and HP bars on top. */
  private drawDynamic() {
    const g = this.dynG;
    g.clear();
    const now = this.time.now;

    const items: { y: number; draw: () => void }[] = [];
    for (const row of this.grid)
      for (const u of row) {
        if (!u) continue;
        items.push({ y: this.origin(u).y + D.CELL_H, draw: () => this.drawUnit(g, u, now) });
      }
    for (const e of this.enemies) {
      const p = this.toPx(e.fx, e.fy);
      const foot = p.y + 6;
      items.push({
        y: foot,
        draw: () => {
          const r = this.enemyRadius(e);
          R.enemyBody(g, p.x, foot, r, e.boss ? 0x8e2bd0 : e.fast ? 0xe08a30 : 0xb83030);
          const cy = foot - r - 3;
          if (this.clock < e.slowUntil) g.lineStyle(3, 0x6fa8ff).strokeCircle(p.x, cy, r + 2);
          if (this.clock < e.poisonUntil) g.lineStyle(2, 0x40e070).strokeCircle(p.x, cy, r + 5);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    for (const s of this.shots) {
      g.fillStyle(0x000000, 0.4).fillCircle(s.x + 1, s.y + 2, 5);
      g.fillStyle(s.stats.color).fillCircle(s.x, s.y, 5);
    }

    // HP bars always on top so enemies stay readable behind cages
    for (const e of this.enemies) {
      const p = this.toPx(e.fx, e.fy);
      const r = this.enemyRadius(e);
      const w = r * 2 + 8;
      const y = p.y + 6 - 2 * r - 14;
      g.fillStyle(0x000000).fillRect(p.x - w / 2 - 1, y - 1, w + 2, 7);
      g.fillStyle(0x7cff6a).fillRect(p.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 5);
    }

    if (this.selected) {
      const c = this.center(this.selected);
      const s = this.stats(this.selected);
      const rx = s.range * D.CELL_W;
      const ry = s.range * D.CELL_H;
      g.fillStyle(0xffffff, 0.07).fillEllipse(c.x, c.y, rx * 2, ry * 2);
      g.lineStyle(2, 0xffffff, 0.75).strokeEllipse(c.x, c.y, rx * 2, ry * 2);
    }
  }

  private enemyRadius(e: Enemy) {
    return e.boss ? 15 : e.fast ? 8 : 10;
  }
}
