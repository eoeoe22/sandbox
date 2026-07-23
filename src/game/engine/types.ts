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
  /**
   * Electric-appliance sink: a hook fired when a live electric pulse reaches a
   * cell of this material — whether from a power source in *direct contact*
   * (Battery/LFP Battery `injectPulses`, Turbine `energizeNeighbors`) or from a
   * Spark relayed down a wire (spark.ts arc phase). It's the one-way
   * "outside → inside" counterpart to `conductive`: the material never becomes
   * or relays a Spark (so it can't act as a free wire), it just *consumes* the
   * pulse and reacts — e.g. the Fan refreshes its blow countdown, the Woofer
   * thumps out a shockwave. Both flood their whole connected body from the
   * touched face, so the hook takes the touched cell (x,y) and is expected to
   * memoize per tick itself (see fan.ts/woofer.ts).
   *
   * This is the single registration point that keeps every pulse *source*
   * consistent: sources dispatch a non-conductive neighbor through the shared
   * `reactToPulse` (spark.ts), which fires this hook if present and otherwise
   * falls through to the explosive arc. A new electric-reaction device is wired
   * up everywhere at once just by declaring `directPulse` here — no power source
   * needs to special-case it by id (the copy-paste that used to drift, so a
   * device worked off a Battery but not a Turbine).
   */
  directPulse?: (sim: SimContext, x: number, y: number) => void;
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
   * This explosive is set off *directly* by an electric arc: when a Spark reaches
   * a `conductive` neighbor of it, the spark detonates it on the spot (see
   * spark.ts) instead of the usual trick of dropping a lick of Fire beside it for
   * the charge's own flame-trigger to catch. That fire hand-off is scan-order
   * dependent and needs an open cell next to the charge — so it fails silently for
   * a charge (C4) that only detonates on a shock/spark and is packed flush against
   * a wall. Marking it here makes the electric detonator deterministic and
   * position-independent. Only meaningful alongside `explosive`.
   */
  electricDetonate?: boolean;
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
   * Destructive power (파괴력) — *whether* this blast can break a material, a
   * scalar independent of reach and heat. Compared against each reached
   * material's `durability` (see blast.ts): power ≥ durability destroys the cell
   * (the ordinary crater); power < durability can't break it, so a weak blast
   * instead *shoves* loose powder/liquid/gas aside (as Debris) and is shadowed by
   * a solid it can't crack. Omitted ⇒ effectively unlimited, so ordinary
   * explosives level everything as before; a low value makes a "concussion"-style
   * charge (Gunpowder). For a connected mass the strongest cell's power wins. Only
   * meaningful alongside `explosive`.
   */
  destructivePower?: number;
  /**
   * Durability (내구력) — how hard this material is to *destroy* by a blast,
   * compared against the blast's `destructivePower` (see blast.ts). A blast whose
   * power falls below this can't break the material: loose matter is flung aside
   * instead, a solid survives and shadows the blast behind it. Omitted ⇒ a
   * phase default (gas < liquid < powder ≪ solid), so only a deliberately weak
   * charge is ever stopped; set it to make a specific material unusually tough or
   * fragile.
   */
  durability?: number;
  /**
   * What a cell of this material leaves behind when a blast destroys it, instead
   * of the usual shockwave flash that fades to Fire/Empty (see defaultCell in
   * blast.ts). A material that should drop *residue* when caught in a crater —
   * a Termite crushed to Sawdust, a Nanobot shattered to Metal Powder — sets this
   * so the residue appears even at the epicenter, not just for the rim cells its
   * own `update` can catch via an adjacent Blast cell. Omitted ⇒ the ordinary
   * flash. Only consulted on the destroy path (power ≥ durability); a blast too
   * weak to break the material never reaches it, so a Woofer's power-0 shockwave
   * (which can't beat any solid's durability) never triggers this — the same
   * "Woofer excluded" property the adjacent-Blast check relies on.
   */
  blastDeathId?: MatId;
  /**
   * What a *fragile* solid crazes into when a blast's shock washes over it but
   * can't otherwise break it (power < durability) — Glass shattering into Broken
   * Glass under a Gunpowder concussion or a Woofer's power-0 shockwave (see
   * blast.ts). Unlike `blastDeathId` (the destroy path), this is the *can't
   * break* path: the cell still SHADOWS the blast exactly as the intact solid did
   * (a shattered pane is no window), it just leaves the shattered material behind
   * instead of shrugging the shock off untouched. Consulted both by the crater
   * flood (where a weak blast is blocked by the solid) and by the non-destructive
   * pressure wave (충격파 압력전파) that rings out past the crater — so a shockwave
   * shatters glass whether it reaches it as the blast front or as the concussion.
   * Omitted ⇒ the solid is unaffected when a blast can't break it (the classic
   * shadow). Only meaningful on a solid.
   */
  shatterId?: MatId;
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
   * `temp` on this material holds packed non-thermal bookkeeping (flight
   * velocity/life for Ember/Debris/Bomblet/Napalm Gel/Heat Ray, flash life for
   * Blast — see ballistic.ts), not a real degree reading. `conductivity: 0` alone
   * only stops the heat pass from touching it; it doesn't stop other code from
   * misreading the packed number as an actual temperature. So any consumer that
   * wants a genuine ambient reading — as opposed to the material's own `update`,
   * which reads its packed state back on purpose — must skip a cell whose material
   * sets this. Current consumers that do: the free-object heat-exposure scan
   * (engine/objects.ts scanBodyExposure), the 돋보기 inspect readout
   * (engine/brushTools.ts inspectCells), and the heat-overlay thermal camera
   * (render/CanvasRenderer.ts). This flag supersedes the older `conductivity === 0`
   * proxy some code (heatray.ts scorch) used for the same "packed, not real" test.
   */
  packedTemp?: boolean;
  /**
   * For a `packedTemp` material only: the fixed apparent temperature (°) the
   * heat-overlay thermal camera should paint the cell at, since its real `temp`
   * is unusable there (see `packedTemp`). Default (unset) keeps the overlay's
   * old behavior of drawing the cell as background — invisible — which is right
   * for a fragment whose own color already reads fine (Ember, Debris) but hides
   * a Heat Ray beam whose entire point is to look ultra-hot. Ignored for any
   * material that isn't `packedTemp`.
   */
  overlayTemp?: number;
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
  /**
   * A porous solid: liquids and gases ignore it entirely (Mesh, Turbine). To
   * powders and solids it's an ordinary blocking Solid — piles rest on it — but
   * a fluid moving into it slips into the cell's 겹침 (overlap) slot
   * (Grid.overlay) and keeps travelling through under its own gravity/buoyancy,
   * one fluid per cell, surfacing in the first empty cell it reaches — so water
   * pours through a mesh floor of any thickness and seeps through a mesh wall
   * until the levels equalize. Read by SimContext (tryMove entry,
   * canHostOverlap); the rest of the engine ignores it.
   */
  porous?: boolean;
  /**
   * 액체 겹침 계수 (liquid-overlap coefficient), 0..1 — for a Powder, the fraction
   * of its grains that may host a 겹침 (overlap) liquid; the rest are "겹침 불가"
   * and block it. A blocked grain doesn't swallow the liquid it sinks through
   * (so the level rises) and doesn't let a soaking/percolating liquid pass (so
   * the flow is impeded) — which is what keeps sand poured into water from
   * overlapping *completely* (no level change, no drag) while still letting the
   * unblocked grains drain water on down through the bed. The split is per-grain
   * and stable: it's read off each grain's fixed `tint` byte, so a given grain
   * is consistently blocking or hosting for its whole life. 1 = every grain
   * hosts (the old full-overlap behavior), 0 = none do (acts like a plain solid
   * bed). Omitted ⇒ POWDER_LIQUID_OVERLAP_DEFAULT (see config.ts). Only read for
   * Powders; Mesh uses its own dark-checkerboard split instead (see SimContext
   * canOverlapAt), and plain porous solids (Turbine) always host.
   */
  liquidOverlap?: number;
  /**
   * Restricts *which* fluid ids may enter this material's 겹침 (overlap) slot at
   * all — a type-level gate checked before `liquidOverlap`'s per-grain
   * coefficient (see SimContext's `canHostOverlap`/`canOverlapAt`). Omitted ⇒
   * any fluid whose phase matches the general host rule (Powder hosts Liquid,
   * `porous` hosts Liquid/Gas) may attempt to overlap. Set this when a host
   * should soak up *some* fluids invisibly but must keep others as ordinary
   * primary neighbor cells — e.g. Ammonium Nitrate soaks up Diesel/Kerosene
   * (ANFO) but must NOT let Water disappear into its overlap slot, since the
   * cold-pack dissolve reaction and the wet/misfire check both only see fluids
   * that are still primary cells (see ammoniumnitrate.ts).
   */
  overlapFluids?: readonly number[];
  /**
   * A second packed color woven through the base `color` as a positional
   * checkerboard, so the material reads as a grid/lattice screen rather than a
   * flat slab (Mesh). Cells where `(x ^ y)` is odd draw this color, the rest draw
   * the base — a cheap, position-tied two-tone weave the renderer applies before
   * any tint/glow. Purely a rendering hint; the simulation never reads it. Omit
   * for an ordinary flat material. (A material tagged `arrow` reuses this as the
   * chevron color instead of a checkerboard.)
   */
  lattice?: number;
  /**
   * Draw a directional chevron (in the `lattice` color, over the base `color`)
   * whose direction is read from the cell's `aux` byte — 2 points left, anything
   * else points right. The Conveyor uses it so a belt visibly shows which way it
   * runs (좌우 화살표). Takes precedence over a plain `lattice` weave in the
   * renderer; purely a rendering hint the simulation never reads. Omit for an
   * ordinary material.
   */
  arrow?: boolean;
  /**
   * Draw a 4-directional chevron (in the `lattice` color, over the base `color`)
   * pointing the way the cell's `aux` byte says it blows — the low 2 bits are the
   * direction (0 up / 1 down / 2 left / 3 right, see materials/fan.ts) and the
   * rest a powered countdown, so the chevron brightens while the fan is running.
   * The Fan uses it so which way a fan blows (and whether it's powered) reads at a
   * glance. Like `arrow`, purely a rendering hint the simulation never reads; omit
   * for an ordinary material.
   */
  windArrow?: boolean;
  /**
   * Render this cell using the *carried* material named by its `aux` byte, not
   * this material's own `color`. Debris sets it: a flying fragment carries its
   * origin material's id in `aux`, so shoved water draws blue and shoved sand
   * draws tan instead of everything reading as one dull Debris grey. Purely a
   * rendering hint — the simulation still treats the cell as this material.
   */
  renderAsAux?: boolean;
  /**
   * 점도 (viscosity), 0..1 — for a Liquid, the per-tick chance it *resists*
   * spreading sideways to level out, so a thick liquid holds a slumping mound
   * before it slowly flattens. It never blocks straight-down fall (a viscous blob
   * still drops under gravity — 점성 흐름 개선), only the lateral leveling and
   * diagonal creep, so honey/mud/slime ooze instead of racing flat like water.
   * 0 (or omitted) ⇒ frictionless flow (Water). Read by updateLiquid; ignored for
   * non-liquids. Replaces the old per-material `chance(FLOW)` throttle.
   */
  viscosity?: number;
  /**
   * 마찰·안식각 (friction / angle of repose), 0..1 — for a Powder, the per-tick
   * chance a grain *grips* instead of tumbling diagonally off a slope, so a
   * higher value piles steeper (a taller angle of repose). It never blocks
   * straight-down fall, only the diagonal slide, so grains still settle but hold
   * a sharper cone. 0 (or omitted) ⇒ the loosest pile (grains always slide).
   * Read by fallAndPile (engine/behaviors.ts), the shared fall/pile step under
   * both updatePowder and updatePowderSink; ignored for non-powders and
   * unrelated to buoyant rise (tryBuoyantRise deliberately doesn't gate on it
   * — see its own comment for why).
   */
  friction?: number;
  /**
   * 탄성 (elasticity / coefficient of restitution), 0..1 — how much speed a
   * ballistic fragment of this material keeps when it ricochets off a solid
   * (see debris.ts / the explosion pressure wave). 1 = a perfectly bouncy grain
   * that ping-pongs around for its whole flight; low = a dead thud that settles
   * on first impact. Omitted ⇒ a middling default restitution (DEBRIS_RESTITUTION),
   * so existing ejecta are unchanged; set it high for a springy material (Slime)
   * or low for something that lands flat. Only read while the material is airborne
   * as blast/pressure debris — a resting cell has no velocity to bounce.
   */
  elasticity?: number;
  /**
   * 표면장력 (surface tension), 0..1 — for a Liquid, the per-tick chance a
   * poorly-connected (edge/straggler) cell pulls itself toward wherever it would
   * touch more of its own kind, so droplets round up and thin films pinch off
   * into beads instead of smearing flat. Only cells with few same-material
   * neighbors move (the bulk of a pool is left to flow normally), and a cell only
   * ever moves to *gain* contact, so it converges rather than jittering. 0 (or
   * omitted) ⇒ no cohesion. Read by updateLiquid; ignored for non-liquids.
   */
  surfaceTension?: number;
  /**
   * 파티클 수명 (generalized lifetime): the cell has a finite life and, each tick,
   * decays with probability ≈ 1/`ticks` into `into` (default Empty) — the
   * memoryless model Smoke always used, lifted to a tag so any ephemeral particle
   * (a puff, a spark, a transient reaction product) expires the same way without
   * its own countdown code. Stateless (no `aux` used), so it never collides with
   * a material's own aux state. The engine applies it before the material's
   * `update`; a cell that decays this tick skips its update. Omit for a permanent
   * material.
   */
  life?: { ticks: number; into?: MatId };
  /**
   * Declarative contact reactions (see ReactionRule / engine/reactions.ts). The
   * engine runs a single contact pass each tick before this material's `update`:
   * a cell that reacts is transformed and marked moved (so it skips its own update
   * that tick). Omit for a material with no simple 2-body reactions; complex
   * multi-stage behavior still lives in `update`.
   */
  reactions?: ReactionRule[];
  /** Per-cell update rule. Resolved by the registry from `phase` when omitted. */
  update?: (x: number, y: number, sim: SimContext) => void;
}

