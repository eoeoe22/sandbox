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
//   • The other four deaths — 고온, 인접 Blast 섬광, 방사선 피폭, 감전 — each leave
//     the same Dead Fish. 감전 is measured two ways: a battery dropped in a tank
//     kills through the water itself, and a single hand-fired pulse lands on the
//     designed 50%.
//   • 고온 has a second threshold above it (VAPORIZE_TEMP, 500°): past that the body
//     burns away entirely — Smoke, never Dead Fish — and the check for it has to
//     run before the DEATH_TEMP one or the higher threshold is unreachable.
//   • 사체. It floats up through water to the surface on its own buoyancy, and it
//     eventually rots away instead of piling up forever — unless it, too, crosses
//     VAPORIZE_TEMP first (deadfish.ts's own copy of the same threshold), in which
//     case it burns away into Smoke without waiting on the decay roll.
//   • 개인 공간, and specifically NOT schooling. A pile spreads out, but the fish
//     end up no tighter than a random scatter — measured against a Monte Carlo
//     null the harness computes itself, not against a hand-picked number.
//   • The renderer's contract: bit 0 of a fish's `aux` is its facing, and it
//     matches the direction it actually last moved (see Material.tailPixel).
//
// Run: `node test/run-fish.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { flashCell } from '../src/game/materials/blast';
import { packSpark, conductorClass, FULL_STRENGTH } from '../src/game/materials/spark';
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
const CO2 = ID('CO2');
const BATTERY = ID('Lithium Battery');
const OIL = ID('Crude Oil'); // 도체가 아닌 액체 — 감전 경로를 직접 접촉만 남기고 자른다
const SPARK = ID('Spark');
const SMOKE = ID('Smoke');
const CHLORINE = ID('Chlorine');

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

