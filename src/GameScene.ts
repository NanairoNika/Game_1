import Phaser from 'phaser';
import * as D from './data';
import { fullPath, pathLength, type Pt } from './path';
import {
  loadBestiary,
  loadMazeChoice,
  loadMeta,
  loadRun,
  saveBestiary,
  saveMazeChoice,
  saveMeta,
  saveRun,
  type MetaSave,
  type RunSave,
} from './save';
import { LAB_UPGRADES, LEVELS, WAVE_NOTES, type LevelDef } from './levels';
import * as R from './render';
import { Battle, toPx, type Enemy } from './combat';
import * as Rules from './rules';

type Unit = {
  x: number;
  y: number;
  kind: 'mon' | 'hybrid' | 'sealed';
  sp?: D.Species;
  level?: number;
  hybrid?: string;
  pillar?: boolean;
  cd: number;
  auraMul: number;
  /** scene time (ms) when the reject-and-seal animation starts */
  sealAt?: number;
  killKind?: R.KillKind;
};

type Phase = 'build' | 'choose' | 'sealing' | 'wave' | 'over' | 'win';
type ButtonSpec = { label: string; cb: () => void; color: number };

const PANEL_Y = D.GRID_Y + D.ROWS * D.CELL_H + 12;
/** Sequential reject animation: one cage after another with varied execution effects */
const KILL_MS = 520;
const SEAL_MS = 380;
const SEAL_STAGGER = 680;
const KILL_KINDS: R.KillKind[] = ['blade', 'fire', 'acid', 'tesla'];

export class GameScene extends Phaser.Scene {
  private grid!: (Unit | null)[][];
  private level!: LevelDef;
  private gridX!: number;
  private gridY!: number;
  private voidSet!: Set<number>;
  private path!: Pt[];
  private battle!: Battle;
  private phase!: Phase;
  private wave!: number;
  private lives!: number;
  private maxStartLives!: number;
  private gold!: number;
  private chance!: number;
  private speed!: number;
  private fresh!: Unit[];
  private selected!: Unit | null;
  private hovered: Unit | null = null;
  private crossing!: boolean;
  private partners!: Unit[];
  private bestiary!: Set<string>;
  private meta!: MetaSave;
  private seenNotes!: Set<number>;
  private usedGadgets = false;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private dossierObjs: Phaser.GameObjects.GameObject[] = [];
  private sealEnd = 0;
  /** chosen maze blueprint, -1 = none */
  private mazeIdx = -1;
  private mazeLabel!: Phaser.GameObjects.Text;
  private mazeBg!: Phaser.GameObjects.Rectangle;

  private boardG!: Phaser.GameObjects.Graphics;
  private dynG!: Phaser.GameObjects.Graphics;
  private waypointLabels: Phaser.GameObjects.Text[] = [];
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
    if (D.DATA_ERRORS.length) return this.showDataErrors();
    this.meta = loadMeta();
    this.bestiary = loadBestiary();
    this.level = LEVELS.find((l) => l.id === this.meta.currentLevel) ?? LEVELS[0];
    this.phase = 'build';
    this.wave = 1;
    this.maxStartLives = D.START_LIVES + (this.meta.upgrades.firewall ?? 0) * 4;
    this.lives = this.maxStartLives;
    this.gold = (this.meta.upgrades.grant ?? 0) * 15;
    this.chance = 0;
    this.speed = this.speed || 1;
    this.fresh = [];
    this.selected = null;
    this.hovered = null;
    this.crossing = false;
    this.partners = [];
    this.buttons = [];
    this.overlay = [];
    this.dossierObjs = [];
    this.seenNotes = new Set();
    this.usedGadgets = false;

    const resumed = this.restore();
    this.applyLevelGeometry();
    if (!resumed) {
      this.grid = Array.from({ length: this.level.rows }, () => Array<Unit | null>(this.level.cols).fill(null));
      this.placeMapObstacles();
    }
    this.path = this.computePath()!;
    this.battle = new Battle(this.path, this.level.waypoints, this.level.hpMul, Math.random, this.gridX, this.gridY);
    this.recalcAuras();

    this.boardG = this.add.graphics();
    this.dynG = this.add.graphics();
    this.buildWaypointLabels();

    this.hud = this.add.text(18, 12, '', {
      fontSize: '21px',
      color: '#f2ead0',
      fontStyle: 'bold',
      lineSpacing: 4,
    });
    this.topButton(420, 'Меню', 148, () => this.openMenuModal());
    this.topButton(565, 'Бестиарий', 130, () => this.openBestiary());
    this.createMazeButton();
    this.speedLabel = this.topButton(672, `x${this.speed}`, 72, () => {
      this.speed = this.speed >= 3 ? 1 : this.speed + 1;
      this.speedLabel.setText(`x${this.speed}`);
    });

    this.msg = this.add.text(20, PANEL_Y + 8, '', {
      fontSize: '25px',
      fontStyle: 'bold',
      color: '#ffe9a8',
      wordWrap: { width: 680 },
    });
    this.info = this.add.text(20, PANEL_Y + 46, '', {
      fontSize: '20px',
      color: '#cfd8c8',
      wordWrap: { width: 680 },
      lineSpacing: 3,
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTap(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p));
    (window as unknown as { __phase: () => Phase }).__phase = () => this.phase;

    this.refresh();
    if (resumed) this.toast(`Игра продолжена: волна ${this.wave}`, '#ffe9a8');
    else this.checkWaveNote();
  }

  private applyLevelGeometry() {
    this.gridX = (720 - this.level.cols * D.CELL_W) / 2;
    this.gridY = D.GRID_Y + ((D.ROWS - this.level.rows) * D.CELL_H) / 2;
    this.voidSet = new Set(this.level.voidCells.map((v) => v.y * this.level.cols + v.x));
  }

  private isVoid(x: number, y: number) {
    return this.voidSet.has(y * this.level.cols + x);
  }

  private placeMapObstacles() {
    for (const ob of this.level.obstacles) {
      if (this.isWaypoint(ob.x, ob.y) || this.isVoid(ob.x, ob.y)) continue;
      this.grid[ob.y][ob.x] = { x: ob.x, y: ob.y, kind: 'sealed', pillar: true, cd: 0, auraMul: 1 };
    }
  }

