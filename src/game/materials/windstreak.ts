import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { DIR_RIGHT, DIR_UP, DIR_LEFT, DIR_DOWN, dirVecFor } from './direction4';

// Wind Streak (바람 자국) — the purely decorative dash a Fan seeds into the open
// air ahead of it (see fan.ts's fanPulse). It carries no force of its own (the
// actual push on loose matter/objects is applied directly by the Fan the
// instant it pulses, in the same tick — see fan.ts/objects.ts); this is only
// the "저해상도 바람" visual: a short streak that flies straight for a few
// ticks and then curls (반시계 방향 hook, echoing a fan blade's own spin)
// before fading, entirely by walking itself cell-to-cell like Ember/Debris,
// so it renders with the same crisp low-res pixel look as everything else in
// the grid — no separate renderer plumbing, no DOM/SVG overlay.
//
// Never painted from the palette (like Spark/Blast, it's deliberately absent).
// It only ever occupies a cell that was EMPTY the instant it stepped there,
// and it never survives contact with anything else — so it can't shove,
// block, or otherwise interact with real matter; it just rides along on top
// of open air and disappears the moment that stops being true. That, plus
// Fan re-seeding it fresh every pulse, is what makes the effect genuinely
// temporary: stop powering the Fan and no new streaks appear, and the ones
// in flight finish their short life (well under a second) rather than
// lingering.

/** Ticks spent flying straight before the curl begins. */
const STRAIGHT_LEN = 9;

/** How many ticks a vacated head cell lingers as a dimmer, immobile afterimage
 *  (see WIND_TAIL below) before it too clears. A single traveling pixel reads
 *  as a blinking dot; leaving a short fading trail behind it is what actually
 *  reads as a *line* sweeping past — closer to the reference animation's
 *  visibly long stroke than one lone cell ever could. */
const TAIL_LIFE = 3;

/** The curl itself, expressed as a fixed sequence of unit steps for a
 *  RIGHT-facing streak: up, up, left, left, down, right — a small hook at the
 *  tail, the same right→up→left→down→right shape the reference "서서히
 *  말리는 바람" animation traces at full scale, just shrunk to a handful of
 *  grid cells. Rotated per-direction below so a streak curls the same way
 *  whichever cardinal it's flying. */
const CURL_RIGHT: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, -1],
  [-1, 0],
  [-1, 0],
  [0, 1],
  [1, 0],
];
const CURL_LEN = CURL_RIGHT.length;

/** Total lifetime in ticks: straight flight + the curl. Kept close to
 *  Battery's PULSE_PERIOD (12 ticks — see battery.ts) so a Fan wired to a
 *  battery hands off from one streak to the next without a visible gap,
 *  without importing battery.ts here (that would risk a cycle back through
 *  fan.ts/spark.ts; see fan.ts's own design note). */
const TOTAL_LIFE = STRAIGHT_LEN + CURL_LEN;

/** Rotate a unit step 90° through the grid's 4 cardinals. Applied to the whole
 *  CURL_RIGHT table below to derive the other 3 directions' curls — the exact
 *  rotation chirality doesn't matter (either winding reads as "curling"), only
 *  that all 4 directions use one consistent rule. */
function rotate90(dx: number, dy: number): readonly [number, number] {
  return [dy, -dx];
}

/** How many rotate90 steps turn a RIGHT-facing curl into each direction's own
 *  (RIGHT itself needs none). */
function rotationCount(dirAux: number): number {
  switch (dirAux) {
    case DIR_UP:
      return 1;
    case DIR_LEFT:
      return 2;
    case DIR_DOWN:
      return 3;
    default:
      return 0; // DIR_RIGHT
  }
}

/** Precomputed curl table per direction (built once at module load, not per
 *  particle per tick — a streak lives only ~a dozen ticks but many can be in
 *  flight from a bank of fans at once). */
/** Look up a direction's curl table, falling back to RIGHT's for 0/unrecognized
 *  — the same "unrecognized ⇒ RIGHT" contract `dirVecFor` documents. A Fan
 *  cell's aux isn't always one PointerPainter wrote: Clone (`clone.ts`) can
 *  latch onto a Fan and spawn fresh Fan cells via `SimContext.spawn`, which
 *  always zeroes aux, so `dirAux` reaching here can genuinely be 0 in normal
 *  play. Straight-line flight already tolerates that (`dirVecFor` itself
 *  defaults 0 to RIGHT); this keeps the curl phase equally safe instead of
 *  indexing CURL_BY_DIR[0], which is never populated below. */
