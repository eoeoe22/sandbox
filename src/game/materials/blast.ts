import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { launchEmber } from './ember';

// ── Explosions: an instant shockwave, not a crawling scan ───────────────────
//
// A detonation resolves in a SINGLE tick. The moment an explosive is triggered
// it calls `detonate`, which floods a *filled* disc outward from the epicenter
// — destroying every particle it reaches (sand, salt, stone, water, …) up to
// the blast radius — and drops a bright, short-lived shockwave flash over the
// whole crater. The flash fades from white-hot to orange over a few ticks and
// collapses into scattered Fire, while glowing Embers are hurled out past the
// rim (see ember.ts). Nothing crawls one-cell-per-tick anymore: the destruction
// is immediate and fills the disc, so a charge sitting on a pile of salt (or
// any non-flammable powder) actually blows the pile apart instead of carving a
// few thin channels through it, and solids in range are levelled too.
//
// The Blast material now serves purely as that flash: a freshly *painted* Blast
// cell (or one reloaded from a save) detonates on its first turn; every cell the
// flood clears becomes a Blast flash cell that just fades and dies. The two are
// told apart by the cell's `temp` slot (Blast conducts nothing, so the heat pass
// leaves it alone as opaque per-cell state): a flash stores its remaining life
// there (1..SHELL_MAX, doubling as the glow brightness), while anything above
// SHELL_MAX is the "detonate me" seed marker. Storing it in `temp` (which
// persists) rather than `aux` (which doesn't) means a flash saved mid-explosion
// reloads as a flash and quietly dies, instead of re-detonating on load.
//
// Walls and blast-proof solids (Diamond) stop the flood — they neither break nor
// let it pass, so they cast a shadow and can shelter what's behind them. Other
// explosives caught inside the front are detonated as part of the SAME pass
// (their own radius refreshes the budget), so a connected mass of Gunpowder /
// Nitro goes off all at once instead of sweeping across cell by cell. Separate
// charges nearby are set off a tick later by the flash / fire the blast leaves
// touching them — the same id-based trigger every explosive already watches for.

/** Blast radius (cells) used when a Blast cell is painted directly by the brush.
 *  Explosives pass their own `blastRadius` to `detonate` instead. */
const BRUSH_RADIUS = 8;

// The shockwave flash lives briefly, then collapses. Each cleared cell gets a
// randomized life in [SHELL_LIFE_MIN, SHELL_LIFE_MIN + SHELL_LIFE_VAR) so the
// disc dissolves organically over a handful of frames rather than blinking off
// all at once. Life is stored in `temp` and also drives the glow ramp below —
// high life renders white-hot, low life orange.
const SHELL_LIFE_MIN = 3;
const SHELL_LIFE_VAR = 4; // flash lives 3..6 ticks
/** Glow's hot end / the ceiling on a flash life. Any `temp` above this is not a
 *  flash but the seed marker that tells a painted Blast to detonate. */
const SHELL_MAX = SHELL_LIFE_MIN + SHELL_LIFE_VAR; // 7
/** `temp` of a Blast cell that still needs to detonate. Comfortably above every
 *  possible flash life so the two states can never be confused, and above the
 *  glow range so a seed renders at full brightness for the one tick it exists. */
const SEED_TEMP = 100;

// A spent flash cell leaves scattered Fire this often (dusting the fresh crater
// with flame that can ignite what's left); otherwise it clears straight to
// Empty, so the net result is a bare crater lightly seasoned with fire.
const SHELL_FIRE_CHANCE = 0.28;

// Rim debris: the outermost flash cells hurl glowing Embers outward — fast
// ballistic sparks that fly well past the crater, pockmark whatever they hit,
// and set off distant explosives via the fire they leave (see ember.ts). Only
// the rim sparks, and never through a Wall, so a blast sealed in a chamber stays
// contained.
const RIM_EMBER_CHANCE = 0.55;

// Chamfer-metric step costs so the flooded region reads as a round disc instead
// of a square: a diagonal step costs ~√2 orthogonal steps. The budget starts at
// the blast radius and drains as the front travels; a cell is reached (and
// destroyed) while the budget hasn't gone negative.
const ORTH_COST = 1;
const DIAG_COST = 1.4142;
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, ORTH_COST],
  [0, 1, ORTH_COST],
  [-1, 0, ORTH_COST],
  [1, 0, ORTH_COST],
  [-1, -1, DIAG_COST],
  [1, -1, DIAG_COST],
  [-1, 1, DIAG_COST],
  [1, 1, DIAG_COST],
];

