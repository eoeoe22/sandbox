// Headless behavioural harness for the swimming life — Fish (materials/fish.ts)
// and the corpse it leaves, Dead Fish (materials/deadfish.ts).
//
// What it pins down:
//   • A fish stays in its tank. It swims (it doesn't sit still), it never leaves
//     the water on its own, and it never eats, breeds or grows — the head count
//     is exactly what was placed.
//   • 수면. A fish cruising just under the waterline, with open air above it, is
//     NOT drowning-in-reverse: it must survive indefinitely. (The bugs' shared
//     `isSubmerged` would call that cell "out of water", which is precisely why
//     fish.ts uses its own `touchingLiquid` — this block is that decision's test.)
//   • 물 밖. Stranded on dry ground it flops about and suffocates on schedule,
//     leaving a corpse; a fish thrown next to a puddle flops its way back in and
//     lives.
//   • The other three deaths — 고온, 인접 Blast 섬광, 방사선 피폭 — each leave the
//     same Dead Fish.
//   • 사체. It floats up through water to the surface on its own buoyancy, and it
//     eventually rots away instead of piling up forever.
//   • 무리 짓기. Fish that can see each other agree on a heading far more than
//     fish that can't — measured against an isolated-fish control run in the same
//     harness, not against a hand-picked number.
//   • The renderer's contract: bit 0 of a fish's `aux` is its facing, and it
//     matches the direction it actually last moved (see Material.tailPixel).
//
// Run: `node test/run-fish.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { flashCell } from '../src/game/materials/blast';
import '../src/game/materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Each block runs on its own seeded stream, so a change to one scene can't shift
 *  every later scene's randomness. None of the checks below are tuned to one lucky
 *  stream: set SEED_BASE to any number (`SEED_BASE=7 node test/run-fish.mjs`) and
 *  the harness should still pass. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0xf15e);
let reseeds = 0;
function reseed(): void {
  Math.random = mulberry32(SEED_BASE + ++reseeds * 0x9e37);
}
reseed();

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const EMPTY = 0;
const FISH = ID('Fish');
const DEAD = ID('Dead Fish');
const WATER = ID('Water');
const STONE = ID('Stone');
const SAND = ID('Sand');
const U238 = ID('U238');

/** ×1 sim speed, mirroring config.SIM_HZ_AT_1X — the harness states real-time
 *  expectations (12초 질식) in seconds and converts here. */
const HZ = 30;

function makeWorld(w = 60, h = 40): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = id;
      grid.aux[i] = 0;
      grid.tint[i] = (Math.random() * 256) | 0;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
const put = (grid: Grid, x: number, y: number, id: number): void => {
  fill(grid, x, y, x, y, id);
};
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Every cell of `id`, as {x, y, aux}. */
function cellsOf(grid: Grid, id: number): { x: number; y: number; aux: number }[] {
  const out: { x: number; y: number; aux: number }[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const i = grid.idx(x, y);
      if (grid.cells[i] === id) out.push({ x, y, aux: grid.aux[i] });
    }
  return out;
}

/** A glass tank: stone walls and floor, filled with water to `surface`, open air
 *  above. The default scene for everything that isn't about being stranded. */
function tank(grid: Grid, surface = 8): void {
  const w = grid.width;
  const h = grid.height;
  fill(grid, 0, h - 3, w - 1, h - 1, STONE); // floor
  fill(grid, 0, 0, 1, h - 1, STONE); // left wall
  fill(grid, w - 2, 0, w - 1, h - 1, STONE); // right wall
  fill(grid, 2, surface, w - 3, h - 4, WATER);
}