// ── 3. 물 밖: 펄떡임 and suffocation as a distribution ────────────────────────
// 질식은 고정 타이머가 아니라 **물 밖에 있던 시간에 비례해 오르는 위험률**이다
// (fish.ts AIR_HAZARD). 그래서 한 마리를 재는 게 아니라 분포를 재는데, 못 박아야
// 하는 성질이 서로 다른 방향으로 셋이다:
//   • 중앙값이 설계값(~12초) 근처일 것 — 체감 시간이 유지된다.
//   • 진짜로 흩어질 것 — 같이 던져진 무리가 한 프레임에 몰살하면 기계처럼 보인다.
//     고정 타이머로 되돌리면 이 항목이 걸린다.
//   • **물 밖에 나온 직후는 사실상 안전할 것** — 이게 균일 확률 대신 오르는 위험률을
//     쓰는 이유 전부다. 매 틱 같은 확률이면 첫 틱에 죽는 개체가 나오는데, 수면이
//     출렁이거나 물고기끼리 한두 틱 서로를 가두는 일은 실제로 있으므로(1번 블록이
//     그 blip을 재고 있다) 멀쩡한 물고기가 이유 없이 죽는 것으로 보인다.
{
  reseed();
  const deaths: number[] = [];
  const RUNS = 200;
  let thrashed = 0;
  let corpses = 0;
  for (let r = 0; r < RUNS; r++) {
    const { grid, sim } = makeWorld(20, 20);
    fill(grid, 0, 14, 19, 19, SAND); // dry bank, no water anywhere
    put(grid, 10, 13, FISH);
    const seen = new Set<number>();
    for (let t = 0; t < 60 * HZ; t++) {
      sim.step();
      const f = cellsOf(grid, FISH)[0];
      if (!f) {
        deaths.push(t);
        if (seen.size >= 4) thrashed++;
        if (count(grid, DEAD) === 1) corpses++;
        break; // stop the moment it dies — the corpse starts rotting immediately
      }
      seen.add(f.y * grid.width + f.x);
    }
  }
  deaths.sort((a, b) => a - b);
  const median = deaths[deaths.length >> 1];
  const spread = deaths[Math.floor(deaths.length * 0.9)] - deaths[Math.floor(deaths.length * 0.1)];
  const early = deaths.filter((d) => d < 1 * HZ).length;
  const blip = deaths.filter((d) => d <= 3).length; // 수면 출렁임 정도의 스침
  check(
    'a stranded fish suffocates — median ~12s, and every one of them dies eventually',
    deaths.length === RUNS && median >= 9 * HZ && median <= 16 * HZ,
    `${deaths.length}/${RUNS} died, median tick ${median} (${(median / HZ).toFixed(1)}s)`,
  );
  check(
    '…확률이라 시점이 흩어진다 (고정 타이머가 아니다)',
    spread > 6 * HZ,
    `10~90분위 폭 ${spread}틱 (${(spread / HZ).toFixed(1)}s), 최소 ${deaths[0]} 최대 ${deaths[deaths.length - 1]}`,
  );
  // 같은 중앙값을 갖는 **균일** 확률(p = ln2/360)이었다면 첫 1초 사망률이 5.6%다.
  // 오르는 위험률은 0.5%로, 5배 넘게 낮다 — 이 격차가 두 설계를 가르는 측정값이다.
  // 한두 틱 스치는 경우(수면 출렁임, 물고기끼리 잠깐 가두기)는 아예 0이어야 한다:
  // 이론값이 2e-5라 200판에서 한 번이라도 나오면 그게 이상한 것이다.
  check(
    '…하지만 물 밖에 나오자마자 죽지는 않는다 (균일 확률이었다면 여기서 걸린다)',
    early <= RUNS * 0.025 && blip === 0,
    `첫 1초 ${((early / RUNS) * 100).toFixed(1)}% (균일 확률이면 5.6%), 3틱 이내 ${blip}`,
  );
  check(
    '…and it thrashes while it does, rather than lying still',
    thrashed > RUNS * 0.8,
    `${thrashed}/${RUNS} moved through 4+ cells`,
  );
  check('…leaving a corpse, not nothing', corpses === RUNS, `${corpses}/${RUNS} left a corpse`);
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

// ── 5b. 500°↑ 초고열: 사체 없이 연기로 소멸 ──────────────────────────────────
// fish.ts의 VAPORIZE_TEMP. DEATH_TEMP(45°)보다 먼저 검사돼야 하므로, 45°와 500°
// 사이에서는 그대로 Dead Fish가 남고(회귀 방지 — 문턱이 사라지면 이 판이 걸린다) 500°를
// 넘는 순간부터는 Dead Fish를 단 한 번도 거치지 않고 Smoke가 된다는 것을 같이 잰다.
// 마른 돌상자 + 초고열 공기를 쓴다(물탱크가 아니다) — 물을 끼우면 이 장면과 무관한
// 잡음이 섞인다. `vaporize`의 `sim.set(x, y, SMOKE.id)`는 다른 모든 반응 연기(Fire·
// Slime 등)와 같은 관문(SimContext.applySmokeLevel)을 지난다 — 기본값 'medium'은
// 35%만 통과시키고 나머지는 EMPTY가 되므로, 이 장면은 `setSmokeLevel('high')`로
// 전량 통과시켜야 확정적으로 Smoke를 관측할 수 있다.
{
  reseed();
  const scorched = makeWorld(20, 20);
  fill(scorched.grid, 0, 0, 19, 19, STONE);
  fill(scorched.grid, 2, 2, 17, 17, EMPTY);
  scorched.grid.temp.fill(600);
  put(scorched.grid, 10, 10, FISH);
  scorched.sim.setSmokeLevel('high');
  let sawDead = false;
  let vaporized = false;
  for (let t = 0; t < 5 * HZ && !vaporized; t++) {
    scorched.sim.step();
    if (count(scorched.grid, DEAD) > 0) sawDead = true;
    vaporized = count(scorched.grid, FISH) === 0 && count(scorched.grid, SMOKE) > 0;
  }
  check(
    '600° 열은 물고기를 사체 없이 연기로 태워 없앤다',
    vaporized && count(scorched.grid, DEAD) === 0,
    `smoke=${count(scorched.grid, SMOKE)}, dead=${count(scorched.grid, DEAD)}, fish=${count(scorched.grid, FISH)}`,
  );
  check(
    '…Dead Fish를 거쳐 가지 않는다 (VAPORIZE_TEMP가 DEATH_TEMP보다 먼저 걸린다)',
    !sawDead,
    sawDead ? '중간에 Dead Fish가 관측됐다' : 'Dead Fish 없이 곧장 소멸',
  );

  // 문턱 바로 아래 — 45°와 500° 사이는 여전히 옛 경로(Dead Fish)를 타야 한다. 이게
  // 없으면 VAPORIZE_TEMP를 0으로 낮춰도(모든 열사가 연기가 돼도) 위 항목만으론 못 잡는다.
  // 200°는 물의 끓는점(100°)을 넘기므로 여기서도 물탱크 대신 마른 돌상자를 쓴다.
  reseed();
  const warm = makeWorld(20, 20);
  fill(warm.grid, 0, 0, 19, 19, STONE);
  fill(warm.grid, 2, 2, 17, 17, EMPTY);
  warm.grid.temp.fill(200);
  put(warm.grid, 10, 10, FISH);
  let cooked2 = false;
  for (let t = 0; t < 5 * HZ && !cooked2; t++) {
    warm.sim.step();
    cooked2 = count(warm.grid, FISH) === 0;
  }
  check(
    '문턱 아래(200°)에서는 그대로 Dead Fish를 남긴다 (연기 문턱이 낮은 열까지 삼키지 않는다)',
    cooked2 && count(warm.grid, DEAD) >= 1 && count(warm.grid, SMOKE) === 0,
    `dead=${count(warm.grid, DEAD)}, smoke=${count(warm.grid, SMOKE)}`,
  );
}

// ── 5c. 염소가스 접촉: 확률이 아니라 접촉 즉시 ────────────────────────────────
// touchingPoison(오염수)은 매 틱 확률(POISON_HAZARD)로 죽이지만, 염소가스는
// touchingBlast와 같은 결로 접촉한 바로 그 틱에 죽는다. chlorine.ts가 다른 생명
// 물질(Plant·Slime 등)을 죽일 때 쓰는 isLiving() 목록에는 물고기가 없고(그쪽은
// 매 틱 30% 확률로 흔적 없이 지운다), 물고기는 fish.ts 자신의 touchingChlorine이
// 판정해 다른 사망 원인과 똑같이 Dead Fish를 남긴다는 것도 함께 잰다.
// 염소는 무거운 기체라 매 틱 아래·옆으로 움직이려 든다(updateHeavyGas), 그리고
// 자기 자신이 DISSIPATE_CHANCE(0.4%/틱)로 사라지기도 한다. 스캔 순서(가로 방향은
// 틱마다 번갈아 바뀐다)에 따라 물고기 차례가 오기 전에 가스가 먼저 처리될 수
// 있으므로, 물고기 **양옆**을 가스로 채우고 나머지는 전부 돌로 막는다:
//   - 물고기 위아래·양옆 중 물고기 자리를 뺀 나머지는 가스의 이동 후보(아래·
//     대각선 아래·좌우)이므로 돌로 막아 그 틱엔 아예 움직일 데가 없게 가둔다
//     (중력 강도가 항상 1이라 위쪽 대각선·랜덤 확산은 애초에 시도되지 않는다).
//   - 가스를 하나가 아니라 **둘**(좌우) 두는 것은 결정성 자체를 위해서다 —
//     0.4% 소멸조차 두 소스가 같은 틱에 동시에 걸릴 확률은 무시할 수준으로
//     떨어진다.
// 물고기의 위쪽 한 칸만은 건드리지 않는다 — 물 장면에서 "여전히 물에 닿아 있다"
// (touchingWater)를 유지하면서 죽는지 보려면 헤엄칠 물이 최소 한 칸은 남아야 한다.
const pinFishBetweenChlorine = (grid: Grid, fx: number, fy: number): void => {
  put(grid, fx - 1, fy, CHLORINE); // 왼쪽 가스
  put(grid, fx + 1, fy, CHLORINE); // 오른쪽 가스
  put(grid, fx, fy, FISH);
  put(grid, fx, fy + 1, STONE); // 아래 — 양쪽 가스의 대각선 아래 이동을 동시에 막는다
  put(grid, fx - 1, fy + 1, STONE); // 왼쪽 가스의 아래
  put(grid, fx + 1, fy + 1, STONE); // 오른쪽 가스의 아래
  put(grid, fx - 2, fy + 1, STONE); // 왼쪽 가스의 대각선 아래(바깥쪽)
  put(grid, fx + 2, fy + 1, STONE); // 오른쪽 가스의 대각선 아래(바깥쪽)
  put(grid, fx - 2, fy, STONE); // 왼쪽 가스의 옆이동(바깥쪽)
  put(grid, fx + 2, fy, STONE); // 오른쪽 가스의 옆이동(바깥쪽)
};

{
  reseed();
  const dry = makeWorld(20, 20);
  fill(dry.grid, 0, 0, 19, 19, STONE);
  fill(dry.grid, 2, 2, 17, 17, EMPTY);
  pinFishBetweenChlorine(dry.grid, 10, 10);
  dry.sim.step();
  check(
    '염소가스에 닿으면 한 틱 만에 죽는다 (확률이 아니라 접촉 즉시)',
    count(dry.grid, FISH) === 0 && count(dry.grid, DEAD) === 1,
    `${count(dry.grid, FISH)} live, ${count(dry.grid, DEAD)} dead`,
  );

  // 물속에서도 마찬가지다 — 오염수처럼 몇 틱 버티는 게 아니라 여기서도 즉발이다.
  // 물고기 위쪽 한 칸은 그대로 물로 남겨 둬(pinFishBetweenChlorine 참고),
  // 헤엄치는 도중에도 죽는지를 잰다(touchingWater가 참인 채로 죽어야 한다).
  reseed();
  const wet = makeWorld(20, 20);
  tank(wet.grid, 4);
  pinFishBetweenChlorine(wet.grid, 10, 10);
  wet.sim.step();
  check(
    '수조 안에서도 염소가스 접촉은 즉사다 (오염수처럼 버티지 않는다)',
    count(wet.grid, FISH) === 0 && count(wet.grid, DEAD) === 1,
    `${count(wet.grid, FISH)} live, ${count(wet.grid, DEAD)} dead`,
  );

  // 여러 시드로 반복해 정말 결정적인지(확률이 섞여 있지 않은지) 확인한다.
  let allDead = true;
  const TRIALS = 20;
  for (let k = 0; k < TRIALS; k++) {
    reseed();
    const t = makeWorld(20, 20);
    fill(t.grid, 0, 0, 19, 19, STONE);
    fill(t.grid, 2, 2, 17, 17, EMPTY);
    pinFishBetweenChlorine(t.grid, 10, 10);
    t.sim.step();
    if (count(t.grid, FISH) !== 0) allDead = false;
  }
  check(
    '20판 전부 첫 틱에 죽는다 (KILL_CHANCE 같은 확률이 아니다)',
    allDead,
    allDead ? '20/20 즉사' : '확률이 섞여 있다',
  );

  // 인접하지 않으면 안 죽는다 — 사거리 없이 아무 염소가스에나 반응하는 버그를 잡는다.
  reseed();
  const far = makeWorld(20, 20);
  fill(far.grid, 0, 0, 19, 19, STONE);
  fill(far.grid, 2, 2, 17, 17, EMPTY);
  put(far.grid, 10, 10, FISH);
  put(far.grid, 13, 10, CHLORINE); // 3칸 떨어짐 — DIR4 접촉이 아니다
  far.sim.step();
  check(
    '떨어져 있는 염소가스는 닿지 않은 것 — 죽지 않는다',
    count(far.grid, FISH) === 1 && count(far.grid, DEAD) === 0,
    `${count(far.grid, FISH)} live, ${count(far.grid, DEAD)} dead`,
  );
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

  // ── 6b. 사체도 500°↑에서는 연기로 소멸 ────────────────────────────────────
  // deadfish.ts의 VAPORIZE_TEMP(fish.ts와 같은 값) — 이미 죽은 몸도 부패를 기다리지
  // 않고 곧장 Smoke가 된다. 마른 돌상자를 쓰는 이유와 setSmokeLevel('high')를 쓰는
  // 이유는 5b와 동일(SimContext.applySmokeLevel이 기본 'medium'에서 쓰기의 65%를
  // EMPTY로 거른다).
  reseed();
  const scorchedCorpse = makeWorld(20, 20);
  fill(scorchedCorpse.grid, 0, 0, 19, 19, STONE);
  fill(scorchedCorpse.grid, 2, 2, 17, 17, EMPTY);
  scorchedCorpse.grid.temp.fill(600);
  put(scorchedCorpse.grid, 10, 10, DEAD);
  scorchedCorpse.sim.setSmokeLevel('high');
  let corpseVaporized = false;
  for (let t = 0; t < 5 * HZ && !corpseVaporized; t++) {
    scorchedCorpse.sim.step();
    corpseVaporized = count(scorchedCorpse.grid, DEAD) === 0 && count(scorchedCorpse.grid, SMOKE) > 0;
  }
  check(
    '600° 열은 사체도 연기로 태워 없앤다 (부패를 기다리지 않는다)',
    corpseVaporized,
    `smoke=${count(scorchedCorpse.grid, SMOKE)}, dead=${count(scorchedCorpse.grid, DEAD)}`,
  );
}

// ── 7. 개인 공간 + 느슨한 모임 ────────────────────────────────────────────────
// 사회성은 밀기와 당기기 두 항이고, 잘못될 수 있는 방향이 정확히 세 가지라 셋 다
// 잰다. 이 블록은 두 번 갈아엎였고 세 번째가 지금이다:
//   • 붙지 않는다 — 구석에 쌓아 두면 흩어지고, 다시 뭉쳐 붙지 않는다.
//   • 한 덩어리로 다니지 않는다 — 응집만 세면 옛 boids로 돌아간다. 같은 수조에
//     무작위로 뿌린 몬테카를로 대조군보다 뭉쳐 있으면 안 된다.
//   • **간격이 규칙적이지 않다** — 이게 이번에 추가된 진짜 요구사항이다. 분리만
//     남기면 물고기가 고르게 벌어져 격자가 되는데, 규칙으로는 가장 자연스러워도
//     보기에는 환공포증을 자극한다. 평균 거리로는 이걸 못 잡는다 — 격자와 뭉친
//     분포가 같은 평균을 가질 수 있기 때문이다. 그래서 최근접 거리의 **변동계수**
//     (표준편차/평균)를 같은 무작위 대조군과 비교한다. 격자는 변동계수가 0에
//     가깝고, 얼룩덜룩한 분포는 무작위만큼 크다.
{
  /** fish.ts's PERSONAL_SPACE, restated rather than imported — the harness should
   *  fail if that constant is retuned without someone looking at these numbers. */
  const PERSONAL_SPACE = 3;
  /** Every fish's distance to its nearest neighbour (Chebyshev — the metric the
   *  8-neighbour ring actually moves in). */
  const nearest = (pts: { x: number; y: number }[]): number[] =>
    pts.map((a) => {
      let best = Infinity;
      for (const b of pts) {
        if (a === b) continue;
        const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        if (d < best) best = d;
      }
      return best;
    });
  const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
  const meanNearest = (pts: { x: number; y: number }[]): number => mean(nearest(pts));
  /** 변동계수 — 표준편차/평균. 간격이 얼마나 **불규칙한가**의 척도로, 평균 거리가
   *  못 잡는 것을 잡는다: 격자는 0에 가깝고, 얼룩덜룩한 분포는 크다. */
  const spacingCV = (pts: { x: number; y: number }[]): number => {
    const nn = nearest(pts);
    const m = mean(nn);
    return Math.sqrt(mean(nn.map((d) => (d - m) * (d - m)))) / m;
  };

  // The null: what "no social behaviour at all" looks like in this exact tank.
  reseed();
  let nullAcc = 0;
  let nullCV = 0;
  const TRIALS = 400;
  for (let t = 0; t < TRIALS; t++) {
    const pts = [];
    for (let k = 0; k < 12; k++) {
      pts.push({ x: 2 + Math.floor(Math.random() * 76), y: 6 + Math.floor(Math.random() * 31) });
    }
    nullAcc += meanNearest(pts);
    nullCV += spacingCV(pts);
  }
  const scattered = nullAcc / TRIALS;
  const scatteredCV = nullCV / TRIALS;

  // Piled into one corner, three cells apart — inside everyone's personal space.
  //
  // **여섯 판을 이어 붙여 평균 낸다.** 한 판만 재면 시드에 따라 빨개진다: 아래 두 항목이
  // 주장하는 마진이 무작위 대비 겨우 1~3%인데(설계상 그렇다 — 무작위와 구분되지 않을
  // 만큼만 퍼지는 게 목표였다) 한 판의 노이즈가 그만큼 크다. 시드 1..1000을 훑어 실측한
  // 플레이크가 15/1000(1.5%)이었고, 전부 clump 아니면 CV 항목이었다(상한 항목은 한 번도
  // 걸리지 않았다 — 마진이 넉넉하다). 8c·8d·8e가 같은 이유로 이미 여러 판을 이어 붙인다.
  //
  // 판 수는 실측한 마진 분포에서 골랐다: 네 판일 때 clump 마진이 평균 1.084에 표준편차
  // 0.024라 임계(1.0)까지 3.5σ — 1/4000쯤에서 여전히 빨개진다. 여섯 판이면 4.3σ가 되어
  // 1/10만 아래로 떨어진다. 한 판을 더 넣는 값이 6초쯤이라 이쪽이 싸다.
  reseed();
  const TANKS = 6;
  let nnAcc = 0;
  let samples = 0;
  let cvAcc = 0;
  let worstCrowd = 0; // 창 전체에서 가장 붙어 있던 순간의 최근접 거리 (판을 통틀어)
  let packed = 0;
  for (let run = 0; run < TANKS; run++) {
    const { grid, sim } = makeWorld(80, 40);
    tank(grid, 6);
    for (let k = 0; k < 12; k++) put(grid, 6 + (k % 4), 10 + Math.floor(k / 4), FISH);
    packed = meanNearest(cellsOf(grid, FISH));
    for (let t = 0; t < 60 * HZ; t++) {
      sim.step();
      if (t < 20 * HZ || t % 15 !== 0) continue; // 20s to disperse from the pile first
      const f = cellsOf(grid, FISH);
      const nn = meanNearest(f);
      nnAcc += nn;
      cvAcc += spacingCV(f);
      samples++;
      if (worstCrowd === 0 || nn < worstCrowd) worstCrowd = nn;
    }
  }
  const settled = nnAcc / samples;
  const settledCV = cvAcc / samples;
  check(
    'a pile of fish spreads itself out — they object to being crowded',
    settled > packed * 2,
    `nearest neighbour ${packed.toFixed(2)} packed → ${settled.toFixed(2)} settled`,
  );
  check(
    '…but they never clump back together, at any moment in the run',
    worstCrowd > PERSONAL_SPACE * 0.6,
    `tightest sampled moment ${worstCrowd.toFixed(2)} (개인 공간 ${PERSONAL_SPACE})`,
  );
  // Bounded on both sides against the same null. Enforcing a minimum spacing
  // *necessarily* spreads them a little wider than a random scatter (which is free
  // to put two fish in adjacent cells), so the honest claim is "not tighter, and
  // not a lattice either" — not "indistinguishable from random".
  check(
    '한 덩어리로 다니지 않는다 — 무작위로 뿌린 것보다 뭉쳐 있지 않다',
    settled > scattered,
    `${settled.toFixed(2)} vs ${scattered.toFixed(2)} scattered (옛 boids는 5.26이었다)`,
  );
  check(
    '…그리고 반발이 지나쳐 멀찍이 벌어지지도 않는다',
    settled < scattered * 1.4,
    `${(settled / scattered).toFixed(2)}× 무작위 (분리만 남겼을 땐 1.20×)`,
  );
  // 이번 요구사항 본체. 평균이 아니라 **분포의 고름**을 본다 — 격자와 얼룩덜룩한
  // 배치는 평균이 같을 수 있고, 눈에 거슬리는 쪽은 고른 쪽이다.
  // 임계 0.8×는 실측으로 잡았다. 응집을 끄면(분리만) 0.37로 떨어지고 — 유저가 실제로
  // 지적한 그 그림이다 — 개인 공간을 키울수록 6칸 0.30, 8칸 0.21로 더 고르게 굳는다.
  // 지금 설정은 0.56으로 무작위와 사실상 같다. 0.7×(=0.38)로 두면 분리만 남긴 판이
  // 아슬아슬하게 걸리므로 여유를 둔다.
  check(
    '간격이 규칙적이지 않다 (격자로 굳지 않는다 — 환공포증)',
    settledCV > scatteredCV * 0.8,
    `변동계수 ${settledCV.toFixed(2)} vs 무작위 ${scatteredCV.toFixed(2)} (분리만: 0.37, 개인 공간 8칸: 0.21)`,
  );
  // 위 세 항목은 전부 "물고기가 여럿일 때"의 그림이고, 애초에 여럿이 되지 않게 하는
  // 것이 나머지 절반이다. 배치는 PointerPainter(UI 경로)에 있어 헤드리스로 돌릴 수
  // 없으므로 태그의 존재만 못 박는다 — 이게 조용히 빠지면 브러시 한 번에 수십 마리가
  // 찍히고 격자 그림이 그대로 돌아온다.
  const fishMat = getMaterial(FISH);
  const seedMat = getMaterial(ID('Seed'));
  check(
    '물고기는 붓는 게 아니라 흩뿌린다 (배치 밀도 태그가 살아 있다)',
    fishMat.placementDensity !== undefined &&
      fishMat.placementDensity < (seedMat.placementDensity ?? 1),
    `물고기 ${fishMat.placementDensity} vs 씨앗 ${seedMat.placementDensity}`,
  );
}

// ── 7b. 감전 ─────────────────────────────────────────────────────────────────
// 물이 도체라, 수조에 전지를 담그면 전류가 물 자체를 타고 퍼진다. 판정은 물고기가
// 자기 이웃에서 Spark를 찾는 게 아니라 **스파크의 arc 단계에서** 내려온다
// (Material.sparkDeathChance) — 스파크는 한 틱만 살고 도체로 되돌아가므로, 물고기가
// 직접 찾으면 스캔 순서에 따라 보이기도 하고 안 보이기도 한다.
{
  reseed();
  let killed = 0;
  let total = 0;
  const RUNS = 20;
  for (let r = 0; r < RUNS; r++) {
    const { grid, sim } = makeWorld(40, 30);
    tank(grid, 6);
    for (let k = 0; k < 6; k++) put(grid, 8 + k * 4, 12, FISH);
    total += 6;
    put(grid, 2, 8, BATTERY); // 한쪽 벽에 붙인 전극 하나 — 나머지는 물이 옮긴다
    for (let t = 0; t < 8 * HZ; t++) sim.step();
    killed += 6 - count(grid, FISH);
  }
  check(
    '수조에 전류가 흐르면 물고기가 감전사한다 (물이 도체라 전선이 안 닿아도 된다)',
    killed > total * 0.5,
    `${killed}/${total} killed across ${RUNS} tanks`,
  );
  // 즉사가 아니라 확률이라는 것 — 한 번 훑고 전멸하면 50%가 아니다. 짧은 창에서
  // 최소한 몇 마리는 살아 있어야 한다.
  reseed();
  const { grid, sim } = makeWorld(40, 30);
  tank(grid, 6);
  for (let k = 0; k < 6; k++) put(grid, 8 + k * 4, 12, FISH);
  put(grid, 2, 8, BATTERY);
  let firstDeath = -1;
  let aliveAtFirstDeath = 0;
  for (let t = 0; t < 8 * HZ; t++) {
    sim.step();
    const alive = count(grid, FISH);
    if (alive < 6 && firstDeath < 0) {
      firstDeath = t;
      aliveAtFirstDeath = alive;
    }
  }
  check(
    '…한 방에 전멸하는 게 아니라 확률 판정이다',
    firstDeath >= 0 && aliveAtFirstDeath > 0,
    `첫 사망 tick ${firstDeath}, 그 순간 생존 ${aliveAtFirstDeath}/6`,
  );
  check(
    '…그리고 감전사도 같은 사체를 남긴다',
    count(grid, DEAD) > 0,
    `${count(grid, DEAD)} corpses`,
  );

  // 위 두 장면은 전지가 계속 뛰므로 결국 전멸한다(옳다 — 전류를 계속 흘리면 다 죽는다).
  // 확률 자체는 **펄스 한 번**으로만 잴 수 있다. 스파크 한 칸을 손으로 충전해 한 틱만
  // 돌린다. 물고기는 돌로 가둔다 — 열린 물에 두면 스파크가 제 차례를 맞기 전에
  // 헤엄쳐 이웃 밖으로 빠져나가서, 접촉당 확률이 아니라 "접촉이 성사될 확률"이
  // 섞여 들어간다(그렇게 재면 20.8%가 나온다).
  reseed();
  let died = 0;
  const SHOTS = 400;
  for (let r = 0; r < SHOTS; r++) {
    const { grid: g, sim: s } = makeWorld(12, 12);
    fill(g, 0, 0, 11, 11, STONE);
    put(g, 5, 5, FISH);
    put(g, 5, 4, SPARK); // 물고기 바로 위 — 한 틱만 살아 있다
    g.aux[g.idx(5, 4)] = packSpark(FULL_STRENGTH, conductorClass(WATER));
    s.step();
    if (g.cells[g.idx(5, 5)] === DEAD) died++;
  }
  const rate = died / SHOTS;
  check(
    '펄스 한 번당 사망률이 설계값 50%다',
    rate > 0.42 && rate < 0.58,
    `${(rate * 100).toFixed(1)}% over ${SHOTS} single pulses`,
  );

  // 스파크를 물고기 **아래**에 두면 스캔 순서가 뒤집혀 스파크가 먼저 처리된다. 그러면
  // 사체는 '이번 틱에 아직 안 훑은 칸'에 쓰이는 것이라, moved 표시를 안 하면
  // updateDeadFish가 **같은 틱에 한 번 더** 돈다 — 태어나자마자 부력으로 한 칸 뜨고,
  // 부패 판정도 한 번 더 받는다. 그래서 이웃 칸에 대한 비어 있지 않은 쓰기는 `set`이
  // 아니라 `spawn`이어야 한다(SimContext.spawn 주석의 규칙, radiationDeath·shockKill도
  // 같은 이유로 spawn을 쓴다). 스파크가 위에 있는 위 장면은 순서가 반대라 이걸 못 잡는다.
  reseed();
  let below = 0;
  let unmarked = 0;
  for (let r = 0; r < SHOTS; r++) {
    const { grid: g, sim: s } = makeWorld(12, 12);
    fill(g, 0, 0, 11, 11, STONE);
    put(g, 5, 5, FISH);
    put(g, 5, 6, SPARK); // 물고기 바로 아래 — 스파크가 먼저 스캔된다
    g.aux[g.idx(5, 6)] = packSpark(FULL_STRENGTH, conductorClass(WATER));
    s.step();
    if (g.cells[g.idx(5, 5)] !== DEAD) continue;
    below++;
    if (g.moved[g.idx(5, 5)] !== 1) unmarked++;
  }
  check(
    '감전사한 사체는 태어난 틱에 처리 완료로 표시된다 (set이 아니라 spawn)',
    below > 0 && unmarked === 0,
    `사체 ${below}개 중 moved 안 된 것 ${unmarked}개 (스파크가 아래=먼저 스캔되는 배치)`,
  );
  check(
    '…그 배치에서도 사망률은 그대로 50%다',
    below / SHOTS > 0.42 && below / SHOTS < 0.58,
    `${((below / SHOTS) * 100).toFixed(1)}%`,
  );

  // 이웃이 둘이면 두 번 굴리는가 — 전류의 앞머리가 넓어지면 한 틱에 여러 칸이 동시에
  // 스파크가 되므로 실제로 일어난다. 노출 한 번은 판정 한 번이어야 한다(SimContext의
  // sparkRolled). 없으면 50%가 66%가 된다 — 충격파 쪽이 이미 같은 이유로 memo를 쓴다.
  reseed();
  let twoSided = 0;
  for (let r = 0; r < SHOTS; r++) {
    const { grid: g, sim: s } = makeWorld(12, 12);
    fill(g, 0, 0, 11, 11, STONE);
    put(g, 5, 5, FISH);
    put(g, 5, 4, SPARK);
    put(g, 5, 6, SPARK); // 위아래 동시 — 각자 제 arc 차례를 갖는다
    g.aux[g.idx(5, 4)] = packSpark(FULL_STRENGTH, conductorClass(WATER));
    g.aux[g.idx(5, 6)] = packSpark(FULL_STRENGTH, conductorClass(WATER));
    s.step();
    if (g.cells[g.idx(5, 5)] === DEAD) twoSided++;
  }
  const twoRate = twoSided / SHOTS;
  check(
    '스파크가 둘이어도 한 틱엔 한 번만 굴린다 (50%가 66%로 불어나지 않는다)',
    twoRate > 0.42 && twoRate < 0.58,
    `${(twoRate * 100).toFixed(1)}% (memo 없을 땐 66.0%)`,
  );

  // 전극에 **직접** 닿은 경우. 위 장면들은 전부 도체(물)를 거쳐 스파크가 생기는 경로라,
  // 전지가 이웃을 직접 때리는 경로(pulseCell → reactToPulse)는 하나도 안 거친다.
  // 그래서 도체를 통째로 지운 세계에 물고기를 둔다 — 판정이 오직 직접 접촉으로만 온다.
  //
  // 예전엔 기름 웅덩이였다("숨은 쉬고 전류는 안 옮기는 액체"). 물·소금물이 아닌 액체가
  // 물고기를 죽이게 된 뒤로 기름은 그 역할을 못 한다 — 3초면 감전이 아니라 기름으로
  // 죽으므로 분기가 빠져도 20/20이 나오는, 조용히 아무것도 안 재는 장면이 된다. 이제
  // 남은 비도체 매질은 **공기**뿐이라 3×3 공기 주머니를 돌로 두르고 전극을 가운데
  // 놓는다. 물고기가 어디로 펄떡여도 여덟 칸 전부 전극의 이웃(DIR8)이라 "닿을 확률"이
  // 섞이지 않는 것은 그대로고, 대신 질식이 섞인다 — 3초 창의 질식 사망률은 4.2%라
  // (AIR_HAZARD, 중앙값 12초) 분기가 빠지면 20판 중 1판쯤 죽는 데 그쳐 여전히 걸린다.
  reseed();
  let zapped = 0;
  const DRY_RUNS = 20;
  for (let r = 0; r < DRY_RUNS; r++) {
    const { grid: g, sim: s } = makeWorld(12, 12);
    fill(g, 0, 0, 11, 11, STONE);
    fill(g, 4, 4, 6, 6, EMPTY); // 공기 주머니 — 도체도, 물고기를 죽이는 액체도 없다
    put(g, 5, 5, BATTERY);
    put(g, 4, 4, FISH);
    for (let t = 0; t < 3 * HZ; t++) s.step();
    if (count(g, FISH) === 0) zapped++;
  }
  check(
    '전극에 직접 닿아도 감전된다 (도체를 거치지 않는 경로)',
    zapped >= DRY_RUNS - 2,
    `${zapped}/${DRY_RUNS} (reactToPulse에 분기가 없으면 1판쯤)`,
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
    let wrong = 0;
    let hops = 0;
    // 여러 판을 이어 붙인다. 질식이 확률이 된 뒤로는 한 판이 얼마나 오래 가는지가
    // 제각각이라(중앙값 12초, 최소는 1초 미만) 한 판만 돌리면 표본이 모자랄 수 있다.
    for (let r = 0; r < 8; r++) {
      const { grid, sim } = makeWorld(40, 40);
      fill(grid, 0, 0, 39, 39, STONE);
      fill(grid, 2, 2, 37, 37, EMPTY); // a dry stone box — nothing but flopping in here
      put(grid, 20, 20, FISH);
      sim.setGravity(dir, 1);
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
      `…and under ${dir} gravity, where a "fall" can itself be sideways`,
      hops > 20 && wrong === 0,
      `${wrong} wrong out of ${hops} sideways steps`,
    );
  }
}

// ── 8e. 펄떡임은 어느 중력 세기에서도 추진기가 아니다 ────────────────────────
// 펄떡임의 *발생*은 중력 게이트를 타지 않는다(제 근육이지 무게가 아니다). 그런데
// *방향*을 중력 벡터로 잡으면, 균형을 잡아 줄 낙하는 게이트를 타서 세기에 비례해
// 줄어드는데 위로 뛰는 편향만 그대로 남는다. 물고기가 스스로 천장까지 노 저어
// 올라가 붙는다.
//
// **끝점 두 개만 재면 이걸 못 본다.** 실제로 첫 수정은 세기 0만 특수 처리했고
// {0, 1}만 검사해서 통과했는데, 정작 최악은 그 사이였다 — 0.05에서 +57칸, 0.1에서
// +42칸으로, 고치려던 무중력 버그(+28칸)보다 나빴다(0에서는 적어도 다시 떨어져
// 뛸 일이 없었다). UI 슬라이더가 0.1 단위라 전부 실제로 고를 수 있는 값이다.
// 그래서 교차점(≈0.25) 양쪽을 훑는다.
//
// 세기마다 **여러 번 돌려 평균**을 낸다. 세기 0은 설계상 편향이 0인 순수 무작위
// 걷기라, 한 번만 재면 분산만으로 임계를 넘는다 — 시드 9%쯤에서 이유 없이 빨개졌다
// (SEED_BASE=17이 그랬다). 추진기가 되는 회귀는 매 판 천장(+28)을 찍으므로 평균을
// 내도 그대로 잡히고, 흔들림만 사라진다.
{
  reseed();
  const rows: string[] = [];
  let rose = 0;
  let frozen = 0;
  const TRIALS = 6;
  for (const strength of [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1]) {
    let peakAcc = 0;
    let movedAcc = 0;
    for (let r = 0; r < TRIALS; r++) {
      const { grid, sim } = makeWorld(40, 40);
      fill(grid, 0, 0, 39, 39, STONE);
      fill(grid, 2, 2, 37, 37, EMPTY);
      put(grid, 20, 30, FISH);
      sim.setGravity('down', strength);
      let prev = cellsOf(grid, FISH)[0];
      let peak = 0; // 창 안에서 가장 높이 올라간 지점 (끝값만 보면 되돌아온 척할 수 있다)
      for (let t = 0; t < 12 * HZ; t++) {
        sim.step();
        const now = cellsOf(grid, FISH)[0];
        if (!now || !prev) break;
        if (now.x !== prev.x || now.y !== prev.y) movedAcc++;
        if (30 - now.y > peak) peak = 30 - now.y;
        prev = now;
      }
      peakAcc += peak;
    }
    const peak = peakAcc / TRIALS;
    rows.push(`g=${strength} 평균 최고 +${peak.toFixed(1)}`);
    if (peak > 12) rose++; // 천장까지는 +28
    if (movedAcc / TRIALS <= 20) frozen++; // 어느 세기에서도 얼어붙지 않아야 한다
  }
  check(
    '펄떡임은 어느 중력 세기에서도 천장으로 가는 추진기가 되지 않는다',
    rose === 0,
    rows.join(', '),
  );
  check(
    '…그리고 어느 세기에서도 얼어붙지 않는다 (게이트로 막아 고친 게 아니다)',
    frozen === 0,
    `${frozen} strengths where the fish barely moved`,
  );
}

// ── 8d. …그리고 남의 aux를 밟지 않는다 ────────────────────────────────────────
// 8c의 낙하 분기 수정은 `moveDown`이 true를 주면 물고기가 중력 한 칸 앞에 있다고
// 믿었는데, `tryMove`는 **움직이지 않고도** true를 준다. 그 목적지에 있는 것은
// 남의 칸이고, 거기에 물고기 aux를 쓰면 그 물질의 상태가 조용히 망가진다.
// (에틸렌이라면 중합 세대 카운터다.) 두 경로 다 평범한 플레이로 닿는다.
{
  // (a) 기체로 떨어질 때의 항력 게이트 — tryMove가 "이번 틱은 버텼다"며 move를
  // 소비하고 true를 반환한다(SimContext의 drag gate). 물 밖 판정은 액체만 보므로
  // CO₂ 옆의 물고기는 펄떡이는 중이고, 낙하 분기가 그대로 기체 칸을 때린다.
  reseed();
  let dirtyGas = 0;
  let contact = 0;
  // 질식이 확률이 된 뒤로 한 판의 길이가 제각각이라, 접촉 표본은 여러 판에서 모은다.
  for (let r = 0; r < 6; r++) {
    const { grid, sim } = makeWorld(40, 40);
    fill(grid, 0, 0, 39, 39, STONE);
    fill(grid, 2, 2, 37, 37, EMPTY);
    fill(grid, 24, 16, 34, 24, CO2); // 중력 방향(오른쪽)에 깔린 기체 웅덩이
    put(grid, 20, 20, FISH);
    sim.setGravity('right', 1);
    for (let t = 0; t < 12 * HZ; t++) {
      sim.step();
      const f = cellsOf(grid, FISH)[0];
      if (!f) break;
      if (grid.cells[grid.idx(f.x + 1, f.y)] === CO2) contact++;
      for (const g of cellsOf(grid, CO2)) if (g.aux !== 0) dirtyGas++;
    }
  }
  check(
    'a fish falling against a gas never writes its aux into the gas cell',
    contact > 20 && dirtyGas === 0,
    `${dirtyGas} corrupted gas cells over ${contact} contact ticks`,
  );
}
{
  // (b) 보이드 경계(ControlPanel에서 켤 수 있다) — 가장자리에서 떨어진 칸은
  // 삭제되는데 tryMove는 true다. 예전 코드는 격자 밖 좌표에 setAux를 했고,
  // Grid.setAux는 경계 검사가 없어 y*width+x가 옆 줄의 멀쩡한 칸으로 감긴다.
  for (const dir of ['left', 'right'] as const) {
    reseed();
    const { grid, sim } = makeWorld(40, 40);
    fill(grid, 0, 0, 39, 39, STONE);
    fill(grid, 0, 20, 39, 20, EMPTY); // 양끝이 열린 복도
    put(grid, dir === 'right' ? 39 : 0, 20, FISH);
    sim.setGravity(dir, 1);
    sim.setBorderMode('void');
    let gone = false;
    for (let t = 0; t < 4 * HZ && !gone; t++) {
      sim.step();
      gone = count(grid, FISH) === 0;
    }
    // 이 세계에는 돌·빈칸·물고기뿐이고 셋 다 aux를 쓰지 않으므로, 0이 아닌 aux는
    // 곧 격자 밖으로 새어 나간 쓰기다. 어느 줄로 감기는지 계산할 필요가 없다.
    let stray = 0;
    for (let i = 0; i < grid.aux.length; i++) if (grid.aux[i] !== 0) stray++;
    check(
      `…nor past the ${dir} void border, into an unrelated cell of another row`,
      gone && stray === 0,
      gone ? `${stray} cells left holding stray aux` : 'the fish never fell out',
    );
  }
}

// ── 9. 오염수: 물과 소금물이 아니면 죽는다 ────────────────────────────────────
// 물고기는 예전엔 **아무 액체에서나** 헤엄쳤다(기름·산·꿀). 지금은 물/소금물만
// 서식지이고 나머지는 오염수다 — 매 틱 굴리는 확률이라(fish.ts POISON_HAZARD,
// 평균 1.5초) 못 박아야 하는 것이 셋이다: 정말 죽는가, 소금물은 멀쩡한가, 그리고
// **한 틱 스친 것으로는 대개 안 죽는가**(즉사가 아니라 확률이라는 것).
{
  reseed();
  const POISON_RUNS = 20;
  let poisoned = 0;
  let corpses = 0;
  const deathTicks: number[] = [];
  for (let r = 0; r < POISON_RUNS; r++) {
    const { grid: g, sim: s } = makeWorld(20, 20);
    fill(g, 0, 0, 19, 19, STONE);
    fill(g, 5, 5, 14, 14, OIL); // 기름 웅덩이 한가운데 — 어디로 가도 기름이 이웃이다
    put(g, 10, 10, FISH);
    for (let t = 0; t < 10 * HZ; t++) {
      s.step();
      if (count(g, FISH) === 0) {
        poisoned++;
        deathTicks.push(t);
        if (count(g, DEAD) >= 1) corpses++;
        break;
      }
    }
  }
  deathTicks.sort((a, b) => a - b);
  const median = deathTicks.length ? deathTicks[deathTicks.length >> 1] : -1;
  check(
    '기름 속 물고기는 몇 초 안에 죽는다 (물·소금물이 아닌 액체는 오염수다)',
    poisoned === POISON_RUNS && median < 5 * HZ,
    `${poisoned}/${POISON_RUNS} died, median tick ${median} (설계 평균 1.5초 = 45틱)`,
  );
  // 사체 항목을 **같은 판**에서 세는 이유: 따로 한 판을 더 두면 기름 속 물고기는
  // 오염수 판정이 통째로 빠져도 10초 창 안에 질식으로 죽어(38%) 우연히 통과한다.
  // 위 항목과 같은 20판을 쓰면 판정이 빠졌을 때 둘 다 함께 걸린다.
  check(
    '…그리고 오염수 사망도 같은 사체를 남긴다',
    corpses === POISON_RUNS,
    `${corpses}/${POISON_RUNS} left a corpse`,
  );

  // 소금물은 서식지다. 40초는 위 중앙값의 스무 배가 넘으므로, 판정이 "물이 아닌 것"
  // 으로 굳어 있으면(소금물을 빠뜨리면) 여기서 전멸한다.
  reseed();
  const brine = makeWorld();
  const SALTWATER = ID('Saltwater');
  fill(brine.grid, 0, brine.grid.height - 3, brine.grid.width - 1, brine.grid.height - 1, STONE);
  fill(brine.grid, 0, 0, 1, brine.grid.height - 1, STONE);
  fill(brine.grid, brine.grid.width - 2, 0, brine.grid.width - 1, brine.grid.height - 1, STONE);
  fill(brine.grid, 2, 8, brine.grid.width - 3, brine.grid.height - 4, SALTWATER);
  for (const [x, y] of [
    [10, 14],
    [20, 20],
    [30, 26],
    [40, 16],
  ] as const)
    put(brine.grid, x, y, FISH);
  for (let t = 0; t < 40 * HZ; t++) brine.sim.step();
  check(
    '소금물에서는 40초를 멀쩡히 산다 (바다도 서식지다)',
    count(brine.grid, FISH) === 4 && count(brine.grid, DEAD) === 0,
    `${count(brine.grid, FISH)}/4 live, ${count(brine.grid, DEAD)} dead`,
  );

  // 한 틱만 스치는 경우. 매 틱 확률(2.2%)이지 접촉 즉사가 아니라는 것 — 파도가 기름을
  // 잠깐 끼얹거나 물 위 기름막을 스쳐 지나는 정도로 떼죽음이 나면 안 된다. 즉사로
  // 굳으면 100%가 나온다.
  reseed();
  let grazed = 0;
  const GRAZE_RUNS = 400;
  for (let r = 0; r < GRAZE_RUNS; r++) {
    const { grid: g, sim: s } = makeWorld(9, 9);
    fill(g, 0, 0, 8, 8, STONE);
    fill(g, 3, 3, 5, 5, WATER);
    put(g, 4, 4, FISH);
    put(g, 4, 3, OIL); // 머리 위 기름 한 칸 — 딱 한 틱
    s.step();
    if (count(g, FISH) === 0) grazed++;
  }
  const grazeRate = grazed / GRAZE_RUNS;
  check(
    '…하지만 한 틱 스친 것으로 죽지는 않는다 (접촉 즉사가 아니라 확률이다)',
    grazeRate < 0.08,
    `${(grazeRate * 100).toFixed(1)}% of ${GRAZE_RUNS} (설계 2.2%, 즉사면 100%)`,
  );
}

// ── 10. 수위: 물고기는 물을 밀어내지 않는다 (겹침) ────────────────────────────
// 물고기가 수조에 들어가면 물 한 칸을 밀어내 수위가 올라갔다. 지금은 들어간 칸의 물을
// **제 겹침(overlay) 슬롯에 담고** 헤엄치므로(fish.ts swim의 drawIntoOverlay) 수조는
// 물고기가 없을 때와 같은 높이를 유지한다. 재는 방법은 표면 높이가 아니라 **채워진 칸
// 수**다 — 표면은 울퉁불퉁해도 채워진 칸 수는 정확히 수위를 뜻하고, 물고기 한 마리가
// 물을 밀어내면 딱 그만큼 늘어난다.
{
  const filled = (g: Grid): number => {
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== EMPTY && g.cells[i] !== STONE) n++;
    return n;
  };
  /** 세계에 있는 물 전부 — 칸으로 있는 것과 무언가에 스며들어 있는 것 둘 다. */
  const allWater = (g: Grid): number => {
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] === WATER) n++;
      if (g.overlay[i] === WATER) n++;
    }
    return n;
  };

  reseed();
  const control = makeWorld();
  tank(control.grid, 8);
  const water0 = allWater(control.grid);
  for (let t = 0; t < 20 * HZ; t++) control.sim.step();
  const flat = filled(control.grid);

  reseed();
  const stocked = makeWorld();
  tank(stocked.grid, 8);
  const FISH_N = 8;
  for (let k = 0; k < FISH_N; k++) put(stocked.grid, 8 + k * 5, 6, FISH); // 수면 위 공중
  for (let t = 0; t < 20 * HZ; t++) stocked.sim.step();

  check(
    '물고기를 풀어도 수위가 오르지 않는다 (들어간 물을 겹침으로 품는다)',
    count(stocked.grid, FISH) === FISH_N && filled(stocked.grid) === flat,
    `${filled(stocked.grid)} filled vs ${flat} with no fish (밀어내면 +${FISH_N})`,
  );
  check(
    '…그리고 그 물은 어디로도 사라지지 않는다 (칸 + 겹침 총량 보존)',
    allWater(stocked.grid) === water0,
    `${allWater(stocked.grid)} vs ${water0} at the start`,
  );
  let carrying = 0;
  for (let i = 0; i < stocked.grid.cells.length; i++) {
    if (stocked.grid.cells[i] === FISH && stocked.grid.overlay[i] === WATER) carrying++;
  }
  check(
    '…수조 안 물고기는 저마다 물 한 칸을 품고 있다',
    carrying === FISH_N,
    `${carrying}/${FISH_N} carrying`,
  );

  // **헤엄치는 쪽이 직접 담는지**를 가르는 장면. 위 세 항목은 `porous`+`overlapFluids`
  // 선언만으로도 통과한다 — 물이 제 발로 움직이다 물고기의 빈 슬롯으로 들어가는
  // 수동 경로(tryMove의 겹침 진입)가 열 틱쯤이면 같은 상태를 만들기 때문이다. 그
  // 수동 경로는 **중력 게이트**를 타므로, 무중력에서는 물이 아예 안 움직여 물고기가
  // 스스로 담지 않으면 슬롯이 영영 빈다. 즉 이 장면만이 `swim`의 `drawIntoOverlay`
  // 호출을 실제로 잰다(그 줄만 지우면 여기만 빨개진다).
  reseed();
  const weightless = makeWorld(20, 20);
  fill(weightless.grid, 0, 0, 19, 19, STONE);
  fill(weightless.grid, 2, 2, 17, 17, WATER); // 사방이 막힌 물통
  put(weightless.grid, 10, 10, FISH);
  weightless.sim.setGravity('down', 0);
  for (let t = 0; t < 5 * HZ; t++) weightless.sim.step();
  const wf = cellsOf(weightless.grid, FISH)[0];
  const wSlot = wf ? weightless.grid.overlay[weightless.grid.idx(wf.x, wf.y)] : -1;
  check(
    '무중력에서도 물고기가 제가 들어간 물을 직접 담는다 (수동 겹침 진입은 중력 게이트를 탄다)',
    wSlot === WATER,
    `slot=${wSlot} (물이면 ${WATER})`,
  );

  // 물 밖으로 나오면 도로 내려놓는다(fish.ts shedWater) — 폭발에 물째로 튕겨 나간
  // 물고기가 물 한 칸을 업고 육지를 돌아다니면 안 된다. **무중력에서도** 내려놓아야
  // 하는데, 겹침의 자연 배수(SimContext.updateOverlay)는 중력 게이트에 걸려 멈추므로
  // 그쪽에 맡겼다면 무중력 물고기는 제가 삼킨 물로 영영 숨을 쉰다(touchingWater가
  // 이웃만 보고 제 슬롯은 안 보는 이유이기도 하다).
  for (const g of [1, 0]) {
    reseed();
    const dry = makeWorld(20, 20);
    fill(dry.grid, 0, 0, 19, 19, STONE);
    fill(dry.grid, 1, 1, 18, 18, EMPTY); // 물 한 방울 없는 마른 방
    put(dry.grid, 10, 10, FISH);
    dry.grid.overlay[dry.grid.idx(10, 10)] = WATER; // 수조에서 업고 나온 한 칸
    dry.sim.setGravity('down', g);
    // 한 틱이면 된다 — 물 밖이라는 걸 알아차린 그 틱에 내려놓는다. 더 오래 돌리면
    // 물고기가 제가 떨어뜨린 물 한 칸 옆으로 펄떡여 다시 삼키므로(웅덩이가 한 칸이면
    // 삼켰다 뱉었다 한다) 재는 것이 흐려진다.
    dry.sim.step();
    const f = cellsOf(dry.grid, FISH)[0];
    const still = f ? dry.grid.overlay[dry.grid.idx(f.x, f.y)] : -1;
    check(
      `뭍에 오른 물고기는 업고 나온 물을 흘린다 (중력 ${g})`,
      still === EMPTY && allWater(dry.grid) === 1,
      `slot=${still}, ${allWater(dry.grid)} water cell(s) in the room`,
    );
  }
}

