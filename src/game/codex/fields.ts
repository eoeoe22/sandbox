// The ledger of `Material` fields the codex deliberately does NOT show, and why.
//
// Together with stats.ts and traits.ts this is meant to be exhaustive: every
// field any registered material actually sets is claimed by a stat row, a trait
// card, or an entry here. test/codex.ts enforces that by sweeping the registry,
// so adding a tag to the engine and forgetting the codex fails loudly with the
// orphan's name rather than quietly leaving a hole in the page.
//
// A structured field (`thermal`, `combustion`, `phaseChange`, …) is claimed part
// by part, by dotted path, and the sweep descends into it — so a later
// `thermal.capacity` comes up as an orphan just as a new top-level tag would.
// That is enforced, not conventional: a struct the codex *shows* while claiming
// only the whole object is itself reported, because claiming the whole is what
// would let a new part slip in unnoticed. A struct listed here is exempt — we
// have decided not to show it at all, so its parts don't matter either.

/** Field → why the codex leaves it out. Keys are `Material` field names. */
export const EXCLUDED_FIELDS: Readonly<Record<string, string>> = {
  // --- The entry's own identity, rendered by the page rather than as a tag ---
  id: 'the codex renders it as the entry key',
  name: 'the codex renders it as the title',
  phase: 'the codex renders it as the 상태 chip and filter (CodexEntry.phase)',
  color: 'the codex renders it as the icon',
  category: 'the codex renders it as the filter tab',
  alsoIn: 'the codex renders it as the filter tab (extra tabs, CodexEntry.categories)',
  update: 'the per-tick rule itself — prose, not a tag; the description covers it',
  reactions: 'rendered as its own 반응 section (see CodexReaction)',

  // --- Rendering-only: how a cell is painted, not what it is ---------------
  // Excluded by design decision — a codex reader wants to know what a material
  // does in play, and these say only what it looks like while doing it.
  glow: 'rendering: temperature → colour ramp',
  colorVary: 'rendering: per-cell colour jitter',
  tintBlock: 'rendering: tint-field block size',
  tintCellVary: 'rendering: per-cell tint jitter',
  lattice: 'rendering: checkerboard second colour',
  checker2x2: 'rendering: coarser 2×2 checkerboard',
  batteryPattern: 'rendering: battery cell tiling',
  arrow: 'rendering: direction arrow overlay',
  windArrow: 'rendering: wind arrow overlay',
  triArrow: 'rendering: triple-arrow overlay',
  coilPattern: 'rendering: coil winding overlay',
  stripePattern: 'rendering: hazard stripe overlay',
  renderAsAux: 'rendering: draw colour comes from aux',
  auxPalette: 'rendering: aux → colour table',
  tintPalette: 'rendering: tint → colour table',
  solarPattern: 'rendering: solar cell tiling',
  brickPattern: 'rendering: brick tiling',
  wooferPattern: 'rendering: speaker cone overlay',
  tntPattern: 'rendering: TNT stencil',
  rotorPattern: 'rendering: rotor blade overlay',
  rotorSpinShift: 'rendering: rotor spin rate',
  // The Fish's tail. It is the one hint here that paints a *neighbouring* cell,
  // which makes it tempting to call a property — but the tail is not there: it
  // occupies nothing, blocks nothing, and no rule can see it. What a player needs
  // to know (물고기는 한 칸이다) is in the entry's own description.
  tailPixel: 'rendering: trailing tail pixel overlay',

  // --- Authoring: how the brush places it, not what it does in play -------
  // A property of the painting tools (PointerPainter), not of the material's
  // behaviour once it's on the grid — so the codex, which describes what a
  // material does in play, leaves it out.
  placementDensity: 'authoring: brush scatters it sparsely instead of solid-fill',

  // --- Not a property, just where the code for one had to live ------------
  // Acting while soaked is the rule for *every* material, not a privilege some
  // opt into: a co-occupant meets its host as a contact pair and the declarative
  // reaction table matches across the seam on its own (SimContext.updateSoaked).
  // `overlapUpdate` is only the escape hatch for what a table row can't say
  // (Acid's probabilistic corrosion) — the interaction it runs is already shown
  // as that material's 반응 or in its description, so a card here would announce
  // an implementation shape rather than anything a player can act on. It briefly
  // had one ('스며든 상태 반응'), left over from making soaked acid work at all.
  overlapUpdate: 'engine: hook shape of an interaction the codex already shows',

  // --- Engine bookkeeping about how `temp` is stored ----------------------
  // These say what the number in the temperature slot MEANS for the engine's own
  // readers, not anything about the material. All three belong to effect cells
  // (Ember, Debris, a firework flower), none of which the codex lists anyway.
  packedTemp: 'engine: `temp` holds packed flight state, not degrees',
  overlayTemp: 'engine: apparent temperature for the heat overlay only',
  decorTemp: 'engine: `temp` is real but decorative — not a heat source',
};
