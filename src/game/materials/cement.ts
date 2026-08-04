import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR4 } from '../engine/directions';
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
//   • aux 1..CURE_TICKS — 양생 중. **Still a Powder, so still porous**: it never
//     touches water again, its 겹침 slot stays free, and anything above keeps
//     percolating straight through it to the dry grains deeper down. This is what
//     kills the lid — there is no crust until CURE_TICKS is up, by which time the
//     splash has had time to get all the way in.
//   • aux = CURE_TICKS — it sets to Concrete. From here it *is* a lid, which is
//     the entire point of building with it.
//
// The two constants below are therefore the "how fast does cement set" knobs, and
// they govern different halves of it: WATER_SPEND_CHANCE decides how *deep* a
// splash reaches, CURE_TICKS how long the pile stays open before it seals.

/** Chance that the water which wets a grain is consumed doing it, rather than
 *  left to soak on down and wet the next one. So one cell of water wets about
 *  1/this many grains before it is used up — the reach of a splash. It is a
 *  *budget*, which is why it isn't simply 0: a puddle must not set an unlimited
 *  amount of cement, the same reason Salt consumes the water it dissolves into. */
const WATER_SPEND_CHANCE = 0.2;

/** Ticks a wetted grain spends curing before it sets to Concrete — the window
 *  during which the pile is still porous powder that water can travel through.
 *  Stored in `aux`, and doubles as the last index of CURE_RAMP, so it must stay
 *  well inside 16 bits. ~2s at the default sim speed (SIM_HZ_AT_1X): long enough
 *  for a poured splash to get all the way in, short enough that "splash it and it
 *  sets" still reads as one action rather than a wait. */
const CURE_TICKS = 60;

/** Dry grey (aux 0 — the same tone as `color`, so an untouched grain and the
 *  palette swatch agree) → the dark of freshly wetted cement (aux 1) → Concrete's
 *  own colour (aux CURE_TICKS). A grain therefore darkens the instant water
 *  reaches it and then creeps toward the colour it is about to become, so "how
 *  far did the water actually get?" is answered by looking at the pile. Built
 *  rather than written out so the ramp can't drift out of step with CURE_TICKS. */
const CURE_RAMP: readonly number[] = Array.from({ length: CURE_TICKS + 1 }, (_, i) => {
  if (i === 0) return rgb(165, 165, 170);
  const t = (i - 1) / (CURE_TICKS - 1);
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
 *  nowhere left to go really is sealed in, which is the right reading — cured
 *  concrete keeps the water it set with. */
function shedSoaked(x: number, y: number, sim: SimContext): void {
  if (sim.getOverlay(x, y) === EMPTY) return;
  const dir = sim.chance(0.5) ? 1 : -1;
  if (sim.pushOverlay(x, y, x, y + 1)) return;
  if (sim.pushOverlay(x, y, x + dir, y + 1)) return;
  if (sim.pushOverlay(x, y, x - dir, y + 1)) return;
  if (sim.pushOverlay(x, y, x + dir, y)) return;
  sim.pushOverlay(x, y, x - dir, y);
}

function updateCement(x: number, y: number, sim: SimContext): void {
  const cure = sim.getAux(x, y);
  if (cure > 0) {
    if (cure >= CURE_TICKS) {
      shedSoaked(x, y, sim);
      sim.set(x, y, CONCRETE.id);
      // Cleared explicitly: an in-place transform to a *non-empty* material keeps
      // the cell's aux, and cure progress is meaningless private state to leave
      // lying on a Concrete cell.
      sim.setAux(x, y, 0);
      return;
    }
    // 양생 중에도 여전히 가루다 — it neither drinks nor blocks; it piles and slumps
    // like the dry powder while the water goes past it to the grains below.
    sim.setAux(x, y, cure + 1);
    updatePowder(x, y, sim);
    return;
  }
  if (wet(x, y, sim)) {
    sim.setAux(x, y, 1);
    return;
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
