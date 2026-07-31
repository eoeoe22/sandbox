import { register, getMaterial } from './registry';
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
import { detonate } from './blast';
import { launchDebris } from './debris';

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
// (sodium.ts) — but a burn that shakes. A grain reacting from *inside* a pile
// thumps out an invisible shockwave (see stirShock below), which tosses the loose
// grit around it and keeps turning fresh metal up into the gas. Without it a pile
// simply crusts over in its own salt after one layer and the reaction dies with
// the core untouched, since powders don't sink through each other. So a stockpile
// gassed with chlorine churns and burns down instead of sealing itself, and the
// player doesn't have to hand-stir it.
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
// ── The stirring thump (see stirShock) ───────────────────────────────────────
// A grain with at least this many sodium neighbours is reacting from inside a
// pile rather than as a loose sprinkle, and only that case thumps: a lone grain
// popping in mid-air has nothing to stir, and throwing its salt around would
// spoil the clean "sprinkle it and it rains salt" picture for nothing.
const STIR_NEIGHBORS = 3;
const STIR_REACH = 4; // × the global 2/3 blast-scale ⇒ ~3 cells: it churns the
// pile it's standing in, and nothing further. (A Woofer's own REACH is 12; this
// fires once per reacting grain instead of once per electric pulse, so it has to
// be local or a burning stockpile would hose the whole scene.)
const STIR_POWER = 0; // identical to the Woofer: too weak to break anything at all

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

/** How many of a cell's 8 neighbours are sodium — "is this grain part of a pile,
 *  or a loose sprinkle?" (mirrors sodium.ts's own DENSE_NEIGHBORS test, which
 *  splits its water fizzle from its water detonation on the same question). */
function sodiumNeighbors(x: number, y: number, sim: SimContext): number {
  let n = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === SODIUM.id) n++;
  }
  return n;
}

/**
 * The invisible thump a pile-buried reaction gives off — the Woofer's shockwave
 * (woofer.ts) borrowed wholesale: the blast subsystem's *physics* only, pinned to
 * POWER 0 so it cannot break anything however flimsy, structural solids shadow it
 * untouched, and loose grit within reach is flung as mass-conserving Debris that
 * arcs out and rains back. That shove is the whole point here: it re-mixes the
 * salt crust with the metal under it.
 *
 * Two things it must never do, both handled by `onCell`:
 *   • **Show itself.** Every EMPTY cell the front reaches is claimed and left
 *     alone, so no Blast flash is painted (same trick as wooferPulse). A flash
 *     would read as an explosion, and it can decay into stray Fire besides.
 *   • **Set anything off.** The default cell handler consumes an `explosive` cell
 *     into a flash *regardless of power* — which here would mean the shockwave
 *     detonating the very sodium it exists to stir, and any charge stored nearby
 *     with it. So explosives are intercepted: loose ones (sodium is a powder) take
 *     the ordinary Debris shove instead, solid ones are passed over untouched.
 *     Everything non-explosive falls through to the normal handling.
 */
function stirShock(sim: SimContext, x: number, y: number): void {
  detonate(sim, x, y, 0, {
    power: STIR_POWER,
    reach: STIR_REACH,
    // Each thump is its own small, self-contained wave — never pooled with a
    // neighbouring one into a bigger mass survey (see DetonateOptions).
    soloSource: true,
    // …and it doesn't craze glass, which a Woofer's pulse (and any real blast)
    // does. This one fires continuously for as long as a pile burns, so the
    // default would quietly dismantle any glass vessel the burn was set up in —
    // the player built that container to *hold* the reaction. The pane still
    // shadows the wave; it just doesn't break.
    shatters: false,
    onCell: (s, cx, cy, prevId, entryDx, entryDy, outB) => {
      if (prevId === EMPTY) return true; // invisible: claimed, no flash
      const m = getMaterial(prevId);
      if (!m.explosive) return false; // ordinary matter: default handling
      if (m.phase !== Phase.Solid) launchDebris(s, cx, cy, prevId, entryDx, entryDy, outB);
      return true;
    },
  });
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
      const buried = sodiumNeighbors(nx, ny, sim) >= STIR_NEIGHBORS;
      sim.spawn(nx, ny, FIRE.id);
      sim.setTemp(nx, ny, REACT_TEMP);
      sim.set(x, y, SALT.id);
      sim.setTemp(x, y, SALT_TEMP);
      // Reacting inside a pile: thump, so the salt just made doesn't settle into
      // a lid over the metal (see stirShock). Fired from this cell — the gas side
      // — because it's the one facing away from the pile, so the wave lifts the
      // covering grit rather than driving it in. Counted *before* the writes
      // above, while the neighbourhood is still the pile it was.
      if (buried) stirShock(sim, x, y);
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