// ── 11. 사체에도 꼬리가 달린다 ────────────────────────────────────────────────
// 꼬리는 `Material.tailPixel` + aux 비트 0(1이면 오른쪽을 본다)이 전부다 — 렌더러와의
// 계약은 8번 블록이 산 물고기 쪽에서 재고 있고, 여기서는 **사체가 그 계약을 물려받는지**
// 를 본다: 태그가 달려 있는가, 그리고 죽는 순간의 방향이 그대로 남는가(0으로 지워지면
// 죽자마자 꼬리가 반대쪽으로 튄다).
{
  check(
    '죽은 물고기도 꼬리 태그를 갖는다',
    getMaterial(DEAD).tailPixel !== undefined,
    `tailPixel=${getMaterial(DEAD).tailPixel}`,
  );

  // 스무 판을 서로 다른 길이만큼 헤엄치게 둔 뒤 수조를 통째로 끓여 죽인다 — 방향을
  // 손으로 찍지 않고 물고기가 **실제로 마지막에 움직인 방향**과 대조하려는 것이고,
  // 길이를 흩뜨리는 것은 양쪽 방향이 다 나오게 하려는 것이다(한쪽만 나오면 aux를 0으로
  // 지우는 회귀가 왼쪽 판에서 그냥 통과한다). 물이 전부 뜨거우면 물고기는 제 차례가
  // 오자마자 움직이기 전에 죽으므로, 직전 틱에 기록해 둔 방향이 곧 죽는 순간의 방향이다.
  reseed();
  let mismatched = 0;
  let corpses = 0;
  let right = 0;
  for (let r = 0; r < 20; r++) {
    const { grid, sim } = makeWorld(30, 24);
    tank(grid, 6);
    put(grid, 15, 12, FISH);
    let facing = -1;
    for (let t = 0; t < 10 + r * 5; t++) {
      sim.step();
      const f = cellsOf(grid, FISH)[0];
      if (f) facing = f.aux & 1;
    }
    if (facing < 0) continue; // 판 자체가 성립 안 함 (물고기가 사라졌다)
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== STONE) grid.temp[i] = 60; // 수조를 끓인다
    }
    sim.step();
    const corpse = cellsOf(grid, DEAD)[0];
    if (!corpse) continue;
    corpses++;
    if (facing) right++;
    if ((corpse.aux & 1) !== facing) mismatched++;
  }
  check(
    '사체는 죽는 순간 보던 방향을 그대로 물려받는다',
    corpses >= 15 && mismatched === 0,
    `${mismatched} mismatched of ${corpses} corpses`,
  );
  check(
    '…그리고 그 판들에 양쪽 방향이 다 있다 (aux를 0으로 지워도 통과하지 않는다)',
    right > 0 && right < corpses,
    `${right} facing right, ${corpses - right} left`,
  );
}

console.log(
  failures === 0 ? '\nAll fish checks passed.' : `\n${failures} fish check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
