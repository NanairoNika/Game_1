import type { Pt } from './path';

export interface LevelDef {
  id: string;
  title: string;
  scientist: string;
  subtitle: string;
  cols: number;
  rows: number;
  waypoints: Pt[];
  /** Pre-sealed obstacle cells at the start of the level */
  obstacles: Pt[];
  /** Cut-out cells outside the arena shape (cannot place or walk here) */
  voidCells: Pt[];
  /** Node position on the Campaign Map screen (720x1280) */
  mapPos: Pt;
  /** Enemy HP multiplier for this map */
  hpMul: number;
}

function rectVoid(x0: number, y0: number, w: number, h: number): Pt[] {
  const out: Pt[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y });
  return out;
}

function cornersVoid(cols: number, rows: number, rx: number, ry: number): Pt[] {
  return [
    ...rectVoid(0, 0, rx, ry),
    ...rectVoid(cols - rx, 0, rx, ry),
    ...rectVoid(0, rows - ry, rx, ry),
    ...rectVoid(cols - rx, rows - ry, rx, ry),
  ];
}

export const LEVELS: LevelDef[] = [
  {
    id: 'doof',
    title: '1. Пентхаус Фуфелшмерца',
    scientist: 'Д-р Хайнц Фуфелшмерц',
    subtitle: 'Классический полигон 15×20 (поддерживает схемы лабиринтов)',
    cols: 15,
    rows: 20,
    waypoints: [
      { x: 7, y: 0 },
      { x: 1, y: 5 },
      { x: 13, y: 10 },
      { x: 1, y: 15 },
      { x: 7, y: 19 },
    ],
    obstacles: [],
    voidCells: [],
    mapPos: { x: 165, y: 955 },
    hpMul: 1.0,
  },
  {
    id: 'frankenstein',
    title: '2. Склеп Франкенштейна',
    scientist: 'Барон Виктор Франкенштейн',
    subtitle: 'Узкий вытянутый склеп 11×20 со срезанными углами',
    cols: 11,
    rows: 20,
    waypoints: [
      { x: 5, y: 0 },
      { x: 1, y: 5 },
      { x: 9, y: 10 },
      { x: 1, y: 15 },
      { x: 5, y: 19 },
    ],
    obstacles: [
      { x: 5, y: 5 },
      { x: 5, y: 14 },
    ],
    voidCells: cornersVoid(11, 20, 2, 3),
    mapPos: { x: 525, y: 830 },
    hpMul: 1.15,
  },
  {
    id: 'moreau',
    title: '3. Виварий доктора Моро',
    scientist: 'Доктор Моро',
    subtitle: 'Широкая арена 15×16 с боковыми нишами и провалами',
    cols: 15,
    rows: 16,
    waypoints: [
      { x: 7, y: 0 },
      { x: 13, y: 5 },
      { x: 1, y: 5 },
      { x: 7, y: 11 },
      { x: 7, y: 15 },
    ],
    obstacles: [
      { x: 5, y: 8 },
      { x: 9, y: 8 },
    ],
    voidCells: [
      ...rectVoid(0, 7, 2, 3),
      ...rectVoid(13, 7, 2, 3),
      ...rectVoid(0, 0, 2, 2),
      ...rectVoid(13, 0, 2, 2),
    ],
    mapPos: { x: 205, y: 675 },
    hpMul: 1.3,
  },
  {
    id: 'octavius',
    title: '4. Реактор Октавиуса',
    scientist: 'Д-р Отто Октавиус (Doc Ock)',
    subtitle: 'Арена-крест 15×19 вокруг термоядерного ядра',
    cols: 15,
    rows: 19,
    waypoints: [
      { x: 7, y: 0 },
      { x: 13, y: 9 },
      { x: 7, y: 17 },
      { x: 1, y: 9 },
      { x: 7, y: 9 },
    ],
    obstacles: [
      { x: 5, y: 7 },
      { x: 9, y: 7 },
      { x: 5, y: 11 },
      { x: 9, y: 11 },
    ],
    voidCells: cornersVoid(15, 19, 3, 4),
    mapPos: { x: 545, y: 530 },
    hpMul: 1.45,
  },
  {
    id: 'breen',
    title: '5. Цитадель доктора Брина',
    scientist: 'Уоллес Брин',
    subtitle: 'Ступенчатый коридор 13×20 с асимметричными провалами',
    cols: 13,
    rows: 20,
    waypoints: [
      { x: 11, y: 0 },
      { x: 2, y: 4 },
      { x: 10, y: 10 },
      { x: 2, y: 15 },
      { x: 11, y: 19 },
    ],
    obstacles: [
      { x: 6, y: 6 },
      { x: 6, y: 7 },
      { x: 6, y: 12 },
      { x: 6, y: 13 },
    ],
    voidCells: [
      ...rectVoid(0, 0, 4, 3),
      ...rectVoid(9, 6, 4, 3),
      ...rectVoid(0, 10, 3, 3),
      ...rectVoid(0, 17, 4, 3),
    ],
    mapPos: { x: 215, y: 375 },
    hpMul: 1.65,
  },
  {
    id: 'rick',
    title: '6. Гараж Санчеза C-137',
    scientist: 'Рик Санчез',
    subtitle: 'Портальный хаос 15×20 с рваной геометрией',
    cols: 15,
    rows: 20,
    waypoints: [
      { x: 7, y: 0 },
      { x: 7, y: 12 },
      { x: 2, y: 5 },
      { x: 12, y: 5 },
      { x: 7, y: 19 },
    ],
    obstacles: [
      { x: 4, y: 8 },
      { x: 10, y: 8 },
      { x: 4, y: 15 },
      { x: 10, y: 15 },
    ],
    voidCells: [
      ...cornersVoid(15, 20, 2, 2),
      ...rectVoid(0, 9, 2, 3),
      ...rectVoid(13, 9, 2, 3),
    ],
    mapPos: { x: 495, y: 215 },
    hpMul: 1.9,
  },
];

