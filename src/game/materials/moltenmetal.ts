import { register, getMaterial } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateLiquid } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { IRON } from './iron';
import { FIRE } from './fire';

// Molten Metal — the liquid, glowing counterpart to Iron, exactly mirroring the
// Lava↔Stone pair one notch hotter. It's placed white-hot and dense enough (8)
// to sink through water and oil (shoving them up out of its way), and within the
// smelting hearth it's the *densest* of the three molten phases — Slag (6) <
// Molten Iron Ore (7) < Molten Metal (8) — so, just as pig iron does under the
// slag in a real hearth, the reduced iron sinks and collects as a bright pool on
// the floor, beneath the ore and the lighter waste slag floating above it. It
// flows sluggishly like thick lava, ignites
// flammable neighbors with its radiant heat, and freezes back into solid Iron
// once conduction has pulled it below the freeze point. As with Lava, nothing
// cold touching it means it never cools (air conducts no heat), so an isolated
// molten pool stays liquid forever; water or metal bridging the heat away is
// what lets it set.
// Iron's melt point sits low enough that the *recommended* smelting fire — a
// coal bed with a modest oxygen blast — actually reaches it: two Oxygen cells
// pin a burning coal at 1300° (see combustion.ts), comfortably past this, so an
// ore→iron→cast workflow no longer demands Lava/Blue Flame/Thermite. It stays
// above a bare flame (~1000°), so ordinary Fire still can't melt iron, and just
// above Stone's 1100° melt — so the blast that melts iron also slumps a stone
// crucible, which is what makes a Diamond/Heatpipe hearth the recommended
// container (both conduct superbly and never melt).
export const IRON_MELT_TEMP = 1200;
// Placed hotter than it freezes, with a wide gap so the surface has to shed a
// lot of heat before it skins over into Iron — a gradual crust, like Lava's.
// Freeze stays below the melt point (100° hysteresis) so a just-melted cell
// can't instantly re-solidify and flicker at the boundary.
const MOLTEN_METAL_TEMP = 1550;
const MOLTEN_METAL_FREEZE_TEMP = 1100;
const IGNITE_CHANCE = 0.12;
const FLOW_CHANCE = 0.2;

function updateMoltenMetal(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) <= MOLTEN_METAL_FREEZE_TEMP) {
    // Cooled enough to set. In-place `set` keeps the (now low) temperature so
    // the fresh Iron reads as cold and keeps conducting heat out of any molten
    // metal still beneath it.
    sim.set(x, y, IRON.id);
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

  // Thick and slow: only flows on a fraction of ticks (see Lava's identical gate).
  if (sim.chance(FLOW_CHANCE)) updateLiquid(x, y, sim);
}

export const MOLTEN_METAL = register({
  id: 29,
  name: 'Molten Metal',
  phase: Phase.Liquid,
  color: rgb(255, 150, 50),
  density: 8,
  category: '불·열',
  thermal: { init: MOLTEN_METAL_TEMP, conductivity: 0.85 },
  // Glows blazing yellow-white when fully molten and darkens to a dull ember as
  // conduction cools it toward setting, so the cooling front is visible before
  // it turns to grey Iron.
  glow: { min: MOLTEN_METAL_FREEZE_TEMP, max: MOLTEN_METAL_TEMP, cool: rgb(95, 45, 30) },
  update: updateMoltenMetal,
});
