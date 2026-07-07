import type { SimContext } from './SimContext';

/** A material identifier — an index into the material registry. */
export type MatId = number;

/** Broad behavior category. Drives the default per-cell update and displacement rules. */
export enum Phase {
  Empty,
  Solid,
  Powder,
  Liquid,
  Gas,
}

/**
 * A material definition. Adding a material = create one file that calls
 * `register({...})`. Provide an `update` to override the phase's default
 * behavior; omit it to inherit the default (powders fall, liquids flow, etc.).
 */
export interface Material {
  /** Stable numeric id (0 is reserved for Empty). Also the value stored in the grid. */
  id: MatId;
  /** Human-readable name, shown in the palette. */
  name: string;
  /** Behavior category. */
  phase: Phase;
  /** Packed 0xAABBGGRR color (see render/color.ts). */
  color: number;
  /** Relative density — heavier materials sink through lighter fluids. */
  density: number;
  /** Fire/Lava convert this to Fire on contact (see fire.ts/lava.ts). */
  flammable?: boolean;
  /** Acid never corrodes this (see acid.ts). */
  acidResistant?: boolean;
  /** Marks the indestructible boundary material, distinct from ordinary Solids for the brush overwrite gate (see PointerPainter.ts). */
  isWall?: boolean;
  /** Per-cell update rule. Resolved by the registry from `phase` when omitted. */
  update?: (x: number, y: number, sim: SimContext) => void;
}

/** The Empty (background) material id. Always 0. */
export const EMPTY: MatId = 0;
