import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';

// The explosion *shockwave* — what makes a detonation different from just
// lighting fuel on fire. Unlike Fire (a gas that only drifts upward and ignites
// flammables), a Blast is a burst of individually-traveling shard particles
// that fan out from the ignition point and DESTROY the particles they pass
// through (sand, water, plants, …), not just ignite them — carving a crater.
//
// Directions in angular order (45° apart), so index±1 (mod 8) is always a
// geometric neighbor — that's what makes the wobble below meaningful (a real
// small left/right deflection, not a jump to an unrelated direction).
const ANGLE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 N
  [1, -1], // 1 NE
  [1, 0], // 2 E
  [1, 1], // 3 SE
  [0, 1], // 4 S
  [-1, 1], // 5 SW
  [-1, 0], // 6 W
  [-1, -1], // 7 NW
];

/** Sentinel `dir` meaning "just ignited, hasn't picked a travel direction
 *  yet" — the one tick where a fresh Blast cell fans out to all 8 directions
 *  at once (the initial punch), each becoming an independently-traveling
 *  shard for the rest of its life. */
const EPICENTER = 8;

// A shard's remaining travel distance and its direction share one float (see
// blast.ts's thermal.conductivity: 0 — the heat-diffusion pass never touches
// this cell, so it's free to reuse `temp` as opaque per-cell state instead of
// real heat). `life` strictly decreases by one every successful step and a
// shard always spends itself after exactly one tick's turn (see the
// unconditional collapse at the end of updateBlast), so — no matter how much
// it wobbles or bounces off obstacles — every shard is guaranteed to stop
// within `life` ticks of being spawned. That bound is what prevents runaway
// spread; nothing here can loop indefinitely.
function encodeBlast(life: number, dir: number): number {
  return life * 9 + dir;
}
function decodeBlast(temp: number): { life: number; dir: number } {
  return { life: Math.floor(temp / 9), dir: temp % 9 };
}
/** Exported so Gunpowder/Nitro (and Blast's own placement radius) seed a
 *  fresh detonation the same way: an omnidirectional epicenter, not a
 *  pre-aimed shard. */
export function seedBlast(life: number): number {
  return encodeBlast(life, EPICENTER);
}

const BLAST_FIRE_CHANCE = 0.35; // a spent shard leaves a scattered flame…
// …otherwise it clears to Empty, so the net result is a crater dusted with fire.

// How often a traveling shard deflects to an adjacent (45°) direction instead
// of continuing straight — mirrors the rising-gas wobble in engine/behaviors.ts
// (GAS_WOBBLE_CHANCE) so a shard's path reads the same "not a rigid line"
// way a flame or wisp of smoke does, just radiating outward instead of up.
const WOBBLE_CHANCE = 0.4;

// Marker stamped on a cell the wave has already cleared to Empty, so a
// *later* shard doesn't re-"discover" it and re-spawn Blast there — without
// this, a shard whose wobble sends it back over already-cleared ground would
// re-ignite it and get an extra, unearned lease on life. The marker is
// *time-bounded*, not permanent: it encodes the tick it was stamped
// (`CRATER_MARK_BASE - tick`) and expires after `CRATER_PROTECT_TICKS`. A
// flat permanent sentinel would work for a single blast but then never
// un-block that air again — re-detonating explosives inside an old crater
// (completely normal sandbox play) would find its own surroundings
// permanently "already cratered" and refuse to spread into them. Any value at
// or below `CRATER_MARK_BASE` is unambiguously a marker, never a legitimate
// temperature (materials stay within roughly [HEAT_BRUSH_MIN, LAVA_TEMP] =
// [-50, 1500]) — Empty cells are otherwise always exactly AMBIENT_TEMP (20),
// since the heat/cool brush explicitly skips Empty (see
// brushTools.heatCells) and no other code path leaves Empty at a non-ambient
// temperature. Painting new material over a marked cell always calls
// `setTemp` itself (see PointerPainter.paint), so reuse clears it instantly
// regardless of expiry.
const CRATER_MARK_BASE = -100_000;
// Comfortably longer than a single blast's full resolution (radius-bounded,
// well under a second even for Nitro's largest radius) but short enough that
// the same spot isn't artificially blast-resistant for long.
const CRATER_PROTECT_TICKS = 120;

/** True if `temp` is a still-active crater marker as of `tick` (see above). */
function isActiveCrater(temp: number, tick: number): boolean {
  if (temp > CRATER_MARK_BASE) return false; // not a marker — ordinary air
  const markedTick = CRATER_MARK_BASE - temp;
  return tick - markedTick < CRATER_PROTECT_TICKS;
}

/** Try to advance a shard one cell in `dir` with `life` steps left. Destroys
 *  whatever's there and spawns the shard's continuation, unless blocked (the
 *  indestructible Wall, an Explosive waiting for its own turn, a cell
 *  already mid-blast/freshly embered, or ground this same wave already
 *  cratered). Returns whether it moved. */
function tryAdvance(sim: SimContext, x: number, y: number, dir: number, life: number): boolean {
  const [dx, dy] = ANGLE_DIRS[dir];
  const nx = x + dx;
  const ny = y + dy;
  if (!sim.inBounds(nx, ny)) return false; // edge (or void border): nothing to hit
  const nid = sim.get(nx, ny);
  if (nid === BLAST.id || nid === FIRE.id) return false;
  if (nid === EMPTY) {
    if (isActiveCrater(sim.getTemp(nx, ny), sim.tick)) return false;
  } else {
    const m = getMaterial(nid);
    // Only the indestructible boundary Wall blocks a shard outright. Every
    // other solid — Stone included — gets destroyed like anything else.
    if (m.isWall) return false;
    // Explosives are passed over so they can chain-detonate on their own turn.
    if (m.explosive) return false;
  }
  sim.spawn(nx, ny, BLAST.id);
  sim.setTemp(nx, ny, encodeBlast(life, dir));
  return true;
}

function updateBlast(x: number, y: number, sim: SimContext): void {
  const { life, dir } = decodeBlast(sim.getTemp(x, y));
  if (life >= 1) {
    if (dir === EPICENTER) {
      // The initial punch: fan out to all 8 directions at once, each
      // becoming its own independently-traveling shard.
      for (let d = 0; d < 8; d++) tryAdvance(sim, x, y, d, life - 1);
    } else {
      const wobbled = sim.chance(WOBBLE_CHANCE) ? (dir + (sim.chance(0.5) ? 1 : 7)) % 8 : dir;
      tryAdvance(sim, x, y, wobbled, life - 1);
    }
  }
  // Spent: collapse into a flame, or clear out and mark the crater so later
  // shards don't bounce back into it.
  if (sim.chance(BLAST_FIRE_CHANCE)) {
    sim.spawn(x, y, FIRE.id);
  } else {
    sim.set(x, y, EMPTY);
    sim.setTemp(x, y, CRATER_MARK_BASE - sim.tick);
  }
}

export const BLAST = register({
  id: 17,
  name: 'Blast',
  phase: Phase.Gas,
  color: rgb(255, 245, 210),
  density: 1,
  // The radius when a Blast is placed directly by the brush, seeded as an
  // epicenter just like Gunpowder/Nitro (see seedBlast above). conductivity 0
  // is load-bearing: it makes the heat pass treat `temp` as inert per-cell
  // state (the shard's remaining life + direction) instead of real heat.
  thermal: { init: seedBlast(5), conductivity: 0 },
  update: updateBlast,
});
