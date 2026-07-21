// Equivalence + determinism harness for the active-tile CA scan
// (src/game/engine/dirtyTiles.ts, docs/PERFORMANCE.md).
//
// Runs the REAL engine — every registered material, reactions, overlap fluids,
// heat — twice from an identical random scene: once with the full scan
// (dirty.enabled = false) and once with the active-tile scan (true). Because
// updateCell draws randomness only on active cells and both scans visit the
// same active cells in the same order, a seeded Math.random makes the two paths
// bit-identical — this asserts exactly that, every tick, over many scenes and
// both gravity orientations. It also re-runs the tile path to prove determinism
// (the property a future lockstep multiplayer needs).
//
// Run: node_modules/.bin/esbuild test/active-tiles.ts --bundle --platform=node
//        --format=esm | node --input-type=module

import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { mixCells } from '../src/game/engine/brushTools';
import { allMaterials } from '../src/game/materials/registry';
import type { GravityDir } from '../src/game/config';
import '../src/game/materials'; // register all materials (side effect)

// --- Seeded PRNG installed over Math.random so the whole sim is deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(1);
Math.random = () => rng();

// Valid (registered) material ids to sprinkle into scenes.
const IDS = allMaterials().map((m) => m.id).filter((id) => id !== 0);

interface Snapshot {
  w: number;
  h: number;
  cells: Uint8Array;
  temp: Float32Array;
  aux: Uint8Array;
  overlay: Uint8Array;
  overlayAux: Uint8Array;
  tint: Uint8Array;
}

/** Build a random scene: a `fill` fraction of cells get a random material, a
 *  random temperature, and a random tint (tint drives some overlap behavior). */
function makeScene(seed: number, w: number, h: number, fill: number): Snapshot {
  rng = mulberry32(seed);
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const aux = new Uint8Array(n);
  const overlay = new Uint8Array(n);
  const overlayAux = new Uint8Array(n);
  const tint = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.random() < fill) {
      cells[i] = IDS[(Math.random() * IDS.length) | 0];
      temp[i] = Math.random() * 1600 - 100;
      tint[i] = (Math.random() * 256) | 0;
    }
  }
  return { w, h, cells, temp, aux, overlay, overlayAux, tint };
}

/** A settled sand slab filling the bottom `rows`, with quiet air above. The air
 *  tiles rebuild as asleep, so stirring at the slab's surface lifts grains into
 *  a tile the tile-scan would skip unless mixCells marks it — the exact
 *  condition the moving-box cases rarely hit. Fire/decay-free so the only motion
 *  is the stir + settling. */
