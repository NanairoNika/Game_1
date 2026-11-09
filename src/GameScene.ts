import Phaser from 'phaser';
import * as D from './data';
import { fullPath, type Pt } from './path';

type Tower = {
  x: number;
  y: number;
  kind: 'gem' | 'special' | 'rock';
  type?: D.GemType;
  level?: number;
  special?: string;
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

const PANEL_Y = D.GRID_Y + D.ROWS * D.CELL;

export class GameScene extends Phaser.Scene {
  private grid!: (Tower | null)[][];
  private path!: Pt[];
  private phase!: Phase;
  private wave!: number;
  private lives!: number;
  private gold!: number;
  private chance!: number;
  private speed!: number;
  private clock!: number;
  private newGems!: Tower[];
  private selected!: Tower | null;
  private enemies!: Enemy[];
  private shots!: Shot[];
  private toSpawn!: number;
  private spawnTimer!: number;
  private curWave!: ReturnType<typeof D.waveInfo>;

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
    this.grid = Array.from({ length: D.ROWS }, () => Array<Tower | null>(D.COLS).fill(null));
    this.phase = 'build';
    this.wave = 1;
    this.lives = D.START_LIVES;
    this.gold = 0;
    this.chance = 0;
    this.speed = 1;
    this.clock = 0;
    this.newGems = [];
    this.selected = null;
    this.enemies = [];
    this.shots = [];
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.buttons = [];
    this.path = this.computePath()!;

    this.boardG = this.add.graphics();
    this.dynG = this.add.graphics();

    D.WAYPOINTS.forEach((w, i) => {
      const c = this.center(w);
      const label = i === 0 ? 'S' : i === D.WAYPOINTS.length - 1 ? 'E' : String(i);
      this.add.text(c.x, c.y, label, { fontSize: '22px', fontStyle: 'bold', color: '#2a1d05' }).setOrigin(0.5).setDepth(2);
    });

    this.hud = this.add.text(20, 36, '', { fontSize: '25px', color: '#f2ead0', fontStyle: 'bold' });
    this.makeSpeedButton();

    this.msg = this.add.text(20, PANEL_Y + 14, '', {
      fontSize: '28px',
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

  private stats(t: Tower): D.Stats {
    if (t.kind === 'special') return D.SPECIALS.find((s) => s.id === t.special)!.stats;
    return D.gemStats(t.type!, t.level!);
  }

  private towers() {
    const out: Tower[] = [];
    for (const row of this.grid) for (const t of row) if (t && t.kind !== 'rock') out.push(t);
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
    this.flashTimer = this.time.delayedCall(1200, () => this.refresh());
  }

  // ---------- input ----------
  private onTap(p: Phaser.Input.Pointer) {
    const cx = Math.floor((p.x - D.GRID_X) / D.CELL);
    const cy = Math.floor((p.y - D.GRID_Y) / D.CELL);
    if (cx < 0 || cy < 0 || cx >= D.COLS || cy >= D.ROWS) return;
    const t = this.grid[cy][cx];

    if (this.phase === 'build' && !t) {
      this.tryPlace(cx, cy);
      return;
    }
    this.selected = t && t.kind !== 'rock' ? t : null;
    this.refresh();
  }

  private tryPlace(x: number, y: number) {
    if (this.isWaypoint(x, y)) return this.flash('Здесь строить нельзя');
    const gem: Tower = {
      x,
      y,
      kind: 'gem',
      type: D.GEM_TYPES[Math.floor(Math.random() * D.GEM_TYPES.length)],
      level: this.rollLevel(),
      cd: 0,
      auraMul: 1,
    };
    this.grid[y][x] = gem;
    const p = this.computePath();
    if (!p) {
      this.grid[y][x] = null;
      return this.flash('Нельзя полностью перекрыть путь!');
    }
    this.path = p;
    this.newGems.push(gem);
    this.selected = gem;
    if (this.newGems.length >= D.GEMS_PER_ROUND) {
      this.phase = 'choose';
      this.selected = null;
    }
    this.refresh();
  }

  // ---------- choose phase ----------
  private recipeMatches(rec: D.Special, sel: Tower) {
    const fits = (g: Tower, n: { type: D.GemType; level: number }) => g.type === n.type && g.level === n.level;
    return rec.needs.some((need, i) => {
      if (!fits(sel, need)) return false;
      const used = new Set<Tower>([sel]);
      return rec.needs.every((n, j) => {
        if (j === i) return true;
        const g = this.newGems.find((c) => !used.has(c) && fits(c, n));
        if (!g) return false;
        used.add(g);
        return true;
      });
    });
  }

  private keep(sel: Tower, level: number, special?: string) {
    for (const g of this.newGems) {
      if (g === sel) continue;
      g.kind = 'rock';
      g.type = undefined;
      g.level = undefined;
    }
    if (special) {
      sel.kind = 'special';
      sel.special = special;
      sel.type = undefined;
      sel.level = undefined;
    } else {
      sel.level = level;
    }
    this.newGems = [];
    this.selected = null;
    this.recalcAuras();
    this.startWave();
  }

  private recalcAuras() {
    const all = this.towers();
    for (const t of all) t.auraMul = 1;
    for (const src of all) {
      const a = this.stats(src).aura;
      if (!a) continue;
      for (const t of all) {
        if (t === src) continue;
        if (Math.hypot(t.x - src.x, t.y - src.y) <= 2.5) t.auraMul += a;
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
    if (this.wave > D.TOTAL_WAVES) this.phase = 'win';
    else this.phase = 'build';
    this.refresh();
  }

  update(_t: number, deltaMs: number) {
    if (this.phase === 'wave') {
      let left = (Math.min(deltaMs, 100) / 1000) * this.speed;
      while (left > 0) {
        const dt = Math.min(left, 1 / 60);
        this.step(dt);
        left -= dt;
        if (this.phase !== 'wave') break;
      }
      this.updateHud();
    }
    this.drawDynamic();
  }

  private step(dt: number) {
    this.clock += dt;
    const w = this.curWave;

    // spawn
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

    // move enemies
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

    // towers fire
    for (const t of this.towers()) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      t.cd = 0;
      const s = this.stats(t);
      const c = this.center(t);
      const r = s.range * D.CELL;
      const inRange = this.enemies
        .filter((e) => !e.dead && Math.hypot(e.px - c.x, e.py - c.y) <= r)
        .sort((a, b) => b.dist - a.dist)
        .slice(0, s.targets ?? 1);
      if (!inRange.length) continue;
      for (const e of inRange) this.shots.push({ x: c.x, y: c.y, target: e, stats: s });
      t.cd = 1 / (s.rate * t.auraMul);
    }

    // projectiles
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
    this.hud.setText(`Волна ${Math.min(this.wave, D.TOTAL_WAVES)}/${D.TOTAL_WAVES}   Жизни ${this.lives}   Золото ${this.gold}`);
  }

  private makeSpeedButton() {
    const bg = this.add.rectangle(650, 50, 100, 60, 0x3a4a30).setStrokeStyle(2, 0x8fa870).setInteractive();
    this.speedLabel = this.add.text(650, 50, 'x1', { fontSize: '28px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    bg.on('pointerdown', () => {
      this.speed = this.speed >= 3 ? 1 : this.speed + 1;
      this.speedLabel.setText(`x${this.speed}`);
    });
  }

  private layoutButtons(specs: { label: string; cb: () => void; color: number }[]) {
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

  private statsText(t: Tower) {
    const s = this.stats(t);
    const parts = [
      `Урон ${Math.round(s.dmg)}`,
      `Скорость ${(s.rate * t.auraMul).toFixed(1)}/с`,
      `Дальность ${s.range}`,
    ];
    if (s.splash) parts.push(`Область ${s.splash}`);
    if (s.slow) parts.push(`Замедление ${Math.round(s.slow * 100)}%`);
    if (s.poison) parts.push(`Яд ${Math.round(s.poison)}/с`);
    if (s.targets) parts.push(`Цели ${s.targets}`);
    if (s.crit) parts.push(`Крит ${Math.round(s.crit * 100)}%`);
    if (s.aura) parts.push(`Аура +${Math.round(s.aura * 100)}% скорости`);
    return `${s.name}. ${s.desc}\n${parts.join(' · ')}`;
  }

  private refresh() {
    this.flashTimer?.remove();
    this.flashTimer = undefined;
    this.msg.setColor('#ffe9a8');
    const specs: { label: string; cb: () => void; color: number }[] = [];
    const sel = this.selected;
    let info = sel ? this.statsText(sel) : '';

    switch (this.phase) {
      case 'build': {
        this.msg.setText(`Постройте самоцветы: ${this.newGems.length}/${D.GEMS_PER_ROUND}`);
        if (!sel) info = `Нажмите на пустую клетку. Шансы: ${this.oddsText()}`;
        if (this.chance < D.UPGRADE_COST.length) {
          const cost = D.UPGRADE_COST[this.chance];
          specs.push({
            label: `Шанс качества +1\n(${cost} золота)`,
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
        this.msg.setText('Выберите один самоцвет. Остальные станут камнями');
        const isNew = sel && this.newGems.includes(sel);
        if (!isNew) {
          info = 'Нажмите на один из новых самоцветов (подсвечены жёлтым)';
          break;
        }
        specs.push({ label: 'Оставить', color: 0x4c6a2e, cb: () => this.keep(sel!, sel!.level!) });
        if (sel!.kind === 'gem') {
          const same = this.newGems.filter((g) => g.type === sel!.type && g.level === sel!.level).length;
          if (same >= 4 && sel!.level! + 2 <= D.MAX_LEVEL)
            specs.push({ label: 'Слить 4\n(+2 уровня)', color: 0x1f5a8a, cb: () => this.keep(sel!, sel!.level! + 2) });
          else if (same >= 2 && sel!.level! < D.MAX_LEVEL)
            specs.push({ label: 'Слить 2\n(+1 уровень)', color: 0x1f5a8a, cb: () => this.keep(sel!, sel!.level! + 1) });
          for (const rec of D.SPECIALS) {
            if (this.recipeMatches(rec, sel!))
              specs.push({ label: `Создать:\n${rec.stats.name}`, color: 0x7a2a7a, cb: () => this.keep(sel!, 0, rec.id) });
          }
        }
        break;
      }
      case 'wave': {
        const w = D.waveInfo(this.wave);
        this.msg.setText(`Волна ${this.wave}${w.boss ? ': БОСС!' : w.fast ? ': быстрые враги' : ''}`);
        if (!sel) info = `Рецепты:\n${D.SPECIALS.map((s) => `${s.stats.name} = ${D.specialRecipeText(s)}`).join('\n')}`;
        break;
      }
      case 'over':
        this.msg.setText(`Поражение на волне ${this.wave}`);
        info = '';
        specs.push({ label: 'Заново', color: 0x8a2a2a, cb: () => this.scene.restart() });
        break;
      case 'win':
        this.msg.setText('Победа! Все волны отбиты');
        info = `Осталось жизней: ${this.lives}`;
        specs.push({ label: 'Заново', color: 0x4c6a2e, cb: () => this.scene.restart() });
        break;
    }
    this.info.setText(info);
    this.info.setY(this.msg.y + this.msg.height + 8);
    this.layoutButtons(specs);
    this.updateHud();
    this.drawBoard();
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

    // path preview
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
      for (const t of row) {
        if (!t) continue;
        const c = this.center(t);
        if (t.kind === 'rock') {
          g.fillStyle(0x6b6760).fillRoundedRect(c.x - 20, c.y - 20, 40, 40, 8);
          g.lineStyle(2, 0x45423d).strokeRoundedRect(c.x - 20, c.y - 20, 40, 40, 8);
          continue;
        }
        const s = this.stats(t);
        if (t.kind === 'special') {
          this.drawStar(g, c.x, c.y, 20, 10, s.color);
        } else {
          const r = D.CELL * (0.26 + 0.04 * t.level!);
          g.fillStyle(s.color);
          g.fillPoints(
            [
              { x: c.x, y: c.y - r },
              { x: c.x + r * 0.85, y: c.y },
              { x: c.x, y: c.y + r },
              { x: c.x - r * 0.85, y: c.y },
            ],
            true,
          );
          g.lineStyle(2, 0xffffff, 0.8);
          g.strokePoints(
            [
              { x: c.x, y: c.y - r },
              { x: c.x + r * 0.85, y: c.y },
              { x: c.x, y: c.y + r },
              { x: c.x - r * 0.85, y: c.y },
            ],
            true,
          );
          for (let i = 0; i <= t.level!; i++) {
            g.fillStyle(0xffffff).fillCircle(c.x - (t.level! * 5) / 2 + i * 5, c.y + D.CELL / 2 - 5, 2);
          }
        }
        if (this.newGems.includes(t)) {
          g.lineStyle(3, 0xffe066).strokeRect(c.x - D.CELL / 2 + 2, c.y - D.CELL / 2 + 2, D.CELL - 4, D.CELL - 4);
        }
      }
  }

  private drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, R: number, r: number, color: number) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      pts.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad });
    }
    g.fillStyle(color).fillPoints(pts, true);
    g.lineStyle(2, 0xffd84a).strokePoints(pts, true);
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
      g.fillStyle(e.boss ? 0x8e2bd0 : e.fast ? 0xe08a30 : 0xd04040).fillCircle(e.px, e.py, r);
      if (this.clock < e.slowUntil) g.lineStyle(3, 0x6fa8ff).strokeCircle(e.px, e.py, r + 2);
      if (this.clock < e.poisonUntil) g.lineStyle(2, 0x40e070).strokeCircle(e.px, e.py, r + 5);
      const w = r * 2 + 6;
      g.fillStyle(0x000000).fillRect(e.px - w / 2, e.py - r - 9, w, 5);
      g.fillStyle(0x7cff6a).fillRect(e.px - w / 2, e.py - r - 9, (w * Math.max(0, e.hp)) / e.maxHp, 5);
    }
    for (const s of this.shots) {
      g.fillStyle(s.stats.color).fillCircle(s.x, s.y, 5);
    }
  }
}
