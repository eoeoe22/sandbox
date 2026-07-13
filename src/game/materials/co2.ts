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
// A burning fuel cell is pinned at combustion's ~800°; SMOTHER_TEMP sits above
// every fuel's autoignition point (highest is Coal at 580) but below that pin, so
// the chill cools actively-burning cells without touching merely-warm material.
const SMOTHER_TEMP = 600;
// The chill is *triggered* by a fuel neighbour merely this warm — well below
// "burning". This is the crux of putting out a thick line: once CO₂ cools the
// surface layer it's no longer touching a burning cell, but the still-burning
// core keeps the surface warm by conduction, so triggering on "warm" (not
// "burning") means CO₂ keeps reaching in until the whole line is cold. Once it's
// fully out the surface drops below this and CO₂ stops flooding.
const TRIGGER_TEMP = 150;
const SMOTHER_CHANCE = 0.5; // per qualifying CO₂ cell per tick — a blanket reliably wins
// The chill sinks *through the connected fuel* (cool cells included), so a blanket
// on top of a coal line reaches the burning cells buried inside it — a gas can't
// touch them directly, but the extinguisher's cold conducts in along the fuel.
// Depth covers a fat brush stroke (brush size N ≈ 2N+1 cells thick; size 3 ≈ 7),
// and the cell cap bounds one flood so a *giant* coal field still keeps a deep,
// slowly-burning core rather than being snuffed whole in one op.
const SMOTHER_MAX_DEPTH = 9;
const SMOTHER_MAX_CELLS = 160;
const DISSIPATE_CHANCE = 0.002; // slowly thins back into air (no permanent fog)

function isCombustible(id: number): boolean {
  return id !== EMPTY && getMaterial(id).combustible === true;
}

/** Sink the chill into a coal/fuel mass from a contact cell: an 8-connected flood
 *  that *travels through connected combustible cells regardless of temperature*
 *  and cools any that are in the burning band (>= SMOTHER_TEMP) back to ambient.
 *  Traversing the already-cooled surface is what lets the chill reach burning
 *  cells buried behind it — the fix for a thick line whose core kept re-lighting
 *  the surface. Bounded by depth and a cell cap. Cooling is a pure setTemp (no
 *  material write), so it never causes same-tick reprocessing. */
function chillThroughFuel(sx: number, sy: number, sim: SimContext): void {
  const w = sim.width;
  const visited = new Set<number>([sy * w + sx]);
  const qx: number[] = [sx];
  const qy: number[] = [sy];
  const qd: number[] = [0];
  let head = 0;
  let visits = 0;
  while (head < qx.length && visits < SMOTHER_MAX_CELLS) {
    const x = qx[head];
    const y = qy[head];
    const d = qd[head];
    head++;
    visits++;
    if (sim.getTemp(x, y) >= SMOTHER_TEMP) sim.setTemp(x, y, AMBIENT_TEMP);
    if (d >= SMOTHER_MAX_DEPTH) continue;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const key = ny * w + nx;
      if (visited.has(key)) continue;
      if (isCombustible(sim.get(nx, ny))) {
        visited.add(key);
        qx.push(nx);
        qy.push(ny);
        qd.push(d + 1);
      }
    }
  }
}

function updateCO2(x: number, y: number, sim: SimContext): void {
  let contactX = -1;
  let contactY = -1;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === FIRE.id) {
      // Snuff the flame outright — writing EMPTY to a neighbor is always safe.
      sim.set(nx, ny, EMPTY);
    } else if (contactX < 0 && isCombustible(nid) && sim.getTemp(nx, ny) >= TRIGGER_TEMP) {
      // A warm fuel neighbour — fire is in or under this mass. Remember it as the
      // flood's entry point (resolved after the snuff pass so all flames go first).
      contactX = nx;
      contactY = ny;
    }
  }
  if (contactX >= 0 && sim.chance(SMOTHER_CHANCE)) {
    // Sink the chill into the fuel so a thick line goes out from the inside — the
    // fix for the "꺼졌다 다시 붙는" re-ignition. Because the trigger is "warm" and
    // the flood walks through cool fuel, CO₂ keeps reaching the buried core until
    // the whole mass is cold.
    chillThroughFuel(contactX, contactY, sim);
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
