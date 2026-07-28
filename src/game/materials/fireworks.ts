import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLAST, detonate, flashCell, type DetonateOptions } from './blast';
import { launchFireworkStar } from './fireworkstar';

// Fireworks (불꽃놀이 화약) — a powder that goes up like a firework shell rather
// than a bomb. It triggers exactly the way Gunpowder does (an adjacent Fire /
// Lava / Blast sets it off, a Water/Saltwater neighbour makes it wet and it
// misfires). What it does when it goes off is the point: the launch charge is a
// *mortar*, not a bomb — it does nothing to the world but throw a scatter of
// Firework Stars (fireworkstar.ts), each of which arcs up and opens a coloured
// flower where it bursts, in a colour rolled per star (각 자탄의 폭발 색상을 랜덤하게).
//
// **The first detonation only scatters the cluster** (최초 폭발시에는 클러스터만
// 흩뿌리기): its `onCell` claims every cell the flood reaches and leaves it exactly
// as it was — no crater, no shockwave flash disc, no Debris shove — and
// `pressure: false` drops the concussion ring too. The one exception is the charge
// itself, which is consumed as a bright pop (`flashCell`) so it can't re-detonate
// forever. All the destructive budget the material has lives in the *stars*, which
// bloom at Gunpowder-level power (see fireworkstar.ts). So a firework fired next to
// a sandcastle launches its display without disturbing a grain of it, and what the
// display does after that is the stars' business.
//
// The flood still *runs* — that's what produces the rim the stars launch from, and
// what makes solids shadow it, so a firework in a box doesn't throw stars through
// the walls. It just doesn't change anything on its way out.
//
// Structurally it is the Cluster shell (cluster.ts) with the payload swapped: the
// whole two-stage mechanism is `detonate`'s rimHandler seam (blast.ts), so this
// file is a trigger check, a launch chance, and a do-nothing cell handler. The
// differences from Cluster are all tuning — a powder instead of a solid shell, a
// launch charge that craters nothing at all instead of full brisance, and stars
// that bloom instead of bomblets that crater.

/** Reach of the main pop. Level with Gunpowder's, so a lone grain behaves like a
 *  firecracker and a packed tube grows the same way any charge does. */
const BLAST_RADIUS = 8;
/** Gunpowder's 파괴력, deliberately verbatim (see gunpowder.ts). The launch charge
 *  never actually destroys anything (its `onCell` leaves every cell alone), so
 *  this no longer decides cell fates — what it still decides is which solids
 *  *shadow* the flood (`blocksBlast`), i.e. that a firework lit inside a stone box
 *  throws its stars into the box's walls and not through them. It's also the power
 *  any OTHER blast inherits when it surveys a mass of this powder, and the value
 *  each star's own bloom uses. */
const DESTRUCTIVE_POWER = 6;
/** Chance each rim cell of the pop throws a star. Higher than Cluster's 0.16
 *  (~8–16 bomblets off an R10 crater): a firework wants a generous spray of
 *  colour, and a star is cheap — it opens a small flower rather than a crater.
 *  An R8 pop's rim is ~45 cells, so this yields roughly 10–20 stars. */
const STAR_RIM_CHANCE = 0.32;

/** The three tones a grain of this powder can be — coral red, grey, light ivory
 *  (코랄레드 + 회색 + 연한 아이보리). Each grain picks one for life from its own
 *  stable `tint` byte (see Material.tintPalette), so a poured tube reads as a
 *  speckled festive mix rather than the single flat hue every other powder is:
 *  `colorVary` can only nudge one colour's brightness, and the point here is
 *  actual different colours. The ordinary brightness grain still rides on top. */
const GRAIN_COLORS: readonly number[] = [
  rgb(0xf2, 0x6b, 0x55), // coral red
  rgb(0x9b, 0x9e, 0xa6), // grey
  rgb(0xf2, 0xeb, 0xd6), // light ivory
];

/**
 * Throw a star from one rim cell — but only out of a cell the launch actually
 * owns: open air, or the bright pop the charge itself left. Launching writes a
 * star into the cell (`spawn`), so firing from a rim cell that still holds terrain
 * would *delete* that grain — and "the launch disturbs nothing it doesn't throw"
 * has to hold at the rim too, not just in the flood (measured: without this, a
 * charge resting on a sand bed ate 8 grains on its launch tick).
 *
 * The practical effect is exactly what a firework should do: a charge sitting on
 * the ground still fires its whole upper rim into the sky, while the rim buried in
 * the ground stays quiet. A charge tamped in on every side throws nothing — which
 * is the right answer for a smothered firework, and matches how it already can't
 * throw stars through the walls of a box.
 */
function fireworksRim(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  if (!sim.isEmpty(x, y) && sim.get(x, y) !== BLAST.id) return;
  if (sim.chance(STAR_RIM_CHANCE)) launchFireworkStar(sim, x, y, dirX, dirY);
}

/**
 * The launch charge's fate for every cell the flood reaches: nothing at all —
 * except the charge itself, which is consumed as a bright pop so it can't
 * re-detonate every tick forever (the same reason blast.ts's own `defaultCell`
 * always flashes an explosive source cell).
 *
 * Returning `true` unconditionally is what makes this a mortar rather than a bomb:
 * the default handling would flash open air into a crater disc and fling every
 * loose grain within reach as Debris, and neither belongs to "최초 폭발시에는
 * 클러스터만 흩뿌리기". Another explosive caught in the survey is deliberately left
 * intact rather than flashed — it sees this pop's flash next tick and goes off as
 * *itself*, with its own crater, instead of being quietly swallowed by ours.
 */
function fireworksCell(sim: SimContext, x: number, y: number, prevId: number): boolean {
  if (prevId === FIREWORKS.id) flashCell(sim, x, y);
  return true;
}

const FIREWORKS_OPTS: DetonateOptions = {
  rimHandler: fireworksRim,
  onCell: fireworksCell,
  // No concussion ring either — the launch disturbs nothing it doesn't throw.
  pressure: false,
};

function updateFireworks(x: number, y: number, sim: SimContext): void {
  let wet = false;
  let trigger = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id) wet = true;
    else if (nid === FIRE.id || nid === LAVA.id || nid === BLAST.id) trigger = true;
  }

  if (!wet && trigger) {
    detonate(sim, x, y, 0, FIREWORKS_OPTS);
    return;
  }
  updatePowder(x, y, sim);
}

export const FIREWORKS = register({
  id: 129,
  name: 'Fireworks',
  phase: Phase.Powder,
  // Only the palette swatch and other `color`-reading UI ever see this — every
  // cell in the world draws one of GRAIN_COLORS instead (tintPalette below). The
  // coral red is the mix's identity colour, and it reads apart from Gunpowder's
  // near-black at a glance.
  color: GRAIN_COLORS[0],
  // Per-grain colour: coral red / grey / light ivory, fixed for each grain's life.
  tintPalette: GRAIN_COLORS,
  // Between Gunpowder (3.8) and the mineral powders: a pressed shell composition
  // is a shade denser than loose black powder, and it still sinks in water so a
  // dunked charge stays wet and misfires.
  density: 4.2,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER, // weak, exactly like Gunpowder
  category: 'explosive',
  thermal: { conductivity: 0.3 },
  update: updateFireworks,
});
