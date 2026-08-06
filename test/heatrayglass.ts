// Headless harness for the Laser Heat Ray's grip on TRANSPARENT MATTER
// (materials/heatray.ts): 유리·깨진 유리·다이아몬드는 빔이 지나가도 **한 칸도 사라지지
// 않는다**. A beam travels through a pane at air speed and may come to rest inside one,
// carrying the displaced pane in its own `aux` and putting it back the moment it
// leaves — so a window a laser shines through must be exactly as intact afterwards as
// it was before. Three distinct ways that broke, all of them 유리 삭제 to the player:
//
//   1. The afterimage tail (잔상 꼬리) laid its glow over the pane the landing cursor
//      was standing in, overwriting the glass with an `aux` 0 cell that nothing could
//      restore. A beam crossing a window ate the whole row it passed through.
//   2. A beam that spent the last of its life *inside* a pane was written back as a
//      life-0 cell — by packing alone identical to an afterimage. The next beam down
//      the line read it as air, landed on it, and dropped the pane.
//   3. A beam resting inside a pane is a Gas by phase, so the movement layer shoved
//      it around like one: a grain of sand landing on a glass roof sank into the beam
//      cell in its top course and swapped the beam — host id and all — up into its own
//      place. The pane reappeared where the beam ended up and the grain was eaten
//      (유리 복제 + 모래 삭제). Fixed by Material.auxHost.
//
// Run: `node test/run-heatrayglass.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { emitHeatRay, isHeatRayAfterimage, HEAT_RAY } from '../src/game/materials/heatray';
import { getMaterial } from '../src/game/materials/registry';
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
const GLASS = ID('Glass');
const BROKEN_GLASS = ID('Broken Glass');
const DIAMOND = ID('Diamond');
const IRON = ID('Iron');
const STONE = ID('Stone');
const MERCURY = ID('Mercury');
const SAND = ID('Sand');
const WATER = ID('Water');
const SMOKE = ID('Smoke');

const W = 100;
const H = 80;

function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}

/** Fire from (mx,my) along (dx,dy) for `shots` ticks with the emitter's own muzzle
 *  rule (laser.ts: clear means EMPTY *or* the last shot's afterimage), then let every
 *  beam still airborne die out. Draining matters: a beam resting inside a pane holds
 *  that pane in `aux`, so counting while one is in flight would read a cell that is
 *  merely in escrow as a cell that was destroyed. */
function fireAndDrain(grid: Grid, sim: Simulation, mx: number, my: number, dx: number, dy: number, shots: number): void {
  for (let t = 0; t < shots; t++) {
    if (grid.cells[grid.idx(mx, my)] === 0 || isHeatRayAfterimage(sim.context, mx, my))
      emitHeatRay(sim.context, mx, my, dx, dy);
    sim.step();
  }
  for (let i = 0; i < 800 && count(grid, HEAT_RAY.id) > 0; i++) sim.step();
}

// 1. 관통해도 한 칸도 안 사라진다. A wall of each transparent material, at each of the
//    widths that used to matter: one cell thin (the beam mostly flies past it), a few
//    cells (about one landing inside), and far wider than the per-tick stride (many
//    landings, and beams expiring mid-pane). Straight and diagonal fire, since the
//    diagonal walk lands on a different set of cells.
{
  const KINDS: ReadonlyArray<readonly [number, string]> = [
    [GLASS, '유리'],
    [BROKEN_GLASS, '깨진 유리'],
    [DIAMOND, '다이아몬드'],
  ];
  for (const [id, label] of KINDS) {
    for (const width of [1, 3, 24]) {
      for (const [dx, dy, aimLabel] of [
        [1, 0, '수평'],
        [1, 1, '대각'],
      ] as ReadonlyArray<readonly [number, number, string]>) {
        Math.random = mulberry32(1234 + width + dx * 7 + dy * 31 + id);
        const grid = new Grid(W, H);
        const sim = new Simulation(grid);
        const X0 = 45;
        for (let y = 5; y < H - 5; y++)
          for (let d = 0; d < width; d++) grid.cells[grid.idx(X0 + d, y)] = id;
        grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
        const before = count(grid, id);
        fireAndDrain(grid, sim, 2, dy === 0 ? 40 : 6, dx, dy, 60);
        const after = count(grid, id);
        check(
          `빔이 ${label} 벽(${width}칸, ${aimLabel})을 지나가도 한 칸도 안 사라진다`,
          after === before,
          `${before} → ${after}`,
        );
      }
    }
  }
}