export interface LabUpgradeDef {
  id: 'firewall' | 'grant' | 'overclock' | 'salvage';
  name: string;
  desc: string;
  maxLevel: number;
  /** Cost in stars per level */
  starCost: number[];
}

export const LAB_UPGRADES: LabUpgradeDef[] = [
  {
    id: 'firewall',
    name: 'Брандмауэр Мейнфрейма',
    desc: '+4 к стартовым жизням суперкомпьютера за уровень',
    maxLevel: 3,
    starCost: [1, 2, 3],
  },
  {
    id: 'grant',
    name: 'Чёрная касса лаборатории',
    desc: '+15 золота на старте каждого забега за уровень',
    maxLevel: 3,
    starCost: [1, 2, 3],
  },
  {
    id: 'overclock',
    name: 'Нейро-стимуляторы',
    desc: '+8% к скорости атаки всех монстров и гибридов за уровень',
    maxLevel: 3,
    starCost: [2, 3, 4],
  },
  {
    id: 'salvage',
    name: 'Плазменный резак',
    desc: 'Снос старых железных блоков в фазе стройки дешевле на 5 золота за уровень',
    maxLevel: 3,
    starCost: [1, 2, 2],
  },
];

/** Scientist's notes shown at the start of specific waves (1-based wave number). */
export const WAVE_NOTES: Record<number, { title: string; text: string }> = {
  1: {
    title: 'Запись #1: Вторжение в лабораторию!',
    text: 'Агенты спецслужб прорвали внешний шлюз! Они бегут по очереди к нашим Терминалам [T1 → T2 → T3], чтобы собрать ключи шифрования и слить чертежи с Главного Суперкомпьютера [ПК].\n\nСтавь 5 клеток за раунд: одного монстра оставим, а остальных ликвидируем и закатаем в бронеплиты — пусть плутают по лабиринту!',
  },
  5: {
    title: 'Запись #5: Кибер-директор и первые гибриды',
    text: 'Внимание! К терминалам идёт Кибер-директор. Если он доберётся до суперкомпьютера [ПК], мы потеряем сразу 3 блока данных.\n\nИз дневника селекции: «Если смешать Студня и Шустрика первого возраста, получается отличный Крио-стрелок. А Студень + Жаровик дают липкий Напалм!»',
  },
  6: {
    title: 'Запись #6: Тревога! Воздушные дроны!',
    text: 'Они запустили Дронов-взломщиков! Дроны летят напрямую поверх наших железных стен от терминала к терминалу.\n\nВАЖНО: Из базовых видов по воздушным целям попадают только ДВА монстра — дальнобойный Плевун и многоцелевой Роевик (отмечены значком прицела [ПВО]). Либо выводи гибриды на их основе!',
  },
  8: {
    title: 'Запись #8: Тяжёлая броня',
    text: 'На подходе бронированные Штурмовики. Их пластины гасят обычный урон от ударов, но абсолютно бессильны против токсинов Гнильника и кислотных гибридов (Гнильник + Плевун).',
  },
  9: {
    title: 'Запись #9: Био-чистильщики',
    text: 'Эти мутанты прямо на ходу залечивают раны! Слабые одиночные тычки их даже не поцарапают — концентрируй огонь в одной зоне или трави их ядом.',
  },
  12: {
    title: 'Запись #12: Контейнеровозы',
    text: 'Тяжёлые Контейнеровозы нашпигованы микро-ботами! Когда корпус разрушается, из него прямо посреди маршрута высыпается три быстрых Микро-бота. Держи наготове Жаровиков с уроном по области!',
  },
};