// Hard cap on cells destroyed by a single detonate() call, and by all detonate
// calls within one tick combined, so even a screen-filling mass of explosives
// can't blow the frame budget in a single frame. Both are far above any normal
// blast (a radius-16 disc is only ~800 cells, a 120² block ~14k); when a giant
// connected mass exceeds them the flood simply stops for the tick, and the
// explosives left at the ragged frontier detonate over the next few ticks via
// the flash now touching them — a graceful spread, never a hang.
const MAX_DETONATE_CELLS = 20_000;
const MAX_DETONATE_CELLS_PER_TICK = 24_000;

// Per-tick destruction budget shared across every detonate() call, so a whole
// field of charges going off on the same tick still can't exceed one big
// blast's worth of work. Reset lazily whenever the tick advances.
let budgetTick = -1;
let budgetLeft = 0;

// Reused visited buffer for the flood, keyed by flat cell index. A monotonic
// `stampId` marks cells touched by the current detonation, so we never allocate
// a Set per blast nor clear the buffer between blasts — a cell counts as visited
// only while its stamp equals the current id. Re-sized to match the grid.
let stampBuf: Int32Array | null = null;
let stampW = 0;
let stampH = 0;
let stampId = 0;

/** Fetch the visited buffer (reallocating on a grid resize) and advance to a
 *  fresh stamp id for this detonation. */
function nextStamp(sim: SimContext): Int32Array {
  if (!stampBuf || stampW !== sim.width || stampH !== sim.height) {
    stampW = sim.width;
    stampH = sim.height;
    stampBuf = new Int32Array(stampW * stampH); // all zero; ids start at 1
    stampId = 0;
  }
  stampId++;
  if (stampId >= 0x7fffffff) {
    // Astronomically unlikely, but keep ids from overflowing Int32: wipe once
    // and restart, so no stale stamp is ever mistaken for the current one.
    stampBuf.fill(0);
    stampId = 1;
  }
  return stampBuf;
}

/** True if the cell blocks the shockwave outright — it survives intact and casts
 *  a shadow. Only the indestructible boundary Wall and blast-proof solids
 *  (Diamond); everything else is fair game to destroy. */
function isBlocker(id: number): boolean {
  if (id === EMPTY) return false;
  const m = getMaterial(id);
  return m.isWall === true || m.explosionProof === true;
}

/** Replace a cleared cell with a shockwave flash cell — a short-lived Blast cell
 *  whose life (in `temp`) both times its fade and drives its glow. spawn() marks
 *  it moved, so a not-yet-scanned cell isn't reprocessed this same tick. */
function placeShell(sim: SimContext, x: number, y: number): void {
  const life = SHELL_LIFE_MIN + sim.randInt(SHELL_LIFE_VAR);
  sim.spawn(x, y, BLAST.id);
  sim.setTemp(x, y, life); // ≤ SHELL_MAX ⇒ a flash, never mistaken for a seed
}

/**
 * Detonate at (cx,cy) with the given blast radius — immediately and in full.
 * Floods a filled disc outward, destroying everything destructible it reaches,
 * chain-detonating other explosives inside the front (their own radius refreshes
 * the budget), and dropping the shockwave flash plus a spray of rim embers. Runs
 * entirely within the calling tick — the whole point is that there's no crawl.
 */
