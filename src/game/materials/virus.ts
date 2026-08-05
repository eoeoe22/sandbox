import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid, collapseVoidBelow } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { DIRT } from './dirt';
import { SAND } from './sand';
import { MUD } from './mud';

// Virus — a plague that converts what it touches into more of itself, then
// spreads from there. It infects soft, "organic" matter — anything flammable or
// combustible (plants, wood, the fuels…) plus water and loose earth — one cell
// per tick via `spawn` (which marks the new cell moved, so it can't fill a
// region in a single frame). It leaves the hard world alone: Stone, metals, Glass, Concrete, Wall,
// the gases, and the explosives are all immune, so a virus outbreak is contained
// by a stone or glass wall.
//
// 액체처럼 흐른다 — it is a `Phase.Liquid` goo, not a static solid: a colony runs
// downhill, drips off a ledge and pools in the low ground instead of hanging in
// mid-air wherever it grew. The two throttles below (VIRUS_FLOW_CHANCE and
// `viscosity`) are what keep that from turning into a map-wide flood the first
// time one cell touches a puddle — it creeps and holds a mound rather than
// levelling flat, so a wall, a pit or a container still contains an outbreak.
// Being a fluid rather than structure also costs it two things it used to get
// for free as a Solid, both deliberate: it no longer shields what's behind it
// from 방사선 (radiation.ts blocks on `Phase.Solid`), so a 방사능 source now
// sterilises a whole colony rather than only its near face; and an object or a
// blast shoves it aside like any other liquid instead of treating it as a wall.
//
// The cure is heat and chemistry: it's tagged `flammable`, so Fire and Lava burn
// it out; and an adjacent Acid/Acid Vapor cell, or being heated to boiling,
// kills a cell outright. So the counters are exactly what you'd reach for —
// torch it, douse it in acid, or steam it.
const INFECT_CHANCE = 0.05;
const CURE_TEMP = 100;

// Thick goo doesn't drop like water: the whole movement step (fall + spread) only
// runs on this fraction of ticks, so a colony oozes downhill instead of splashing
// (the same throttle Slime and Lava use, at a looser value — see
// slime.ts's SLIME_FLOW_CHANCE, 0.15). `viscosity` below throttles only the
// LATERAL spread (updateLiquid reads it after the straight fall), so this gate is
// what actually slows the drop, and the two together place the virus between Mud
// (viscosity, no gate — falls at full speed) and Slime (both, at magma pace):
// noticeably slower than mud, roughly three times livelier than slime. Deliberate
// rather than cosmetic — a flowing plague that levelled out like water would
// reach every corner of the map within seconds of the first splash, and the whole
// point of the material is that you can still wall it off and burn it out.
const FLOW_CHANCE = 0.5;

// A virus cell reached by a chemical disinfectant (H₂O₂) becomes a *corrosion
// front*, and its `aux` byte carries a small "reach" budget (1..CURE_SEED_BUDGET).
// On its own turn a front eats itself away and, if any budget is left, hands
// budget-1 to a SINGLE randomly-chosen still-infected neighbour (via `spawn`, so
// it acts only next tick). That one random step per tick does two things the old
// sweep-the-whole-colony wave didn't: the eaten edge comes out ragged and organic
// instead of a clean expanding square, and the decrementing budget hard-caps how
// far one seed can travel — so the spread can't run away across a whole colony.
// Because H₂O₂ is also consumed each time it seeds one (see hydrogenperoxide.ts),
// the total virus a splash can clear is proportional to how much you actually
// pour: a drop can't sterilise a huge mass. Contact-only disinfectants (Alcohol)
// kill the touched cell outright and seed no front. Virus otherwise never uses
// aux, so any healthy cell reads 0 here.
export const CURE_SEED_BUDGET = 10;

function isInfectable(id: number): boolean {
  if (id === EMPTY || id === VIRUS.id) return false;
  if (id === WATER.id || id === SALTWATER.id || id === DIRT.id || id === SAND.id || id === MUD.id) {
    return true;
  }
  const m = getMaterial(id);
  return !!(m.flammable || m.combustion);
}