// 2. A beam that comes to rest inside a pane is NOT an afterimage, however spent it
//    looks. This is the packing trap of failure (2) above, pinned directly rather than
//    through its symptom: `isHeatRayAfterimage` is what every reader uses to decide
//    "this cell is really just glowing air", and a cell holding a pane in `aux` must
//    never answer yes to it whatever its life field says.
{
  Math.random = mulberry32(99);
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  const aim = 40;
  const X0 = 40;
  const PW = 24;
  for (let y = 10; y < H - 10; y++)
    for (let d = 0; d < PW; d++) grid.cells[grid.idx(X0 + d, y)] = GLASS;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const panes = count(grid, GLASS);

  // Fly one beam until it is resting inside the block, then starve its life to zero
  // in place — exactly the state a beam that ran out of range mid-pane is left in.
  let restX = -1;
  emitHeatRay(sim.context, 2, aim, 1, 0);
  for (let i = 0; i < 30 && restX < 0; i++) {
    sim.step();
    for (let d = 0; d < PW; d++) {
      const gi = grid.idx(X0 + d, aim);
      if (grid.cells[gi] === HEAT_RAY.id && grid.aux[gi] === GLASS) {
        restX = X0 + d;
        break;
      }
    }
  }
  check('빔이 유리판 안에 자리 잡는다 (aux에 유리를 싣고)', restX >= 0);
  if (restX >= 0) {
    const gi = grid.idx(restX, aim);
    grid.temp[gi] = grid.temp[gi] & 15; // life 0, flight direction kept
    check(
      '수명이 다 된 판 속의 빔은 잔상이 아니다 (아니면 뒷 빔이 공기로 알고 착지해 유리를 먹는다)',
      !isHeatRayAfterimage(sim.context, restX, aim),
    );
    // …and letting it take its own turn puts the pane back rather than leaving a hole.
    for (let i = 0; i < 5; i++) sim.step();
    check('그 빔이 소멸하면 유리를 제자리에 돌려놓는다', count(grid, GLASS) === panes, `${panes} → ${count(grid, GLASS)}`);
  }
}

// 3. 유리 지붕 위의 모래. A beam resting inside the top course of a glass wall is a Gas
//    by phase; without Material.auxHost the movement layer displaces it like one, and a
//    grain landing on the roof swaps the beam — pane and all — up into its own cell.
//    Both counts are the check: the glass must not be duplicated and the sand must not
//    be eaten. Several seeds because whether a landing lands under the pile is chance.
{
  for (let seed = 1; seed <= 6; seed++) {
    Math.random = mulberry32(seed);
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    const X0 = 40;
    const PW = 12;
    const TOP = 30;
    for (let y = TOP; y < H - 10; y++)
      for (let d = 0; d < PW; d++) grid.cells[grid.idx(X0 + d, y)] = GLASS;
    for (let y = TOP - 4; y < TOP; y++)
      for (let d = 0; d < PW; d++) grid.cells[grid.idx(X0 + d, y)] = SAND;
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    const glass0 = count(grid, GLASS);
    const sand0 = count(grid, SAND);
    fireAndDrain(grid, sim, 2, TOP, 1, 0, 80);
    check(
      `유리 지붕에 모래가 쌓여 있어도 유리가 복제되지 않는다 (seed ${seed})`,
      count(grid, GLASS) === glass0,
      `${glass0} → ${count(grid, GLASS)}`,
    );
    check(
      `…그리고 그 모래도 먹히지 않는다 (seed ${seed})`,
      count(grid, SAND) === sand0,
      `${sand0} → ${count(grid, SAND)}`,
    );
  }
}