  private buildWaypointLabels() {
    for (const l of this.waypointLabels) l.destroy();
    this.waypointLabels = [];
    this.level.waypoints.forEach((w, i) => {
      const c = this.center(w);
      const isStart = i === 0;
      const isExit = i === this.level.waypoints.length - 1;
      const label = isStart ? 'ШЛЮЗ' : isExit ? 'ПК' : `T${i}`;
      const t = this.add
        .text(c.x, c.y + (isStart ? 0 : 12), label, {
          fontSize: isStart ? '13px' : '14px',
          fontStyle: 'bold',
          color: isExit ? '#f8d0ff' : isStart ? '#ffb8a8' : '#a8f8ff',
          backgroundColor: '#00000088',
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(40);
      this.waypointLabels.push(t);
    });
  }

  private showDataErrors() {
    const list = D.DATA_ERRORS.slice(0, 25).map((e) => `• ${e}`);
    if (D.DATA_ERRORS.length > 25) list.push(`…и ещё ${D.DATA_ERRORS.length - 25}`);
    this.add.text(30, 40, `Ошибки в таблицах (папка data):\n\n${list.join('\n')}`, {
      fontSize: '24px',
      color: '#ffb0a0',
      wordWrap: { width: 660 },
      lineSpacing: 6,
    });
  }

  // ---------- maze blueprints ----------
  private supportsMazeBlueprints() {
    return this.level.cols === D.COLS && this.level.rows === D.ROWS && this.level.voidCells.length === 0;
  }

  private createMazeButton() {
    this.mazeIdx = loadMazeChoice();
    if (this.mazeIdx >= D.MAZES.length) this.mazeIdx = -1;
    this.mazeBg = this.add.rectangle(360, 120, 680, 44, 0x2a3324).setStrokeStyle(2, 0x8fa870).setInteractive();
    this.mazeLabel = this.add.text(360, 120, '', { fontSize: '22px', fontStyle: 'bold', color: '#f2ead0' }).setOrigin(0.5);
    this.mazeBg.on('pointerdown', () => this.openMazePicker());
  }

  private updateMazeButton() {
    const show = this.supportsMazeBlueprints();
    this.mazeBg.setVisible(show);
    this.mazeLabel.setVisible(show);
    if (show) this.mazeLabel.setText(`Схема лабиринта: ${this.maze ? this.maze.name : 'нет'}  ▾`);
    else this.mazeLabel.setText('');
  }

  private closeOverlay() {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
  }

  /** Window with a miniature of every blueprint: tap one to choose it. */
  private openMazePicker() {
    if (this.overlay.length) return;
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(this.add.rectangle(360, 640, 720, 1280, 0x0b0f0b, 0.97).setInteractive().setDepth(100));
    objs.push(
      this.add
        .text(360, 40, 'Выберите схему лабиринта', { fontSize: '30px', fontStyle: 'bold', color: '#ffe9a8' })
        .setOrigin(0.5)
        .setDepth(101),
    );
    objs.push(
      this.add
        .text(360, 80, 'Крестики: жёлтые — этап 1, оранжевые — 2, серые — 3. Линия — путь врагов', {
          fontSize: '18px',
          color: '#bfc8b4',
          align: 'center',
          wordWrap: { width: 680 },
        })
        .setOrigin(0.5, 0)
        .setDepth(101),
    );
    const g = this.add.graphics().setDepth(101);
    objs.push(g);

    const entries = [-1, ...D.MAZES.map((_, i) => i)];
    const cardW = 335;
    const cardH = 330;
    const cw = 14;
    const ch = 11;
    const baseLen = pathLength(fullPath(D.COLS, D.ROWS, () => false, D.WAYPOINTS)!);
    entries.forEach((idx, n) => {
      const x0 = 20 + (n % 2) * (cardW + 10);
      const y0 = 130 + Math.floor(n / 2) * (cardH + 12);
      const m = idx >= 0 ? D.MAZES[idx] : null;
      const chosen = idx === this.mazeIdx;
      const card = this.add
        .rectangle(x0 + cardW / 2, y0 + cardH / 2, cardW, cardH, chosen ? 0x3a3018 : 0x1c2419)
        .setStrokeStyle(chosen ? 4 : 2, chosen ? 0xffe066 : 0x45553a)
        .setInteractive()
        .setDepth(100.5);
      card.on('pointerdown', () => {
        this.mazeIdx = idx;
        saveMazeChoice(idx);
        this.closeOverlay();
        this.refresh();
      });
      objs.push(card);
      objs.push(
        this.add
          .text(x0 + cardW / 2, y0 + 22, m ? m.name : 'Без схемы', { fontSize: '24px', fontStyle: 'bold', color: chosen ? '#ffe066' : '#f2ead0' })
          .setOrigin(0.5)
          .setDepth(101),
      );

      // miniature board
      const gx = x0 + (cardW - D.COLS * cw) / 2;
      const gy = y0 + 44;
      const cell = (p: Pt) => ({ x: gx + p.x * cw + cw / 2, y: gy + p.y * ch + ch / 2 });
      for (let y = 0; y < D.ROWS; y++)
        for (let x = 0; x < D.COLS; x++) {
          g.fillStyle((x + y) % 2 ? 0x2a3d2c : 0x24362a).fillRect(gx + x * cw, gy + y * ch, cw, ch);
        }
      const blocked = (x: number, y: number) => !!m && m.cells.has(y * D.COLS + x);
      const path = fullPath(D.COLS, D.ROWS, blocked, D.WAYPOINTS);
      if (m?.focus) {
        const c = cell(m.focus);
        g.lineStyle(1.5, 0xffe066, 0.5).strokeEllipse(c.x, c.y, 6 * cw, 6 * ch);
      }
      if (path) {
        g.lineStyle(2, 0xd9a24a, 0.85).beginPath();
        path.forEach((p, i) => {
          const c = cell(p);
          if (i === 0) g.moveTo(c.x, c.y);
          else g.lineTo(c.x, c.y);
        });
        g.strokePath();
      }
      if (m)
        for (const [ci, st] of m.cells) {
          const c = cell({ x: ci % D.COLS, y: Math.floor(ci / D.COLS) });
          const col = st === 1 ? 0xffe066 : st === 2 ? 0xf08a3a : 0x9aa3ad;
          g.lineStyle(1.6, col);
          g.lineBetween(c.x - 4, c.y - 3.5, c.x + 4, c.y + 3.5);
          g.lineBetween(c.x - 4, c.y + 3.5, c.x + 4, c.y - 3.5);
        }
      if (m?.focus) {
        const c = cell(m.focus);
        g.fillStyle(0xffe066).fillCircle(c.x, c.y, 3.5);
      }
      for (const w of D.WAYPOINTS) {
        const c = cell(w);
        g.fillStyle(0xd9b13b).fillCircle(c.x, c.y, 4.5);
      }

      const len = path ? pathLength(path) : 0;
      const stats = m
        ? `${m.cells.size} клеток · путь ×${(len / baseLen).toFixed(1)}`
        : 'Строите как хотите';
      objs.push(
        this.add
          .text(x0 + cardW / 2, y0 + cardH - 26, stats, { fontSize: '19px', color: '#cfd8c8' })
          .setOrigin(0.5)
          .setDepth(101),
      );
    });

    const close = this.add.rectangle(360, 1220, 680, 80, 0x4a4a4a).setStrokeStyle(3, 0xf0e0a0).setInteractive().setDepth(101);
    const closeT = this.add.text(360, 1220, 'Закрыть', { fontSize: '26px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setDepth(102);
    close.on('pointerdown', () => this.closeOverlay());
    objs.push(close, closeT);
    this.overlay = objs;
  }

  private get maze() {
    return this.supportsMazeBlueprints() && this.mazeIdx >= 0 ? D.MAZES[this.mazeIdx] : null;
  }

  /** First stage of the blueprint that still has unbuilt cells (stages + 1 when done). */
  private mazeStage() {
    const m = this.maze!;
    for (let st = 1; st <= m.stages; st++)
      for (const [idx, s] of m.cells) if (s === st && !this.grid[Math.floor(idx / D.COLS)][idx % D.COLS]) return st;
    return m.stages + 1;
  }

  private mazeInfo() {
    const m = this.maze!;
    const st = this.mazeStage();
    if (st > m.stages) return `Схема «${m.name}» построена полностью.`;
    let left = 0;
    for (const [idx, s] of m.cells) if (s === st && !this.grid[Math.floor(idx / D.COLS)][idx % D.COLS]) left++;
    return `Схема «${m.name}»: этап ${st} из ${m.stages}, осталось ${left} клеток (яркие крестики).`;
  }

  private drawMaze(g: Phaser.GameObjects.Graphics) {
    if (!this.supportsMazeBlueprints()) return;
    const m = this.maze;
    if (!m) return;
    if (m.focus) {
      const c = this.center(m.focus);
      g.fillStyle(0xffe066, 0.06).fillEllipse(c.x, c.y, 6 * D.CELL_W, 6 * D.CELL_H);
      g.lineStyle(2, 0xffe066, 0.35).strokeEllipse(c.x, c.y, 6 * D.CELL_W, 6 * D.CELL_H);
    }
    const st = this.mazeStage();
    for (const [idx, s] of m.cells) {
      const x = idx % D.COLS;
      const y = Math.floor(idx / D.COLS);
      if (this.grid[y][x]) continue;
      const o = this.origin({ x, y });
      const now = s === st;
      const d = 11;
      const cx = o.x + D.CELL_W / 2;
      const cy = o.y + D.CELL_H / 2;
      if (m.focus && m.focus.x === x && m.focus.y === y) {
        g.lineStyle(3, 0xffe066, 0.95).strokeCircle(cx, cy, 13);
        g.fillStyle(0xffe066, 0.95).fillCircle(cx, cy, 4);
        continue;
      }
      g.lineStyle(now ? 3 : 2, now ? 0xffe066 : 0xffffff, now ? 0.9 : 0.22);
      g.lineBetween(cx - d, cy - d * 0.8, cx + d, cy + d * 0.8);
      g.lineBetween(cx - d, cy + d * 0.8, cx + d, cy - d * 0.8);
    }
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
        cells.push({
          x: u.x,
          y: u.y,
          kind: u.kind,
          sp: u.sp,
          level: u.level,
          hybrid: u.hybrid,
          pillar: u.pillar,
        });
      }
    saveRun({
      levelId: this.level.id,
      wave: this.wave,
      lives: this.lives,
      gold: this.gold,
      chance: this.chance,
      cells,
      fresh,
      seenNotes: [...this.seenNotes],
      usedGadgets: this.usedGadgets,
    });
  }

  private restore() {
    const s = loadRun();
    if (!s) return false;
    const savedLevel = LEVELS.find((l) => l.id === (s.levelId ?? 'doof')) ?? LEVELS[0];
    this.level = savedLevel;
    this.meta.currentLevel = savedLevel.id;
    this.applyLevelGeometry();
    this.grid = Array.from({ length: this.level.rows }, () => Array<Unit | null>(this.level.cols).fill(null));
    const fits =
      s.wave >= 1 &&
      s.wave <= D.TOTAL_WAVES &&
      s.chance >= 0 &&
      s.chance < D.QUALITY_ODDS.length &&
      Array.isArray(s.cells) &&
      Array.isArray(s.fresh) &&
      s.cells.every(
        (c) =>
          c.x >= 0 &&
          c.x < this.level.cols &&
          c.y >= 0 &&
          c.y < this.level.rows &&
          !this.isVoid(c.x, c.y) &&
          !this.isWaypoint(c.x, c.y) &&
          ((c.kind === 'mon' && c.sp && D.BASE[c.sp] && (c.level ?? 99) <= D.MAX_LEVEL) ||
            (c.kind === 'hybrid' && D.HYBRIDS.some((h) => h.id === c.hybrid)) ||
            c.kind === 'sealed' ||
            c.kind === 'cocoon'),
      );
    if (!fits) {
      saveRun(null);
      return false;
    }
    this.wave = s.wave;
    this.lives = s.lives;
    this.gold = s.gold;
    this.chance = s.chance;
    this.seenNotes = new Set(s.seenNotes ?? []);
    this.usedGadgets = !!s.usedGadgets;
    s.cells.forEach((c, i) => {
      const u: Unit = { ...c, kind: c.kind === 'cocoon' ? 'sealed' : c.kind, cd: 0, auraMul: 1 };
      this.grid[c.y][c.x] = u;
      if (s.fresh.includes(i)) this.fresh.push(u);
    });
    if (!this.computePath()) {
      this.grid = Array.from({ length: this.level.rows }, () => Array<Unit | null>(this.level.cols).fill(null));
      this.fresh = [];
      saveRun(null);
      return false;
    }
    if (this.fresh.length >= D.PER_ROUND || (this.fresh.length > 0 && !this.hasValidBuildCell())) {
      this.phase = 'choose';
    }
    return true;
  }

  private newGame(levelId?: string) {
    if (levelId) {
      this.meta.currentLevel = levelId;
      saveMeta(this.meta);
    }
    saveRun(null);
    this.scene.restart();
  }

  // ---------- helpers ----------
  private center(p: Pt) {
    return this.toPx(p.x, p.y);
  }

  private toPx(fx: number, fy: number) {
    return toPx(fx, fy, this.gridX, this.gridY);
  }

  private origin(p: Pt) {
    return { x: this.gridX + p.x * D.CELL_W, y: this.gridY + p.y * D.CELL_H };
  }

  private isWaypoint(x: number, y: number) {
    return this.level.waypoints.some((w) => w.x === x && w.y === y);
  }

  private computePath() {
    return fullPath(
      this.level.cols,
      this.level.rows,
      (x, y) => this.isVoid(x, y) || this.grid[y][x] !== null,
      this.level.waypoints,
    );
  }

  /** Whether at least one empty cell on the board can still be placed without blocking the path. */
  private hasValidBuildCell(): boolean {
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.isVoid(x, y) || this.grid[y][x] || this.isWaypoint(x, y)) continue;
        this.grid[y][x] = { x, y, kind: 'sealed', cd: 0, auraMul: 1 };
        const ok = this.computePath() !== null;
        this.grid[y][x] = null;
        if (ok) return true;
      }
    }
    return false;
  }

