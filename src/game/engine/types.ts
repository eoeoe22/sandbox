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
   * 피복 전선 — a `conductive` material whose insulation keeps the current *in*.
   * A Spark travelling on this conductor only ever hands the pulse on to another
   * cell of the SAME material; it never energizes a bare conductor beside it
   * (Water, Iron, brine, …), so a cable can be run straight through a puddle or
   * bolted onto a steel wall without electrifying it. What it still does deliver
   * to is the thing at the end of the run: an appliance (`directPulse`) or an
   * explosive charge, both of which are one-way sinks that consume the pulse
   * rather than spreading it (전선 → 장치). The gate is deliberately one-way:
   * current may flow *into* the wire from a bare conductor or a battery terminal
   * (that's how you feed it), it just can't flow back out into one. Read only by
   * spark.ts's hand-off; omitted ⇒ an ordinary bare conductor that energizes
   * every conductive neighbor.
   */
  insulated?: boolean;
  /**
   * 배선재 — a `conductive` material that counts as *proper wiring*: a cable
   * (Wire) or a metal (Iron, Mercury, Gallium, Liquid Gallium, Nichrome,
   * Aluminum). Nothing about how a pulse propagates reads this; it's what a
   * *source* checks when it only wants to feed wiring rather than whatever it
   * happens to be sitting in — the Turbine's `'wiring'` emission gate (see
   * spark.ts's PulseGate), which is how a turbine standing in its own boiler
   * stops electrifying the condensate around it.
   *
   * Wiring is by definition zero-loss (spark.ts asserts that at load: a `wiring`
   * conductor whose CONDUCTOR_LOSS isn't 0 throws), but the converse is
   * deliberately NOT true — Acid Slime conducts at zero loss and is still not
   * wiring, because "무손실"과 "배선" 은 다른 질문이다. That's exactly why this is
   * a declared tag instead of a `loss === 0` test.
   */
  wiring?: boolean;
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
  /**
   * 광전 효과 — a hook fired when a Heat Ray beam *strikes* a cell of this
   * material (see heatray.ts). It is the light-side mirror of `directPulse`: the
   * beam is absorbed by the cell (it neither reflects nor passes on) and, crucially,
   * deposits NO heat — the material converts the light instead of soaking it, which
   * is what lets a Solar Panel sit in a laser without cooking. What the hook does
   * with it is the material's business; the panel pulses its adjacent conductors.
   * Checked before the ordinary opaque-solid absorption, so declaring it alone is
   * enough to opt a material out of beam heating. Omitted ⇒ the beam heats the cell
   * as usual.
   */
  lightPulse?: (sim: SimContext, x: number, y: number) => void;
  /**
   * 자성 — ferromagnetic matter a powered Electromagnet's field pulls toward
   * itself (see materials/electromagnet.ts). A pure data tag: the magnet reads it
   * and nothing else does, so a new attractable material is added by setting this
   * alone.
   *
   * Only tag matter that is genuinely *loose* — a powder (Iron Powder, Rust
   * Powder, Iron Ore) or a `shockLoose` crawler (Nanobot). Structural solids
   * (Iron, Rust) are deliberately NOT tagged even though real iron is magnetic:
   * dragging a fixed structure around would walk a player's wiring, machines and
   * walls off their mounts, the same reason the Fan's gust refuses to push solids
   * (see fan.ts `isWindPushable`). Molten Iron isn't tagged either — above the
   * Curie point iron isn't ferromagnetic, so the one liquid that might qualify
   * has a real excuse not to. The magnet enforces this too (it only ever moves
   * loose matter), so a mistagged wall stays put rather than tearing apart.
   */
  magnetic?: boolean;
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
  /** No corroder ever eats this — Acid, Acid Vapor and Acid Slime all read this
   *  one flag through the shared pass in materials/corrosion.ts. */
  acidResistant?: boolean;
  /**
   * 산에 녹으면서 수소를 내놓는 금속 — a metal *above hydrogen in the reactivity
   * series* (이온화 경향이 수소보다 큰 금속: Al·U·Fe·Ga…). The shared corrosion pass
   * (materials/corrosion.ts) reads this: instead of blinking the cell out silently,
   * the acid cell
   * doing the eating *becomes* a hydrogen bubble, so the fizz is visible and the
   * two are consumed 1:1. Omit for anything that dissolves without giving off
   * hydrogen — the metals *below* hydrogen (Copper/Wire, Mercury), oxides and
   * carbonates (Rust, Iron Ore, Limestone), and every non-metal.
   *
   * Sodium is the one deliberate omission at the *top* of the series rather than
   * the bottom: it is violent enough in plain water that a polite stream of cool
   * bubbles would be a downgrade, so it handles acid in its own update instead
   * (flame + hot hydrogen, detonating when packed — see sodium.ts). Adding the
   * tag to it would not be a fix.
   *
   * This is the generalization of what the aluminum line used to do with three
   * copies of the same `reactions` row (see docs/MATERIAL-IDEAS.md's
   * `Material.acidReaction` note): a tag rather than a rule row, so it can't
   * lose the race against acid's own corrosion — the corrosion pass rolls this
   * first, per contact, and only falls through to a silent bite when it misses.
   */
  acidHydrogen?: AcidHydrogen;
  /**
   * 방사선원 — this material continuously irradiates its surroundings. The value
   * is the dose delivered to a cell *one step away*; it falls off as `dose / d`
   * over the emission's reach (see RADIATION_RANGE in engine/radiation.ts). Every
   * material in the 방사능 palette tab declares it, at a strength matching how hot
   * the isotope actually is — spent fuel is far more radioactive than fresh, so
   * Nuke Waste out-doses solid U235 (see materials/nukewaste.ts).
   *
   * The engine drives it, not the material: Simulation flattens this into a
   * per-id table and runs `irradiate` (engine/radiation.ts) on the cell's turn,
   * exactly the way `Material.life` decay is driven. So a new radioactive
   * material becomes lethal by declaring this one number — there is no call to
   * forget in its `update`.
   *
   * The emission floods outward through **anything that isn't a Solid** — air,
   * gas, powder, liquid alike — and is stopped dead by solids. So sand poured
   * over a waste drum shields nothing and a pool carries the dose across itself,
   * while a stone or concrete casing is real shielding. Declaring this also makes
   * the material *opaque to radiation itself* (자기차폐, self-shielding): a pile's
   * interior grains are blocked in every direction, so only its surface emits — a
   * buried grain still probes its eight neighbours each tick but stops there, so
   * the *flood* cost tracks a source's surface rather than its volume.
   */
  radiation?: number;
  /**
   * 피폭사 — what a cell of this (living) material leaves behind when radiation
   * kills it, and one of the two tags that make it *count* as alive: the
   * irradiation flood only ever touches a material declaring this or
   * `radiationHit`. Each living thing dies the way it already dies of everything
   * else — a Termite to Sawdust, Plant/Seed to Ash, Yeast/Virus to nothing
   * (`EMPTY`, which is why this is checked for `undefined` rather than
   * truthiness).
   *
   * Three 생명 tab materials deliberately declare neither this nor
   * `radiationHit`: Nanobot is a machine rather than life, and Slime/Acid Slime
   * are radiation-tolerant extremophiles — between them they're what still works
   * in a hot zone (see materials/nanobot.ts, materials/slime.ts).
   */
  radiationDeath?: MatId;
  /**
   * 피폭 반응 — the imperative alternative to `radiationDeath`, for a living
   * material that maps exposure onto its own damage model instead of dying
   * outright. Called once per irradiating source cell that reaches this cell,
   * with the dose that arrived (already distance-attenuated), and takes
   * precedence over `radiationDeath` when both are somehow present. The
   * light/electric-side hooks `directPulse`/`lightPulse` are the same shape.
   *
   * Coral uses it to feed the dose into its own 백화 stress meter, so an
   * irradiated reef loses its colour over seconds — and visibly stops growing
   * first — instead of blinking into skeleton a cell at a time; Bleached Coral
   * uses it to stamp a short "recently irradiated" countdown that suspends
   * recolonisation, so a skeleton in a hot tank doesn't flicker between polyp
   * and bone (see materials/coral.ts, materials/bleachedcoral.ts).
   */
  radiationHit?: (sim: SimContext, x: number, y: number, dose: number) => void;
  /**
   * A polished, highly-reflective surface that a Heat Ray beam bounces off with a
   * clean specular (정반사) reflection instead of being absorbed — Mercury and the
   * shiny metals (Iron, Heatpipe, Gallium, Liquid Gallium). The Heat Ray walk
   * (heatray.ts) reads this flag alone, so any future high-reflectivity metal just
   * sets `laserReflective: true` to become a laser mirror — no change to the beam
   * code needed. Read only by heatray.ts; the rest of the engine ignores it.
   */
  laserReflective?: boolean;
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
   * Truly indestructible — no *ordinary* force in the world can remove it: a
   * Blast front is blocked by it, a flying Ember shatters on it, a Void can't
   * swallow it, and even a critical uranium's Nuclear Ray bounces off it
   * (the one thing that pierces blast-proof Diamond). The single exception is
   * Antimatter, which annihilates everything but the Wall and the Void — armor
   * and indestructibility alike are no defense against it (antimatter.ts).
   * Unlike `isWall` it isn't
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
   * shadow over what's behind) and a flying Ember shatters on contact instead of
   * smashing it (see blast.ts/ember.ts), exactly like the Wall. Antimatter is
   * the exception it does *not* survive — annihilation ignores armor entirely
   * (antimatter.ts). Unlike `isWall`
   * though, it isn't the container boundary — it's an ordinary placeable solid
   * (Diamond) that just happens to be blast-proof. Combined with never declaring
   * a temperature reaction, it makes a material effectively indestructible by
   * heat/cold/explosion while still conducting heat. The single exception: a
   * critical uranium's Nuclear Ray (heatray.ts) smashes through it — only
   * `isWall` stops that.
   */
  explosionProof?: boolean;
  /**
   * 관통 제트마저 막는 방폭 — an `explosionProof` material that stays immune even
   * to a `pierceProof` blast (the Shaped Charge's armor-piercing jet, which
   * ordinarily defeats 방폭 armor like Diamond/Obsidian — see
   * DetonateOptions.pierceProof in blast.ts). The uranium family declares it:
   * their 방폭 isn't armor but a *systemic invariant* — every uranium-series
   * material is immune to explosions so reactor containment can only be breached
   * by a critical mass's own Nuclear Ray, never by stacking charges against it
   * (see uranium.ts). Only meaningful alongside `explosionProof`; omitted ⇒ the
   * armor reading (a pierceProof jet gets through).
   */
  jetProof?: boolean;
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
   * a Termite crushed to Sawdust, a Nanobot shattered to Iron Powder — sets this
   * so the residue appears even at the epicenter, not just for the rim cells its
   * own `update` can catch via an adjacent Blast cell. Omitted ⇒ the ordinary
   * flash. Also the residue a `shockDeathChance` roll leaves when a shockwave too
   * weak to break the material kills it anyway (see below), so one field covers
   * "what's left of it" on both paths.
   */
  blastDeathId?: MatId;
  /**
   * 충격파에 휩쓸리는 고체 — a Solid that a shockwave treats as LOOSE matter rather
   * than as structure. Normally a solid a blast can't break shadows the wave and
   * is left untouched (see blocksBlast/shadowsPressure in blast.ts), which is
   * right for a stone wall but wrong for something tiny and unanchored: a crawling
   * bug (Termite/Nanobot) is `Phase.Solid` only because it walks instead of
   * piling, and it should be blown away by a passing shockwave, not act as a
   * blast shield. With this set, the material never shadows the crater flood nor
   * the pressure wave, and a blast too weak to destroy it FLINGS it outward as
   * mass-conserving Debris (it arcs out and lands again) exactly like a powder.
   * A blast strong enough to beat its `durability` still destroys it as before.
   * Omitted ⇒ the classic solid behavior (shadow the wave, survive untouched).
   * Only meaningful on a Solid — loose phases are already shoved.
   */
  shockLoose?: boolean;
  /**
   * 물질이 아님 — an *effect* cell rather than matter (a firework's coloured
   * flower), which a blast front passes straight over as if it weren't there: it
   * is neither destroyed, nor flashed, nor shoved aside as Debris, and it simply
   * keeps running its own lifetime. This is the tagged form of the treatment
   * blast.ts already hard-codes for its own shockwave flash and for a Debris
   * fragment in flight — both cases where "resolving" the cell is meaningless
   * because there's no matter there to resolve.
   *
   * Distinct from `explosionProof`, which is about *armor*: a 방폭 solid STOPS the
   * front and shadows what's behind it, whereas a `blastInert` cell is transparent
   * to it — the front flows through and keeps going.
   *
   * The load-bearing part is the *shove*: a fragment carries its origin material
   * in `aux`, which for an effect cell either means nothing or (for an
   * `auxPalette` material) collides with the aux meaning it already has. Tagging
   * is also strictly safer than the alternative of making the cell trivially
   * destructible: routing an effect cell through the destroy path leaves a real
   * `BLAST` flash behind, which decays into stray Fire and reads as a detonation
   * trigger to every charge that watches for an adjacent flash — so a
   * *non-destructive* pulse (a Woofer's) could set off a stockpile it must never
   * be able to reach.
   */
  blastInert?: boolean;
  /**
   * 충격파 노출 시 사망 확률, 0..1 — the chance that a shockwave too weak to *break*
   * this material kills the cell outright anyway, leaving `blastDeathId` behind
   * instead of flinging it (a Termite's fragile body being crushed by the pressure
   * wave, 50%). Rolled once per cell the wave reaches — the crater flood's shove
   * path and the pressure ring alike — so a Woofer's silent thump is as lethal as
   * a firecracker's concussion. Requires `blastDeathId` (there'd be no remains to
   * leave otherwise); omitted ⇒ the shockwave only ever moves the cell, never
   * kills it (a Nanobot machine just gets thrown around).
   */
  shockDeathChance?: number;
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
   * velocity/life for Ember/Debris/Bomblet/Napalm Gel/Nuclear Ray, flash life for
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
   * a Nuclear Ray beam whose entire point is to look ultra-hot. Ignored for any
   * material that isn't `packedTemp`.
   */
  overlayTemp?: number;
  /**
   * `temp` on this material IS a real degree reading (unlike `packedTemp`), so
   * the 돋보기 readout and the heat-overlay camera should show it — but it's
   * decoration, not heat: the cell conducts nothing (`conductivity: 0`) and no
   * consumer outside the heat field may treat it as a heat *source*. The
   * Firework Burst is the case this exists for: a firework flower should read as
   * the ~1200° flame it looks like rather than as room-temperature air, while
   * still washing over a wooden box without setting it alight.
   *
   * Grid materials need no special handling — conduction is gated by the lower of
   * the two cells' conductivities, so a 0 never warms a neighbour. The object
   * layer is what has to opt out explicitly, since it reads raw cell
   * temperatures: the body heat-exposure scan and the dynamite fuse tip both
   * ignore a cell whose material sets this (engine/objects.ts).
   */
  decorTemp?: boolean;
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
   * flat. A powder's tint byte is seeded once when the grain is created and then
   * travels with it unchanged — it never re-rolls, moving or not; a liquid has no
   * tint of its own and instead samples a positional background field that drifts
   * slowly even at rest. Ignored for `glow` materials (they're shaded by
   * temperature instead). See game/tint.ts and the renderer/Simulation.
   */
  colorVary?: number;
  /**
   * Edge, in cells, of the square block that shares one `colorVary` sample
   * (Obsidian: `2`). Omitted ⇒ 1, i.e. every cell reads its own tint byte and the
   * grain is per-cell white noise.
   *
   * With `2` the renderer samples the tint field at the cell's block anchor
   * (`x & ~1, y & ~1`) instead of at the cell itself, so the grain comes out as
   * chunky 2×2 flakes rather than single-cell static — for volcanic glass that
   * reads as conchoidal fracture faces catching the light, where per-cell noise
   * read as dust. The palette icon hashes the same anchor coordinates, so chip and
   * canvas are blocked identically (see render/materialSvg.ts).
   *
   * Only meaningful for a material that doesn't move: the anchor is *positional*,
   * so a travelling grain would swap flakes as it crossed a block boundary rather
   * than carrying its own shade the way `colorVary` otherwise promises. Every
   * blocked material today is a static Solid.
   */
  tintBlock?: number;
  /**
   * A second, *finer* brightness spread applied on top of a blocked grain: the
   * block-anchored sample shades the whole `tintBlock` square by `colorVary`, and
   * then each cell inside it is shifted again by its own sample by this much.
   *
   * The point is a two-level texture. A blocked grain alone gives flat facets with
   * a hard step between them — right for the *shape* of a fracture, but the facets
   * themselves come out as painted squares. A per-cell grain alone gives features
   * one cell across, which read as dust on the surface rather than as stone. Coal
   * and Obsidian carry both: a wide spread between 2×2 flakes (`colorVary`) and a
   * narrow one within each (this), so a facet catches the light as a facet and
   * still has grit in it.
   *
   * Meaningful only alongside `colorVary` and a `tintBlock` above 1 — without a
   * block the two samples are the same sample and this would just widen
   * `colorVary`. The two amplitudes add, so the total spread a material can show is
   * `colorVary + tintCellVary` either way.
   */
  tintCellVary?: number;
  /**
   * A porous solid: liquids and gases ignore it entirely (Mesh, Turbine, Pump).
   * To powders and solids it's an ordinary blocking Solid — piles rest on it —
   * but a fluid moving into it slips into the cell's 겹침 (overlap) slot
   * (Grid.overlay) and keeps travelling through under its own gravity/buoyancy,
   * one fluid per cell, surfacing in the first empty cell it reaches — so water
   * pours through a mesh floor of any thickness and seeps through a mesh wall
   * until the levels equalize. Read by SimContext (tryMove entry,
   * canHostOverlap); the rest of the engine ignores it.
   */
  porous?: boolean;
  /**
   * For a `porous` host: powders pass through it too, not just liquids and gases
   * (Pump). A grain moving into such a cell takes the 겹침 slot exactly the way a
   * liquid does and keeps falling through under gravity, so the material reads as
   * a sieve with pores wide enough for grit rather than a fluid-only screen —
   * which is what lets a Pump lift sand as well as water. Ignored unless `porous`
   * is set. Read by SimContext (canHostOverlap, tryMove entry, updateOverlay).
   */
  porousPowder?: boolean;
  /**
   * For a `porous` host: only half its cells actually admit a fluid — the light
   * cells of the `lattice` checkerboard the renderer draws, so the screen filters
   * at half its pore density and the cells that *look* woven are the ones that
   * block (Mesh). The light cells connect diagonally, so a fluid still threads a
   * screen of any thickness. Omitted ⇒ every cell of the porous body admits
   * (Turbine, Pump). Read by SimContext (canOverlapAt).
   */
  latticeFilter?: boolean;
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
   * Draw a 2x2 positional checkerboard (using the `lattice` color over base `color`)
   * thicker than Mesh's 1x1 checkerboard (Diamond).
   */
  checker2x2?: boolean;
  /**
   * Draw a repeating battery pattern (Lithium Battery, LFP Battery): a 2-step
   * diagonal staircase of flat black on a 4x5 tile, leaving a 1px border of the
   * battery's own `color` around each pair of cells.
   */
  batteryPattern?: boolean;
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
   * pointing the way the cell's `aux` byte says it faces — the low 2 bits are the
   * direction (0 up / 1 down / 2 left / 3 right, see materials/fan.ts, which still
   * defines the encoding) and the rest a powered countdown, so the chevron
   * brightens while the machine is running. The **Laser** uses it, so which way it
   * fires (and whether it's powered) reads at a glance.
   *
   * The Fan used to be the other user and is where the name comes from; it draws a
   * `rotorPattern` wheel now, which is why an unpowered fan no longer points. The
   * aux layout is unchanged, so switching a machine back is just swapping the flag.
   *
   * Like `arrow`, purely a rendering hint the simulation never reads; omit for an
   * ordinary material.
   */
  windArrow?: boolean;
  /**
   * Draw a solid 4-directional TRIANGLE (in the `lattice` color, over the base
   * `color`) pointing the way the cell's `aux` byte says it faces — the low 2
   * bits are the direction, same codes as `windArrow` (0 up / 1 down / 2 left /
   * 3 right). Where `windArrow` draws a thin chevron line (Laser), this
   * tiles filled triangles 6 cells across the axis by 3 deep along it, each
   * side stepping in one cell per lane and separated by a 2-cell gutter on
   * every side — the Shaped Charge uses it so its liner cone (성형작약의 원뿔
   * 라이너) reads as distinct ▶-shaped arrowheads aimed down the jet axis.
   * Purely a rendering hint the simulation never reads; omit for an ordinary
   * material.
   */
  triArrow?: boolean;
  /**
   * Draw horizontal coil windings (in the `lattice` color, over the base `color`)
   * that brighten while the cell's `aux` byte is non-zero — the Electromagnet,
   * whose whole aux byte is its powered countdown (see materials/electromagnet.ts).
   * A magnet has no direction to point at, so it gets stripes rather than the
   * Laser's chevron; the brightening is what makes "the field is on" readable at a
   * glance, the same job `windArrow`'s brightening does for a firing laser. Purely
   * a rendering hint the simulation never reads; omit for an ordinary material.
   */
  coilPattern?: boolean;
  /**
   * Draw vertical channel stripes (in the `lattice` color, over the base `color`)
   * that brighten while the cell's `aux` byte is non-zero — the Pump, whose whole
   * aux byte is its powered countdown (see materials/pump.ts). The 90°-rotated
   * counterpart of `coilPattern`: one lit column of every three, so a block of it
   * reads as a stack of open risers matter can travel up rather than a solid
   * machine face, and the brightening is what says "it's pumping". Purely a
   * rendering hint the simulation never reads; omit for an ordinary material.
   */
  stripePattern?: boolean;
  /**
   * Render this cell using the *carried* material named by its `aux` byte, not
   * this material's own `color`. Debris sets it: a flying fragment carries its
   * origin material's id in `aux`, so shoved water draws blue and shoved sand
   * draws tan instead of everything reading as one dull Debris grey. Purely a
   * rendering hint — the simulation still treats the cell as this material.
   */
  renderAsAux?: boolean;
  /**
   * Render this cell in one of a fixed set of colors, picked by its `aux` value
   * (`auxPalette[aux % auxPalette.length]`) instead of the material's own
   * `color` — a *per-cell* color that isn't a brightness nudge of one base tone
   * the way `colorVary` is. The Firework Burst uses it: a shell's stars each roll
   * one palette entry at launch and stamp it into every cell of the burst they
   * open, so one volley paints half a dozen differently-coloured flowers out of a
   * single material. Purely a rendering hint; the simulation only ever reads the
   * aux value as an opaque index. Omit for an ordinary single-colour material.
   */
  auxPalette?: readonly number[];
  /**
   * Draw each *particle* in one of a fixed set of colors, picked by its own stable
   * `tint` byte (`tintPalette[tint % tintPalette.length]`) instead of the
   * material's `color` — so a pile of it is a speckle of genuinely different
   * colors rather than one hue at different brightnesses, which is all
   * `colorVary` can express. The Fireworks powder uses it (coral red / grey /
   * light ivory).
   *
   * `tint` is the right plane for this and `aux` is not: it's seeded once when a
   * grain is created, never re-rolled in place, and travels with the grain on
   * every swap (see game/tint.ts), so a resting or sliding grain holds its color
   * — while `aux` would be cleared by the next `spawn` and is already spoken for
   * by half the roster. A grain that is genuinely *re-created* does re-roll: a
   * blast shove turns it into a Debris fragment and back, and a world reload
   * reseeds every tint. That's the same treatment every powder's brightness
   * speckle already gets, so the palette color is exactly as persistent as the
   * variation it replaces — no more, no less.
   * Indexing by `tint % n` (rather than banding the byte) also keeps the color
   * uncorrelated with the other per-grain decision read off the same byte — the
   * `liquidOverlap` threshold split.
   *
   * `colorVary` still applies on top, so grains of one palette color keep a
   * little brightness grain. Purely a rendering hint; the simulation never reads
   * it. Two readings of one byte can't coexist, so don't set this with `glow`.
   */
  tintPalette?: readonly number[];
  /**
   * Draw a photovoltaic cell grid (Solar Panel): rectangular cells of the base
   * `color` separated by thin `lattice`-coloured seams — one seam column of every
   * SOLAR_CELL_W and one seam row of every SOLAR_CELL_H, so each cell reads 3
   * wide × 5 tall (the reference art's 4×7 proportions scaled down so a small
   * panel still shows its structure — see CanvasRenderer's SOLAR_CELL_W).
   * Positional (tied to x/y, not to the particle) like the Mesh weave, so a
   * painted array lines up into one continuous panel however it's drawn. Purely a
   * rendering hint the simulation never reads.
   */
  solarPattern?: boolean;
  /**
   * Draw running-bond masonry (Wall): a `lattice`-coloured mortar bed under every
   * course and a mortar head joint between bricks, with the top row of each brick
   * lit a step above the base `color` so a slab reads as stacked blocks with light
   * falling on their top edges. Alternate courses are offset half a brick, which is
   * what makes it masonry rather than a grid. Positional (tied to x/y, not to the
   * particle) like the Mesh weave and the panel's seams, so however the brush is
   * dragged the courses line up into one continuous wall instead of restarting per
   * stroke. Purely a rendering hint the simulation never reads.
   */
  brickPattern?: boolean;
  /**
   * Draw a grid of speaker drivers (Woofer): one round driver per tile — a rim, a
   * cone in the `lattice` colour, and a dark dust cap at the centre — with the base
   * `color` as the baffle between them. The same four tones, in the same radial
   * order, as the hand-drawn Woofer chip. Positional (tied to x/y, not to the
   * particle) like the Mesh weave and the panel's seams, so a cabinet dragged out
   * with the brush reads as one continuous array of drivers. Purely a rendering hint
   * the simulation never reads — the Woofer stamps no cell state at all (it fires a
   * shockwave and is done), so unlike the Pump's stripes nothing here brightens.
   */
  wooferPattern?: boolean;
  /**
   * Draw bundles of labelled dynamite (TNT): four sticks per tile — each a lit column
   * in the base `color` brightened, two of the plain colour, and a shaded one in
   * `lattice` — above and below a paper band carrying the word TNT. Positional (tied
   * to x/y, not to the particle) like the Wall's courses, so dragging the brush
   * extends one continuous bundle rather than tiling a block per cell. Purely a
   * rendering hint the simulation never reads.
   *
   * The only pattern in the engine that is a **bitmap** rather than an expression, and
   * the only art in the project carrying lettering: the tile, its palette and the
   * reasoning for both live in `render/tntTile.ts`, shared by the renderer and the
   * palette icon generator instead of being restated in each. Its period is therefore
   * fixed at TNT_N (16) — far coarser than the other patterns, because that is the
   * smallest grid the word fits on.
   */
  tntPattern?: boolean;
  /**
   * Draw a bladed rotor (Turbine: 8, Fan: 4): one wheel per tile — blades whose
   * leading edge is the `lattice` colour and whose trailing edge is the base
   * `color` darkened, keyed to a darker hub. The value is the blade count and
   * picks which wheel; the tiles themselves live in `render/rotorTile.ts`, shared
   * with the palette icon generator, so its period is fixed at ROTOR_N (12) rather
   * than being a rule this type could restate.
   *
   * Positional (tied to x/y, not to the particle) like the Wall's courses, so a
   * dragged-out machine is one continuous array of wheels. Purely a rendering hint
   * the simulation never reads.
   *
   * A Fan carrying this draws no chevron: the rotor replaces `windArrow` rather
   * than layering on it, so the *direction* it blows is read off the wind streaks
   * it throws rather than off the block face. That is a deliberate trade for the
   * machine reading as a fan at a glance — see docs/MATERIAL-ICONS.md §4.1.
   */
  rotorPattern?: 4 | 8;
  /**
   * Right-shift applied to a `rotorPattern` cell's `aux` before its low bit is read
   * as the spin phase — 2 for the Fan (whose low two bits are its blow direction),
   * 8 for the Turbine (whose low byte is its active countdown and whose high byte is
   * the beat counter that actually advances while it runs). 0 is the default.
   *
   * The wheel alternates between its two frames as that counter advances, so it
   * turns exactly while the machine is working and freezes when it stops. See
   * `rotorFrame` in render/rotorTile.ts for why the animation is driven off sim
   * state rather than off a renderer clock. Purely a rendering hint; ignored unless
   * `rotorPattern` is set.
   */
  rotorSpinShift?: number;
  /**
   * 점도 (viscosity), 0..1 — for a Liquid, the per-tick chance it *resists*
   * spreading sideways to level out, so a thick liquid holds a slumping mound
   * before it slowly flattens. It never blocks straight-down fall (a viscous blob
   * still drops under gravity — 점성 흐름 개선), only the lateral leveling and
   * diagonal creep, so honey/mud/slime ooze instead of racing flat like water.
   * 0 (or omitted) ⇒ frictionless flow (Water). Read by updateLiquid; ignored for
   * non-liquids.
   *
   * Because it never touches the fall, this tag alone can't make a liquid *ooze*
   * — a very viscous liquid still drops at water speed and only refuses to
   * flatten once it lands. A material that should crawl in every direction pairs
   * it with the per-material `chance(FLOW_CHANCE)` gate around its own
   * `updateLiquid` call, which throttles the whole movement step: Lava does this
   * at 0.15, and Honey / Slime / Acid Slime follow it (see lava.ts, honey.ts,
   * slime.ts). The two are complementary — the gate sets how *often* the liquid
   * moves at all, `viscosity` how reluctantly it levels out when it does.
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
 * How briskly a metal fizzes hydrogen off in acid (see `Material.acidHydrogen`
 * and materials/corrosion.ts). One number per metal, and that number *is* the reactivity
 * ordering as the player reads it: aluminum bubbles harder than iron because its
 * chance is higher, and a loose powder harder than a cast bar because dust
 * presents all of itself where bulk metal presents one face.
 */
export interface AcidHydrogen {
  /** Per-tick, per-acid-contact chance the metal cell dissolves into a bubble. */
  chance: number;
  /** Heat of reaction dumped into the fresh Hydrogen. Omit for corrosion.ts's default,
   *  which is picked to stay under Hydrogen's 200° autoignition so the gas gets to
   *  rise and collect instead of lighting at birth. */
  heat?: number;
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
