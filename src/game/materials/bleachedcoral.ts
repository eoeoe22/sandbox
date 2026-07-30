import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { radiationLevel } from '../engine/radiation';
import { SALTWATER } from './saltwater';
import { CORAL } from './coral';

// Bleached Coral (백화 산호) — what a coral polyp leaves behind when it dies: the
// bare white calcium-carbonate skeleton, with none of the living tissue's colour.
// It's produced by Coral itself (coral.ts) whenever a cell's bleaching stress
// maxes out — heat over its tolerance, or brine that has drained away, gone
// fresh, or been built over — and it's paintable on its own for anyone who wants
// to lay out a dead reef and then try to bring it back.
//
// Which is the point of the one rule it has: 재생 (recolonisation). A skeleton
// that ends up properly submerged in cool salt water again — RECOVER_BRINE of its
// eight neighbours, under RECOVER_TEMP — is very occasionally taken over by new
// polyps and turns back into living Coral, which then starts branching from
// there. It is deliberately slow, far slower than the bleaching that produced it:
// killing a reef takes seconds and growing it back takes patience, which is the
// whole shape of the thing being modelled. Leave the tank hot or fresh and it
// simply stays white forever.
//
// Structurally it is plain inert rock: it holds its shape, blocks and supports
// like any solid, doesn't burn, and (being limestone, not stone) Acid eats it.
const RECOVER_CHANCE = 0.0008; // per tick, and only while fully submerged and cool
const RECOVER_BRINE = 3; // saltwater neighbours needed before polyps take hold
const RECOVER_TEMP = 30; // comfortably below Coral's own bleaching threshold

function updateBleachedCoral(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) > RECOVER_TEMP || !sim.chance(RECOVER_CHANCE)) return;

  let brine = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny) && sim.get(nx, ny) === SALTWATER.id) brine++;
  }
  if (brine < RECOVER_BRINE) return;

  // Nothing settles in a hot tank: a dose from anything in the 방사능 tab blocks
  // recolonisation outright (see engine/radiation.ts). Without this a skeleton
  // beside a waste drum would keep flickering — a polyp taking hold, bleaching
  // straight back out on its accumulated stress, over and over. Clear the source
  // out and the reef can come back exactly as before.
  if (radiationLevel(x, y, sim) > 0) return;

  // Recolonised. In-place `set` keeps the cell's temperature; a zeroed aux means
  // "no structure yet", so coral.ts's own init gives the fresh polyp a heading
  // and a full run of vigour on its next tick. CORAL's id is read here rather
  // than at module level because coral.ts imports this module back (the deferred
  // read obsidian.ts/stone.ts use).
  sim.set(x, y, CORAL.id);
  sim.setAux(x, y, 0);
}

export const BLEACHED_CORAL = register({
  id: 135,
  name: 'Bleached Coral',
  phase: Phase.Solid,
  // Bone white with the faintest grey — next to living Coral's pink it should
  // read as "the colour went out of it" at a glance.
  color: rgb(226, 223, 213),
  colorVary: 12,
  density: 1000,
  category: 'life',
  // No `radiationDeath` — there's nothing left in it to kill (see
  // engine/radiation.ts). Radiation reaches this material the other way round: it
  // keeps the living Coral it would recolonise from ever taking hold, so a
  // skeleton in an irradiated tank simply stays white.
  // Same skeleton as living Coral, so it conducts the same.
  thermal: { conductivity: 0.4 },
  update: updateBleachedCoral,
});