  private demolishCost(): number {
    return Math.max(0, 15 - (this.meta.upgrades.salvage ?? 0) * 5);
  }

  private totalStars(): number {
    return Object.values(this.meta.stars).reduce((a, b) => a + b, 0);
  }

  private spentStars(): number {
    let sum = 0;
    for (const up of LAB_UPGRADES) {
      const lvl = this.meta.upgrades[up.id] ?? 0;
      for (let i = 0; i < lvl; i++) sum += up.starCost[i] ?? 0;
    }
    return sum;
  }

  private availableStars(): number {
    return Math.max(0, this.totalStars() - this.spentStars());
  }

  private stats(u: Unit): D.Stats {
    return Rules.statsOf(u);
  }

  private fighters() {
    const out: Unit[] = [];
    for (const row of this.grid) for (const u of row) if (u && u.kind !== 'sealed') out.push(u);
    return out;
  }

  private rollLevel() {
    return Rules.rollLevel(this.chance);
  }

  private flash(text: string) {
    this.msg.setText(text).setColor('#ff7a6a');
    this.flashTimer?.remove();
    this.flashTimer = this.time.delayedCall(1300, () => this.refresh());
  }

  private toast(text: string, color: string) {
    const t = this.add
      .text(360, D.GRID_Y + (D.ROWS * D.CELL_H) / 2, text, {
        fontSize: '32px',
        fontStyle: 'bold',
        color,
        align: 'center',
        backgroundColor: '#000000cc',
        padding: { x: 18, y: 12 },
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 600, onComplete: () => t.destroy() });
  }

  // ---------- input ----------
  private cellAtPointer(p: Phaser.Input.Pointer): { cx: number; cy: number; u: Unit | null } | null {
    const cx = Math.floor((p.x - this.gridX) / D.CELL_W);
    let cy = Math.floor((p.y - this.gridY) / D.CELL_H);
    // Cages rise above their cell. Outside the build phase, a tap on an empty cell
    // that is visually covered by the cage below selects that cage.
    if (
      this.phase !== 'build' &&
      cx >= 0 &&
      cx < this.level.cols &&
      cy >= 0 &&
      cy < this.level.rows - 1 &&
      !this.isVoid(cx, cy) &&
      !this.grid[cy][cx]
    ) {
      const coveredFrom = this.gridY + (cy + 1) * D.CELL_H - D.OBJ_H;
      if (p.y >= coveredFrom && !this.isVoid(cx, cy + 1) && this.grid[cy + 1][cx]) cy++;
    }
    if (cx < 0 || cy < 0 || cx >= this.level.cols || cy >= this.level.rows || this.isVoid(cx, cy)) return null;
    return { cx, cy, u: this.grid[cy][cx] };
  }

  private onHover(p: Phaser.Input.Pointer) {
    if (this.overlay.length || this.phase === 'sealing') {
      if (this.hovered) {
        this.hovered = null;
        this.updateDossier();
      }
      return;
    }
    const hit = this.cellAtPointer(p);
    const next = hit && hit.u && hit.u.kind !== 'sealed' ? hit.u : null;
    if (next !== this.hovered) {
      this.hovered = next;
      this.updateDossier();
    }
  }

  private onTap(p: Phaser.Input.Pointer) {
    if (this.overlay.length || this.phase === 'sealing') return;
    const hit = this.cellAtPointer(p);
    if (!hit) return;
    const { cx, cy, u } = hit;

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
    // In build phase, allow selecting sealed blocks (to demolish them) or fresh cages (to undo misclicks)
    if (this.phase === 'build' && u) {
      this.selected = u;
      this.refresh();
      return;
    }
    this.selected = u && u.kind !== 'sealed' ? u : null;
    this.refresh();
  }

  private tryPlace(x: number, y: number) {
    if (this.isWaypoint(x, y)) return this.flash('Здесь терминал — селить нельзя');
    const u: Unit = {
      x,
      y,
      kind: 'mon',
      sp: Rules.randomSpecies(),
      level: this.rollLevel(),
      cd: 0,
      auraMul: 1,
    };
    this.grid[y][x] = u;
    const p = this.computePath();
    if (!p) {
      this.grid[y][x] = null;
      return this.flash('Нельзя полностью перекрыть путь к терминалам!');
    }
    this.path = p;
    this.fresh.push(u);
    this.selected = u;
    if (this.fresh.length >= D.PER_ROUND || !this.hasValidBuildCell()) {
      this.phase = 'choose';
      this.selected = null;
    }
    this.refresh();
  }

