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
import { BLAST, detonate, type DetonateOptions } from './blast';
import { launchFireworkStar } from './fireworkstar';

// Fireworks (불꽃놀이 화약) — a powder that goes up like a firework shell rather
// than a bomb. It triggers exactly the way Gunpowder does (an adjacent Fire /
// Lava / Blast sets it off, a Water/Saltwater neighbour makes it wet and it
// misfires), and it hits exactly as hard as Gunpowder does — a low
// `destructivePower` that heaves loose powder and water aside as Debris but can't
// crack stone, metal or glass (파괴력은 Gunpowder 수준). What it adds is the second
// stage: from the rim of its own pop it lobs a scatter of Firework Stars
// (fireworkstar.ts), each of which arcs up and opens a *coloured flower* where it
// bursts, in a colour rolled per star (각 자탄의 폭발 색상을 랜덤하게).
//
// Structurally it is the Cluster shell (cluster.ts) with the payload swapped: the
// whole two-stage mechanism is `detonate`'s rimHandler seam (blast.ts), so this
// file is a trigger check, a launch chance, and nothing else. The differences from
// Cluster are all tuning — a powder instead of a solid shell, Gunpowder-weak
// instead of full brisance, and stars that bloom instead of bomblets that crater.

/** Reach of the main pop. Level with Gunpowder's, so a lone grain behaves like a
 *  firecracker and a packed tube grows the same way any charge does. */
const BLAST_RADIUS = 8;
/** Gunpowder's 파괴력, deliberately verbatim (see gunpowder.ts): below every
 *  phase's default durability, so the pop breaks nothing solid and shoves all
 *  loose matter within reach. */
const DESTRUCTIVE_POWER = 6;
/** Chance each rim cell of the pop throws a star. Higher than Cluster's 0.16
 *  (~8–16 bomblets off an R10 crater): a firework wants a generous spray of
 *  colour, and a star is cheap — it opens a small flower rather than a crater.
 *  An R8 pop's rim is ~45 cells, so this yields roughly 10–20 stars. */
const STAR_RIM_CHANCE = 0.32;

function fireworksRim(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  if (sim.chance(STAR_RIM_CHANCE)) launchFireworkStar(sim, x, y, dirX, dirY);
}

const FIREWORKS_OPTS: DetonateOptions = { rimHandler: fireworksRim };

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
  // A pale festive grey-lilac, so a poured tube reads apart from Gunpowder's
  // near-black at a glance.
  color: rgb(196, 168, 200),
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
