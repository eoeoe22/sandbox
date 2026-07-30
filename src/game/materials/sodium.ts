import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updatePowder } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { ACID } from './acid';
import { FIRE } from './fire';
import { HYDROGEN } from './hydrogen';
import { detonate } from './blast';

// Sodium (나트륨) — a soft silvery metal powder that turns a quiet puddle into a
// hazard. It's lighter than water, so a pinch tossed on a pool rides the surface
// (see the density below) and reacts on contact: 2Na + 2H₂O → 2NaOH + H₂ + heat.
// In the sim a reacting grain flashes to Fire (the burning metal) and turns the
// water it touched into hot Hydrogen — which, sitting next to that fresh flame,
// promptly ignites, so even a light sprinkle whooshes into a spreading fire over
// the water.
//
// A *packed* pile is the real payoff: when a grain deep in a mass touches water
// (so it has many sodium neighbours), the whole connected lump detonates at once
// as a proper shockwave that scales with how much you piled up — "물 조금이면 불,
// 뭉쳐두면 폭발". It's tagged `explosive` purely so that blast surveys the whole
// connected sodium mass for a proportional crater; nothing but a wetting liquid
// (water, brine, acid) sets it off.
//
// **Acid counts as water here**, and takes the same path rather than the quiet
// `acidHydrogen` fizz every other metal got (types.ts / acid.ts). Sodium is the
// top of the reactivity series — it tears hydrogen out of *neutral* water, so an
// acid can only be worse — and routing it through the tag would have been an
// outright downgrade: the drop-a-lump-in-acid outcome would have been a polite
// stream of cool bubbles from the metal that detonates in a puddle. So an acid
// contact fizzles to Fire + hot Hydrogen and a packed pile in acid still goes off
// as one shockwave, exactly as in water. (Acid's own corrosion pass can still eat
// a grain silently at 0.03, but at REACT_CHANCE 0.5 it almost never gets there
// first.)
const REACT_CHANCE = 0.5; // reacts with water fast, but not every single tick
const REACT_TEMP = 720; // heat of reaction — hot enough to light the released H₂
// A grain with at least this many sodium neighbours is buried in a pile, so its
// water contact sets off the whole mass instead of merely fizzling.
const DENSE_NEIGHBORS = 5;
const BLAST_RADIUS = 4; // a lone grain's pop; a packed mass reaches much farther
// Enough to crater loose powder/liquid and shove terrain, but below a solid's
// durability (200) — a chemical blast heaves and burns rather than leveling stone.
const DESTRUCTIVE_POWER = 45;

function updateSodium(x: number, y: number, sim: SimContext): void {
  // The wetting liquid this grain reacts with: water, brine, or acid.
  let wetX = -1;
  let wetY = -1;
  let sodiumCount = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === WATER.id || nid === SALTWATER.id || nid === ACID.id) {
      if (wetX < 0) {
        wetX = nx;
        wetY = ny;
      }
    } else if (nid === SODIUM.id) {
      sodiumCount++;
    }
  }

  if (wetX >= 0 && sim.chance(REACT_CHANCE)) {
    if (sodiumCount >= DENSE_NEIGHBORS) {
      // Buried in a pile: the liquid contact sets off the whole connected mass as
      // one shockwave (detonate surveys every `explosive` cell reachable from
      // here), so a big lump goes off far bigger than a lone grain.
      detonate(sim, x, y);
      return;
    }
    // Light contact: fizzle. The touched liquid becomes hot Hydrogen (the gas the
    // reaction liberates), and this grain burns off as Fire — the flame then
    // ignites that hydrogen for the signature over-water whoosh.
    sim.spawn(wetX, wetY, HYDROGEN.id);
    sim.setTemp(wetX, wetY, REACT_TEMP);
    sim.set(x, y, FIRE.id);
    sim.setTemp(x, y, REACT_TEMP);
    return;
  }

  updatePowder(x, y, sim);
}

export const SODIUM = register({
  id: 86,
  name: 'Sodium',
  phase: Phase.Powder,
  color: rgb(176, 180, 198),
  // Lighter than water (3) so a grain floats and reacts at the surface instead of
  // sinking out of reach — the iconic "sodium skitters across the pond" look.
  density: 2.5,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  destructivePower: DESTRUCTIVE_POWER,
  category: 'powder',
  thermal: { conductivity: 0.4 },
  update: updateSodium,
});