// ── 1. 헤엄: it moves, it stays in, and there is exactly as much of it as placed ──
{
  reseed();
  const { grid, sim } = makeWorld();
  tank(grid);
  const start: [number, number][] = [
    [10, 14],
    [20, 20],
    [30, 26],
    [40, 16],
    [48, 22],
  ];
  for (const [x, y] of start) put(grid, x, y, FISH);

  const visited = new Set<number>();
  let escaped = 0;
  let worstAir = 0;
  for (let t = 0; t < 40 * HZ; t++) {
    sim.step();
    for (const f of cellsOf(grid, FISH)) {
      visited.add(f.y * grid.width + f.x);
      // Left the water body it was poured into. Measured as position rather than
      // as "has a wet cardinal neighbour": three schooling fish packed into a
      // corner can box each other in for a single tick with stone on the other
      // two sides, which reads as dry without anyone having gone anywhere. The
      // air counter below is what says that blip stayed a blip.
      if (f.x < 2 || f.x > grid.width - 3 || f.y < 8 || f.y > grid.height - 4) escaped++;
      const air = (f.aux >>> 5) & 0x3ff; // 물 밖 경과 틱 (see fish.ts aux layout)
      if (air > worstAir) worstAir = air;
    }
  }
  check('all five fish survive 40s of swimming', count(grid, FISH) === 5, `${count(grid, FISH)}/5`);
  check(
    'a fish never breeds, eats or splits — the head count is what was placed',
    count(grid, FISH) === 5 && count(grid, DEAD) === 0,
    `${count(grid, FISH)} live, ${count(grid, DEAD)} dead`,
  );
  check(
    'they actually swim — the school covers real ground, not one puddle of cells',
    visited.size >= 300,
    `${visited.size} distinct cells visited`,
  );
  check(
    'no fish ever climbs out of the water on its own',
    escaped === 0,
    `${escaped} fish-ticks outside the poured water body`,
  );
  check(
    '…and none of them ever starts suffocating (12초 = 360틱)',
    worstAir <= 2,
    `worst air counter reached ${worstAir} ticks`,
  );
}

// ── 2. 수면: open air above is not suffocation ────────────────────────────────
// The trap this exists to catch: crawler.ts's isSubmerged (no air neighbour at
// all) would read the top row of any tank as "out of water", so every fish that
// cruised along the surface would quietly asphyxiate in its own tank.
{
  reseed();
  const { grid, sim } = makeWorld();
  tank(grid, 8);
  put(grid, 30, 8, FISH); // the waterline itself — open air directly above
  let leftSurface = 0;
  for (let t = 0; t < 60 * HZ; t++) {
    sim.step();
    if (t % 10 === 0) {
      const f = cellsOf(grid, FISH)[0];
      if (f && f.y <= 9) leftSurface++;
    }
  }
  check(
    'a fish at the waterline survives a full minute (air above ≠ drowning)',
    count(grid, FISH) === 1 && count(grid, DEAD) === 0,
    `${count(grid, FISH)} live, ${count(grid, DEAD)} dead`,
  );
  check(
    '…and it spends real time up at the surface rather than fleeing the top row',
    leftSurface > 0,
    `${leftSurface} samples in the top two rows`,
  );
}

// ── 3. 물 밖: 펄떡임 and suffocation on schedule ───────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 30, grid.width - 1, grid.height - 1, SAND); // dry bank, no water anywhere
  put(grid, 30, 29, FISH);
  const seen = new Set<number>();
  let diedAt = -1;
  for (let t = 0; t < 30 * HZ; t++) {
    sim.step();
    const f = cellsOf(grid, FISH)[0];
    if (!f) {
      diedAt = t;
      break; // stop the moment it dies — the corpse starts rotting immediately
    }
    seen.add(f.y * grid.width + f.x);
  }
  check(
    'a stranded fish suffocates — but only after ~12s of flopping',
    diedAt >= 10 * HZ && diedAt <= 16 * HZ,
    `died at tick ${diedAt} (${(diedAt / HZ).toFixed(1)}s)`,
  );
  check('…and it thrashes while it does, rather than lying still', seen.size >= 4, `${seen.size} cells`);
  check('…leaving a corpse, not nothing', count(grid, DEAD) === 1, `${count(grid, DEAD)} dead fish`);
}

// ── 4. 펄떡여서 물로 복귀 ─────────────────────────────────────────────────────
// Thrown onto the bank right beside a pool: the flop has to be able to save it.
{
  let saved = 0;
  const TRIES = 12;
  for (let k = 0; k < TRIES; k++) {
    reseed();
    const { grid: g, sim: s } = makeWorld();
    const h = g.height;
    const w = g.width;
    // A pool held on the right by a raised stone shelf, with the shelf's dry top
    // level with the waterline — the bank a blast would fling a fish onto.
    fill(g, 0, h - 4, w - 1, h - 1, STONE); // floor
    fill(g, 0, 0, 1, h - 1, STONE); // left wall
    fill(g, w - 2, 0, w - 1, h - 1, STONE); // right wall
    fill(g, 40, h - 10, w - 3, h - 5, STONE); // the shelf
    fill(g, 2, h - 10, 39, h - 5, WATER); // the pool it holds back
    put(g, 43, h - 11, FISH); // stranded on the shelf, 4 cells from the water
    for (let t = 0; t < 25 * HZ; t++) s.step();
    if (count(g, FISH) === 1) saved++;
  }
  check(
    'a fish stranded on the lip of a pool can flop its way back in',
    saved >= 3,
    `${saved}/${TRIES} made it back`,
  );
}

