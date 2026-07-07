// Shared neighbor-offset tables for materials that scan around themselves
// (dissolving, igniting, corroding, growing). Kept separate from behaviors.ts,
// which is specifically the phase-default update functions.

export const DIR4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export const DIR8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
