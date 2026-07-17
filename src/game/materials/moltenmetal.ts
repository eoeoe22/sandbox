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
// smelting hearth it's the *densest* of the whole stack — Slag (5.5) < Molten
// Iron Ore (6.5) < Coal Powder (7.5) < Molten Metal (8), see slag.ts/
// moltenironore.ts/coalpowder.ts — so, just as pig iron does under the slag in a
// real hearth, the reduced iron sinks and collects as a bright pool on the
// floor, beneath the ore, the carbon dusted on it, and the lighter waste slag
// floating above it. It flows sluggishly like thick lava, ignites
// flammable neighbors with its radiant heat, and freezes back into solid Iron
// once conduction has pulled it below the freeze point. As with Lava, nothing
// cold touching it means it never cools (air conducts no heat), so an isolated
// molten pool stays liquid forever; water or metal bridging the heat away is
// what lets it set. (A cold solid a cell or two away, across the air, does
// draw a little heat via the near-field radiative pass — see
// RADIANT_HEAT_RANGE in config.ts — but with nothing at all in range the pool
// stays molten forever exactly as before.)
// Iron's melt point sits low enough that a bare coal fire reaches it: Coal
// pins its own burn at 1300° (see coal.ts's `burnTemp` override in
// combustion.ts), comfortably past this with no oxygen blast needed, so an
// ore→iron→cast workflow no longer demands Lava/Blue Flame/Thermite. It stays
// above a bare Fire (~1000°), so ordinary Fire still can't melt iron, and just
// above Stone's 1100° melt — so the coal fire that melts iron also slumps a
// stone crucible, which is what makes a Diamond/Heatpipe hearth the
// recommended container (both conduct superbly and never melt).
export const IRON_MELT_TEMP = 1200;
// Placed hotter than it freezes, with a wide gap so the surface has to shed a
// lot of heat before it skins over into Iron — a gradual crust, like Lava's.
const MOLTEN_METAL_TEMP = 1550;
// Kept below Molten Iron Ore's own SOLIDIFY_TEMP (750, moltenironore.ts) —
// deliberately, not just "some hysteresis" — because this is also the
// temperature freshly-reduced metal cools to *while still submerged in the
// ore/slag it was just pulled out of* (see REDUCE_HEAT there): a reduction is
// exothermic and starts a cell far above this, but ordinary conduction with
// the surrounding, still-liquid ore/slag pulls it right back down toward
// *their* temperature within a tick or two, long before it has sunk clear to
// the pool below (density-sorted sinking is gated and slow — see
// DISPLACE_DRAG_* in config.ts). If this sat at or above the ore's own
// solidify point (it used to, at 1100° — a plain melt/freeze hysteresis gap
// copied from Lava/Stone without checking it against the *other* material this
// one is born inside), every reduced cell would freeze into a stray Iron fleck
// exactly where it formed, well before consolidating — the reduced metal has
// to be able to outlive its parent ore's own liquid state, or the "clean pool
// of iron under a slag skin" the smelting flow is built around (see
// moltenironore.ts) never actually forms; instead the furnace fills with
// scattered solid grit, including right at the ore surface where the player
// is watching it "smelt" — the reported bug. 100° of margin below 750 (rather
// than exactly 750) covers an ore cell that's mid-cool itself, hovering just
// above its own solidify point.
const MOLTEN_METAL_FREEZE_TEMP = 650;
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