// ── 5. 나머지 세 가지 죽음 ────────────────────────────────────────────────────
{
  reseed();
  // 고온 — hot water cooks it.
  const hot = makeWorld(20, 20);
  tank(hot.grid, 4);
  for (let i = 0; i < hot.grid.cells.length; i++) {
    if (hot.grid.cells[i] === WATER) hot.grid.temp[i] = 60;
  }
  put(hot.grid, 10, 10, FISH);
  hot.grid.temp[hot.grid.idx(10, 10)] = 60;
  // Stop on death, don't run a fixed window: the corpse starts rotting the instant
  // it appears, and a fixed window loses it outright once in ten runs.
  let cooked = false;
  for (let t = 0; t < 5 * HZ && !cooked; t++) {
    hot.sim.step();
    cooked = count(hot.grid, FISH) === 0;
  }
  check(
    '60° water cooks a fish into a corpse',
    cooked && count(hot.grid, DEAD) >= 1,
    `${count(hot.grid, FISH)} live, ${count(hot.grid, DEAD)} dead`,
  );

  // 충격파 — an adjacent Blast flash cell kills outright. A real flashCell, not a
  // hand-painted Blast: a raw Blast at room temperature reads as a brush seed and
  // detonates a whole crater, which would bury the fish rather than flash it.
  reseed();
  const bang = makeWorld(20, 20);
  tank(bang.grid, 4);
  put(bang.grid, 10, 10, FISH);
  flashCell(bang.sim.context, 11, 10);
  bang.sim.step();
  check(
    'an adjacent blast flash kills a fish on the spot',
    count(bang.grid, FISH) === 0 && count(bang.grid, DEAD) === 1,
    `${count(bang.grid, FISH)} live, ${count(bang.grid, DEAD)} dead`,
  );

  // 피폭 — declarative (Material.radiationDeath), so this is a wiring check. The
  // fish goes in a 3×3 pocket rather than an open tank: dose falls off as 선량/d,
  // so in a big tank its own wander can spend most of the window out at 6 cells
  // and the check turns into a coin flip on the seed. Penned in, it is always
  // within 2 cells of the source, and the water between them doesn't shield
  // (only solids do).
  reseed();
  const rad = makeWorld(20, 20);
  fill(rad.grid, 0, 0, 19, 19, STONE);
  fill(rad.grid, 9, 9, 11, 11, WATER);
  put(rad.grid, 10, 10, FISH);
  put(rad.grid, 12, 10, U238);
  let died = false;
  for (let t = 0; t < 20 * HZ && !died; t++) {
    rad.sim.step();
    if (count(rad.grid, FISH) === 0) died = true;
  }
  check('radiation kills a fish and leaves the same corpse', died && count(rad.grid, DEAD) >= 1, `dead=${died}`);
}

// ── 6. 사체: 배가 하얗게 떠오르고, 언젠가 삭는다 ──────────────────────────────
{
  // Five of them, and only 10s: a corpse is rotting the whole time it rises (a
  // 45s mean — see below), so one dropped alone and watched for long enough will
  // eventually be checked after it has already gone.
  reseed();
  const { grid, sim } = makeWorld();
  tank(grid, 8);
  for (let x = 20; x <= 40; x += 5) put(grid, x, 30, DEAD); // dropped deep
  for (let t = 0; t < 10 * HZ; t++) sim.step();
  const risen = cellsOf(grid, DEAD);
  check(
    'a corpse floats up to the surface on its own buoyancy',
    risen.length > 0 && risen.every((c) => c.y <= 9),
    risen.length === 0
      ? 'every corpse rotted before it could rise'
      : `${risen.length} left, deepest at y=${Math.max(...risen.map((c) => c.y))} (surface y=8)`,
  );

  // Decay is a per-tick roll, not a countdown (see deadfish.ts), so the corpses go
  // out staggered — which is the point. That makes it an exponential with a ~45s
  // mean: about a third should still be there at 45s, and effectively none at 600s.
  reseed();
  const rot = makeWorld(40, 20);
  tank(rot.grid, 4);
  for (let x = 5; x < 35; x++) put(rot.grid, x, 10, DEAD);
  const before = count(rot.grid, DEAD);
  for (let t = 0; t < 45 * HZ; t++) rot.sim.step();
  const at45 = count(rot.grid, DEAD);
  for (let t = 0; t < 555 * HZ; t++) rot.sim.step();
  check(
    'corpses rot away instead of collecting forever',
    count(rot.grid, DEAD) === 0,
    `${before} → ${at45} at 45s → ${count(rot.grid, DEAD)} at 600s`,
  );
  check(
    '…and they go one at a time, not all at once',
    at45 > 0 && at45 < before,
    `${at45} of ${before} still there at the 45s mean`,
  );
}

