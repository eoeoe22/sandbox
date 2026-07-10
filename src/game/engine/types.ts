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
  /**
   * Part of the crude-oil / petroleum family (Crude Oil, Gasoline, Kerosene,
   * Diesel). Two purely-data uses: the renderer draws these liquids as a flat
   * single colour instead of sampling the shimmering background tint field (so
   * a slick reads as one solid body — see game/tint.ts), and Water uses it to
   * spot a *burning* petroleum layer floating on it and refuse to boil beneath
   * it — an oil fire on water doesn't flash the water below to Steam (see
   * water.ts / combustion.ts).
   */
  petroleum?: boolean;
  /**
   * Truly indestructible — nothing in the world can remove it: a Blast front is
   * blocked by it, a flying Ember shatters on it, Antimatter skips it, a Void
   * can't swallow it, and even a critical uranium's Heat Ray bounces off it
   * (the one thing that pierces blast-proof Diamond). Unlike `isWall` it isn't
   * the container boundary, so it stays an ordinary placeable solid the brush
   * treats normally — it just can't be destroyed by any in-world force (Clone).
   * The only ways to clear it are the eraser brush and a full clear.
   */
  indestructible?: boolean;
  /**
   * Cold-side phase change for an ordinary (non-molten) liquid: below `temp`
   * the liquid "freezes in place" — it stops flowing and acts solid (denser
   * material can no longer sink through it) and the renderer frosts its colour,
   * without swapping to a separate material. Warmed back above `temp` it flows
   * again. Read by SimContext.isFrozen (movement/displacement) and the renderer
   * (frost tint). Water keeps its own richer Snow/Ice freeze instead; the molten
   * liquids have their own high-temperature set points, so neither declares this.
   */
  freeze?: { temp: number };
  /** Marks the indestructible boundary material, distinct from ordinary Solids for the brush overwrite gate (see PointerPainter.ts). */
  isWall?: boolean;
  /**
   * Survives every explosive force: a Blast front is stopped by it (casting a
   * shadow over what's behind), a flying Ember shatters on contact instead of
   * smashing it, and Antimatter annihilation skips over it (see
   * blast.ts/ember.ts/antimatter.ts), exactly like the Wall. Unlike `isWall`
   * though, it isn't the container boundary — it's an ordinary placeable solid
   * (Diamond) that just happens to be blast-proof. Combined with never declaring
   * a temperature reaction, it makes a material effectively indestructible by
   * heat/cold/explosion while still conducting heat. The single exception: a
   * critical uranium's Heat Ray (heatray.ts) smashes through it — only
   * `isWall` stops that.
   */
  explosionProof?: boolean;
  /**
   * Marks a material that detonates rather than merely burning. When one is
   * triggered, `detonate` (blast.ts) surveys the whole *connected mass* of
   * explosive cells and sets it off as a single crater whose reach scales with
   * the mass's total yield — so a chamber packed solid goes off far bigger than
   * one merely lined. Separate charges just out of range are set off a tick later
   * by the flash/fire the blast leaves touching them (gunpowder.ts/nitro.ts).
   */
  explosive?: boolean;
  /**
   * Blast reach (in cells) a *lone* charge of this material detonates with, and —
   * unless `blastYield` overrides it — the yield each cell contributes to a
   * connected mass's total (see `surveyMass`/`computeReach` in blast.ts). A single
   * charge reaches exactly this radius; stacking more explosive sums their yields
   * into a larger reach. Only meaningful alongside `explosive`.
   */
  blastRadius?: number;
  /**
   * How much this explosive contributes to the total yield of a connected mass
   * (see `surveyMass`/`computeReach` in blast.ts). A detonation sums this over
   * the whole connected mass and turns it into the blast's reach, so more packed
   * explosive means a bigger crater. Defaults to `blastRadius` when omitted — so
   * no material need set it, and a lone charge still reaches its own radius. Set
   * it only to decouple "how far a single charge reaches" from "how much a cell
   * adds to a big pile" (e.g. a small-but-potent charge). Only meaningful
   * alongside `explosive`.
   */
  blastYield?: number;
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
  /**
   * Per-particle color variation: how far (in 0..255 channel units) each
   * individual cell's brightness is nudged from the base `color`, so a body of
   * this material reads as a grainy/shimmering mass of slightly different shades
   * instead of a flat slab. Omit to inherit a sensible default by phase (powders
   * and liquids vary, everything else stays flat); set `0` to force a material
   * flat. Powders re-roll their tint only while moving; liquids drift it slowly
   * even at rest. Ignored for `glow` materials (they're shaded by temperature
   * instead). See game/tint.ts and the renderer/Simulation.
   */
  colorVary?: number;
  /** Per-cell update rule. Resolved by the registry from `phase` when omitted. */
  update?: (x: number, y: number, sim: SimContext) => void;
}

/** The Empty (background) material id. Always 0. */
export const EMPTY: MatId = 0;