export function detonate(sim: SimContext, cx: number, cy: number, radius: number): void {
  const w = sim.width;
  const h = sim.height;
  const stamp = nextStamp(sim);
  const id0 = stampId;

  // Refresh the shared per-tick destruction budget when the tick advances.
  if (sim.tick !== budgetTick) {
    budgetTick = sim.tick;
    budgetLeft = MAX_DETONATE_CELLS_PER_TICK;
  }

  // FIFO frontier as parallel arrays (cheaper than a queue of objects). Each
  // entry is a cell plus the budget still available for it to push outward.
  const qx: number[] = [cx];
  const qy: number[] = [cy];
  const qb: number[] = [radius];
  stamp[cy * w + cx] = id0;
  // Rim cells (the outer edge, one outward direction each) that spray embers
  // once the flood settles — collected rather than launched inline so spawning
  // them can't disturb the cell reads the flood depends on.
  const rimX: number[] = [];
  const rimY: number[] = [];
  const rimDX: number[] = [];
  const rimDY: number[] = [];

  let head = 0;
  let destroyed = 0;
  // The origin always detonates (so a triggered charge always makes progress);
  // every cell after it is gated by both the per-call cap and the shared
  // per-tick budget.
  while (
    head < qx.length &&
    destroyed < MAX_DETONATE_CELLS &&
    (destroyed === 0 || budgetLeft > 0)
  ) {
    const x = qx[head];
    const y = qy[head];
    const b = qb[head];
    head++;

    // Read the cell before overwriting it: an explosive caught in the front
    // detonates as part of this same pass, its own radius refreshing the budget
    // so a connected charge goes off all at once rather than one cell per tick.
    const id = sim.get(x, y);
    let outB = b;
    if (id !== EMPTY) {
      const m = getMaterial(id);
      if (m.explosive && m.blastRadius) outB = Math.max(b, m.blastRadius);
    }

    placeShell(sim, x, y);
    destroyed++;
    budgetLeft--;

    let isRim = false;
    let rimDx = 0;
    let rimDy = 0;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      // A container edge contains the blast (like a Wall) — no leak, no ember.
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (stamp[nidx] === id0) continue;
      if (outB - cost < 0) {
        // The front ran out of push in this direction: this cell is the outer
        // rim here, so it can fling an ember outward. Record the first such
        // direction (roughly radial) and move on.
        if (!isRim) {
          isRim = true;
          rimDx = dx;
          rimDy = dy;
        }
        continue;
      }
      // Wall / Diamond stops the front and shadows what's beyond — no ember
      // either (an explosion behind a wall shouldn't spit sparks through it).
      if (isBlocker(sim.get(nx, ny))) continue;
      stamp[nidx] = id0;
      qx.push(nx);
      qy.push(ny);
      qb.push(outB - cost);
    }
    if (isRim) {
      rimX.push(x);
      rimY.push(y);
      rimDX.push(rimDx);
      rimDY.push(rimDy);
    }
  }

  for (let i = 0; i < rimX.length; i++) {
    if (sim.chance(RIM_EMBER_CHANCE)) launchEmber(sim, rimX[i], rimY[i], rimDX[i], rimDY[i]);
  }
}

/** One tick of a Blast cell: either it's a seed that detonates now, or a flash
 *  cell fading toward the bare crater. */
function updateBlast(x: number, y: number, sim: SimContext): void {
  const t = sim.getTemp(x, y);
  if (t > SHELL_MAX) {
    // A freshly painted Blast (or a seed reloaded from a save): go off, using
    // the brush radius. detonate() overwrites this very cell with a flash.
    detonate(sim, x, y, BRUSH_RADIUS);
    return;
  }
  // A shockwave flash cell: dim one step (life + brightness share this slot);
  // when spent, collapse into a lick of Fire or clear to the bare crater.
  const life = Math.round(t);
  if (life <= 1) {
    if (sim.chance(SHELL_FIRE_CHANCE)) sim.spawn(x, y, FIRE.id);
    else sim.set(x, y, EMPTY);
    return;
  }
  sim.setTemp(x, y, life - 1);
  // No movement: the flash marks where the shockwave passed and fades in place,
  // rather than drifting upward like ordinary gas would.
}

export const BLAST = register({
  id: 17,
  name: 'Blast',
  phase: Phase.Gas,
  // Base (hot) color of the flash; the glow ramp fades it toward the cool orange
  // below as each flash cell's life counts down.
  color: rgb(255, 246, 224),
  density: 1,
  category: '폭발',
  // conductivity 0 is load-bearing: it makes the heat pass treat `temp` as inert
  // per-cell state (the flash's life / the seed marker) instead of real heat.
  // init = SEED_TEMP so a brush-placed cell reads as a seed and detonates.
  thermal: { init: SEED_TEMP, conductivity: 0 },
  // Fade the flash white-hot → orange as its life (stored in temp) drops from
  // SHELL_MAX to 1, so the shockwave visibly cools as it dies.
  glow: { min: 1, max: SHELL_MAX, cool: rgb(255, 120, 24) },
  update: updateBlast,
});
