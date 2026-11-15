// Minimal Node globals used by tools/sim.ts (avoids adding @types/node).
declare const process: {
  argv: string[];
  exit(code?: number): never;
};