// 4. The general invariant, swept over chaotic scenes rather than staged ones: a beam
//    cell holding a pane in `aux` is that pane, in ESCROW. Every tick, every escrowed
//    cell must either still be an escrowing beam or have become the host material back.
//    Anything else — EMPTY, some other material — is the pane being dropped, which is
//    the whole bug class here whatever route it took.
//
//    Sweeping beats counting because counting is not actually conserved: the beam heats
//    what it strikes, so Sand melts to Molten Glass and freezes as Glass, and Broken
//    Glass anneals the same way. A plain tally reads those as corruption; the escrow
//    invariant is blind to them because they act on real cells, not escrowed ones.
{
  const KINDS = [GLASS, BROKEN_GLASS, DIAMOND, IRON, STONE, MERCURY];
  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  let dropped = 0;
  let staged = 0;
  let firstDrop = '';
  for (let seed = 1; seed <= 12; seed++) {
    Math.random = mulberry32(seed);
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    const r = mulberry32(seed * 7919 + 13);
    const put = (x: number, y: number, id: number): void => {
      if (x >= 0 && x < W && y >= 0 && y < H) grid.cells[grid.idx(x, y)] = id;
    };
    for (let b = 0; b < 22; b++) {
      const id = KINDS[Math.floor(r() * KINDS.length)];
      const x0 = Math.floor(r() * (W - 12));
      const y0 = Math.floor(r() * (H - 12));
      const w = 1 + Math.floor(r() * 6);
      const h = 1 + Math.floor(r() * 8);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, id);
    }
    for (let b = 0; b < 8; b++) {
      const id = [SAND, WATER, SMOKE][Math.floor(r() * 3)];
      const x0 = Math.floor(r() * (W - 8));
      const y0 = Math.floor(r() * 20);
      for (let y = y0; y < y0 + 4; y++)
        for (let x = x0; x < x0 + 6; x++) if (grid.cells[grid.idx(x, y)] === 0) put(x, y, id);
    }
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);

    const muzzles = Array.from({ length: 6 }, () => {
      const [dx, dy] = DIRS[Math.floor(r() * DIRS.length)];
      return {
        x: dx > 0 ? 1 : dx < 0 ? W - 2 : Math.floor(r() * W),
        y: dy > 0 ? 1 : dy < 0 ? H - 2 : Math.floor(r() * H),
        dx,
        dy,
      };
    });
    let escrow = new Map<number, number>();
    for (let t = 0; t < 200; t++) {
      if (t < 150)
        for (const m of muzzles)
          if (grid.cells[grid.idx(m.x, m.y)] === 0 || isHeatRayAfterimage(sim.context, m.x, m.y))
            emitHeatRay(sim.context, m.x, m.y, m.dx, m.dy);
      sim.step();
      for (const [i, host] of escrow) {
        const now = grid.cells[i];
        if (now === host) {
          staged++;
          continue;
        }
        if (now === HEAT_RAY.id && grid.aux[i] === host) continue; // still in escrow
        dropped++;
        if (!firstDrop)
          firstDrop = `seed ${seed} tick ${t} (${i % W},${(i / W) | 0}): ${getMaterial(host).name} → ${now === 0 ? 'EMPTY' : getMaterial(now).name}`;
      }
      escrow = new Map();
      for (let i = 0; i < grid.cells.length; i++)
        if (grid.cells[i] === HEAT_RAY.id && grid.aux[i] !== 0) escrow.set(i, grid.aux[i]);
    }
  }
  check('난장판 12개에서 빔이 물고 있던 판을 흘리지 않는다', dropped === 0, firstDrop || `${staged}건 회수`);
  // Guard the guard: a scene that never puts a beam inside a pane would pass the check
  // above by doing nothing at all.
  check('…그리고 그 검사가 실제로 판을 물어 봤다', staged > 100, `${staged}건 회수`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
