import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4, DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { CONCRETE } from './concrete';

// Cement — a dry grey powder that falls and piles like sand, but touch it to
// water and it *sets*: the grain darkens, cures for a couple of seconds, and
// hardens into solid Concrete. That makes it the game's construction tool — pour
// dry cement into a mold or a gap, splash water on it, and it freezes into a
// rigid structure you can build with.
//
// ## 굳는 데 시간이 걸린다 (양생), 그리고 그동안 물이 스며든다
//
// Setting used to be instant: any grain that met water became Concrete on the
// spot, and it consumed that water 1:1. Both halves of that made a pile
// essentially uncurable below its own skin.
//
//   • Concrete is a plain Solid — it hosts no 겹침 fluid — so the instant the top
//     row flipped it became a **waterproof lid** over everything under it. You
//     poured water on a deep pile, got a one-grain-thick crust, and the rest
//     stayed powder forever however much more water you added.
//   • And the crust ate the water on its way in, so the splash was gone before it
//     had anywhere to go.
//
// Both are fixed by the same idea: water *wets* cement long before it is *spent*
// on it, and a wetted grain stays powder while it cures.
//
//   • aux 0 — dry powder. The first water it meets (its own 겹침 slot, else a
//     face-adjacent cell) starts it curing. That water is only **used up** with
//     probability WATER_SPEND_CHANCE; the rest of the time it is left alone to go
//     on percolating down and wet the grains below, so one cell of water wets a
//     whole trail of them (~1/WATER_SPEND_CHANCE) instead of stopping at the
//     first. This is what "물이 스며든다" means in practice — the wet, darkened
//     region you can see spreading down into the pile is where the water went.
//   • aux 1..CURE_STEPS — 양생 중. **Still a Powder, so still porous**: it never
//     reaches for water again, it never keeps a drop that arrives (the one already
//     in its slot at the moment it was wetted percolates on next tick like any
//     other), and anything above goes straight through it to the dry grains deeper
//     down. This is what kills the lid — there is no crust until the cure is up,
//     by which time the splash has had time to get all the way in.
//   • aux = CURE_STEPS — it sets to Concrete. From here it *is* a lid, which is
//     the entire point of building with it.
//
// The constants below are therefore the "how fast does cement set" knobs, and they
// govern different halves of it: WATER_SPEND_CHANCE decides how *deep* a splash
// reaches, CURE_STEPS/CURE_STEP_CHANCE how long the pile stays open before it
// seals — and, because the steps are rolled rather than counted, how raggedly.
//
// ## 겹침 불가 알갱이는 이웃을 따라 굳는다
//
// The 액체 겹침 계수 (Material.liquidOverlap) is rolled per *grain*, off the cell's
// own tint byte — so however permeable cement is as a material, a scattered
// minority of grains are sealed and can never take water in at all. Water alone
// therefore leaves those grains dry **forever**, however much of it you pour, and
// they stay behind as permanent grey specks freckled through a finished wall.
// That is not a water budget, it is a dead end, so a sealed grain (SimContext.
// canHostFluid says no) joins the cure of any neighbouring grain that is already
// curing, **at that neighbour's progress** — so they finish together and it reads
// as one slab hardening rather than as a patch catching up.
//
// This can only ever spread *through* sealed grains — a permeable grain still
// waits for real water — so it is not a chain reaction that could cure a pile the
// water never reached: every run of it has to start at a grain some water
// actually wetted, and sealed grains are far too sparse to percolate. Note the
// join is checked on every dry tick, so a sealed grain is swept up within a tick
// of any neighbour starting to cure, not at the end of the cure; and because the
// scan is a single in-place sweep, a run of sealed grains lying along the scan
// direction can join in the *same* tick rather than one cell per tick. Neither
// widens what can be reached — only how fast the sweep travels through grains
// that were going to be reached anyway.

/** Chance that the water which wets a grain is consumed doing it, rather than
 *  left to soak on down and wet the next one. So one cell of water wets about
 *  1/this many grains before it is used up — the reach of a splash. It is a
 *  *budget*, which is why it isn't simply 0: a puddle must not set an unlimited
 *  amount of cement, the same reason Salt consumes the water it dissolves into. */