function makeSlab(w: number, h: number, rows: number): Snapshot {
  const SAND = 2;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const tint = new Uint8Array(n);
  for (let y = h - rows; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells[y * w + x] = SAND;
      tint[y * w + x] = (x * 31 + y * 7) & 255;
    }
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** A jagged Ash raft sealed mid-pool — Water above, below, and beside it at
 *  every column's depth, no open air anywhere near it. Exercises
 *  moveSidewaysBuoyant/swapOntoLiquid (SimContext.ts), the pool-interior
 *  "comb" flattening path plain moveSideways can never reach (see
 *  docs/MATERIAL-SYSTEMS.md's "뜨는 가루 평탄화 후속 수정"). Deterministic (no
 *  RNG) so it drops straight into the equivalence harness like makeSlab. */
function makeFloatingRaft(w: number, h: number): Snapshot {
  const ASH = 55;
  const WATER = 3;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const tint = new Uint8Array(n);
  const surface = (h / 2) | 0;
  for (let y = surface; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = WATER;
  }
  for (let x = 2; x < w - 2; x++) {
    const depth = (x * 7) % 12; // deterministic jagged depth, no RNG
    for (let y = surface - 4; y < surface + depth; y++) cells[y * w + x] = ASH;
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** A jagged Limestone comb sealed inside a hot, layered Molten Iron
 *  Ore/Slag/Molten Metal melt (no open air, no carbon so nothing reduces) —
 *  the melt-pinned sibling of makeFloatingRaft's ordinary-liquid case.
 *  Exercises moveSidewaysContained/the containerIds-scoped swapOntoLiquid
 *  path (SimContext.ts) reached via moltenironore.ts's tryHoldInActiveMelt
 *  (see docs/MATERIAL-SYSTEMS.md's "제련 중 갇힌 플럭스가 못 퍼지던 문제").
 *  The comb's depth varies enough per column to reach past the Slag/Molten
 *  Metal boundary on some columns, so some Limestone cells end up flanked by
 *  Molten Metal at that boundary — the case containerIds was widened to cover
 *  ([...pinIds, MOLTEN_METAL.id], see tryHoldInActiveMelt's doc comment), not
 *  just Slag. A narrow strip of unrelated Water along one edge (never
 *  touched by the comb) also exercises swapOntoLiquid's containerIds
 *  rejection path for a genuinely foreign liquid. Deterministic (no RNG) so
 *  it drops straight into the equivalence harness like makeFloatingRaft. */
function makeMeltPinnedFlux(w: number, h: number): Snapshot {
  const LIMESTONE = 69;
  const MOLTEN_IRON_ORE = 71;
  const SLAG = 68;
  const MOLTEN_METAL = 29;
  const WATER = 3;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(1000); // well above Ore/Slag's solidify points
  const tint = new Uint8Array(n);
  const r1 = (h / 3) | 0; // Ore/Slag boundary
  const r2 = ((h * 2) / 3) | 0; // Slag/Molten Metal boundary
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells[y * w + x] = y < r1 ? MOLTEN_IRON_ORE : y < r2 ? SLAG : MOLTEN_METAL;
    }
  }
  const waterCols = 3;
  for (let y = r1; y < r2; y++) {
    for (let x = w - waterCols; x < w; x++) {
      cells[y * w + x] = WATER;
      temp[y * w + x] = 20;
    }
  }
  for (let x = 2; x < w - waterCols - 2; x++) {
    const depth = 3 + ((x * 7) % (r2 - r1 + 6)); // deterministic jagged depth, no RNG
    for (let i = 0; i < depth; i++) {
      const y = r1 + i;
      if (y < h) cells[y * w + x] = LIMESTONE;
    }
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** A shelf of alternating Coal Powder / Limestone cells over a thick Coal
 *  Powder slab over Molten Metal — every shelf cell's own-row lateral
 *  neighbor is the *other* floating powder, never Liquid, and the slab is
 *  thick enough to keep Molten Metal's soak-into-a-powder-bed seepage from
 *  reaching the shelf within this scene's tick budget. Exercises
 *  SimContext.swapOntoPowder/moveSidewaysMix, the free-floating counterpart
 *  to makeMeltPinnedFlux's moveSidewaysContained coverage (see
 *  docs/MATERIAL-SYSTEMS.md's "두 종류의 뜨는 가루가 서로를 막던 문제") — without
 *  it, a shelf cell here has no adjacent Liquid to glide into (tryMove and
 *  swapOntoLiquid only ever move a Powder cell past a Liquid one, never past
 *  another Powder) and no valid fall/pile target either (straight/diagonal
 *  down both land on more of the slab), so it's stuck with zero legal moves
 *  regardless of how many ticks pass. Cool throughout (well under Coal
 *  Powder's 580° autoignite) so this is purely a movement scene, not a
 *  combustion one. Deterministic (no RNG) so it drops straight into the
 *  equivalence harness like makeFloatingRaft/makeMeltPinnedFlux. */
function makeMixedFloat(w: number, h: number): Snapshot {
  const COAL_POWDER = 70;
  const LIMESTONE = 69;
  const MOLTEN_METAL = 29;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(200);
  const tint = new Uint8Array(n);
  const floorTop = (h * 0.6) | 0;
  for (let y = floorTop; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells[y * w + x] = MOLTEN_METAL;
      temp[y * w + x] = 900; // above its 650 freeze point
    }
  }
  const slabTop = floorTop - 6;
  for (let y = slabTop; y < floorTop; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = COAL_POWDER;
  }
  const shelfY = slabTop - 1;
  for (let x = 0; x < w; x++) cells[shelfY * w + x] = x % 2 === 0 ? COAL_POWDER : LIMESTONE;
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** A mixed-species light-powder raft (alternating Ash/Sawdust columns) loaded
 *  by a Sand pile stacked on top, all floating on Water — the brush-mix-tool
 *  scenario the two jitter fixes in this change target (see
 *  docs/MATERIAL-SYSTEMS.md's "가루 섞임 수직 지터" section). Every column is
 *  identical (uniform depth, uniform Sand load) so the scene is fully
 *  deterministic with no RNG, and the Sand is dense enough (5) to register as
 *  real load on the raft while both Ash (1.5) and Sawdust (2) stay buoyant on
 *  Water (3) — exactly the density ordering that used to trip
 *  tryFloatLightPowderStack's digging-swap into ping-ponging Ash ↔ Sawdust
 *  vertically (load reached past the buoyant layer to the Sand, but the swap
 *  target was the buoyant cell right above the column, not the Sand itself).
 *  Exercises both fixes together: hasFlattenableGap's interior-notch guard
 *  (so adjacent same-height raft cells don't shuttle sideways) and
 *  tryFloatLightPowderStack's load-target guard (so the digging swap only
 *  fires when the cell directly atop the column is itself the heavy load). */
function makeLoadedMixedRaft(w: number, h: number): Snapshot {
  const ASH = 55;
  const SAWDUST = 27;
  const SAND = 2;
  const WATER = 3;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const tint = new Uint8Array(n);
  const surface = (h / 2) | 0;
  for (let y = surface; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = WATER;
  }
  // Two-cell-tall raft, alternating species per column. Sand on top of every
  // third column — enough to load the raft, not so much it overwhelms buoyancy
  // instantly (we want the system to *settle*, not to dig through).
  for (let x = 2; x < w - 2; x++) {
    const id = x % 2 === 0 ? ASH : SAWDUST;
    cells[(surface - 1) * w + x] = id;
    cells[(surface - 2) * w + x] = id;
    if (x % 3 === 0) {
      cells[(surface - 3) * w + x] = SAND;
      cells[(surface - 4) * w + x] = SAND;
    }
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** Vertical-jitter guard for makeLoadedMixedRaft: fails if any two
 *  vertically-adjacent interior cells trade values back and forth on a
 *  majority of ticks within any 20-tick window across the whole run — the
 *  signature of the Ash↔Sawdust ping-pong the fix in tryFloatLightPowderStack
 *  targets (two light powders at a column's top, driven by a heavier load
 *  above, swapping every tick with no net effect).
 *
 *  Scans a sliding 20-tick window across every frame rather than just the
 *  run's tail, because in this scene the ping-pong is concentrated in the
 *  early settling phase (the Sand load drives rapid vertical exchanges while
 *  the raft finds its equilibrium), which a tail-only check would miss once
 *  the scene eventually calms down on its own. The fix eliminates the
 *  ping-pong throughout, so a clean run has no high-swap window anywhere.
 *
 *  Checks vertical pairs, not individual cells: the ping-pong is
 *  fundamentally a *pair* phenomenon (each cell flips because its neighbor
 *  just flipped into it), and a per-cell "changed often" test would
 *  false-positive on a grain merely transiting sideways through the water
 *  row (which visits many cells briefly without being stuck). "Vertical"
 *  specifically because that's the orientation of the load-driven swap this
 *  fix guards — a sideways shuffle of a stray grain trapped under the raft
 *  is a separate issue this test deliberately does not cover. "Interior"
 *  excludes the outermost 3 columns/rows on each side (edge effects there,
 *  including the deliberately uneven Sand load that starts and stops
 *  mid-raft, would mask a real regression — same reasoning as
 *  verifyMeltPinnedMixMoved's edge exclusion). */
function verifyNoVerticalJitter(initial: Snapshot, frames: Snapshot[]): string | null {
  const { w, h } = initial;
  const WINDOW = 20;
  for (let x = 3; x < w - 3; x++) {
    for (let y = 3; y < h - 4; y++) {
      const ia = y * w + x;
      const ib = (y + 1) * w + x;
      // For each starting tick, count swap-signatures in the next WINDOW frames.
      for (let t0 = 0; t0 + WINDOW < frames.length; t0++) {
        let swaps = 0;
        for (let t = t0 + 1; t <= t0 + WINDOW; t++) {
          const aPrev = frames[t - 1].cells[ia];
          const bPrev = frames[t - 1].cells[ib];
          const aCur = frames[t].cells[ia];
          const bCur = frames[t].cells[ib];
          if (aCur === bPrev && bCur === aPrev && aCur !== bCur) swaps++;
        }
        if (swaps > WINDOW * 0.4) {
          return `vertical pair (${x},${y})↔(${x},${y + 1}) swapped values ${swaps}/${WINDOW} in window starting tick ${t0} — ping-pong`;
        }
      }
    }
  }
  return null;
}

/** A single row of alternating Coal Powder/Limestone sandwiched between a
 *  Slag ceiling and a Molten Metal floor (mirrors makeMixedFloat's flat
 *  shelf, not makeMeltPinnedFlux's multi-row comb) — every interior cell's
 *  own-row lateral neighbor is the *other* melt-pinned powder, and every
 *  cell's against-gravity neighbor is Slag, so every cell is genuinely
 *  pinned by tryHoldInActiveMelt (not just the topmost row of a deeper comb
 *  — an earlier, multi-row version of this scene had that flaw: only its
 *  top row was ever actually pinned, since a lower comb row's own
 *  above-neighbor was more comb of the *same* column's material, not
 *  Ore/Slag, so tryHoldInActiveMelt returned false there and those rows were
 *  silently exercising the already-fixed free-floating path instead — a
 *  regression test that disabled swapOntoPinnedPowder entirely still passed
 *  as a result).
 *
 *  Molten Metal (not Slag/Molten Iron Ore) as the floor specifically because
 *  Coal Powder (7.5) is *lighter* than it (8): the shelf's Coal Powder cells
 *  can't displace down (or diagonally) into it via the ordinary
 *  fallAndPile/tryMove path either, unlike Slag or Molten Iron Ore (which
 *  it's denser than and would sink into every tick regardless of the fix
 *  under test — an earlier version of this scene used Slag as the floor and
 *  a disabled-fix regression test still passed for exactly this reason). Slag
 *  (not Molten Iron Ore) as the ceiling specifically because Molten Iron Ore
 *  actively reduces adjacent carbon/flux (see moltenironore.ts) and would
 *  consume the shelf's own Coal Powder/Limestone cells over the run,
 *  contaminating "did this cell change" with an unrelated reaction; Slag has
 *  no such reaction (see slag.ts) and coalpowder.ts's touchingMelt shields
 *  the shelf from auto-ignition via the Molten Metal floor regardless of the
 *  Slag ceiling. Exercises SimContext.swapOntoPinnedPowder/
 *  moveSidewaysContained's mixIds fallback, the melt-pinned counterpart to
 *  makeMixedFloat's free-floating coverage — reported after that
 *  free-floating fix shipped: two melt-pinned powders side by side, still
 *  mixed in with Molten Iron Ore, can freeze the same way one step earlier
 *  in the smelt (see docs/MATERIAL-SYSTEMS.md). Deterministic (no RNG) so it
 *  drops straight into the equivalence harness like the other targeted
 *  scenes.
 *
 *  tint 255 throughout: SimContext.canOverlapAt's per-grain 겹침 admission
 *  check (`tint < liquidOverlap*256`, default coefficient 0.6) always passes
 *  at tint 0 (Grid's default), which would let the Slag above the shelf soak
 *  into it (soakDown) and clear itself to EMPTY — silently unpinning a shelf
 *  cell through a route that has nothing to do with the fix under test;
 *  tint 255 fails that roll outright. Explicit per-material temperatures
 *  (not a single uniform fill): Slag/Molten Metal need to stay well above
 *  their own softening/freeze points for the run's duration, while the shelf
 *  itself is kept far below Coal Powder's 580 autoignite threshold (moot
 *  given the touchingMelt shield above, but keeps the scene's intent
 *  unambiguous even if that shield ever changes). */
function makeMeltPinnedMix(w: number, h: number): Snapshot {
  const LIMESTONE = 69;
  const COAL_POWDER = 70;
  const SLAG = 68;
  const MOLTEN_METAL = 29;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n);
  const tint = new Uint8Array(n).fill(255);
  const shelfY = (h / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = y < shelfY ? SLAG : y > shelfY ? MOLTEN_METAL : x % 2 === 0 ? COAL_POWDER : LIMESTONE;
      cells[y * w + x] = id;
      temp[y * w + x] = id === SLAG ? 700 : id === MOLTEN_METAL ? 900 : 25;
    }
  }
  return { w, h, cells, temp, aux: new Uint8Array(n), overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** Fails the meltPinnedMix case if not one *interior* shelf cell is ever seen
 *  to differ from its starting material at *any* tick of the run — the
 *  equivalence/determinism checks above only prove the two scan orders agree
 *  with *each other*, not that swapOntoPinnedPowder actually fired.
 *
 *  Checks every tick, not just the final one: this scene's every shelf cell
 *  is symmetric (same shouldFlatten condition, same mixIds, same seeded RNG),
 *  so a synchronized run swaps every adjacent pair in lockstep and can flip
 *  the whole row back to its exact starting pattern on alternating ticks —
 *  comparing only tick 0 against a coincidentally-even final tick count found
 *  zero difference despite a swap firing on *every single tick* (confirmed by
 *  instrumenting swapOntoPinnedPowder directly). Scanning the whole run
 *  catches that regardless of parity.
 *
 *  Deliberately excludes the shelf's outermost 3 columns on each side: those
 *  have plain background Molten Iron Ore/Slag exposed on their *outer*
 *  flank, so they can shuffle via the pre-existing containerIds-only
 *  swapOntoLiquid fallback alone — checking the whole grid would let that
 *  edge movement mask a regression in the interior, where every column's
 *  *both* flanks are the other pinned powder and swapOntoPinnedPowder is the
 *  only path that can ever unstick it. */
function verifyMeltPinnedMixMoved(initial: Snapshot, frames: Snapshot[]): string | null {
  const { w, h } = initial;
  const shelfY = (h / 2) | 0;
  for (const frame of frames) {
    for (let x = 5; x < w - 5; x++) {
      const i = shelfY * w + x;
      if (initial.cells[i] !== frame.cells[i]) return null;
    }
  }
  return 'meltPinnedMix shelf interior never changed at any tick — swapOntoPinnedPowder appears to be a no-op';
}

/** A powered Fan wall blowing right down an open corridor scattered with
 *  Sand/Water/Helium — one per loose phase (powder/liquid/gas) Fan.blow()
 *  pushes — stopped by a Stone wall at a known distance. Targeted coverage
 *  for materials/fan.ts: nothing else in this harness ever exercises a fan
 *  cell actually blowing (`makeScene`'s random fill seeds every cell's aux at
 *  0, so any Fan it happens to place is permanently unpowered — see
 *  docs/MATERIAL-SYSTEMS.md's Fan section), so this is the wind push's only
 *  path to being proven bit-identical between the full and active-tile scans.
 *
 *  A Battery sits diagonally against the fan wall's top cell (direct-contact
 *  power, like a Woofer/Turbine wired straight to a terminal — no relay wire
 *  needed) and re-pulses it every PULSE_PERIOD (12) ticks, comfortably inside
 *  POWER_LINGER (16), so the whole 5-cell connected body stays continuously
 *  powered for the run (fanBodyPulse floods the body from that single contact
 *  point). The corridor is boxed with a Stone ceiling/floor flush against the
 *  fan wall's own top/bottom rows — each of the wall's 5 cells blows straight
 *  along its own row only (dy=0), so a grain that fell (or a Helium bubble
 *  that rose) to a *different* row within the band is still on a row some
 *  fan cell blows; only a floor/ceiling stops one from drifting out of the
 *  band entirely (Sand/Water settling below the band, Helium escaping above
 *  it) into open space the wind can never reach again. Deterministic (no RNG
 *  in the layout) so it drops straight into the equivalence harness like the
 *  other targeted scenes. */
function makeFanTunnel(w: number, h: number): Snapshot {
  const STONE = 4;
  const BATTERY = 39;
  const FAN = 110;
  const FAN_RIGHT = 1;
  const SAND = 2;
  const WATER = 3;
  const HELIUM = 97;
  const n = w * h;
  const cells = new Uint8Array(n);
  const temp = new Float32Array(n).fill(20);
  const aux = new Uint8Array(n);
  const tint = new Uint8Array(n);
  const fanX = 8;
  const fanTop = 10;
  const fanBottom = 14; // 5-cell-tall connected body
  const wallX = 30; // stops the stream at a known, sub-FAN_WIND_RANGE distance
  cells[9 * w + (fanX - 1)] = BATTERY; // diagonal to (fanX, fanTop) — direct contact
  for (let y = fanTop; y <= fanBottom; y++) {
    cells[y * w + fanX] = FAN;
    aux[y * w + fanX] = FAN_RIGHT;
  }
  for (let y = fanTop; y <= fanBottom; y++) cells[y * w + wallX] = STONE;
  // Ceiling/floor flush against the fan band, spanning the open corridor only
  // (not the Battery's column) so loose matter can't fall/rise out of reach.
  // Runs through x=wallX inclusive — stopping one short would leave a
  // diagonal gap at the corridor's downstream corners (against the Stone
  // wall's own top/bottom cells) for a rising Helium bubble to slip through.
  for (let x = fanX + 1; x <= wallX; x++) {
    cells[(fanTop - 1) * w + x] = STONE;
    cells[(fanBottom + 1) * w + x] = STONE;
  }
  // One isolated grain of each loose phase per row (deterministic, formula-
  // based x — no RNG), spaced well apart both from the fan and from each
  // other. Deliberately sparse: an earlier version densely packed ~3/5 of
  // every row and gravity alone settled that much Sand into a floor exactly
  // wide enough to fill edge-to-edge with zero gaps before the wind ever
  // got a turn — a fully congested floor blocks blow()'s push (its target
  // cell must be EMPTY), freezing Sand in place and making the scene falsely
  // fail verifyFanBlew despite Fan.blow() working correctly. Sparse grains
  // with room to travel avoid that congestion and give the wind push (not
  // gravity settling) the decisive share of each grain's rightward drift.
  for (let r = 0; r < fanBottom - fanTop + 1; r++) {
    const y = fanTop + r;
    const base = fanX + 2 + r * 4;
    cells[y * w + base] = SAND;
    cells[y * w + (base + 1)] = WATER;
    cells[y * w + (base + 2)] = HELIUM;
  }
  return { w, h, cells, temp, aux, overlay: new Uint8Array(n), overlayAux: new Uint8Array(n), tint };
}

/** Fails the fanTunnel case if the corridor's loose matter never drifted
 *  net-rightward — proving the fan actually blew rather than merely running
 *  without diverging. Sums each loose cell's x-position (mass-weighted center
 *  of mass proxy) at the start and after the run; the equivalence/determinism
 *  checks above only prove the two scan orders agree with *each other*, not
 *  that Fan.blow() fired at all. */
function verifyFanBlew(initial: Snapshot, frames: Snapshot[]): string | null {
  const { w, h } = initial;
  const looseIds = new Set([2, 3, 97]); // SAND, WATER, HELIUM
  const sumX = (s: Snapshot): number => {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (looseIds.has(s.cells[y * w + x])) sum += x;
      }
    }
    return sum;
  };
  const before = sumX(initial);
  const after = sumX(frames[frames.length - 1]);
  if (after <= before) {
    return `fanTunnel corridor's loose matter didn't drift rightward (Σx ${before} → ${after}) — Fan.blow() appears inert`;
  }
  return null;
}

function loadInto(grid: Grid, s: Snapshot): void {
  grid.cells.set(s.cells);
  grid.temp.set(s.temp);
  grid.aux.set(s.aux);
  grid.overlay.set(s.overlay);
  grid.overlayAux.set(s.overlayAux);
  grid.tint.set(s.tint);
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}

/** Deep copy of the state arrays that must match between the two scans. */
function grab(grid: Grid): Snapshot {
  return {
    w: grid.width,
    h: grid.height,
    cells: grid.cells.slice(),
    temp: grid.temp.slice(),
    aux: grid.aux.slice(),
    overlay: grid.overlay.slice(),
    overlayAux: grid.overlayAux.slice(),
    tint: grid.tint.slice(),
  };
}

/** First index where two snapshots differ, or -1. Temperature is compared
 *  bit-exactly (both paths run the identical kernel), so no tolerance. */
function firstDiff(a: Snapshot, b: Snapshot): { field: string; i: number } | null {
  const fields: (keyof Snapshot)[] = ['cells', 'temp', 'aux', 'overlay', 'overlayAux', 'tint'];
  for (const f of fields) {
    const av = a[f] as ArrayLike<number>;
    const bv = b[f] as ArrayLike<number>;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return { field: f, i };
    }
  }
  return null;
}

/** A deterministic brush footprint (flat x,y pairs) for tick `t`: a box that
 *  walks across the grid. Derived from `t` only — no RNG — so the full and tile
 *  runs stir the identical cells and stay RNG-aligned. */
function mixFootprint(t: number, w: number, h: number, at?: [number, number]): number[] {
  const r = 3;
  const cx = at ? at[0] : 3 + ((t * 7) % Math.max(1, w - 6));
  const cy = at ? at[1] : 3 + ((t * 5) % Math.max(1, h - 6));
  const pts: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && x < w && y >= 0 && y < h) pts.push(x, y);
    }
  }
  return pts;
}

function run(
  scene: Snapshot,
  enabled: boolean,
  simSeed: number,
  gravity: GravityDir,
  ticks: number,
  mixEvery: number,
  mixAt?: [number, number],
): Snapshot[] {
  const grid = new Grid(scene.w, scene.h);
  grid.dirty.enabled = enabled;
  loadInto(grid, scene);
  const sim = new Simulation(grid);
  sim.setGravity(gravity, 1);
  rng = mulberry32(simSeed);
  const frames: Snapshot[] = [];
  for (let t = 0; t < ticks; t++) {
    // Interleave the stir brush (mixCells) — a between-ticks writer that mutates
    // cells/overlay directly. It must mark tiles or the tile scan would strand
    // grains it lifts into empty space; running it here proves it does. Both
    // runs stir identically (footprint is RNG-free, mixCells shares `rng`).
    if (mixEvery > 0 && t > 0 && t % mixEvery === 0) {
      mixCells(grid, mixFootprint(t, scene.w, scene.h, mixAt));
    }
    sim.step();
    frames.push(grab(grid));
  }
  return frames;
}

interface Case {
  seed: number;
  w: number;
  h: number;
  fill: number;
  gravity: GravityDir;
  ticks: number;
  mixEvery: number; // stir the brush every N ticks (0 = never)
  slabRows?: number; // if set, use a settled sand slab instead of random fill
  raft?: boolean; // if set, use a jagged sealed Ash-in-Water raft instead of random fill
  meltFlux?: boolean; // if set, use a jagged Limestone comb pinned inside a Molten Iron Ore melt
  meltPinnedMix?: boolean; // if set, use a uniform-depth Coal Powder/Limestone comb pinned inside a Molten Iron Ore melt
  verifyMove?: (initial: Snapshot, frames: Snapshot[]) => string | null; // extra check beyond equivalence: did the scene actually change?
  mixedFloat?: boolean; // if set, use an alternating Coal Powder/Limestone shelf over a Molten Metal slab
  loadedMixedRaft?: boolean; // if set, use a mixed Ash/Sawdust raft loaded by Sand on Water (jitter repro)
  fanTunnel?: boolean; // if set, use a powered Fan wall blowing Sand/Water/Helium down an open corridor
  mixAt?: [number, number]; // fixed stir center (for the slab surface case)
}

const CASES: Case[] = [
  { seed: 0x1111, w: 48, h: 40, fill: 0.25, gravity: 'down', ticks: 120, mixEvery: 0 },
  { seed: 0x2222, w: 40, h: 48, fill: 0.5, gravity: 'down', ticks: 120, mixEvery: 0 },
  { seed: 0x3333, w: 33, h: 27, fill: 0.15, gravity: 'right', ticks: 120, mixEvery: 0 },
  { seed: 0x4444, w: 50, h: 50, fill: 0.6, gravity: 'up', ticks: 100, mixEvery: 0 },
  { seed: 0x5555, w: 64, h: 24, fill: 0.35, gravity: 'left', ticks: 100, mixEvery: 0 },
  { seed: 0x6666, w: 17, h: 71, fill: 0.4, gravity: 'down', ticks: 100, mixEvery: 0 },
  // Stir-brush coverage: mixCells writes cells/overlay directly between ticks,
  // so it must mark tiles — these cases would strand grains under the tile scan
  // if it didn't. Low fill so stirred grains land in otherwise-empty tiles.
  { seed: 0x7777, w: 48, h: 40, fill: 0.12, gravity: 'down', ticks: 140, mixEvery: 5 },
  { seed: 0x8888, w: 40, h: 44, fill: 0.2, gravity: 'down', ticks: 140, mixEvery: 7 },
  { seed: 0x9999, w: 33, h: 33, fill: 0.15, gravity: 'right', ticks: 120, mixEvery: 6 },
  // Targeted: settled sand slab (bottom 16 rows of a 48-tall grid = tile-row 2),
  // stir fixed at the surface (y=32, the boundary into asleep air tile-row 1).
  // Without the mixCells tile-mark this strands grains the tile scan skips.
  { seed: 0xa1, w: 48, h: 48, fill: 0, gravity: 'down', ticks: 80, mixEvery: 4, slabRows: 16, mixAt: [24, 32] },
  // Targeted: jagged Ash raft sealed mid-pool (no open air near it) — the
  // swapOntoLiquid fallback's only path to being exercised, since the raft's
  // flanks are Water the whole way down, not empty air a plain moveSideways
  // could already handle.
  { seed: 0xb2, w: 48, h: 40, fill: 0, gravity: 'down', ticks: 120, mixEvery: 0, raft: true },
  // Targeted: jagged Limestone comb pinned inside a Molten Iron Ore melt —
  // moveSidewaysContained's only path to being exercised, since the flux is
  // covered by melt on every side, not open air a plain moveSideways or the
  // unrestricted moveSidewaysBuoyant could already handle.
  { seed: 0xb3, w: 54, h: 60, fill: 0, gravity: 'down', ticks: 120, mixEvery: 0, meltFlux: true },
  // Targeted: alternating Coal Powder/Limestone shelf over Molten Metal —
  // swapOntoPowder/moveSidewaysMix's only path to being exercised, since
  // every shelf cell's own-row neighbor is the other floating powder, not
  // open air or Liquid a plain moveSideways/moveSidewaysBuoyant could
  // already handle.
  { seed: 0xb4, w: 50, h: 24, fill: 0, gravity: 'down', ticks: 120, mixEvery: 0, mixedFloat: true },
  // Targeted: jagged Coal Powder/Limestone comb pinned inside a Molten Iron
  // Ore melt — swapOntoPinnedPowder/moveSidewaysContained's mixIds fallback's
  // only path to being exercised, since adjacent comb columns here are each
  // other (not Ore/Slag/Molten Metal), which the plain containerIds-only
  // swapOntoLiquid fallback could already handle.
  {
    seed: 0xb5,
    w: 54,
    h: 60,
    fill: 0,
    gravity: 'down',
    ticks: 120,
    mixEvery: 0,
    meltPinnedMix: true,
    verifyMove: verifyMeltPinnedMixMoved,
  },
  // Targeted: mixed Ash/Sawdust raft loaded by Sand on Water — the only path
  // to exercising the tryFloatLightPowderStack load-target guard. Without it,
  // Ash↔Sawdust cells at a loaded column's top swap every tick (the load scan
  // reaches past the buoyant layer to the Sand, but the swap target is the
  // buoyant cell right above the column, not the Sand itself, so next tick
  // the same condition fires on the flipped pair and the swap reverses).
  // verifyNoVerticalJitter catches that pair-swap signature directly.
  {
    seed: 0xb6,
    w: 40,
    h: 30,
    fill: 0,
    gravity: 'down',
    ticks: 400,
    mixEvery: 0,
    loadedMixedRaft: true,
    verifyMove: verifyNoVerticalJitter,
  },
  // Targeted: a powered Fan wall blowing Sand/Water/Helium down an open
  // corridor to a Stone wall — materials/fan.ts's only path to being
  // exercised here, since makeScene's random fill never powers a Fan it
  // happens to place (aux starts at 0 — see makeFanTunnel's doc comment).
  {
    seed: 0xc7,
    w: 40,
    h: 24,
    fill: 0,
    gravity: 'down',
    ticks: 150,
    mixEvery: 0,
    fanTunnel: true,
    verifyMove: verifyFanBlew,
  },
];

const SIM_SEED = 0xc0ffee;
let failed = false;
let totalTicks = 0;

for (const c of CASES) {
  const scene = c.slabRows
    ? makeSlab(c.w, c.h, c.slabRows)
    : c.raft
      ? makeFloatingRaft(c.w, c.h)
      : c.meltFlux
        ? makeMeltPinnedFlux(c.w, c.h)
        : c.meltPinnedMix
          ? makeMeltPinnedMix(c.w, c.h)
          : c.mixedFloat
            ? makeMixedFloat(c.w, c.h)
            : c.loadedMixedRaft
              ? makeLoadedMixedRaft(c.w, c.h)
              : c.fanTunnel
                ? makeFanTunnel(c.w, c.h)
                : makeScene(c.seed, c.w, c.h, c.fill);
  const full = run(scene, false, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt);
  const tile = run(scene, true, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt);
  const tile2 = run(scene, true, SIM_SEED, c.gravity, c.ticks, c.mixEvery, c.mixAt); // determinism

  let caseOk = true;
  for (let t = 0; t < c.ticks; t++) {
    const d = firstDiff(full[t], tile[t]);
    if (d) {
      const { field, i } = d;
      console.error(
        `EQUIV FAIL seed=0x${c.seed.toString(16)} ${c.w}x${c.h} g=${c.gravity} tick ${t}: ` +
          `field ${field} cell ${i} (x=${i % c.w}, y=${(i / c.w) | 0}) ` +
          `full=${(full[t][field] as ArrayLike<number>)[i]} tile=${(tile[t][field] as ArrayLike<number>)[i]}`,
      );
      caseOk = false;
      break;
    }
    const dd = firstDiff(tile[t], tile2[t]);
    if (dd) {
      console.error(
        `DETERMINISM FAIL seed=0x${c.seed.toString(16)} tick ${t}: field ${dd.field} cell ${dd.i}`,
      );
      caseOk = false;
      break;
    }
  }
  if (caseOk && c.verifyMove) {
    const err = c.verifyMove(scene, full);
    if (err) {
      console.error(`VERIFY FAIL seed=0x${c.seed.toString(16)}: ${err}`);
      caseOk = false;
    }
  }
  totalTicks += c.ticks;
  if (caseOk) {
    const mix = c.mixEvery > 0 ? ` +mix/${c.mixEvery}` : '';
    console.log(`OK  seed=0x${c.seed.toString(16)} ${c.w}x${c.h} g=${c.gravity}${mix} — ${c.ticks} ticks bit-identical + deterministic`);
  } else {
    failed = true;
  }
}

if (failed) {
  console.error('\nFAILED — active-tile scan diverged from the full scan.');
  process.exit(1);
}
console.log(`\nOK — ${CASES.length} scenes, ${totalTicks} ticks total: active-tile scan ≡ full scan, and deterministic.`);
