import Phaser from 'phaser';
import * as D from './data';
import { fullPath, type Pt } from './path';
import { loadBestiary, loadRun, saveBestiary, saveRun, type RunSave } from './save';

type Unit = {
  x: number;
  y: number;
  kind: 'mon' | 'hybrid' | 'cocoon';
  sp?: D.Species;
  level?: number;
  hybrid?: string;
  cd: number;
  auraMul: number;
};

type Enemy = {
  px: number;
  py: number;
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
type Phase = 'build' | 'choose' | 'wave' | 'over' | 'win';
type ButtonSpec = { label: string; cb: () => void; color: number };

const PANEL_Y = D.GRID_Y + D.ROWS * D.CELL;

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
      const u: Unit = { ...c, cd: 0, auraMul: 1 };
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
  private center(p: Pt) {
    return { x: D.GRID_X + p.x * D.CELL + D.CELL / 2, y: D.GRID_Y + p.y * D.CELL + D.CELL / 2 };
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
    for (const row of this.grid) for (const u of row) if (u && u.kind !== 'cocoon') out.push(u);
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
      .text(360, D.GRID_Y + (D.ROWS * D.CELL) / 2, text, {
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
    if (this.overlay.length) return;
    const cx = Math.floor((p.x - D.GRID_X) / D.CELL);
    const cy = Math.floor((p.y - D.GRID_Y) / D.CELL);
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
    this.selected = u && u.kind !== 'cocoon' ? u : null;
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
    for (const u of this.fresh) {
      if (u === sel) continue;
      u.kind = 'cocoon';
      u.sp = undefined;
      u.level = undefined;
    }
    this.fresh = [];
    this.selected = null;
    this.crossing = false;
    this.partners = [];
    this.recalcAuras();
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
      const c = this.center(this.path[0]);
      this.enemies.push({
        px: c.x,
        py: c.y,
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
      let remaining = e.speed * slowed * D.CELL * dt;
      while (remaining > 0 && e.seg < this.path.length - 1) {
        const t = this.center(this.path[e.seg + 1]);
        const d = Math.hypot(t.x - e.px, t.y - e.py);
        if (d <= remaining) {
          e.px = t.x;
          e.py = t.y;
          e.seg++;
          e.dist += d;
          remaining -= d;
        } else {
          e.px += ((t.x - e.px) / d) * remaining;
          e.py += ((t.y - e.py) / d) * remaining;
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
      const c = this.center(u);
      const r = s.range * D.CELL;
      const targets = this.enemies
        .filter((e) => !e.dead && Math.hypot(e.px - c.x, e.py - c.y) <= r)
        .sort((a, b) => b.dist - a.dist)
        .slice(0, s.targets ?? 1);
      if (!targets.length) continue;
      for (const e of targets) this.shots.push({ x: c.x, y: c.y, target: e, stats: s });
      u.cd = 1 / (s.rate * u.auraMul);
    }

    const shotSpeed = 750 * dt;
    this.shots = this.shots.filter((sh) => {
      if (sh.target.dead) return false;
      const dx = sh.target.px - sh.x;
      const dy = sh.target.py - sh.y;
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
      const r = s.splash * D.CELL;
      for (const o of this.enemies) {
        if (o !== e && !o.dead && Math.hypot(o.px - e.px, o.py - e.py) <= r) this.damage(o, dmg * 0.5);
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
        this.msg.setText('Оставьте одного. Остальные уйдут в коконы');
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
  private drawBoard() {
    const g = this.boardG;
    g.clear();
    g.fillStyle(0x1b2a1d).fillRect(D.GRID_X - 4, D.GRID_Y - 4, D.COLS * D.CELL + 8, D.ROWS * D.CELL + 8);
    for (let y = 0; y < D.ROWS; y++)
      for (let x = 0; x < D.COLS; x++) {
        g.fillStyle((x + y) % 2 ? 0x24362a : 0x203126);
        g.fillRect(D.GRID_X + x * D.CELL, D.GRID_Y + y * D.CELL, D.CELL, D.CELL);
      }

    g.lineStyle(8, 0x8a6d3b, 0.45);
    g.beginPath();
    this.path.forEach((p, i) => {
      const c = this.center(p);
      if (i === 0) g.moveTo(c.x, c.y);
      else g.lineTo(c.x, c.y);
    });
    g.strokePath();

    for (const w of D.WAYPOINTS) {
      const c = this.center(w);
      g.fillStyle(0xd9b13b).fillCircle(c.x, c.y, D.CELL * 0.42);
    }

    for (const row of this.grid)
      for (const u of row) {
        if (!u) continue;
        const c = this.center(u);
        if (u.kind === 'cocoon') this.drawCocoon(g, c.x, c.y);
        else if (u.kind === 'hybrid') this.drawHybrid(g, c.x, c.y, this.stats(u).color);
        else this.drawCreature(g, c.x, c.y, u.level!, D.BASE[u.sp!].color);

        if (this.fresh.includes(u)) {
          const col = this.partners.includes(u) ? 0xff5ad8 : 0xffe066;
          g.lineStyle(3, col).strokeRect(c.x - D.CELL / 2 + 2, c.y - D.CELL / 2 + 2, D.CELL - 4, D.CELL - 4);
        }
      }
  }

  private drawEyes(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
    const ex = r * 0.38;
    const er = Math.max(3, r * 0.26);
    g.fillStyle(0xffffff)
      .fillCircle(x - ex, y - r * 0.15, er)
      .fillCircle(x + ex, y - r * 0.15, er);
    g.fillStyle(0x111111)
      .fillCircle(x - ex, y - r * 0.1, er * 0.5)
      .fillCircle(x + ex, y - r * 0.1, er * 0.5);
  }

  private drawCreature(g: Phaser.GameObjects.Graphics, x: number, y: number, level: number, color: number) {
    const r = D.CELL * (0.24 + 0.035 * level);
    g.fillStyle(0x000000, 0.25).fillEllipse(x, y + r * 0.9, r * 1.8, r * 0.5);
    g.fillStyle(color).fillCircle(x, y, r);
    g.lineStyle(2, 0x000000, 0.35).strokeCircle(x, y, r);
    this.drawEyes(g, x, y, r);
    for (let i = 0; i <= level; i++) {
      g.fillStyle(0xffffff).fillCircle(x - (level * 5) / 2 + i * 5, y + D.CELL / 2 - 4, 2);
    }
  }

  private drawHybrid(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 8;
      const rad = i % 2 ? 15 : 22;
      pts.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad });
    }
    g.fillStyle(0xffd84a).fillPoints(pts, true);
    g.fillStyle(color).fillCircle(x, y, 15);
    g.lineStyle(2, 0x000000, 0.4).strokeCircle(x, y, 15);
    this.drawEyes(g, x, y, 15);
  }

  private drawCocoon(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(0x6e6458).fillEllipse(x, y, 30, 40);
    g.lineStyle(2, 0x4a4238);
    g.strokeEllipse(x, y, 30, 40);
    g.lineBetween(x - 13, y - 8, x + 13, y - 4);
    g.lineBetween(x - 14, y + 4, x + 14, y + 8);
  }

  private drawDynamic() {
    const g = this.dynG;
    g.clear();
    if (this.selected) {
      const c = this.center(this.selected);
      const s = this.stats(this.selected);
      g.lineStyle(2, 0xffffff, 0.7).strokeCircle(c.x, c.y, s.range * D.CELL);
      g.fillStyle(0xffffff, 0.06).fillCircle(c.x, c.y, s.range * D.CELL);
      g.lineStyle(3, 0xffffff).strokeRect(c.x - D.CELL / 2, c.y - D.CELL / 2, D.CELL, D.CELL);
    }
    for (const e of this.enemies) {
      const r = e.boss ? 17 : e.fast ? 9 : 11;
      g.fillStyle(e.boss ? 0x8e2bd0 : e.fast ? 0xe08a30 : 0xb83030).fillCircle(e.px, e.py, r);
      if (this.clock < e.slowUntil) g.lineStyle(3, 0x6fa8ff).strokeCircle(e.px, e.py, r + 2);
      if (this.clock < e.poisonUntil) g.lineStyle(2, 0x40e070).strokeCircle(e.px, e.py, r + 5);
      const w = r * 2 + 6;
      g.fillStyle(0x000000).fillRect(e.px - w / 2, e.py - r - 9, w, 5);
      g.fillStyle(0x7cff6a).fillRect(e.px - w / 2, e.py - r - 9, (w * Math.max(0, e.hp)) / e.maxHp, 5);
    }
    for (const s of this.shots) g.fillStyle(s.stats.color).fillCircle(s.x, s.y, 5);
  }
}
