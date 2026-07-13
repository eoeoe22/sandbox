import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import { updateHeavyGas } from '../engine/behaviors';
import type { SimContext } from '../engine/SimContext';
import { AMBIENT_TEMP } from '../config';
import { FIRE } from './fire';

// Carbon Dioxide (이산화탄소) — the world's first *heavy* gas and its first
// "smother it" fire extinguisher. Unlike Smoke/Steam/Oxygen (which all rise), CO₂
// is denser than air, so it slumps to the floor and pools in low ground, sliding
// under the lighter gases and settling on top of any liquid (see updateHeavyGas /
// its density below). Flood a burning room's floor with it and the fire drowns.
//
// Extinguishing is two-pronged, so it actually *keeps* a fire out instead of
// letting it flare back (기존엔 불꽃만 지워 근접 인화로 재발화했다):
//   • Snuff — any adjacent Fire cell is displaced outright (the flame has no
//     oxygen), deterministically now, so the visible flame dies the instant CO₂
//     reaches it.
//   • Smother — this is the key: a *burning fuel* cell (Coal/Wood/…) doesn't
//     vanish while it burns — combustion pins it hot (~800°) and it re-wreaths
//     flame every tick, which is exactly why snuffing alone let it re-ignite. So
//     CO₂ also cools any adjacent burning combustible back below its ignition
//     point (mirrors Soda's dry-chem smother), which is what genuinely puts the
//     fuel out. Because CO₂ is a gas that floods and pools across a whole burning
//     bed, this cooling is inherently wide-area — a poured blanket walks over the
//     coals and cools them all, rather than killing one flame lick at a time.
// It's otherwise inert and slowly thins back into air so a room doesn't stay
// gassed forever.
//
// It's also what Dry Ice now sublimates into (see dryice.ts) instead of vanishing
// to nothing — a block of dry ice fumes a cold, creeping CO₂ fog that pools and
// snuffs fire, exactly like the real thing.
// A burning fuel cell is pinned at combustion's ~800°; this threshold sits above
// every fuel's autoignition point (highest is Coal at 580) but below that pin, so
// it catches actively-burning cells without touching merely-warm material —
// identical to Soda's SMOTHER_TEMP.
const SMOTHER_TEMP = 600;
const SMOTHER_CHANCE = 0.6; // per adjacent burning cell — a CO₂ blanket reliably wins
const DISSIPATE_CHANCE = 0.002; // slowly thins back into air (no permanent fog)

function updateCO2(x: number, y: number, sim: SimContext): void {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id) {
      // Snuff the flame outright — writing EMPTY to a neighbor is always safe.
      sim.set(nx, ny, EMPTY);
    } else if (
      nid !== EMPTY &&
      getMaterial(nid).combustible &&
      sim.getTemp(nx, ny) >= SMOTHER_TEMP &&
      sim.chance(SMOTHER_CHANCE)
    ) {
      // Cool the burning fuel out of its ignition band so it stops re-lighting
      // itself (see combustion.ts — a burning fuel is fuel pinned hot). This is
      // what stops the "꺼졌다가 다시 붙는" re-ignition.
      sim.setTemp(nx, ny, AMBIENT_TEMP);
    }
  }

  // Inert and long-lived, but not eternal — a very low per-tick chance to thin
  // back into air keeps a gassed room from staying gassed forever.
  if (sim.chance(DISSIPATE_CHANCE)) {
    sim.set(x, y, EMPTY);
    return;
  }

  updateHeavyGas(x, y, sim);
}

export const CO2 = register({
  id: 87,
  name: 'CO2',
  phase: Phase.Gas,
  color: rgb(150, 160, 172),
  // Heavier than the ordinary gases (all density 1) so it sinks below them and
  // pools on the floor, but lighter than every liquid (Water 3) so it settles on
  // a puddle's surface instead of diving through. See updateHeavyGas.
  density: 2,
  category: '기체',
  // A gas, so it conducts heat poorly; it mostly carries cold (from sublimating
  // Dry Ice) by physically flowing rather than by conduction.
  thermal: { conductivity: 0.06 },
  update: updateCO2,
});