function curlTableFor(dirAux: number): ReadonlyArray<readonly [number, number]> {
  return CURL_BY_DIR[dirAux] ?? CURL_BY_DIR[DIR_RIGHT];
}

const CURL_BY_DIR: Record<number, ReadonlyArray<readonly [number, number]>> = (() => {
  const table: Record<number, ReadonlyArray<readonly [number, number]>> = {};
  for (const dir of [DIR_RIGHT, DIR_UP, DIR_LEFT, DIR_DOWN]) {
    let seq: ReadonlyArray<readonly [number, number]> = CURL_RIGHT;
    for (let r = 0; r < rotationCount(dir); r++) {
      seq = seq.map(([dx, dy]) => rotate90(dx, dy));
    }
    table[dir] = seq;
  }
  return table;
})();

/** aux layout: low 3 bits = travel direction (DIR_RIGHT..DIR_DOWN), high 5
 *  bits = ticks of life remaining. Mirrors spark.ts's packSpark bit-budget
 *  style (a fixed 8-bit field split class/strength ↔ direction/life). */
const DIR_BITS = 3;
const DIR_MASK = (1 << DIR_BITS) - 1;

function packStreak(dirAux: number, life: number): number {
  return (life << DIR_BITS) | (dirAux & DIR_MASK);
}

/** Seed a fresh streak at (x,y) flying in the given packed direction. Silently
 *  does nothing off-grid or onto an occupied cell — a streak never displaces
 *  real matter, it only ever rides on open air (see the design note above). */
export function spawnWindStreak(sim: SimContext, x: number, y: number, dirAux: number): void {
  if (!sim.inBounds(x, y) || sim.get(x, y) !== EMPTY) return;
  sim.spawn(x, y, WIND_STREAK.id);
  sim.setAux(x, y, packStreak(dirAux, TOTAL_LIFE));
}

function updateWindStreak(x: number, y: number, sim: SimContext): void {
  const aux = sim.getAux(x, y);
  const dirAux = aux & DIR_MASK;
  const remaining = (aux >> DIR_BITS) - 1;
  if (remaining < 0) {
    sim.set(x, y, EMPTY);
    return;
  }
  let dx: number;
  let dy: number;
  if (remaining >= CURL_LEN) {
    [dx, dy] = dirVecFor(dirAux);
  } else {
    const idx = CURL_LEN - 1 - remaining;
    [dx, dy] = curlTableFor(dirAux)[idx];
  }
  const tx = x + dx;
  const ty = y + dy;
  // Leave a fading afterimage behind instead of clearing straight to EMPTY —
  // see TAIL_LIFE above. spawn()'s own bounds check makes this a no-op if the
  // head somehow moved off-grid, which never happens here but keeps the call
  // symmetric with the head's own inBounds-gated spawn just below.
  sim.spawn(x, y, WIND_TAIL.id);
  sim.setAux(x, y, TAIL_LIFE);
  if (!sim.inBounds(tx, ty) || sim.get(tx, ty) !== EMPTY) return; // disperses on contact
  sim.spawn(tx, ty, WIND_STREAK.id);
  sim.setAux(tx, ty, packStreak(dirAux, remaining));
}

function updateWindTail(x: number, y: number, sim: SimContext): void {
  const remaining = sim.getAux(x, y) - 1;
  if (remaining <= 0) {
    sim.set(x, y, EMPTY);
    return;
  }
  sim.setAux(x, y, remaining);
}

export const WIND_STREAK = register({
  id: 111,
  name: 'Wind Streak',
  phase: Phase.Gas,
  // Pale sky-blue, the mid tone from the reference curling-wind animation's
  // 3-line palette (#bae6fd/#7dd3fc/#38bdf8) — bright enough to read as a
  // gust against most backgrounds without overpowering the scene.
  color: rgb(0x7d, 0xd3, 0xfc),
  density: 1,
  thermal: { conductivity: 0 },
  update: updateWindStreak,
});

/** The dimmer, immobile afterimage a Wind Streak's head leaves behind each
 *  tick it moves (see TAIL_LIFE) — never itself spawned by a Fan, never
 *  painted from the palette, purely the streak's own trailing exhaust. */
export const WIND_TAIL = register({
  id: 112,
  name: 'Wind Tail',
  phase: Phase.Gas,
  // A darker, desaturated step down from the streak's own color — the
  // reference animation layers several shades (#bae6fd/#7dd3fc/#38bdf8); this
  // reuses that same family for the "already passed through" trail.
  color: rgb(0x38, 0x8f, 0xbd),
  density: 1,
  thermal: { conductivity: 0 },
  update: updateWindTail,
});