const WATER_SPEND_CHANCE = 0.2;

/**
 * How a wetted grain gets from wet to set: `CURE_STEPS` steps of progress, each
 * one advanced with probability `CURE_STEP_CHANCE` per tick. Mean duration is
 * therefore STEPS/CHANCE ≈ 180 ticks, ~6s at the default sim speed
 * (SIM_HZ_AT_1X) — concrete going off is a thing you *watch*, and the first pass
 * at ~2s set so fast that the pile flipped almost as soon as it darkened, which
 * was the old instant behaviour with a flicker in front of it.
 *
 * **The roll is the point, not the mean.** A plain countdown gave every grain the
 * *same* duration, so a pile wetted together set together — one flat instant where
 * the whole slab turned over at once, which reads as a scripted cut rather than as
 * curing. Rolling each step makes the total a negative binomial: mean 180 ticks,
 * σ = √(STEPS·(1−CHANCE))/CHANCE ≈ 38 ticks. Grains that were wetted in the same
 * tick now finish across a window of several seconds, in no particular order, so
 * the slab hardens as a spreading speckle. Same idiom as Seed's germination
 * (GERMINATE_CHANCE × SPROUT_PROGRESS), and for the same reason: progress you can
 * see, at a pace that isn't a metronome.
 *
 * STEPS is also the ramp's resolution and the aux range, so it stays small and
 * well inside 16 bits. Fewer steps at a lower chance would scatter the finish
 * *more* (σ grows as CHANCE shrinks) at the cost of a chunkier colour ramp; 20 is
 * the balance — a visibly staggered set with a ramp fine enough to read as a
 * gradient rather than as bands.
 */
const CURE_STEPS = 20;
const CURE_STEP_CHANCE = 0.11;

/** Dry grey (aux 0 — the same tone as `color`, so an untouched grain and the
 *  palette swatch agree) → the dark of freshly wetted cement (aux 1) → Concrete's
 *  own colour (aux CURE_STEPS). A grain therefore darkens the instant water
 *  reaches it and then creeps toward the colour it is about to become, so "how
 *  far did the water actually get?" is answered by looking at the pile. Built
 *  rather than written out so the ramp can't drift out of step with CURE_STEPS. */
const CURE_RAMP: readonly number[] = Array.from({ length: CURE_STEPS + 1 }, (_, i) => {
  if (i === 0) return rgb(165, 165, 170);
  const t = (i - 1) / (CURE_STEPS - 1);
  return rgb(
    Math.round(128 + (110 - 128) * t),
    Math.round(128 + (112 - 128) * t),
    Math.round(134 + (118 - 134) * t),
  );
});

function isSettingWater(id: number): boolean {
  return id === WATER.id || id === SALTWATER.id;
}

/** Find the water that wets this dry grain — the one soaked *into* it first (the
 *  겹침 layer: most grains swallow the water passing through them, and without
 *  this a splashed pile only cured the grains the water never got inside),
 *  otherwise one touching its faces. Spends it with WATER_SPEND_CHANCE and leaves
 *  it be otherwise. Returns whether any water was there at all — being wetted is
 *  what starts the cure, whether or not this grain is the one that used it up. */
function wet(x: number, y: number, sim: SimContext): boolean {
  if (isSettingWater(sim.getOverlay(x, y))) {
    if (sim.chance(WATER_SPEND_CHANCE)) sim.clearOverlay(x, y);
    return true;
  }
  for (const [dx, dy] of DIR4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isSettingWater(sim.get(nx, ny))) {
      if (sim.chance(WATER_SPEND_CHANCE)) sim.set(nx, ny, EMPTY);
      return true;
    }
  }
  return false;
}

