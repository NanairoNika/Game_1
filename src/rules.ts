/**
 * Pure game rules shared by the Phaser scene and the headless balance simulator.
 * No Phaser imports here.
 */
import * as D from './data';

export type Creature = {
  kind: 'mon' | 'hybrid' | 'sealed';
  sp?: D.Species;
  level?: number;
  hybrid?: string;
};

export type CrossResult = { level: number } | { hybrid: D.Hybrid } | null;

export function statsOf(c: Creature): D.Stats {
  if (c.kind === 'hybrid') return D.HYBRIDS.find((h) => h.id === c.hybrid)!.stats;
  return D.speciesStats(c.sp!, c.level!);
}

/** Result of crossing the given parents (first one is the kept creature), or null if nothing happens. */
export function crossResult(parents: Creature[]): CrossResult {
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
      const i = pool.findIndex((p) =>
        need.hybrid
          ? p.kind === 'hybrid' && p.hybrid === need.hybrid
          : p.kind === 'mon' && p.sp === need.sp && p.level === need.level,
      );
      if (i < 0) return false;
      pool.splice(i, 1);
      return true;
    });
    if (ok) return { hybrid: h };
  }
  return null;
}

/** Random age (0-based level) according to the bought «breed chance» tier. */
export function rollLevel(chance: number, rng: () => number = Math.random): number {
  const odds = D.QUALITY_ODDS[chance];
  let r = rng();
  for (let i = 0; i < odds.length; i++) {
    r -= odds[i];
    if (r < 0) return i;
  }
  return 0;
}

export function randomSpecies(rng: () => number = Math.random): D.Species {
  return D.SPECIES[Math.floor(rng() * D.SPECIES.length)];
}

/** Rough single-number strength estimate used by the simulator bots. */
export function power(s: D.Stats): number {
  const hit = s.dmg * s.rate * (s.targets ?? 1) * (1 + (s.crit ?? 0));
  const splash = s.splash ? 1 + s.splash * 0.6 : 1;
  const poison = (s.poison ?? 0) * 1.5;
  const slow = 1 + (s.slow ?? 0) * 0.8;
  const aura = 1 + (s.aura ?? 0) * 2;
  return (hit * splash + poison) * slow * aura * (0.6 + s.range * 0.15);
}