  /** Undo a freshly placed cage during the build phase (free misclick recovery) or demolish an old sealed plate. */
  private removeBuildUnit(u: Unit) {
    if (this.phase !== 'build') return;
    if (this.fresh.includes(u)) {
      this.grid[u.y][u.x] = null;
      this.fresh = this.fresh.filter((f) => f !== u);
      this.selected = null;
      this.path = this.computePath()!;
      this.refresh();
      return;
    }
    if (u.kind === 'sealed' && !u.pillar) {
      const cost = this.demolishCost();
      if (this.gold < cost) return this.flash('Не хватает золота на снос плиты');
      this.gold -= cost;
      this.grid[u.y][u.x] = null;
      this.selected = null;
      this.path = this.computePath()!;
      this.toast('Железный блок разобран!', '#a8f0ff');
      this.refresh();
    }
  }

  // ---------- choose phase ----------
  /** Result of crossing the given parents, or null if nothing happens. */
  private crossResult(parents: Unit[]) {
    return Rules.crossResult(parents);
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
        this.meta.cores += 1;
        saveMeta(this.meta);
      }
      sel.kind = 'hybrid';
      sel.hybrid = res.hybrid.id;
      sel.sp = undefined;
      sel.level = undefined;
      this.toast(`${isNew ? 'Новый гибрид! (+1💎)\n' : ''}${res.hybrid.stats.name}`, '#ffd84a');
    } else {
      sel.level = res.level;
      this.toast(`${D.BASE[sel.sp!].name}: ${D.LEVEL_NAMES[res.level]}`, '#a8f0ff');
    }
    this.keep(sel);
  }

  private keep(sel: Unit) {
    const now = this.time.now;
    // Shuffle the 4 execution animations so each rejected box shows a different effect one after another
    const kinds = [...KILL_KINDS].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const u of this.fresh) {
      if (u === sel) continue;
      u.kind = 'sealed';
      u.killKind = kinds[i % kinds.length];
      u.sealAt = now + i * SEAL_STAGGER;
      i++;
    }
    this.sealEnd = now + Math.max(0, i - 1) * SEAL_STAGGER + KILL_MS + SEAL_MS + 180;
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
          u.killKind = undefined;
          u.sp = undefined;
          u.level = undefined;
        }
    this.startWave();
  }

  private recalcAuras() {
    const all = this.fighters();
    const overclockBonus = (this.meta.upgrades.overclock ?? 0) * 0.08;
    for (const u of all) u.auraMul = 1 + overclockBonus;
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
    this.battle.path = this.path;
    this.battle.startWave(D.WAVES[this.wave - 1]);
    this.refresh();
  }

  private endWave() {
    this.gold += D.WAVE_BONUS_BASE + this.wave;
    this.wave++;
    this.battle.shots = [];
    if (this.wave > D.TOTAL_WAVES) {
      this.onLevelWin();
      return;
    }
    if (!this.hasValidBuildCell()) {
      this.toast('Свободных клеток больше нет!', '#ffe9a8');
      this.startWave();
      return;
    }
    this.phase = 'build';
    this.refresh();
    this.checkWaveNote();
  }

  private onLevelWin() {
    this.phase = 'win';
    const stars = this.lives >= 18 ? 3 : this.lives >= 10 ? 2 : 1;
    const prevStars = this.meta.stars[this.level.id] ?? 0;
    if (stars > prevStars) {
      const diff = stars - prevStars;
      this.meta.stars[this.level.id] = stars;
      this.meta.cores += diff * 2;
    }
    if (!this.usedGadgets && !this.meta.hardcoreCleared.includes(this.level.id)) {
      this.meta.hardcoreCleared.push(this.level.id);
    }
    saveMeta(this.meta);
    saveRun(null);
    this.refresh();
  }

  private checkWaveNote() {
    const note = WAVE_NOTES[this.wave];
    if (!note || this.seenNotes.has(this.wave)) return;
    this.seenNotes.add(this.wave);
    this.persist();
    this.openNoteModal(note.title, note.text);
  }

  update(_t: number, deltaMs: number) {
    if (D.DATA_ERRORS.length) return;
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
    const b = this.battle;
    b.path = this.path;
    b.step(dt, this.fighters(), (f) => this.stats(f as Unit));
    this.gold += b.drainGold();
    this.lives -= b.drainLives();
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'over';
      saveRun(null);
      this.refresh();
      return;
    }
    if (b.finished) this.endWave();
  }


  // ---------- Gadgets (Step 5 economy) ----------
  private useCryoBlast() {
    if (this.meta.cores < 1) return this.flash('Не хватает энергоядер (💎)');
    this.meta.cores -= 1;
    this.usedGadgets = true;
    saveMeta(this.meta);
    for (const e of this.battle.enemies) {
      if (e.dead) continue;
      e.slowPct = Math.max(e.slowPct, 0.7);
      e.slowUntil = this.battle.clock + 5;
    }
    this.toast('Крио-выброс! Враги заморожены на 5 с', '#70e8ff');
    this.updateHud();
  }

  private useRerollFresh() {
    if (this.meta.cores < 1) return this.flash('Не хватает энергоядер (💎)');
    this.meta.cores -= 1;
    this.usedGadgets = true;
    saveMeta(this.meta);
    for (const u of this.fresh) {
      u.sp = Rules.randomSpecies();
      u.level = this.rollLevel();
    }
    this.toast('Мутаген распылён! Новые образцы в клетках', '#ffd84a');
    this.refresh();
  }

  private useBackupRam() {
    if (this.meta.cores < 1) return this.flash('Не хватает энергоядер (💎)');
    this.meta.cores -= 1;
    this.usedGadgets = true;
    saveMeta(this.meta);
    this.lives += 5;
    this.toast('Резервный сервер подключён: +5 жизней', '#7cff6a');
    this.refresh();
  }

  // ---------- UI ----------
  private updateHud() {
    const hc = this.meta.hardcore ? ' [ХАРДКОР]' : '';
    this.hud.setText(
      `${this.level.title}${hc}\nВолна ${Math.min(this.wave, D.TOTAL_WAVES)}/${D.TOTAL_WAVES} · ❤️${this.lives} · 💰${this.gold} · 💎${this.meta.cores}`,
    );
  }

  private topButton(x: number, label: string, w: number, cb: () => void) {
    const bg = this.add.rectangle(x, 42, w, 54, 0x3a4a30).setStrokeStyle(2, 0x8fa870).setInteractive();
    const t = this.add.text(x, 42, label, { fontSize: '20px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5);
    bg.on('pointerdown', cb);
    return t;
  }

  private layoutButtons(specs: ButtonSpec[]) {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    if (!specs.length) return;
    const gap = 8;
    const w = (680 - gap * (specs.length - 1)) / specs.length;
    const y = 1280 - 56;
    specs.forEach((s, i) => {
      const x = 20 + i * (w + gap) + w / 2;
      const bg = this.add.rectangle(x, y, w, 80, s.color).setStrokeStyle(3, 0xf0e0a0).setInteractive();
      const tx = this.add
        .text(x, y, s.label, {
          fontSize: specs.length > 3 ? '18px' : specs.length > 2 ? '20px' : '24px',
          fontStyle: 'bold',
          color: '#fff',
          align: 'center',
          wordWrap: { width: w - 10 },
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
    if (u.kind === 'sealed') {
      if (u.pillar) return 'Несущая колонна лаборатории. Снести нельзя.';
      const cost = this.demolishCost();
      return `Запечатанный железный блок (стена лабиринта).\nВ фазе стройки можно разобрать за ${cost} золота.`;
    }
    const s = this.stats(u);
    const parts = [`Урон ${Math.round(s.dmg)}`, `Скорость ${(s.rate * u.auraMul).toFixed(1)}/с`, `Дальность ${s.range}`];
    if (s.antiAir) parts.push('ПВО (бьёт воздух)');
    if (s.splash) parts.push(`Область ${s.splash}`);
    if (s.slow) parts.push(`Замедление ${Math.round(s.slow * 100)}%`);
    if (s.poison) parts.push(`Яд ${Math.round(s.poison)}/с`);
    if (s.targets) parts.push(`Цели ${s.targets}`);
    if (s.crit) parts.push(`Крит ${Math.round(s.crit * 100)}%`);
    if (s.aura) parts.push(`Вой +${Math.round(s.aura * 100)}% скорости`);
    return `${s.name}. ${s.desc}\n${parts.join(' · ')}`;
  }

  private clearDossier() {
    for (const o of this.dossierObjs) o.destroy();
    this.dossierObjs = [];
  }

  /** Renders a structured monster dossier card (portrait + stat table) on hover or selection. */
  private updateDossier() {
    this.clearDossier();
    if (this.crossing || this.phase === 'sealing' || this.phase === 'over' || this.phase === 'win') {
      this.info.setVisible(true);
      return;
    }
    const target = this.hovered ?? (this.selected && this.selected.kind !== 'sealed' ? this.selected : null);
    if (!target || target.kind === 'sealed') {
      this.info.setVisible(true);
      return;
    }
    this.info.setVisible(false);
    const s = this.stats(target);
    const isHyb = target.kind === 'hybrid';
    const topY = PANEL_Y + 46;
    const cardH = 148;
    const objs: Phaser.GameObjects.GameObject[] = [];

    // Dossier background card
    const bg = this.add.rectangle(360, topY + cardH / 2, 684, cardH, 0x151e18, 0.96).setStrokeStyle(2, s.color);
    objs.push(bg);

    // Portrait frame on the left
    const px = 72;
    const py = topY + cardH / 2;
    const pBox = this.add.rectangle(px, py, 86, 118, 0x222c24).setStrokeStyle(2, isHyb ? 0xd9b13b : 0x7c868e);
    const pg = this.add.graphics();
    R.cageFloor(pg, px - D.CELL_W / 2, py - D.CELL_H / 2 + 10, s.color);
    R.creature(pg, px, py + 24, isHyb ? 15 : this.monsterRadius(target.level ?? 0) + 3, s.color, { spikes: isHyb });
    const roleTag = this.add
      .text(px, topY + 24, s.antiAir ? 'ПВО ✈' : isHyb ? 'ГИБРИД' : `УР. ${(target.level ?? 0) + 1}`, {
        fontSize: '12px',
        fontStyle: 'bold',
        color: s.antiAir ? '#70e8ff' : isHyb ? '#ffd84a' : '#d8e0d0',
        backgroundColor: '#0c120e',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);
    objs.push(pBox, pg, roleTag);

    // Header: Name + short description
    const head = this.add.text(126, topY + 10, `${s.name}  —  ${s.desc}`, {
      fontSize: '17px',
      fontStyle: 'bold',
      color: '#ffe9a8',
      wordWrap: { width: 560 },
    });
    objs.push(head);

    // Structured stat cells (2 rows x 4 columns)
    const cells: { k: string; v: string; col?: string }[] = [
      { k: 'УРОН', v: `${Math.round(s.dmg)}`, col: '#ff9a7a' },
      { k: 'СКОРОСТЬ', v: `${(s.rate * target.auraMul).toFixed(1)}/с`, col: '#a8f0ff' },
      { k: 'ДАЛЬНОСТЬ', v: `${s.range}`, col: '#d8e8c8' },
      { k: 'ВОЗДУХ', v: s.antiAir ? 'ДА (ПВО)' : 'НЕТ', col: s.antiAir ? '#70e8ff' : '#7a847e' },
    ];
    if (s.targets) cells.push({ k: 'ЦЕЛИ', v: `${s.targets}`, col: '#ffd84a' });
    if (s.splash) cells.push({ k: 'ОБЛАСТЬ', v: `${s.splash}`, col: '#ff8a50' });
    if (s.slow) cells.push({ k: 'ЗАМЕДЛ.', v: `${Math.round(s.slow * 100)}%`, col: '#70c8ff' });
    if (s.poison) cells.push({ k: 'ЯД', v: `${Math.round(s.poison)}/с`, col: '#60e878' });
    if (s.crit) cells.push({ k: 'КРИТ', v: `${Math.round(s.crit * 100)}%`, col: '#ffe066' });
    if (s.aura) cells.push({ k: 'АУРА', v: `+${Math.round(s.aura * 100)}%`, col: '#ff90d8' });

    const cols = 4;
    const cellW = 136;
    const cellH = 44;
    const startX = 126;
    const startY = topY + 42;
    cells.slice(0, 8).forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (cellW + 6);
      const cy = startY + row * (cellH + 6);
      const box = this.add.rectangle(cx + cellW / 2, cy + cellH / 2, cellW, cellH, 0x1e2b23).setStrokeStyle(1, 0x455a4c);
      const kt = this.add.text(cx + 6, cy + 4, c.k, { fontSize: '11px', color: '#9ab0a0', fontStyle: 'bold' });
      const vt = this.add.text(cx + 6, cy + 20, c.v, {
        fontSize: '16px',
        color: c.col ?? '#ffffff',
        fontStyle: 'bold',
      });
      objs.push(box, kt, vt);
    });

    this.dossierObjs = objs;
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
        if (!sel) {
          info = `${this.maze ? this.mazeInfo() + '\n' : 'Нажмите на пустую клетку (или на блок/клетку для отмены и сноса).\n'}Шансы: ${this.oddsText()}`;
        }
        if (sel && this.fresh.includes(sel)) {
          specs.push({
            label: 'Убрать клетку\n(отмена мисклика)',
            color: 0x3b6e4c,
            cb: () => this.removeBuildUnit(sel),
          });
        } else if (sel && sel.kind === 'sealed' && !sel.pillar) {
          const cost = this.demolishCost();
          specs.push({
            label: `Снести блок\n(${cost > 0 ? `${cost} золота` : 'бесплатно'})`,
            color: this.gold >= cost ? 0x8a4820 : 0x3a3a3a,
            cb: () => this.removeBuildUnit(sel),
          });
        }
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
        if (!this.meta.hardcore && this.lives < this.maxStartLives) {
          specs.push({
            label: 'Бекап ОЗУ\n(+5❤️ за 1💎)',
            color: this.meta.cores >= 1 ? 0x2a5a6a : 0x3a3a3a,
            cb: () => this.useBackupRam(),
          });
        }
        break;
      }
      case 'choose': {
        const isFresh = !!sel && this.fresh.includes(sel);
        if (this.crossing && isFresh) {
          this.msg.setText('Выберите партнёров для скрещивания');
          const names = this.partners.map((p) => this.stats(p).name);
          let previewLine = '';
          if (this.partners.length) {
            const res = this.crossResult([sel!, ...this.partners]);
            if (res && 'level' in res) {
              previewLine = `\n→ Потомок: ${D.BASE[sel!.sp!].name}: ${D.LEVEL_NAMES[res.level]}`;
            } else if (res && 'hybrid' in res && this.bestiary.has(res.hybrid.id)) {
              previewLine = `\n→ Гибрид: ${res.hybrid.stats.name}`;
            } else {
              previewLine = '\n→ Результат: ???';
            }
          }
          info = `${this.stats(sel!).name}\n× ${names.length ? names.join(', ') : '(нажмите на новых монстров)'}${previewLine}`;
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
        this.msg.setText('Оставьте одного. Остальных ликвидируют по очереди');
        if (!isFresh) {
          info =
            'Нажмите на одного из новых монстров (подсвечены жёлтым).\nОдинаковые дают более взрослого потомка, а секретные комбинации дают гибридов.';
          if (!this.meta.hardcore) {
            specs.push({
              label: 'Переброс партии\n(1💎)',
              color: this.meta.cores >= 1 ? 0x2a5a6a : 0x3a3a3a,
              cb: () => this.useRerollFresh(),
            });
          }
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
        if (!this.meta.hardcore) {
          specs.push({
            label: 'Переброс (1💎)',
            color: this.meta.cores >= 1 ? 0x2a5a6a : 0x3a3a3a,
            cb: () => this.useRerollFresh(),
          });
        }
        break;
      }
      case 'sealing':
        this.msg.setText('Ликвидация отбракованных образцов…');
        info = 'Коробки запечатываются бронеплитами одна за другой';
        break;
      case 'wave': {
        const groups = D.WAVES[this.wave - 1];
        const names = [...new Set(groups.map((g) => g.enemy.name))];
        const hasFlying = groups.some((g) => g.enemy.flying);
        this.msg.setText(`Волна ${this.wave}: ${names.join(', ')}${hasFlying ? ' ✈️' : ''}`);
        if (!sel) {
          info = `Враги рвутся к Терминалам 1→2→3 и Суперкомпьютеру [ПК]. Открыто гибридов: ${this.bestiary.size}/${D.HYBRIDS.length}`;
        }
        if (!this.meta.hardcore) {
          specs.push({
            label: 'Крио-импульс\n(заморозка 1💎)',
            color: this.meta.cores >= 1 ? 0x24627a : 0x3a3a3a,
            cb: () => this.useCryoBlast(),
          });
        }
        break;
      }
      case 'over':
        this.msg.setText(`Суперкомпьютер взломан на волне ${this.wave}!`);
        info = `Чертежи украдены. Открыто гибридов: ${this.bestiary.size}/${D.HYBRIDS.length}. Бестиарий и Лаборатория сохранены.`;
        specs.push({ label: 'Заново', color: 0x8a2a2a, cb: () => this.newGame() });
        specs.push({ label: 'Карта', color: 0x3a5a6a, cb: () => this.openMapModal() });
        break;
      case 'win': {
        const stars = this.lives >= 18 ? 3 : this.lives >= 10 ? 2 : 1;
        const badge = !this.usedGadgets ? ' · 💀Без гаджетов!' : '';
        this.msg.setText(`Победа! Лаборатория защищена (${'★'.repeat(stars)}${'☆'.repeat(3 - stars)})`);
        info = `Осталось жизней мейнфрейма: ${this.lives}${badge}`;
        specs.push({ label: 'Сыграть ещё', color: 0x4c6a2e, cb: () => this.newGame() });
        specs.push({ label: 'Карта', color: 0x3a5a6a, cb: () => this.openMapModal() });
        break;
      }
    }
    this.info.setText(info);
    this.info.setY(this.msg.y + this.msg.height + 6);
    this.layoutButtons(specs);
    this.updateHud();
    this.updateMazeButton();
    this.updateDossier();
    this.drawBoard();
    this.persist();
  }

  // ---------- Modals: Scientist Notes, Menu, World Map, Lab Upgrades, Settings ----------
  private openNoteModal(title: string, body: string) {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x080c0a, 0.88).setInteractive().setDepth(100);
    const card = this.add.rectangle(360, 620, 640, 480, 0x18241e).setStrokeStyle(3, 0x70e8ff).setDepth(101);
    const head = this.add
      .text(360, 425, title, {
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#70e8ff',
        align: 'center',
        wordWrap: { width: 590 },
      })
      .setOrigin(0.5)
      .setDepth(102);
    const txt = this.add
      .text(70, 475, body, {
        fontSize: '22px',
        color: '#e8f0e8',
        wordWrap: { width: 580 },
        lineSpacing: 6,
      })
      .setDepth(102);
    const ok = this.add
      .rectangle(360, 800, 280, 70, 0x3b6e4c)
      .setStrokeStyle(2, 0xf0e0a0)
      .setInteractive()
      .setDepth(102);
    const okT = this.add
      .text(360, 800, 'В работу!', { fontSize: '25px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(103);
    this.overlay = [bg, card, head, txt, ok, okT];
    ok.on('pointerdown', () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    });
  }

  private isLevelUnlocked(idx: number): boolean {
    if (idx === 0) return true;
    return (this.meta.stars[LEVELS[idx - 1].id] ?? 0) > 0;
  }

  private openMenuModal() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x090e0b, 0.92).setInteractive().setDepth(100);
    const panel = this.add.rectangle(360, 620, 560, 760, 0x16201a).setStrokeStyle(3, 0x8fa870).setDepth(101);
    const title = this.add
      .text(360, 295, 'МЕНЮ ЛАБОРАТОРИИ', { fontSize: '30px', fontStyle: 'bold', color: '#ffe9a8' })
      .setOrigin(0.5)
      .setDepth(102);
    const sub = this.add
      .text(360, 338, `${this.level.title} · ★${this.availableStars()}/${this.totalStars()} · 💎${this.meta.cores}`, {
        fontSize: '18px',
        color: '#b8c8b8',
      })
      .setOrigin(0.5)
      .setDepth(102);
    const items: Phaser.GameObjects.GameObject[] = [bg, panel, title, sub];

    const addBtn = (y: number, label: string, color: number, cb: () => void) => {
      const b = this.add.rectangle(360, y, 460, 82, color).setStrokeStyle(2, 0xf0e0a0).setInteractive().setDepth(102);
      const t = this.add.text(360, y, label, { fontSize: '25px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5).setDepth(103);
      b.on('pointerdown', cb);
      items.push(b, t);
    };

    const closeAll = () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    };

    addBtn(425, 'Продолжить забег', 0x3b6e4c, closeAll);
    addBtn(530, 'Карта лабораторий', 0x2c5268, () => {
      closeAll();
      this.openMapModal();
    });
    addBtn(635, `Улучшения лаборатории (★${this.availableStars()})`, 0x5c4a22, () => {
      closeAll();
      this.openUpgradesModal();
    });
    addBtn(740, 'Настройки', 0x3b444e, () => {
      closeAll();
      this.openSettingsModal();
    });
    addBtn(865, 'Выйти из забега на карту', 0x722a2a, () => {
      saveRun(null);
      closeAll();
      this.openMapModal();
    });

    this.overlay = items;
  }

  private openMapModal() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x0a1014, 0.98).setInteractive().setDepth(100);
    const items: Phaser.GameObjects.GameObject[] = [bg];

    const header = this.add
      .text(360, 42, 'КАРТА ЛАБОРАТОРИЙ', { fontSize: '30px', fontStyle: 'bold', color: '#ffe9a8' })
      .setOrigin(0.5)
      .setDepth(101);
    const sub = this.add
      .text(360, 80, `Пройди уровень на ★+, чтобы открыть следующую арену · ★${this.totalStars()}/${LEVELS.length * 3}`, {
        fontSize: '18px',
        color: '#a8c0c8',
      })
      .setOrigin(0.5)
      .setDepth(101);
    items.push(header, sub);

    // Draw subtle grid & connecting route lines between nodes
    const mapG = this.add.graphics().setDepth(101);
    mapG.lineStyle(1, 0x1e2e36, 0.45);
    for (let x = 40; x < 720; x += 60) mapG.lineBetween(x, 120, x, 1130);
    for (let y = 120; y < 1130; y += 60) mapG.lineBetween(20, y, 700, y);

    for (let i = 0; i < LEVELS.length - 1; i++) {
      const a = LEVELS[i].mapPos;
      const b = LEVELS[i + 1].mapPos;
      const unlocked = this.isLevelUnlocked(i + 1);
      mapG.lineStyle(6, unlocked ? 0x58b888 : 0x36424a, unlocked ? 0.85 : 0.45);
      mapG.lineBetween(a.x, a.y, b.x, b.y);
    }
    items.push(mapG);

    // Level nodes on the map
    LEVELS.forEach((lvl, idx) => {
      const unlocked = this.isLevelUnlocked(idx);
      const isCur = lvl.id === this.level.id;
      const stars = this.meta.stars[lvl.id] ?? 0;
      const hc = this.meta.hardcoreCleared.includes(lvl.id) ? ' 💀' : '';
      const { x, y } = lvl.mapPos;

      const node = this.add
        .circle(x, y, 36, !unlocked ? 0x262d33 : stars > 0 ? 0x2d6844 : 0x2d5070)
        .setStrokeStyle(4, isCur ? 0xffe066 : unlocked ? 0x90e8b8 : 0x526068)
        .setDepth(102);
      if (unlocked) node.setInteractive();

      const numTxt = this.add
        .text(x, y, unlocked ? String(idx + 1) : '🔒', {
          fontSize: unlocked ? '28px' : '24px',
          fontStyle: 'bold',
          color: unlocked ? '#ffffff' : '#9aa8b0',
        })
        .setOrigin(0.5)
        .setDepth(103);

      const labelBg = this.add
        .rectangle(x, y + 62, 240, 56, 0x121b20, 0.92)
        .setStrokeStyle(1.5, isCur ? 0xffe066 : unlocked ? 0x4c6878 : 0x2a343c)
        .setDepth(102);
      const starStr = unlocked ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}${hc}` : 'Закрыто';
      const titleTxt = this.add
        .text(x, y + 51, lvl.title.replace(/^\d+\.\s*/, ''), {
          fontSize: '16px',
          fontStyle: 'bold',
          color: unlocked ? '#f4eed8' : '#788890',
        })
        .setOrigin(0.5)
        .setDepth(103);
      const metaTxt = this.add
        .text(x, y + 73, `${lvl.cols}×${lvl.rows} · ХП ×${lvl.hpMul} · ${starStr}`, {
          fontSize: '14px',
          color: unlocked ? '#ffd84a' : '#64727a',
        })
        .setOrigin(0.5)
        .setDepth(103);

      if (unlocked) {
        const launch = () => {
          closeAll();
          this.newGame(lvl.id);
        };
        node.on('pointerdown', launch);
        labelBg.setInteractive().on('pointerdown', launch);
      }
      items.push(node, numTxt, labelBg, titleTxt, metaTxt);
    });

    const backBtn = this.add
      .rectangle(200, 1205, 320, 76, 0x4a4a4a)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(102);
    const backT = this.add
      .text(200, 1205, 'В меню', { fontSize: '24px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(103);
    const closeBtn = this.add
      .rectangle(535, 1205, 310, 76, 0x3b6e4c)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(102);
    const closeT = this.add
      .text(535, 1205, 'Вернуться в игру', { fontSize: '24px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(103);
    items.push(backBtn, backT, closeBtn, closeT);

    this.overlay = items;
    const closeAll = () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    };
    backBtn.on('pointerdown', () => {
      closeAll();
      this.openMenuModal();
    });
    closeBtn.on('pointerdown', closeAll);
  }

  private openUpgradesModal() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x0b0f0e, 0.97).setInteractive().setDepth(100);
    const items: Phaser.GameObjects.GameObject[] = [bg];

    const header = this.add
      .text(360, 46, `УЛУЧШЕНИЯ ЛАБОРАТОРИИ · ★${this.availableStars()} доступно`, {
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffe9a8',
      })
      .setOrigin(0.5)
      .setDepth(101);
    const sub = this.add
      .text(360, 84, 'Звёзды даются за прохождение карт. Улучшения действуют на всех аренах.', {
        fontSize: '17px',
        color: '#a8b8c0',
      })
      .setOrigin(0.5)
      .setDepth(101);
    items.push(header, sub);

    LAB_UPGRADES.forEach((up, idx) => {
      const y = 140 + idx * 140;
      const curLvl = this.meta.upgrades[up.id] ?? 0;
      const nextCost = curLvl < up.maxLevel ? up.starCost[curLvl] : 0;
      const canBuy = curLvl < up.maxLevel && this.availableStars() >= nextCost;
      const box = this.add
        .rectangle(360, y + 52, 660, 118, 0x1a2228)
        .setStrokeStyle(2, canBuy ? 0x70e8ff : 0x3a4852)
        .setInteractive()
        .setDepth(101);
      const label = this.add
        .text(48, y + 18, `${up.name} (Ур. ${curLvl}/${up.maxLevel})`, {
          fontSize: '23px',
          fontStyle: 'bold',
          color: '#f0ead8',
        })
        .setDepth(102);
      const desc = this.add
        .text(48, y + 54, up.desc, { fontSize: '18px', color: '#a8b8c0', wordWrap: { width: 440 } })
        .setDepth(102);
      const buyLabel = this.add
        .text(665, y + 52, curLvl >= up.maxLevel ? 'МАКС' : `Купить\n(${nextCost}★)`, {
          fontSize: '20px',
          fontStyle: 'bold',
          align: 'right',
          color: curLvl >= up.maxLevel ? '#888' : canBuy ? '#ffe066' : '#777',
        })
        .setOrigin(1, 0.5)
        .setDepth(102);
      box.on('pointerdown', () => {
        if (!canBuy) return;
        this.meta.upgrades[up.id] = curLvl + 1;
        saveMeta(this.meta);
        this.maxStartLives = D.START_LIVES + (this.meta.upgrades.firewall ?? 0) * 4;
        this.recalcAuras();
        closeAll();
        this.openUpgradesModal();
      });
      items.push(box, label, desc, buyLabel);
    });

    const back = this.add
      .rectangle(360, 1205, 420, 78, 0x4c6a2e)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const backT = this.add
      .text(360, 1205, 'Назад в меню', { fontSize: '25px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    items.push(back, backT);

    this.overlay = items;
    const closeAll = () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    };
    back.on('pointerdown', () => {
      closeAll();
      this.openMenuModal();
    });
  }

  private openSettingsModal() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x0b0f0e, 0.97).setInteractive().setDepth(100);
    const title = this.add
      .text(360, 60, 'НАСТРОЙКИ', { fontSize: '30px', fontStyle: 'bold', color: '#ffe9a8' })
      .setOrigin(0.5)
      .setDepth(101);
    const items: Phaser.GameObjects.GameObject[] = [bg, title];

    const closeAll = () => {
      for (const o of this.overlay) o.destroy();
      this.overlay = [];
    };

    const hcBtn = this.add
      .rectangle(360, 220, 640, 96, this.meta.hardcore ? 0x6a2222 : 0x243028)
      .setStrokeStyle(2, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const hcTxt = this.add
      .text(
        360,
        220,
        `Режим «Хардкор без гаджетов»: ${this.meta.hardcore ? 'ВКЛЮЧЁН 💀' : 'ВЫКЛЮЧЕН'}\n(отключает платные кнопки за 💎 в бою)`,
        { fontSize: '20px', fontStyle: 'bold', color: '#fff', align: 'center' },
      )
      .setOrigin(0.5)
      .setDepth(102);
    hcBtn.on('pointerdown', () => {
      this.meta.hardcore = !this.meta.hardcore;
      saveMeta(this.meta);
      closeAll();
      this.refresh();
      this.openSettingsModal();
    });

    const restartBtn = this.add
      .rectangle(360, 355, 640, 84, 0x5c3a22)
      .setStrokeStyle(2, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const restartTxt = this.add
      .text(360, 355, 'Перезапустить текущую арену с 1-й волны', { fontSize: '22px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    restartBtn.on('pointerdown', () => {
      closeAll();
      this.newGame();
    });

    const resetAllBtn = this.add
      .rectangle(360, 475, 640, 84, 0x6a2020)
      .setStrokeStyle(2, 0xf0a0a0)
      .setInteractive()
      .setDepth(101);
    const resetAllTxt = this.add
      .text(360, 475, 'Сбросить прогресс кампании (звёзды и карты)', { fontSize: '21px', fontStyle: 'bold', color: '#ffd0d0' })
      .setOrigin(0.5)
      .setDepth(102);
    resetAllBtn.on('pointerdown', () => {
      this.meta = { stars: {}, hardcoreCleared: [], cores: 3, upgrades: {}, currentLevel: LEVELS[0].id, hardcore: false };
      saveMeta(this.meta);
      closeAll();
      this.newGame(LEVELS[0].id);
    });

    const back = this.add
      .rectangle(360, 1205, 420, 78, 0x4c6a2e)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const backT = this.add
      .text(360, 1205, 'Назад в меню', { fontSize: '25px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    back.on('pointerdown', () => {
      closeAll();
      this.openMenuModal();
    });

    items.push(hcBtn, hcTxt, restartBtn, restartTxt, resetAllBtn, resetAllTxt, back, backT);
    this.overlay = items;
  }

  private openBestiary() {
    if (this.overlay.length) return;
    const bg = this.add.rectangle(360, 640, 720, 1280, 0x0b0f0b, 0.96).setInteractive().setDepth(100);
    const lines: string[] = ['БАЗОВЫЕ ВИДЫ (по летающим дронам попадают только [ПВО])'];
    for (const sp of D.SPECIES) {
      const aa = D.BASE[sp].antiAir ? ' [ПВО ✈️]' : '';
      lines.push(`• ${D.BASE[sp].name}${aa}: ${D.BASE[sp].desc.toLowerCase()}`);
    }
    lines.push('', `СЕКРЕТНЫЕ ГИБРИДЫ (${this.bestiary.size}/${D.HYBRIDS.length}, +1💎 за открытие)`);
    for (const h of D.HYBRIDS) {
      const aa = h.stats.antiAir ? ' [ПВО ✈️]' : '';
      if (this.bestiary.has(h.id)) lines.push(`• ${h.stats.name}${aa} = ${D.parentsText(h)}`);
      else lines.push(`• ??? (родителей: ${h.parents.length})`);
    }
    lines.push(
      '',
      'ПРАВИЛА ЛАБОРАТОРИИ',
      '• Одинаковые вид и возраст: 2–3 родителя дают +1 к возрасту, 4 родителя дают +2.',
      '• В фазе стройки можно бесплатно убрать случайно поставленную клетку или снести старый железный блок.',
      '• Враги бегут через Терминалы T1→T2→T3 к Суперкомпьютеру [ПК]. Летающие дроны летят напрямую над стенами!',
    );
    const textTop = 40;
    const viewH = 1100;
    const text = this.add
      .text(30, textTop, lines.join('\n'), {
        fontSize: '21px',
        color: '#e8e0c8',
        wordWrap: { width: 660 },
        lineSpacing: 5,
      })
      .setDepth(101);
    const maskG = this.make.graphics({});
    maskG.fillStyle(0xffffff).fillRect(0, textTop, 720, viewH);
    const mask = maskG.createGeometryMask();
    text.setMask(mask);

    const minY = Math.min(textTop, textTop + viewH - text.height);
    let dragStartY = 0;
    let textStartY = textTop;
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragStartY = p.y;
      textStartY = text.y;
    });
    const onMove = (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      text.y = Phaser.Math.Clamp(textStartY + (p.y - dragStartY), minY, textTop);
    };
    const onWheel = (_p: Phaser.Input.Pointer, _go: unknown, _dx: number, dy: number) => {
      text.y = Phaser.Math.Clamp(text.y - dy * 0.5, minY, textTop);
    };
    this.input.on('pointermove', onMove);
    this.input.on('wheel', onWheel);

    const close = this.add
      .rectangle(200, 1210, 340, 80, 0x4c6a2e)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const closeT = this.add
      .text(200, 1210, 'Закрыть', { fontSize: '26px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    const reset = this.add
      .rectangle(545, 1210, 290, 80, 0x6a2a2a)
      .setStrokeStyle(3, 0xf0e0a0)
      .setInteractive()
      .setDepth(101);
    const resetT = this.add
      .text(545, 1210, 'Новая игра', { fontSize: '26px', fontStyle: 'bold', color: '#fff' })
      .setOrigin(0.5)
      .setDepth(102);
    this.overlay = [bg, text, maskG, close, closeT, reset, resetT];
    const closeAll = () => {
      this.input.off('pointermove', onMove);
      this.input.off('wheel', onWheel);
      mask.destroy();
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
  /** Ground layer: tiles, cable path, cell highlights. Redrawn on state changes. */
  private drawBoard() {
    const g = this.boardG;
    g.clear();
    // Draw dark arena border behind each playable cell so custom arena shapes stand out
    g.fillStyle(0x111a14);
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.isVoid(x, y)) continue;
        g.fillRect(this.gridX + x * D.CELL_W - 5, this.gridY + y * D.CELL_H - 5, D.CELL_W + 10, D.CELL_H + 10);
      }
    }
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.isVoid(x, y)) continue;
        g.fillStyle((x + y) % 2 ? 0x26342c : 0x223028);
        g.fillRect(this.gridX + x * D.CELL_W, this.gridY + y * D.CELL_H, D.CELL_W, D.CELL_H);
      }
    }

    // Ground data cable path between terminals
    g.lineStyle(12, 0x3b685c, 0.55);
    g.beginPath();
    this.path.forEach((p, i) => {
      const c = this.center(p);
      if (i === 0) g.moveTo(c.x, c.y);
      else g.lineTo(c.x, c.y);
    });
    g.strokePath();

    this.drawMaze(g);
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
      if (t >= KILL_MS + SEAL_MS) return R.sealedBlock(g, o.x, o.y, 1, u.pillar);
      const kind: R.KillKind = u.killKind ?? 'blade';
      const k = Phaser.Math.Clamp(t / KILL_MS, 0, 1);
      const hurtColors: Record<R.KillKind, number> = {
        blade: 0xff1820,
        fire: 0xff6810,
        acid: 0x40ff50,
        tesla: 0x80f0ff,
      };
      // Wait in cage until this unit's staggered execution turn starts (t < 0), then execute (0..KILL_MS), then seal
      R.cageFloor(g, o.x, o.y, u.sp && t < KILL_MS ? D.BASE[u.sp].color : undefined, kind, k);
      R.cageBack(g, o.x, o.y, 0x8a8f96);
      if (t < KILL_MS && u.sp) {
        const shrink = kind === 'acid' || kind === 'fire' ? 1 - 0.78 * k : 1 - 0.55 * k;
        const r = this.monsterRadius(u.level ?? 0) * shrink;
        R.creature(g, cx, foot, r, D.BASE[u.sp].color, { hurt: k, hurtColor: hurtColors[kind] });
      }
      R.cageFront(g, o.x, o.y, 0x8a8f96);
      if (t >= 0 && t < KILL_MS) R.killEffect(g, o.x, o.y, kind, k);
      else if (t >= KILL_MS) R.sealedBlock(g, o.x, o.y, (t - KILL_MS) / SEAL_MS, u.pillar);
      return;
    }

    const hybrid = u.kind === 'hybrid';
    const s = this.stats(u);
    const frame = hybrid ? 0xd9b13b : 0x9aa0a8;
    R.cageFloor(g, o.x, o.y, hybrid ? s.color : D.BASE[u.sp!].color);
    R.cageBack(g, o.x, o.y, frame);
    if (hybrid) R.creature(g, cx, foot, 12, s.color, { spikes: true });
    else R.creature(g, cx, foot, this.monsterRadius(u.level!), D.BASE[u.sp!].color);
    R.cageFront(g, o.x, o.y, frame, hybrid ? -1 : u.level!, !!s.antiAir);
  }

  private monsterRadius(level: number) {
    return D.CELL_W * (0.22 + 0.03 * level);
  }

  /** Object layer: terminals, mainframe, cages and enemies sorted by depth, then shots and HP bars on top. */
  private drawDynamic() {
    const g = this.dynG;
    g.clear();
    const now = this.time.now;

    const items: { y: number; draw: () => void }[] = [];

    // Waypoints: S = Spawn Breach, 1..N-1 = Code Terminals, Last = Supercomputer Mainframe
    this.level.waypoints.forEach((w, i) => {
      const o = this.origin(w);
      items.push({
        y: o.y + D.CELL_H - 2,
        draw: () => {
          if (i === 0) R.spawnBreach(g, o.x, o.y, now);
          else if (i === this.level.waypoints.length - 1) R.mainframeCore(g, o.x, o.y, now);
          else R.terminalNode(g, o.x, o.y, i, now);
        },
      });
    });

    for (const row of this.grid)
      for (const u of row) {
        if (!u) continue;
        items.push({ y: this.origin(u).y + D.CELL_H, draw: () => this.drawUnit(g, u, now) });
      }
    for (const e of this.battle.enemies) {
      const p = this.toPx(e.fx, e.fy);
      const foot = p.y + 6;
      items.push({
        y: foot + (e.def.flying ? 14 : 0),
        draw: () => {
          const r = this.enemyRadius(e);
          R.enemyBody(g, p.x, foot, r, e.def.color, {
            flying: e.def.flying,
            regen: e.def.regen > 0,
            split: !!e.def.splitInto,
            now,
          });
          const hover = e.def.flying ? 20 + Math.sin(now * 0.012 + p.x) * 2.5 : 3;
          const cy = foot - r - hover;
          if (e.def.armor > 0) g.lineStyle(3, 0xc8d0d8).strokeCircle(p.x, cy, r);
          if (this.battle.clock < e.slowUntil) g.lineStyle(3, 0x6fa8ff).strokeCircle(p.x, cy, r + 2);
          if (this.battle.clock < e.poisonUntil) g.lineStyle(2, 0x40e070).strokeCircle(p.x, cy, r + 5);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    for (const s of this.battle.shots) {
      g.fillStyle(0x000000, 0.4).fillCircle(s.x + 1, s.y + 2, 5);
      g.fillStyle(s.stats.color).fillCircle(s.x, s.y, 5);
    }

    // HP bars always on top so enemies stay readable behind cages
    for (const e of this.battle.enemies) {
      const p = this.toPx(e.fx, e.fy);
      const r = this.enemyRadius(e);
      const w = r * 2 + 8;
      const hover = e.def.flying ? 20 : 3;
      const y = p.y + 6 - 2 * r - hover - 11;
      g.fillStyle(0x000000).fillRect(p.x - w / 2 - 1, y - 1, w + 2, 7);
      g.fillStyle(e.def.flying ? 0x70e8ff : 0x7cff6a).fillRect(p.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 5);
    }

    const focusUnit = this.hovered ?? (this.selected && this.selected.kind !== 'sealed' ? this.selected : null);
    if (focusUnit && focusUnit.kind !== 'sealed') {
      const c = this.center(focusUnit);
      const s = this.stats(focusUnit);
      const rx = s.range * D.CELL_W;
      const ry = s.range * D.CELL_H;
      g.fillStyle(0xffffff, 0.07).fillEllipse(c.x, c.y, rx * 2, ry * 2);
      g.lineStyle(2, 0xffffff, 0.75).strokeEllipse(c.x, c.y, rx * 2, ry * 2);
    }
  }

  private enemyRadius(e: Enemy) {
    return e.def.size;
  }
}