/** Hand off whatever is soaked into a grain that is about to set, so the water
 *  passing through gets on with wetting the pile instead of being bricked up:
 *  `SimContext.set` destroys an overlay its new occupant can't host, and Concrete
 *  hosts nothing. Same directions percolation itself would take. Water with
 *  nowhere left to go is **destroyed**, not stored — say it plainly, because
 *  "sealed into the concrete" is the in-world reading of that, not a second
 *  mechanism: nothing holds it and nothing can ever give it back. This is the one
 *  path on which cement loses water, and it is bounded by how often a grain
 *  happens to be holding a drop on the exact tick it sets with all five exits
 *  blocked (a mold's floor and walls, or neighbours setting in the same tick). */
function shedSoaked(x: number, y: number, sim: SimContext): void {
  if (sim.getOverlay(x, y) === EMPTY) return;
  const dir = sim.chance(0.5) ? 1 : -1;
  if (sim.pushOverlay(x, y, x, y + 1)) return;
  if (sim.pushOverlay(x, y, x + dir, y + 1)) return;
  if (sim.pushOverlay(x, y, x - dir, y + 1)) return;
  if (sim.pushOverlay(x, y, x + dir, y)) return;
  sim.pushOverlay(x, y, x - dir, y);
}

/** The cure progress of a curing neighbour, for a grain water can't reach on its
 *  own (see the 겹침 불가 note up top) — its neighbour's progress, so the two set
 *  together, and 0 when nothing next to it is curing. DIR8 rather than DIR4: the
 *  point is that no sealed grain is left stranded, and a diagonal pocket is
 *  exactly where one would be. */
function neighborCure(x: number, y: number, sim: SimContext): number {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny) || sim.get(nx, ny) !== CEMENT.id) continue;
    const cure = sim.getAux(nx, ny);
    if (cure > 0) return cure;
  }
  return 0;
}

function updateCement(x: number, y: number, sim: SimContext): void {
  const cure = sim.getAux(x, y);
  if (cure > 0) {
    if (cure >= CURE_STEPS) {
      shedSoaked(x, y, sim);
      sim.set(x, y, CONCRETE.id);
      // Cleared explicitly: an in-place transform to a *non-empty* material keeps
      // the cell's aux, and cure progress is meaningless private state to leave
      // lying on a Concrete cell.
      sim.setAux(x, y, 0);
      return;
    }
    // 양생 중에도 여전히 가루다 — it neither drinks nor blocks; it piles and slumps
    // like the dry powder while the water goes past it to the grains below. The
    // step is rolled, not counted: that is what staggers a slab's set (see
    // CURE_STEPS) rather than flipping it over in one tick.
    if (sim.chance(CURE_STEP_CHANCE)) sim.setAux(x, y, cure + 1);
    updatePowder(x, y, sim);
    return;
  }
  if (wet(x, y, sim)) {
    sim.setAux(x, y, 1);
    return;
  }
  // A grain water can't get into rides along with the ones around it. Checked
  // last, so a grain that *can* be wetted is never cured by proximity alone.
  if (!sim.canHostFluid(x, y, WATER.id)) {
    const joined = neighborCure(x, y, sim);
    if (joined > 0) {
      sim.setAux(x, y, joined);
      return;
    }
  }
  updatePowder(x, y, sim);
}

export const CEMENT = register({
  id: 45,
  name: 'Cement',
  phase: Phase.Powder,
  color: rgb(165, 165, 170),
  // The cell's colour is its cure progress (see CURE_RAMP): dry grey → wet dark →
  // concrete. The ordinary powder speckle still rides on top.
  auxPalette: CURE_RAMP,
  density: 5,
  category: 'powder',
  // Fine, cohesive dry powder — the steepest-piling of the powders (마찰).
  friction: 0.52,
  // 액체 겹침 계수 — cement is a flour-fine, thirsty powder, so nearly every grain
  // takes water in rather than shouldering it aside. Above the powder default
  // (0.6) because this is the one material whose whole point is that the water
  // gets *through* the pile: at 0.6 the two-in-five blocking grains alone were
  // enough to strand a splash a few cells down, which is the same "it never
  // reached the bottom" complaint the cure window above exists to fix.
  liquidOverlap: 0.9,
  thermal: { conductivity: 0.3 },
  update: updateCement,
});