// ── 7. 무리 짓기 ─────────────────────────────────────────────────────────────
// Two separate claims, each measured against a control the harness computes for
// itself rather than against a number picked to fit:
//   • 뭉친다 — the school ends up closer together than the same 12 fish dropped at
//     random in the same body of water (a Monte Carlo null, right below).
//   • 방향을 맞춘다 — fish close enough to see each other share a heading more often
//     than fish too far apart to, taken from the same run so nothing else differs.
{
  /** Mean distance from a fish to its nearest neighbour (Chebyshev — the metric
   *  the 8-neighbour ring actually moves in). */
  const meanNearest = (pts: { x: number; y: number }[]): number => {
    let acc = 0;
    for (const a of pts) {
      let best = Infinity;
      for (const b of pts) {
        if (a === b) continue;
        const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        if (d < best) best = d;
      }
      acc += best;
    }
    return acc / pts.length;
  };

  // The null: what "no schooling at all" looks like in this exact tank.
  reseed();
  let nullAcc = 0;
  const TRIALS = 400;
  for (let t = 0; t < TRIALS; t++) {
    const pts = [];
    for (let k = 0; k < 12; k++) {
      pts.push({ x: 2 + Math.floor(Math.random() * 76), y: 6 + Math.floor(Math.random() * 31) });
    }
    nullAcc += meanNearest(pts);
  }
  const scattered = nullAcc / TRIALS;

  reseed();
  const { grid, sim } = makeWorld(80, 40);
  tank(grid, 6);
  for (let k = 0; k < 12; k++) put(grid, 4 + k * 6, 12 + (k % 3) * 2, FISH); // spread the length of the tank
  let nnAcc = 0;
  let samples = 0;
  let nearSame = 0;
  let nearAll = 0;
  let farSame = 0;
  let farAll = 0;
  for (let t = 0; t < 60 * HZ; t++) {
    sim.step();
    if (t < 20 * HZ || t % 15 !== 0) continue; // give the school 20s to form first
    const f = cellsOf(grid, FISH);
    nnAcc += meanNearest(f);
    samples++;
    for (let i = 0; i < f.length; i++)
      for (let j = i + 1; j < f.length; j++) {
        const ha = (f[i].aux >>> 1) & 0xf;
        const hb = (f[j].aux >>> 1) & 0xf;
        if (ha === 0 || hb === 0) continue; // one of them hasn't picked a heading
        const near = Math.max(Math.abs(f[i].x - f[j].x), Math.abs(f[i].y - f[j].y)) <= 8;
        if (near) {
          nearAll++;
          if (ha === hb) nearSame++;
        } else {
          farAll++;
          if (ha === hb) farSame++;
        }
      }
  }
  const clumped = nnAcc / samples;
  const near = nearSame / nearAll;
  const far = farSame / farAll;
  check(
    'a school ends up tighter than the same fish scattered at random',
    clumped < scattered * 0.85,
    `nearest neighbour ${clumped.toFixed(2)} vs ${scattered.toFixed(2)} scattered`,
  );
  check(
    'fish close enough to see each other line up on a heading',
    nearAll > 500 && farAll > 500 && near > far * 1.4,
    `${(near * 100).toFixed(0)}% of near pairs agree vs ${(far * 100).toFixed(0)}% of far pairs`,
  );
}

