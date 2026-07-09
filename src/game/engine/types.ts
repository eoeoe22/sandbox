import type { SimContext } from './SimContext';

/** A material identifier — an index into the material registry. */
export type MatId = number;

/**
 * How the sandbox edges behave. `wall` (the default) treats the grid boundary as
 * a solid, indestructible container — nothing can leave, matching the original
 * behavior. `void` opens the edges: any particle that tries to move out of the
 * grid falls out of the world and is removed, so a floorless/wall-less sandbox
 * drains itself. Read by SimContext.tryMove; user-drawn Walls are unaffected.
 */
export type BorderMode = 'wall' | 'void';

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
  /**
   * Palette grouping. The toolbar builds one tab per distinct category in a
   * fixed thematic order (see MaterialPalette). Omit to fall back to a label
   * derived from `phase` — so an untagged material still lands in a sensible
   * default group and the "add material = one file" rule holds. Purely a UI
   * hint; the simulation never reads it.
   */
  category?: string;
  /**
   * Carries an electric charge: a Spark propagates from cell to cell only
   * through `conductive` materials (Metal, Mercury), the same tag-based,
   * scan-order-independent approach `flammable`/`combustible` use. A conductor
   * also uses its per-cell `aux` byte as a post-spark refractory countdown so a
   * pulse travels one way down a wire instead of bouncing back (see spark.ts).
   */
  conductive?: boolean;
  /** Fire/Lava convert this to Fire on contact (see fire.ts/lava.ts). */
  flammable?: boolean;
  /**
   * Marks a fuel that burns via the shared surface-front model (see
   * combustion.ts): Crude Oil, Gasoline, Coal, Wood, Sawdust. A cell already
   * burning uses this tag to tell which of its neighbors are fuel it can light,
   * so the burn creeps from cell to cell through the whole body. Distinct from
   * `flammable`, which hands ignition to Fire's own global-rate pass instead.
   */
  combustible?: boolean;
  /** Acid never corrodes this (see acid.ts). */
  acidResistant?: boolean;
  /** Marks the indestructible boundary material, distinct from ordinary Solids for the brush overwrite gate (see PointerPainter.ts). */
  isWall?: boolean;
  /**
   * Survives every explosive force: a Blast shard, flying Ember, and Antimatter
   * annihilation all pass *around* it instead of destroying it (see
   * blast.ts/ember.ts/antimatter.ts), exactly like the Wall. Unlike `isWall`
   * though, it isn't the container boundary — it's an ordinary placeable solid
   * (Diamond) that just happens to be blast-proof. Combined with never declaring
   * a temperature reaction, it makes a material effectively indestructible by
   * heat/cold/explosion while still conducting heat.
   */
  explosionProof?: boolean;
  /**
   * Marks a material that detonates rather than merely burning. When a Blast
   * front sweeps over one of these it detonates it *in the same pass*, its own
   * `blastRadius` refreshing the front (see blast.ts), so a connected mass of
   * Gunpowder/Nitro goes off all at once instead of being flattened by the first
   * blast to reach it. Separate charges just out of range are set off a tick
   * later by the flash/fire the blast leaves touching them (gunpowder.ts/nitro.ts).
   */
  explosive?: boolean;
  /**
   * Blast radius (in cells) this explosive detonates with. Read by `detonate`
   * (blast.ts) when the shockwave front sweeps over *another* explosive and sets
   * it off within the same tick — its own radius refreshes the front so a
   * connected mass goes off all at once. Each explosive also passes this same
   * value to `detonate` when it's triggered directly. Only meaningful alongside
   * `explosive`.
   */
  blastRadius?: number;
  /**
   * Heat-conduction properties (see config.ts and Simulation's diffusion pass).
   * Pure self-data — no cross-material references — so it never affects the
   * material load order. Temperature-driven *reactions* (Lava freezing to
   * Stone, Water boiling to Steam) live in each material's own `update`, read
   * off `SimContext.getTemp`, matching how every other reaction is expressed.
   * Omit entirely for an inert material: it sits at ambient and conducts at the
   * default rate.
   */
  thermal?: {
    /** Temperature a freshly placed/spawned cell of this material starts at. Default `AMBIENT_TEMP`. */
    init?: number;
    /** How readily heat flows through this material, 0..1. 0 = perfect insulator (air/Empty). Default `DEFAULT_CONDUCTIVITY`. */
    conductivity?: number;
  };
  /**
   * Optional temperature → color ramp for the renderer. The cell is drawn
   * interpolated from `cool` (at temperature `min`) up to the material's base
   * `color` (at `max` and above), so a hot material like Lava visibly darkens
   * as it cools toward setting — making the conduction gradient legible.
   */
  glow?: { min: number; max: number; cool: number };
  /** Per-cell update rule. Resolved by the registry from `phase` when omitted. */
  update?: (x: number, y: number, sim: SimContext) => void;
}

/** The Empty (background) material id. Always 0. */
export const EMPTY: MatId = 0;
