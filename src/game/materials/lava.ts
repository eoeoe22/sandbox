import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { STONE } from './stone';
import { FIRE } from './fire';

// Liquid: flows like water but gated behind a per-tick probability so it
// visibly moves slower/thicker (density > water, so water floats and sand
// sinks). Lava is placed molten-hot; it solidifies to Stone once it has *cooled*
// past a threshold rather than the instant it touches water. Cooling is driven
// entirely by the heat-conduction system: water poured on top boils away and
// carries heat off, and — crucially — heat keeps conducting *through* the Stone
// crust that forms at the interface, so the lava underneath keeps losing heat
// and freezes too. The crust slows solidification but never fully blocks it.
//
// Because Empty (air) conducts no heat, a lava blob with nothing cold touching
// it never cools below the freeze point, so isolated lava stays molten forever
// (matching its original behavior) — it's specifically a cold sink like water
// that lets it set. (A cold solid within a couple of cells, even without
// touching, does draw a little heat away via the near-field radiative pass —
// see RADIANT_HEAT_RANGE in config.ts — but a truly isolated blob with nothing
// in range stays molten exactly as before.)
const IGNITE_CHANCE = 0.15;
const FLOW_CHANCE = 0.15;

// Placement temperature and the point it hardens at. The wide gap between them
// is what makes crusting gradual: the surface has to shed a lot of heat before
// it sets, so a lava/water interface skins over across many ticks.
const LAVA_TEMP = 1500;
const LAVA_FREEZE_TEMP = 560;

function updateLava(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) <= LAVA_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the cell's (now low)
    // temperature, so the fresh Stone reads as cold rock and keeps conducting
    // heat out of whatever molten lava is still beneath it.
    sim.set(x, y, STONE.id);
    return;
  }

  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (getMaterial(nid).flammable && sim.chance(IGNITE_CHANCE)) {
      sim.spawn(nx, ny, FIRE.id);
    }
  }

  // No `return` above (intentionally — lets several neighbors ignite in one
  // tick), so a just-ignited Fire neighbor is live grid state by the time we
  // reach here: if the flow gate fires and picks that direction, Lava (denser
  // than Fire) can immediately swap into the cell it just ignited, pushing
  // the Fire out to Lava's old position. Both cells end up `moved`, so this
  // isn't a same-tick runaway — just a legitimate density-sorted swap that
  // makes ignition-then-displacement visually chase itself forward.
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const LAVA = register({
  id: 10,
  name: 'Lava',
  phase: Phase.Liquid,
  color: rgb(220, 70, 20),
  density: 4.5,
  category: '불·열',
  thermal: { init: LAVA_TEMP, conductivity: 0.6 },
  // Molten lava glows bright orange (base color); as conduction cools it toward
  // the freeze point it darkens to a dull ember, so the crust and the cooling
  // front beneath it are visible before they turn to grey Stone.
  glow: { min: LAVA_FREEZE_TEMP, max: LAVA_TEMP, cool: rgb(120, 28, 12) },
  update: updateLava,
});