// ── 8. 꼬리 방향 비트 (렌더러와의 계약) ───────────────────────────────────────
// bit 0 of aux is the facing the renderer trails the tail from. It must track the
// last horizontal step the fish actually took — including staying put through a
// purely vertical one, which is the whole reason it is its own bit.
{
  reseed();
  const { grid, sim } = makeWorld();
  tank(grid, 8);
  put(grid, 30, 20, FISH);
  let wrong = 0;
  let horizontalMoves = 0;
  let verticalHolds = 0;
  let prev = cellsOf(grid, FISH)[0];
  for (let t = 0; t < 60 * HZ; t++) {
    sim.step();
    const now = cellsOf(grid, FISH)[0];
    if (!now || !prev) break;
    const facingRight = (now.aux & 1) !== 0;
    const dx = now.x - prev.x;
    if (dx > 0 || dx < 0) {
      horizontalMoves++;
      if (facingRight !== dx > 0) wrong++;
    } else if ((prev.aux & 1) !== (now.aux & 1)) {
      // No horizontal motion, yet the tail flipped sides.
      verticalHolds++;
    }
    prev = now;
  }
  check(
    'the facing bit matches the direction the fish actually moved',
    horizontalMoves > 100 && wrong === 0,
    `${wrong} wrong out of ${horizontalMoves} horizontal steps`,
  );
  check(
    '…and a purely vertical step never flips the tail to the other side',
    verticalHolds === 0,
    `${verticalHolds} flips with no horizontal motion`,
  );
}

// ── 8b. …펄떡일 때도 ─────────────────────────────────────────────────────────
// The same contract on the OTHER movement path. Worth its own scene because the
// block above never leaves the tank, so it exercises `swim` only — and `flop`
// had the facing backwards on every sideways hop the whole time it went unseen.
// (The jump is built off the perpendicular to gravity, which is (-gy, gx): under
// ordinary downward gravity a positive lean moves the fish LEFT, not right.)
{
  reseed();
  let wrong = 0;
  let hops = 0;
  for (let k = 0; k < 8; k++) {
    const { grid, sim } = makeWorld();
    fill(grid, 0, 30, grid.width - 1, grid.height - 1, SAND); // dry bank, no water
    put(grid, 30, 29, FISH);
    let prev = cellsOf(grid, FISH)[0];
    for (let t = 0; t < 11 * HZ; t++) {
      sim.step();
      const now = cellsOf(grid, FISH)[0];
      if (!now || !prev) break;
      const dx = now.x - prev.x;
      if (dx !== 0) {
        hops++;
        if (((now.aux & 1) !== 0) !== dx > 0) wrong++;
      }
      prev = now;
    }
  }
  check(
    'the facing bit is right on a flop too, not just a swim',
    hops > 50 && wrong === 0,
    `${wrong} wrong out of ${hops} sideways hops`,
  );
}

// ── 8c. …중력이 돌아가 있어도 ─────────────────────────────────────────────────
// 좌우 중력(UI로 고를 수 있다)에서는 `moveDown`의 한 걸음 자체가 가로 이동이라,
// "떨어지는 것"에도 좌우 방향이 있다. flop의 점프 분기만 고치고 낙하 분기를 두면
// 여기서만 틀리므로 — 첫 수정이 정확히 그랬다 — 네 방향을 전부 돈다.
{
  for (const dir of ['down', 'up', 'left', 'right'] as const) {
    reseed();
    const { grid, sim } = makeWorld(40, 40);
    fill(grid, 0, 0, 39, 39, STONE);
    fill(grid, 2, 2, 37, 37, EMPTY); // a dry stone box — nothing but flopping in here
    put(grid, 20, 20, FISH);
    sim.setGravity(dir, 1);
    let wrong = 0;
    let hops = 0;
    let prev = cellsOf(grid, FISH)[0];
    for (let t = 0; t < 11 * HZ; t++) {
      sim.step();
      const now = cellsOf(grid, FISH)[0];
      if (!now || !prev) break;
      const dx = now.x - prev.x;
      if (dx !== 0) {
        hops++;
        if (((now.aux & 1) !== 0) !== dx > 0) wrong++;
      }
      prev = now;
    }
    check(
      `…and under ${dir} gravity, where a "fall" can itself be sideways`,
      hops > 20 && wrong === 0,
      `${wrong} wrong out of ${hops} sideways steps`,
    );
  }
}

console.log(
  failures === 0 ? '\nAll fish checks passed.' : `\n${failures} fish check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