function updateVirus(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= CURE_TEMP) {
    sim.set(x, y, EMPTY); // boiled/burned away
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === ACID.id || nid === ACID_VAPOR.id) {
      sim.set(x, y, EMPTY); // dissolved by acid
      return;
    }
  }

  // Corrosion front (aux = remaining reach): eat this cell away, and if any reach
  // is left, hand the corrosion to ONE random still-healthy virus neighbour. A
  // single random step per tick makes the eaten boundary ragged (not a geometric
  // ring), and the decrementing budget bounds one seed's total reach so a splash
  // can't sterilise a whole colony. `spawn` marks the chosen neighbour moved so it
  // only acts next tick (one step per tick, no same-tick runaway).
  const budget = sim.getAux(x, y);
  if (budget > 0) {
    if (budget > 1) {
      const cxs: number[] = [];
      const cys: number[] = [];
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!sim.inBounds(nx, ny)) continue;
        if (sim.get(nx, ny) === VIRUS.id && sim.getAux(nx, ny) === 0) {
          cxs.push(nx);
          cys.push(ny);
        }
      }
      if (cxs.length > 0) {
        const k = sim.randInt(cxs.length);
        sim.spawn(cxs[k], cys[k], VIRUS.id); // moved-guard: acts next tick
        sim.setAux(cxs[k], cys[k], budget - 1);
      }
    }
    sim.set(x, y, EMPTY); // corroded away
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    if (isInfectable(sim.get(nx, ny)) && sim.chance(INFECT_CHANCE)) {
      sim.spawn(nx, ny, VIRUS.id);
      return;
    }
  }

  // An enclosed hole inside the goo collapses at once, outside the flow gate —
  // otherwise the gate and `viscosity` together leave a settling colony pitted
  // with empty cells that render as bare background (see collapseVoidBelow in
  // behaviors.ts for the measurements, and slime.ts for the same call).
  if (collapseVoidBelow(x, y, sim)) return;

  // Flow. Everything above — curing, corroding, infecting — still runs every
  // tick; only the movement is gated, so a stalled cell keeps infecting and
  // keeps dying to whatever is touching it.
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

/**
 * 스며든 바이러스 — the turn a cell takes once it has soaked into a powder bed
 * through the 겹침 layer (SimContext.soakDown, or a falling grain swallowing it in
 * tryMove). `(x, y)` is the HOST cell; the virus is its overlay occupant.
 *
 * This exists because an overlay occupant does NOT run its material's `update`
 * (see Simulation's per-cell step: a soaked fluid gets `updateSoaked` +
 * `updateOverlay` only). Without it a virus that seeped into a sand or ash bed
 * would go completely inert — invisible, unable to infect, and unable to be cured
 * by heat or acid, i.e. an immortal reservoir sitting under a pile the player has
 * no way to see or clear. That is the one genuinely new failure mode a liquid
 * virus has that a solid one couldn't, so it is answered here rather than by
 * forbidding the soak: a plague percolating down through the ground and eating it
 * from the inside is the more interesting version anyway.
 *
 * Its three rules are exactly the ones a surfaced cell keeps: die in heat, die
 * against acid, and infect. Infecting the host is what resolves the situation —
 * `set` cannot leave the virus in the slot (a Liquid hosts no overlay), so the
 * grain and the droplet inside it become one ordinary virus cell that then
 * behaves normally. The chemical cures (H₂O₂, Alcohol, Soapy Water) all scan for
 * a *primary* Virus cell and so can't reach a soaked one — deliberate, and the
 * reason heat and acid are kept here: 땅속에 숨은 바이러스는 태우거나 녹여야 한다.
 * 방사선 likewise only doses primary cells (radiation.ts).
 */
function updateSoakedVirus(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= CURE_TEMP) {
    sim.clearOverlay(x, y);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === ACID.id || nid === ACID_VAPOR.id) {
      sim.clearOverlay(x, y);
      return;
    }
  }

  // Infect the grain holding it. `set` on the host destroys an overlay the new
  // material can't hold, so the pair collapses into a single Virus cell — the
  // mirror of the two-cells-become-one absorb that put the virus in there.
  if (isInfectable(sim.get(x, y)) && sim.chance(INFECT_CHANCE)) {
    sim.set(x, y, VIRUS.id);
  }
}

export const VIRUS = register({
  id: 48,
  name: 'Virus',
  phase: Phase.Liquid,
  color: rgb(158, 66, 176),
  // Just denser than Water (3) and than H₂O₂ (3.4), so a colony dropped into a
  // pool sinks and creeps along the bottom while it infects, and a splash of the
  // disinfectant poured on top floats and eats its way down rather than sliding
  // underneath. It was 1000 before — a placeholder, since a Solid's density is
  // never read by the movement code.
  density: 3.6,
  // Thick, gooey ooze — holds a slumping mound instead of spreading flat. The
  // lateral half of the throttle; FLOW_CHANCE above is the half that slows the
  // fall. Just under the roster's thickest goos (Slime/Acid Slime 0.86, Mud 0.82,
  // Honey 0.8), so it is the runniest of the goos while still nothing like water.
  viscosity: 0.85,
  flammable: true,
  category: 'life',
  // 피폭사 — 방사선 멸균, and a fourth counter to an outbreak alongside fire, acid
  // and steam: a cell touching anything radioactive is sterilised to nothing, the
  // same remains its other deaths leave (see engine/radiation.ts). A wall of Nuke
  // Waste is a firebreak a plague can't cross.
  radiationDeath: EMPTY,
  thermal: { conductivity: 0.3 },
  update: updateVirus,
  // 스며든 바이러스도 살아 있다 — keeps a cell that soaked into a powder bed
  // infecting and curable instead of inert (see updateSoakedVirus).
  overlapUpdate: updateSoakedVirus,
});