/**
 * A single declarative contact-reaction rule (see engine/reactions.ts). Attached
 * to a material via `Material.reactions`, it describes a simple two-body
 * substitution "when a cell of this material touches a cell of `with`, they
 * become something else" — the same scan-order-independent, moved-guarded
 * discipline the `flammable`/`conductive` tags use, generalized into data. Only
 * *simple* 2-body swaps live here; multi-stage behaviors (blast survey,
 * distillation, the combustion front) stay in each material's `update`.
 *
 * The rule fires from the cell that *declares* it: when a declaring cell finds a
 * `with` neighbor and all gates pass, `produce` replaces the declaring cell and
 * `otherBecomes` (if set) replaces the neighbor. Both cells are marked moved so
 * neither re-reacts this tick (no double reaction, no scan-order runaway).
 */
export interface ReactionRule {
  /** The neighbor material this cell reacts on contact with (8-neighborhood). */
  with: MatId;
  /** What the *declaring* cell becomes. Omit to leave it unchanged (e.g. a
   *  catalytic surface that only transforms the other cell / emits a byproduct). */
  produce?: MatId;
  /** What the *neighbor* (`with`) cell becomes. Omit to leave it unchanged — used
   *  for a catalyst/surface that isn't consumed, or a one-sided transformation. */
  otherBecomes?: MatId;
  /** Per-tick, per-contact chance the reaction fires (0..1). Omit ⇒ 1 (every
   *  contact). Lower values make a reaction creep forward gradually. */
  probability?: number;
  /** Only react when the declaring cell's temperature is ≥ this (activation heat). */
  tempMin?: number;
  /** Only react when the declaring cell's temperature is ≤ this (a reaction that
   *  stops once things get too hot — e.g. a dissolution that gives way to
   *  decomposition). */
  tempMax?: number;
  /**
   * Heat released (>0, exothermic) or absorbed (<0, endothermic) by the reaction,
   * added to both reacting cells' temperature. This is the knob behind thermal
   * runaway (an exothermic reaction that heats its neighbors into reacting too)
   * and self-cooling (an endothermic one, e.g. an instant cold pack).
   */
  heat?: number;
  /** A gas/particle emitted into an adjacent empty cell when the reaction fires
   *  (O₂ off a decomposition, etc.). Skipped silently if the cell is boxed in. */
  byproduct?: MatId;
  /** If a cell of this id sits in the neighborhood, the reaction runs faster
   *  (probability × `catalystFactor`) without the catalyst being consumed — the
   *  textbook catalyst. Only meaningful alongside `probability` < 1. */
  catalyst?: MatId;
  /** Probability multiplier applied while `catalyst` is present (default 4). */
  catalystFactor?: number;
}

/** The Empty (background) material id. Always 0. */
export const EMPTY: MatId = 0;
