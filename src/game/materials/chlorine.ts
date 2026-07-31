import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateHeavyGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { PLANT } from './plant';
import { VIRUS } from './virus';
import { YEAST } from './yeast';
import { SEED } from './seed';
import { SLIME } from './slime';
import { TERMITE } from './termite';
import { CORAL } from './coral';
import { SODIUM } from './sodium';
import { SALT } from './salt';
import { FIRE } from './fire';

// Chlorine (염소가스) — a heavy, sickly yellow-green poison gas. Like CO₂ it's
// denser than air, so it slumps and pools along the floor (see updateHeavyGas),
// but where CO₂ merely suffocates, Chlorine *kills*: any living thing it touches —
// Plant, Virus, Yeast, Seed, Slime, Coral — withers to nothing. It creeps into low
// ground and wipes out a garden or an infection from below, the classic "gas the
// trench" horror. It's otherwise inert and slowly disperses back into air.
//
// (In reality Chlorine is made by mixing Bleach with Acid; Bleach isn't in the
// game yet, so for now it's a directly-placed hazard. When Bleach lands it will
// spawn Chlorine on contact with Acid — see the wiki's 신규 물질 doc.)
//
// The one thing it isn't inert against is **Sodium**: 2Na + Cl₂ → 2NaCl, the
// textbook "make table salt out of two poisons" reaction. The touched grain
// flashes to Fire and this gas cell — the chlorine it consumed — becomes the
// grain of Salt. Chlorine is the oxidiser here, so the reaction needs no fuel, no
// air and no ignition source: it runs just as well inside a sealed pocket. One
// cell of gas converts exactly one grain, so a cloud is a finite reagent rather
// than a catalyst.
//
// It is deliberately a *burn*, not the detonation sodium does in water or acid
// (sodium.ts). Sprinkle sodium into a cloud and every grain converts, flames
// popping and salt raining down; dump the gas on a packed pile instead and only
// the surface goes, because the salt it makes falls onto the pile and crusts it
// over (powders don't sink through each other). Water's rule is "the more you
// pile up the bigger the bang", chlorine's is the mirror of it — "the more you
// pile up the less of it burns", and the player's answer is to scatter or stir.
// See docs/MATERIAL-SYSTEMS.md for why the crust was kept rather than fixed.
const KILL_CHANCE = 0.3; // living neighbors wither fairly fast
const DISSIPATE_CHANCE = 0.004; // disperses back into air over time
const SODIUM_REACT_CHANCE = 0.35; // contact burns fast, but grain by grain
// Heat of reaction, same figure sodium.ts uses for its water flare. Deliberately
// under Salt's 800° melting point (moltensalt.ts) so the product piles up as Salt
// instead of the flame promptly melting its own output into Molten Salt.
const REACT_TEMP = 720;
// The fresh grain of salt is hot from the reaction but not glowing — it has to
// stay well clear of 800° even after the flame beside it warms it a while.
const SALT_TEMP = 400;

function isLiving(id: number): boolean {
  return (
    id === PLANT.id ||
    id === VIRUS.id ||
    id === YEAST.id ||
    id === SEED.id ||
    id === SLIME.id ||
    id === TERMITE.id ||
    // Living coral polyps wither away to nothing like everything else here —
    // gassing a reef erases it rather than bleaching it. Bleached Coral is
    // already-dead rock, not a living thing, so it is deliberately NOT on this
    // list and a gassed reef leaves bare seabed (see coral.ts/bleachedcoral.ts:
    // 백화 is the heat/brine death, and it's the only one that leaves a skeleton).
    id === CORAL.id
  );
}

function updateChlorine(x: number, y: number, sim: SimContext): void {
  // Poison: kill any living neighbor. A write to EMPTY is always safe (it can't
  // cause same-tick re-processing).
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === SODIUM.id && sim.chance(SODIUM_REACT_CHANCE)) {
      // 2Na + Cl₂ → 2NaCl. The burning grain flashes to Fire exactly as it does
      // in water (sodium.ts), and the salt is born in *this* cell — the consumed
      // gas — rather than on top of the grain. Which cell gets which product is
      // not cosmetic: laying the salt down on the grain itself armours the metal
      // where it stands, so the front stalls against a crust that never had to
      // fall there in the first place. Made in the gas, the salt falls clear —
      // and where it lands is then the pile's own doing, not the rule's.
      sim.spawn(nx, ny, FIRE.id);
      sim.setTemp(nx, ny, REACT_TEMP);
      sim.set(x, y, SALT.id);
      sim.setTemp(x, y, SALT_TEMP);
      return;
    }
    if (isLiving(nid) && sim.chance(KILL_CHANCE)) {
      sim.set(nx, ny, EMPTY);
    }
  }

  if (sim.chance(DISSIPATE_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  updateHeavyGas(x, y, sim);
}

export const CHLORINE = register({
  id: 96,
  name: 'Chlorine',
  phase: Phase.Gas,
  color: rgb(190, 214, 92),
  // Heaviest of the gases — sinks below CO₂ (2) and the ordinary gases (1), pools
  // on the floor, but still lighter than any liquid so it rides on a puddle.
  density: 2.5,
  category: 'gas',
  thermal: { conductivity: 0.06 },
  update: updateChlorine,
});
