// Headless behavioural harness for the 부패 계통 — the shared spoilage model
// (materials/spoil.ts), 곰팡이 (mold.ts), 부패물 (spoiledfood.ts), 퇴비
// (compost.ts), and the fertility those last two buy the plant line
// (soil.ts / plant.ts).
//
// What it pins down:
//   • 무엇이 썩고 무엇이 안 썩는가. The eight foods rot; 나무·톱밥·식물·밀가루·
//     탄 고기 do not, and that boundary is the whole safety property of the round
//     — a build must never decay out from under its owner. The negative half is
//     checked against the *registry*, so a `spoil` tag added to a structural
//     material in future fails here by name rather than in someone's save file.
//   • aux 충돌은 세 방향 다 본다. A spoilage counter must clear the material's own
//     dryness counter, the bits its *transform target* claims, and the bits the
//     material itself parks there. All three have or could have shipped a silent
//     bug; each is a structural check rather than a scene.
//   • 보존 넷. 저온·고온·염장·담금 each hold a cut indefinitely, and all four are
//     a *pause*: unsalt it and it carries on from where it stopped rather than
//     restarting or completing. That is the difference between this and a
//     memoryless decay roll, so it is measured rather than asserted.
//   • 육포 대 웰던. A cut dried *below* cooking heat keeps forever, off the dryness
//     counter meat.ts already maintains — and a cut grilled to well-done, which
//     ends up every bit as dry, does not. That pair is the section: 건조 보존 once
//     applied to 익은 고기 too, and since grilling drives the same counter to full
//     on its own, every cooked cut was quietly immortal.
//   • 반죽은 발효가 멈춘 것만 썩는다. 발효 and 부패 are the same kind of process, so
//     the dough is *kept* while it is rising (`SpoilSpec.keptWhile`) and on the
//     clock once it stops. Measured as aux progress, not cell counts.
//   • 마른 식품은 느리지만 면제는 아니다. 옥수수·팝콘 outlast a loaf of bread on the
//     same shelf by a wide margin, and still end up as 부패물 in the end.
//   • 곰팡이는 아무것도 파괴하지 않는다. A stone/glass/iron/wood box with rotting
//     food inside comes out with every wall cell intact, however long it runs.
//     This is the requirement the design was built around and the one that would
//     be most damaging to get wrong.
//   • 곰팡이는 한 겹이다. It films a surface rather than filling a room — measured
//     as "no mold cell is surrounded only by mold and air", i.e. every colony cell
//     still touches something real.
//   • 물속에는 안 핀다, with no rule of its own: a submerged surface has no empty
//     cells against it.
//   • 전염 경로. Mold against food is what makes a stack go over together — a
//     stack seeded with one rotting cell finishes markedly sooner than the same
//     stack with mold suppressed.
//   • 사슬은 질량을 보존한다. N cells of food end up as N cells of 퇴비, through
//     부패물, with nothing created or lost on either transform.
//   • 퇴비는 밭이다. A seed germinates on it, and a plant rooted over a compost bed
//     grows visibly bigger than the same plant on the same water over plain dirt.
//
// Run: `node test/run-spoil.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import { SPOIL_MASK } from '../src/game/materials/spoil';
import { DRY_MASK } from '../src/game/materials/meat';
import { BURNT_LIT_BIT } from '../src/game/materials/burntmeat';
import { MOLD_ATE_BIT } from '../src/game/materials/mold';
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
 *  every later scene's randomness. Nothing below is tuned to one lucky stream:
 *  `SEED_BASE=7 node test/run-spoil.mjs` should pass too. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x5b01);
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
const RAW_MEAT = ID('Raw Meat');
const COOKED_MEAT = ID('Cooked Meat');
const BURNT_MEAT = ID('Burnt Meat');
const BREAD = ID('Bread');
const BATTER = ID('Batter');
const CORN_KERNEL = ID('Corn Kernel');
const POPCORN = ID('Popcorn');
const DEAD_FISH = ID('Dead Fish');
const SPOILED = ID('Spoiled Food');
const COMPOST = ID('Compost');
const MOLD = ID('Mold');
const SALT = ID('Salt');
const HONEY = ID('Honey');
const ALCOHOL = ID('Alcohol');
const STONE = ID('Stone');
const GLASS = ID('Glass');
const IRON = ID('Iron');
const WOOD = ID('Wood');
const WATER = ID('Water');
const DIRT = ID('Dirt');
const SEED = ID('Seed');
const PLANT = ID('Plant');
const ASH = ID('Ash');

/** The three bits a spoilage counter occupies, before it is shifted into place. */
const SPOIL_FIELD = SPOIL_MASK;

/**
 * 사슬 위에 있는 질량 — every cell that entered the chain and has not left it.
 *
 * 곰팡이 is a *stage* now, not a decoration: it eats a food cell and carries that
 * cell's mass until it decays into 부패물 (mold.ts). So a mass-conservation count
 * has to include the mold that ate — and *only* that mold. Film mold, which grew
 * into empty space, is mass that was never in the chain and must not be counted,
 * which is exactly the distinction `MOLD_ATE_BIT` exists to draw.
 */
function chainMass(grid: Grid, food: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    const id = grid.cells[i];
    if (id === food || id === SPOILED || id === COMPOST) n++;
    else if (id === MOLD && (grid.aux[i] & MOLD_ATE_BIT) !== 0) n++;
  }
  return n;
}
/** Mold that got here by eating, as opposed to the film that just grew. */
function ateMold(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++)
    if (grid.cells[i] === MOLD && (grid.aux[i] & MOLD_ATE_BIT) !== 0) n++;
  return n;
}

/** ×1 sim speed, mirroring config.SIM_HZ_AT_1X — the harness states its
 *  expectations in seconds and converts here. */
const HZ = 30;
/** Room temperature (config.AMBIENT_TEMP), the anchor every declared 부패 시간 is
 *  quoted at. Scenes that mean "left on the counter" simply don't set a
 *  temperature. */
const ROOM = 20;

function makeWorld(w = 40, h = 30): { grid: Grid; sim: Simulation } {
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
function setTemp(grid: Grid, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.temp[grid.idx(x, y)] = t;
}
/** Hold a rectangle at a temperature every tick — the harness's stand-in for an
 *  environment (a freezer, a warm plate) rather than a one-shot heat brush. */
function run(
  sim: Simulation,
  grid: Grid,
  ticks: number,
  hold?: { x0: number; y0: number; x1: number; y1: number; t: number },
): void {
  for (let i = 0; i < ticks; i++) {
    if (hold) setTemp(grid, hold.x0, hold.y0, hold.x1, hold.y1, hold.t);
    sim.step();
  }
}
/** A sealed box of `wall`, `inner` cells across, with its interior at (x0,y0). */
function box(grid: Grid, x0: number, y0: number, inner: number, wall: number): void {
  fill(grid, x0 - 1, y0 - 1, x0 + inner, y0 + inner, wall);
  fill(grid, x0, y0, x0 + inner - 1, y0 + inner - 1, EMPTY);
}

// ── 1. 무엇이 썩고, 무엇이 절대 안 썩는가 ────────────────────────────────────
// The safety property of the whole round, checked at the registry rather than by
// simulating: 부패 is declared, so the roster of what decays is a fact about the
// material table and can be stated exactly.
{
  const rots = new Set(
    allMaterials()
      .filter((m) => m.spoil !== undefined)
      .map((m) => m.name),
  );
  const expected = [
    'Raw Meat',
    'Cooked Meat',
    'Bread',
    'Dead Fish',
    'Spoiled Food',
    'Batter',
    'Corn Kernel',
    'Popcorn',
  ];
  check(
    '썩는 것은 식품과 사체뿐 — 여덟, 이름까지',
    rots.size === expected.length && expected.every((n) => rots.has(n)),
    [...rots].sort().join(', '),
  );

  // The negative half, named one by one. Structural organics are the dangerous
  // ones — a decaying wall is the failure this whole design exists to prevent —
  // and they are the reason the list is spelled out rather than derived.
  const mustNotRot = [
    'Wood',
    'Sawdust',
    'Plant',
    'Seed',
    'Coral',
    'Amber',
    'Resin',
    'Coal',
    'Burnt Meat',
    'Compost',
    // 밀가루 — 마른 가루는 안 썩는다. 물을 만나 반죽이 되는 순간부터 시계가 돈다
    // (batter.ts), 그러니 「젖은 것이 상한다」가 여기서도 성립한다.
    'Flour',
    'Sugar',
    'Honey',
    'Slime',
  ];
  const leaked = mustNotRot.filter((n) => rots.has(n));
  check(
    '나무·식물·마른 가루는 썩지 않는다 — 지어 둔 것이 삭지 않는다',
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(', ')}` : `${mustNotRot.length} materials checked`,
  );

  // Every declaration must keep its counter clear of whatever else that material
  // parks in the same word. Checked structurally rather than by eye because the
  // failure is silent — a steak that quietly changes colour, a loaf whose crust
  // flickers — and the shifts are the one thing SpoilSpec can't derive.
  const overlaps = allMaterials()
    .filter((m) => m.spoil !== undefined && m.spoil.dryMask !== undefined)
    .filter((m) => (m.spoil!.dryMask! & (SPOIL_FIELD << m.spoil!.auxShift)) !== 0)
    .map((m) => m.name);
  check(
    '부패 카운터가 같은 물질의 건조 카운터와 안 겹친다',
    overlaps.length === 0,
    overlaps.length ? `OVERLAP: ${overlaps.join(', ')}` : 'meat chain checked',
  );

  // …and clear of what the material it turns into parks there, which is the half
  // the check above cannot see and the half that actually shipped a bug.
  //
  // `sim.set` preserves aux, so an aux-preserving transform hands the whole word
  // to a material with its own conventions — and "bit 3 is free" can be true of
  // 익은 고기 and false of the 탄 고기 it becomes. It was: the spoilage counter
  // first went in at shift 3, landing on 탄 고기's alight bit, so a cut that had
  // rotted to any odd stage arrived pre-lit and `tryFlameOnlyBurn` let it burn on
  // radiant heat with no flame anywhere near it — the exact failure `flameOnly`
  // exists to prevent, arriving from a material that never touches that code.
  //
  // There is no registry of "which bits does this material claim", so the edges
  // are listed by hand. That is the honest form: each entry is a transform that
  // preserves aux, and adding one is the moment to think about this.
  const AUX_PRESERVING_EDGES: Array<{ from: number; to: number; bits: number; why: string }> = [
    // 익은 고기 --(200° + 바싹 마름)--> 탄 고기, cookedmeat.ts's own `sim.set`.
    { from: COOKED_MEAT, to: BURNT_MEAT, bits: BURNT_LIT_BIT, why: '탄 고기 alight 비트' },
    // 생고기 --(70°)--> 익은 고기, via `tryPhaseChange`. The target's only aux
    // users are the dryness counter and its own spoilage counter, and sharing the
    // latter is deliberate (a steak is not made fresh by cooking), so what is
    // checked is that the dryness counter is still clear.
    { from: RAW_MEAT, to: COOKED_MEAT, bits: DRY_MASK, why: '익은 고기 건조 카운터' },
  ];
  const crossOverlaps = AUX_PRESERVING_EDGES.filter((e) => {
    const spec = getMaterial(e.from).spoil;
    return spec !== undefined && (e.bits & (SPOIL_FIELD << spec.auxShift)) !== 0;
  });
  check(
    '부패 카운터가 **변한 뒤의** 물질이 쓰는 비트와도 안 겹친다',
    crossOverlaps.length === 0,
    crossOverlaps.length
      ? `OVERLAP: ${crossOverlaps.map((e) => `${getMaterial(e.from).name} → ${e.why}`).join(', ')}`
      : `${AUX_PRESERVING_EDGES.length} aux-preserving transforms checked`,
  );

  // …and clear of everything the material *itself* keeps in that word, which is
  // the third face of the same problem and the one neither check above sees.
  //
  // `dryMask` is the only such field SpoilSpec knows about, so every other one is
  // private to its material: 빵's crust and lit bits, 반죽's leaven level and two
  // agent flags, 죽은 물고기's facing bit (which the *renderer* reads), 팝콘's own
  // lit bit. A collision here is exactly the shipped 탄 고기 bug one level down —
  // silent, and expressed as the material doing something it has no code for.
  //
  // Listed by hand for the same reason the edges above are: there is no registry
  // of claimed bits, and writing the number down next to the material is the
  // moment someone has to look at the layout.
  const OWN_AUX_USERS: Array<{ id: number; bits: number; why: string }> = [
    { id: BREAD, bits: 0b11, why: '빵 껍질 비트 + 점화 비트' },
    { id: BATTER, bits: 0b11111, why: '반죽 발효도(0-2) + 배양·소다 플래그' },
    { id: DEAD_FISH, bits: 0b1, why: '죽은 물고기 방향 비트(렌더러가 읽는다)' },
    { id: POPCORN, bits: 0b1, why: '팝콘 점화 비트' },
    { id: CORN_KERNEL, bits: 0b0, why: '옥수수는 aux 를 안 쓴다' },
  ];
  const selfOverlaps = OWN_AUX_USERS.filter((e) => {
    const spec = getMaterial(e.id).spoil;
    return spec !== undefined && (e.bits & (SPOIL_FIELD << spec.auxShift)) !== 0;
  });
  check(
    '부패 카운터가 **같은 물질이** 그 워드에 둔 것과도 안 겹친다',
    selfOverlaps.length === 0,
    selfOverlaps.length
      ? `OVERLAP: ${selfOverlaps.map((e) => `${getMaterial(e.id).name} → ${e.why}`).join(', ')}`
      : `${OWN_AUX_USERS.length} materials checked`,
  );
}

// ── 1b. 썩다 만 고기를 태워도 불이 붙지는 않는다 ─────────────────────────────
// The behavioural half of the cross-material aux check above, and the scene that
// would have caught the bug on its own.
//
// 탄 고기 is 직화 전용: radiant heat must never light it, however fierce, because
// an oven cannot be cooler than the fire heating it (combustion.ts). A lit cell
// skips that gate entirely, so a spoilage counter overlapping 탄 고기's alight bit
// silently converted "rotted a bit first" into "ignites with no flame present".
// Measured before the fix: gone in 73 ticks. The scene has no Fire cell in it at
// all, which is what makes it an honest test of the gate.
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 24, 39, 26, STONE);
  fill(grid, 12, 22, 27, 23, COOKED_MEAT);
  // Bone dry (so it chars at once) and part-rotten — the odd stage is the point:
  // at the old shift that single bit *was* 탄 고기's alight flag.
  const spec = getMaterial(COOKED_MEAT).spoil!;
  for (let y = 22; y <= 23; y++)
    for (let x = 12; x <= 27; x++) grid.aux[grid.idx(x, y)] = DRY_MASK | (1 << spec.auxShift);
  const before = count(grid, COOKED_MEAT);
  run(sim, grid, 200, { x0: 11, y0: 21, x1: 28, y1: 24, t: 900 });
  check(
    '썩다 만 고기가 탄 고기가 돼도 불꽃 없이는 안 붙는다 (직화 전용 유지)',
    count(grid, BURNT_MEAT) === before && count(grid, ASH) === 0,
    `${count(grid, BURNT_MEAT)}/${before} 탄 고기 left at 900° with no flame, ` +
      `${count(grid, ASH)} 재`,
  );
}

// ── 2. 상온에 두면 썩는다, 그리고 부패물이 된다 ──────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 5, 20, 24, 22, RAW_MEAT); // 60 cells on a shelf
  const before = count(grid, RAW_MEAT);
  run(sim, grid, 400 * HZ);
  check(
    '상온에 둔 생고기는 전부 썩는다',
    count(grid, RAW_MEAT) === 0,
    `${before} → ${count(grid, RAW_MEAT)} 생고기 after 400s`,
  );
  check(
    '…그리고 사라지는 게 아니라 사슬 위에 남는다',
    chainMass(grid, RAW_MEAT) === before,
    `${ateMold(grid)} 곰팡이(먹은 것) + ${count(grid, SPOILED)} 부패물 + ` +
      `${count(grid, COMPOST)} 퇴비 = ${chainMass(grid, RAW_MEAT)} of ${before}`,
  );
}

// ── 3. 사슬 전체가 질량을 보존한다: 식품 N칸 → 퇴비 N칸 ──────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 4, 24, 35, 25, RAW_MEAT); // 64 cells, floor-level so nothing falls out
  const before = count(grid, RAW_MEAT);
  run(sim, grid, 1800 * HZ);
  const total = chainMass(grid, RAW_MEAT);
  check(
    '부패 사슬은 칸을 만들지도 잃지도 않는다',
    total === before,
    `${before} 생고기 → ${ateMold(grid)} 곰팡이 + ${count(grid, SPOILED)} 부패물 + ` +
      `${count(grid, COMPOST)} 퇴비 (합 ${total})`,
  );
  // The livelock check. 부패물 declares `spoil` too, so an "eat anything that
  // rots" rule ate it — and mold that ate decays back into 부패물, so the two fed
  // each other and the chain never terminated (measured: 0 퇴비 at 900s, the whole
  // mass still cycling). Requiring the *end* of the chain, not merely a conserved
  // total, is what makes that failure visible here.
  check(
    '…그리고 끝까지 가면 전부 퇴비다 (사슬이 닫힌다)',
    count(grid, COMPOST) === before,
    `${count(grid, COMPOST)} of ${before} 퇴비 after 1800s`,
  );
}

// ── 4. 보존 넷 ───────────────────────────────────────────────────────────────
// Each holds the same cut for four times its own spoil time. The control in the
// block above is what makes these mean anything: the identical scene without the
// preservation is completely gone by 200s.
{
  const KEEP = 500 * HZ;

  // 4a. 저온 — 냉장고. Held under 0° every tick.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 20, 19, 21, RAW_MEAT);
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP, { x0: 9, y0: 19, x1: 20, y1: 22, t: -10 });
    check(
      '저온 — 얼려 두면 안 썩는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 500s at -10°`,
    );
  }

  // 4b. 고온 — 조리 중인 것은 썩는 중이 아니다. Held over 60° but under the
  // 70° cook point, so the cut can't leave the material by cooking instead.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 20, 19, 21, RAW_MEAT);
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP, { x0: 9, y0: 19, x1: 20, y1: 22, t: 65 });
    check(
      '고온 — 익히는 중에는 썩지 않는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 500s at 65°`,
    );
  }

  // 4c. 염장 — a crust of Salt against the meat.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 21, 19, 21, RAW_MEAT);
    fill(grid, 10, 20, 19, 20, SALT); // salt laid straight on top
    fill(grid, 9, 22, 20, 22, STONE); // a shelf, so nothing falls apart
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP);
    check(
      '염장 — 소금에 절이면 안 썩는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 500s under salt`,
    );
  }

  // 4d. 담금 — a jar of honey, and the same in alcohol.
  for (const [id, label] of [
    [HONEY, '꿀'],
    [ALCOHOL, '알콜'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    box(grid, 10, 18, 8, STONE);
    fill(grid, 10, 18, 17, 25, id); // a sealed jar of it
    fill(grid, 12, 21, 15, 22, RAW_MEAT); // submerged in the middle
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP);
    check(
      `담금 — ${label}에 담가 두면 안 썩는다`,
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 500s`,
    );
  }
}

// ── 5. 보존은 멈추는 것이지 되돌리는 것이 아니다 ─────────────────────────────
// The reason spoilage is a counter and not a per-tick roll, measured on the
// counter itself rather than on a headcount: a cut is left out to part-rot, then
// frozen, and its *progress* has to still be there afterwards. A memoryless model
// has no progress to hold, and a "preservation resets it" model would zero it.
//
// Reading aux directly is what makes this precise. Counting surviving cells was
// the first attempt and it stopped working the moment mold could eat them — the
// aged side simply vanished during the ageing window, and a scene that ends in 0
// cannot say anything about progress being held.
{
  reseed();
  const { grid, sim } = makeWorld(40, 30);
  const W = grid.width;
  const spec = getMaterial(RAW_MEAT).spoil!;
  /** Total spoilage progress on one half of the world. */
  const progress = (left: boolean): number => {
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== RAW_MEAT) continue;
      if (left !== (i % W < 20)) continue;
      n += (grid.aux[i] >> spec.auxShift) & SPOIL_FIELD;
    }
    return n;
  };
  const cells = (left: boolean): number => {
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === RAW_MEAT && left === (i % W < 20)) n++;
    return n;
  };
  fill(grid, 5, 20, 14, 21, RAW_MEAT); // A — left, aged at room temperature first
  fill(grid, 25, 20, 34, 21, RAW_MEAT); // B — right, held frozen from the start

  // Phase 1: A ages on the counter while B is kept frozen. Kept short, but the
  // scene deliberately does NOT require the block to still be whole afterwards —
  // a 20-cell body has 20 independent counters and the *earliest* of them reaches
  // the spore stage well before the mean, so some mold and some loss is normal.
  // What is recorded is whatever state it reached; the freeze has to hold exactly
  // that.
  run(sim, grid, 60 * HZ, { x0: 24, y0: 19, x1: 35, y1: 22, t: -10 });
  const agedA = progress(true);
  const agedCells = cells(true);
  const freshB = progress(false);
  check(
    '상온에 둔 쪽은 진행도가 실제로 올라간다 (아래 검사의 전제)',
    agedA > 0 && agedCells > 0 && freshB === 0,
    `aged progress ${agedA} over ${agedCells} cells, frozen side ${freshB}`,
  );

  // Phase 2: everything frozen. Neither side may move — including the half that
  // is sitting on part-finished counters, which is the case a memoryless roll
  // could not represent at all. Both the progress and the headcount are pinned:
  // at -10° the mold is dead too, so nothing may be eaten either.
  run(sim, grid, 120 * HZ, { x0: 0, y0: 0, x1: W - 1, y1: 29, t: -10 });
  check(
    '얼려 두는 동안에는 진행도 그대로 — 절반쯤 썩은 것도 안 넘어간다',
    progress(true) === agedA && cells(true) === agedCells && progress(false) === 0,
    `aged ${agedA}/${agedCells}칸 → ${progress(true)}/${cells(true)}칸, ` +
      `frozen ${freshB} → ${progress(false)} across 120s`,
  );

  // Phase 3: thaw both and watch which finishes first. Temperature has to be put
  // back by hand — with no heat source in the scene, a frozen world stays frozen
  // (which is itself the freezer working).
  // Phase 3: thaw both for a fixed window and compare what is left. Measured as
  // survivors rather than as "which hit zero first", which is the maximum of N
  // independent draws and so mostly noise — it flipped on four seeds out of five
  // even with the aged side genuinely ahead.
  // 45s, not longer: run it far enough and *both* sides collapse to nearly zero
  // and the comparison stops saying anything (measured: 2 vs 2 at 90s on one seed,
  // with the aged side genuinely ahead the whole way). The window has to end while
  // the fresh side is still mostly intact.
  setTemp(grid, 0, 0, W - 1, 29, ROOM);
  run(sim, grid, 45 * HZ);
  check(
    '녹이면 멈춘 자리에서 이어진다 — 미리 썩힌 쪽이 확실히 더 많이 나갔다',
    cells(true) < cells(false),
    `aged ${cells(true)}칸 left vs fresh ${cells(false)}칸 after the same 45s thaw`,
  );
}

// ── 6. 육포 — 말려서 보존한 고기, 그리고 굽기만 한 고기 ──────────────────────
// 건조 보존 belongs to 생고기 alone, and the control is the whole point of the
// section rather than a formality.
//
// It shipped on 익은 고기 too, and that made every grilled cut immortal: cooking
// drives the very same dryness counter (fast — meat.ts quotes 4.7s at 400°), and
// 탄 고기 gates its char on that counter being full, so **anything cooked past
// medium reaches DRY_MAX by construction**. 웰던 스테이크가 영원히 안 썩었고,
// 익은 고기가 선언한 260초는 한 번도 발동하지 않았다.
//
// So the two scenes below are the same cut taken two ways. 육포 has to be a thing
// you *chose*: 생고기 turns at 70° the instant it is hot enough to cook, so the
// only window it can dry in is STEAM_TEMP(45°)~70° — a dehydrator, not a grill.
{
  /** Cells of `id` whose dryness counter is full (meat.ts). */
  const boneDry = (grid: Grid, id: number): number => {
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === id && (grid.aux[i] & DRY_MASK) === DRY_MASK) n++;
    return n;
  };

  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 10, 20, 19, 21, RAW_MEAT);
  const before = count(grid, RAW_MEAT);
  // 건조기: over the steam point, under the cook point. Nothing cooks, and above
  // 60° nothing rots either, so the only clock running is the moisture counter.
  run(sim, grid, 240 * HZ, { x0: 9, y0: 19, x1: 20, y1: 22, t: 65 });
  const jerky = boneDry(grid, RAW_MEAT);
  check(
    '45~70°에 오래 두면 익지 않고 바싹 마른 생고기가 된다',
    jerky === before && count(grid, COOKED_MEAT) === 0,
    `${jerky}/${before} 바싹 마름, ${count(grid, COOKED_MEAT)} 익은 고기`,
  );
  // Off the heat, at room temperature, for nearly three times its spoil time.
  setTemp(grid, 0, 0, 39, 29, ROOM);
  run(sim, grid, 440 * HZ);
  check(
    '육포 — 말린 생고기는 상온에 두어도 안 썩는다',
    count(grid, RAW_MEAT) === before,
    `${count(grid, RAW_MEAT)} of ${before} left after 440s at room temperature`,
  );

  // 대조군, and the regression test for the bug above: grilled to well-done, bone
  // dry by the same counter, and it must still rot like any other cooked meat.
  reseed();
  const done = makeWorld();
  fill(done.grid, 10, 20, 19, 21, RAW_MEAT);
  const doneBefore = count(done.grid, RAW_MEAT);
  // 150°: past the cook point, under the 200° char point.
  run(done.sim, done.grid, 90 * HZ, { x0: 9, y0: 19, x1: 20, y1: 22, t: 150 });
  const welldone = boneDry(done.grid, COOKED_MEAT);
  check(
    '웰던으로 구우면 바싹 마른 익은 고기가 된다 (대조군의 전제)',
    welldone === doneBefore && count(done.grid, BURNT_MEAT) === 0,
    `${welldone}/${doneBefore} 바싹 마른 익은 고기, ${count(done.grid, BURNT_MEAT)} 탄 고기`,
  );
  setTemp(done.grid, 0, 0, 39, 29, ROOM);
  run(done.sim, done.grid, 440 * HZ);
  check(
    '…그런데 웰던 고기는 말랐어도 썩는다 — 굽는 것은 말려서 보존하는 것이 아니다',
    count(done.grid, COOKED_MEAT) === 0,
    `${doneBefore} → ${count(done.grid, COOKED_MEAT)} 익은 고기`,
  );
}

// ── 7. 곰팡이는 아무것도 파괴하지 않는다 ─────────────────────────────────────
// The requirement the material was designed around. Four containers, each sealed
// around rotting food, run for a long time: every wall cell must still be there.
{
  for (const [wall, label] of [
    [STONE, '돌'],
    [GLASS, '유리'],
    [IRON, '철'],
    [WOOD, '나무'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    box(grid, 12, 12, 12, wall);
    const wallBefore = count(grid, wall);
    fill(grid, 14, 20, 21, 23, RAW_MEAT); // a good pile, plenty of empty air around it
    run(sim, grid, 600 * HZ);
    check(
      `곰팡이가 ${label} 벽을 갉아먹지 않는다`,
      count(grid, wall) === wallBefore,
      `${count(grid, wall)} of ${wallBefore} wall cells, ${count(grid, MOLD)} 곰팡이 grown`,
    );
  }

  // And it did actually grow — a "nothing was destroyed" check passes trivially if
  // no mold ever appeared, so this is the half that makes the four above mean
  // something.
  reseed();
  const { grid, sim } = makeWorld();
  box(grid, 12, 12, 12, STONE);
  fill(grid, 14, 20, 21, 23, RAW_MEAT);
  run(sim, grid, 300 * HZ);
  check(
    '…곰팡이는 실제로 폈다 (위 네 검사의 전제)',
    count(grid, MOLD) > 0,
    `${count(grid, MOLD)} 곰팡이 cells`,
  );
}

// ── 8. 곰팡이는 방을 채우지 않는다 · 붙은 것은 안 움직인다 ──────────────────
// 곰팡이 is a floaty powder now, so "표면 한 겹" is no longer a property of every
// cell: a loose spore genuinely is unsupported — that is what drifting *is* — and
// settled spores pile like any powder. The invariant that still matters, and the
// one that protects the game, is that a colony cannot fill a volume.
//
// Two halves, because the material has two behaviours:
//   • **붙은 것은 안 움직인다.** A grain against a surface has landed; it holds its
//     place and creeps. Without this, mold on a wall or a ceiling would slide off
//     the instant it grew and 「곰팡이 슬은 벽」 would not exist at all.
//   • **방은 안 찬다.** The creep only takes empty cells that touch a *non-mold*
//     surface, so it cannot scaffold on itself outward.
{
  reseed();
  const { grid, sim } = makeWorld(50, 36);
  box(grid, 10, 6, 30, STONE);
  fill(grid, 14, 26, 41, 29, RAW_MEAT); // a long shelf of it, lots of open air above
  const interior = 30 * 30;
  run(sim, grid, 900 * HZ);
  const molds = count(grid, MOLD);
  check(
    '곰팡이는 방을 채우지 않는다',
    molds > 0 && molds < interior * 0.35,
    `${molds} 곰팡이 in a ${interior}-cell room (${((molds / interior) * 100).toFixed(1)}%)`,
  );

  // 붙은 것은 안 움직인다 — a grain painted onto the underside of the ceiling has a
  // surface above it and nothing below, so gravity is the only thing that could
  // move it. It must still be there.
  reseed();
  const stick = makeWorld();
  fill(stick.grid, 0, 8, 39, 9, STONE); // a ceiling slab
  for (let x = 8; x < 32; x++) put(stick.grid, x, 10, MOLD); // hanging off its underside
  const hung = count(stick.grid, MOLD);
  run(stick.sim, stick.grid, 120 * HZ);
  let stillHanging = 0;
  for (let x = 8; x < 32; x++) if (stick.grid.cells[stick.grid.idx(x, 10)] === MOLD) stillHanging++;
  check(
    '붙은 곰팡이는 안 떨어진다 — 천장에도 슨다',
    stillHanging === hung,
    `${stillHanging} of ${hung} still on the ceiling after 120s`,
  );

  // …and the other half of the same rule: a spore with nothing to cling to falls.
  reseed();
  const drift = makeWorld();
  fill(drift.grid, 0, 26, 39, 28, STONE);
  for (let x = 10; x < 30; x += 2) put(drift.grid, x, 4, MOLD); // released in mid-air
  const released = count(drift.grid, MOLD);
  run(drift.sim, drift.grid, 200 * HZ);
  let airborne = 0;
  let landed = 0;
  for (let y = 0; y < 26; y++)
    for (let x = 0; x < 40; x++) {
      if (drift.grid.cells[drift.grid.idx(x, y)] !== MOLD) continue;
      if (y < 20) airborne++;
      else landed++;
    }
  // Not an equality: a spore that lands roots and starts creeping along the floor,
  // so the settled count grows past what was released. What is being pinned is
  // that nothing stayed up in the air.
  check(
    '붙을 데 없는 포자는 밀가루처럼 흩날려 내려앉는다',
    airborne === 0 && landed >= released,
    `${released} released → ${landed} on the floor, ${airborne} still airborne`,
  );
}

// ── 8b. 침식 — 식품만 먹고, 보존된 것은 안 먹는다 ────────────────────────────
{
  // 먹는다: mold painted onto a fresh loaf eats it, and the mass becomes mold that
  // remembers it ate (so it will hand the loaf on as 부패물 rather than deleting it).
  // 생고기, not 빵: erosion can only take a cell the clock has already brought to
  // MOLD_AT (spoil.ts `moldCanEat`), so a scene shorter than that stage measures
  // the gate rather than the eating. Raw meat reaches it soonest.
  reseed();
  const eat = makeWorld();
  fill(eat.grid, 0, 24, 39, 26, STONE);
  fill(eat.grid, 10, 21, 29, 23, RAW_MEAT);
  const cut = count(eat.grid, RAW_MEAT);
  put(eat.grid, 10, 20, MOLD); // one grain, on the corner
  run(eat.sim, eat.grid, 300 * HZ);
  check(
    '곰팡이는 식품을 침식한다 — 한 알이 고기 한 덩이를 먹는다',
    count(eat.grid, RAW_MEAT) === 0,
    `${cut} → ${count(eat.grid, RAW_MEAT)} 생고기, ${ateMold(eat.grid)} 곰팡이(먹은 것)`,
  );

  // 보존된 것은 안 먹는다. Same scene, same single grain, salt laid on the loaf —
  // and this is the check that keeps 보존 meaning 보존: without it, salting would
  // stop the clock and change nothing, because the mold would eat it anyway.
  // A *single row* of loaf with salt laid on it, because 염장 is a contact rule:
  // salt on top of a three-deep block preserves the row it touches and nothing
  // below, which is correct behaviour and a useless scene — it measured the block
  // geometry rather than the rule.
  reseed();
  const salted = makeWorld();
  fill(salted.grid, 0, 24, 39, 26, STONE);
  fill(salted.grid, 10, 23, 29, 23, BREAD);
  fill(salted.grid, 10, 22, 29, 22, SALT);
  const saltedLoaf = count(salted.grid, BREAD);
  put(salted.grid, 9, 23, MOLD);
  run(salted.sim, salted.grid, 300 * HZ);
  check(
    '…절인 빵은 안 먹는다 (보존이 침식에도 듣는다)',
    count(salted.grid, BREAD) === saltedLoaf,
    `${count(salted.grid, BREAD)} of ${saltedLoaf} 빵 left under salt`,
  );

  // 얼린 것도 마찬가지 — same predicate, other branch.
  reseed();
  const frozen = makeWorld();
  fill(frozen.grid, 0, 24, 39, 26, STONE);
  fill(frozen.grid, 10, 21, 29, 23, BREAD);
  const frozenLoaf = count(frozen.grid, BREAD);
  put(frozen.grid, 10, 20, MOLD);
  // -10° kills the mold outright as well, which is the honest result of putting a
  // mouldy loaf in a freezer; the loaf is what is being measured.
  run(frozen.sim, frozen.grid, 300 * HZ, { x0: 0, y0: 19, x1: 39, y1: 26, t: -10 });
  check(
    '…얼린 빵도 안 먹는다',
    count(frozen.grid, BREAD) === frozenLoaf,
    `${count(frozen.grid, BREAD)} of ${frozenLoaf} 빵 left frozen`,
  );

  // 자기가 남길 것은 다시 안 먹는다 — the livelock guard, as a direct statement.
  // A box of 부패물 with mold in it must still reach 퇴비.
  reseed();
  const sludge = makeWorld();
  fill(sludge.grid, 0, 24, 39, 26, STONE);
  fill(sludge.grid, 12, 22, 27, 23, SPOILED);
  const before = count(sludge.grid, SPOILED);
  fill(sludge.grid, 12, 21, 27, 21, MOLD);
  run(sludge.sim, sludge.grid, 600 * HZ);
  // Stated as "none of it was eaten and none of it was lost", not as "it all
  // finished" — the latter is really a measurement of 부패물's own 300s clock over
  // 32 cells, which needs a much longer window and adds nothing.
  check(
    '곰팡이는 부패물을 다시 안 먹는다 — 사슬이 닫힌다',
    ateMold(sludge.grid) === 0 &&
      count(sludge.grid, SPOILED) + count(sludge.grid, COMPOST) === before &&
      count(sludge.grid, COMPOST) > 0,
    `${before} 부패물 → ${count(sludge.grid, COMPOST)} 퇴비 + ` +
      `${count(sludge.grid, SPOILED)} 남음, 먹힌 것 ${ateMold(sludge.grid)}칸`,
  );
}

// ── 9. 물속에는 안 핀다 ──────────────────────────────────────────────────────
// Mostly no rule of its own — a submerged surface has no empty cells against it,
// so the film rule keeps mold out of the water for free — plus `isDrowned`
// (mold.ts) for the one hole that leaves, which is that rot rising through a
// liquid leaves bubbles behind it.
//
// Measured as flooding-versus-not on the same box, because two stricter drafts
// both failed by measuring the wrong thing and the pair is worth recording. An
// open tank grows mold at the waterline: 부패물 floats (density 2.9 against
// Water's 3) and surfaces as scum, and scum has air above it. Sealing the tank
// brim-full does not make it airless either — a Powder rising through water
// absorbs a water cell into its 겹침 slot and leaves an empty behind (two cells
// become one), and the pocket collects under the lid. Neither is the rule
// breaking; both are "submerged" being the wrong word for what was counted. Water
// is a real defence rather than a total one, so that is what gets asserted.
{
  reseed();
  const wet = makeWorld();
  box(wet.grid, 12, 12, 14, STONE); // interior y = 12..25
  fill(wet.grid, 12, 12, 25, 25, WATER); // filled to the lid
  fill(wet.grid, 16, 22, 21, 24, RAW_MEAT); // sunk at the bottom
  run(wet.sim, wet.grid, 400 * HZ);
  const wetMold = count(wet.grid, MOLD);

  reseed();
  const dry = makeWorld();
  box(dry.grid, 12, 12, 14, STONE);
  fill(dry.grid, 16, 22, 21, 24, RAW_MEAT); // same box, same shelf, air instead
  run(dry.sim, dry.grid, 400 * HZ);
  const dryMold = count(dry.grid, MOLD);

  check(
    '물에 잠기면 곰팡이가 거의 안 핀다 — 물이 방어다',
    wetMold * 2 < dryMold,
    `flooded ${wetMold} vs dry ${dryMold} 곰팡이 in the same box`,
  );
  check(
    '…마른 쪽은 제대로 폈다 (위 비교의 전제)',
    dryMold > 0,
    `${dryMold} 곰팡이 in the dry version`,
  );
}

// ── 10. 곰팡이가 전염 경로다 ─────────────────────────────────────────────────
// "창고에 하나 썩으면 다 썩는다" is not a food-to-food rule; it is mold creeping
// along the outside of a stack and the stack rotting faster under it. Measured as
// the same stack with and without room for mold to grow: the open one must go over
// markedly sooner than the one packed in so tightly there is nowhere to film.
{
  // A single row, so *every* cell has a face mold can film and the effect is the
  // whole population rather than a rim of it. A thick block buries most of its
  // cells where no film reaches them, which buries the measurement too — the
  // first draft of this scene was a 2×24 slab and came out at 13 vs 35, a margin
  // thin enough to flip on the seed. Bread because it is the slowest spoiler, so
  // a 3× difference has the most room to show.
  const SLAB = { x0: 4, y0: 26, x1: 35, y1: 26 } as const;

  reseed();
  const open = makeWorld(40, 30);
  fill(open.grid, 0, 27, 39, 29, STONE); // a floor, air everywhere above
  fill(open.grid, SLAB.x0, SLAB.y0, SLAB.x1, SLAB.y1, BREAD);

  reseed();
  const packed = makeWorld(40, 30);
  // The same row with stone laid tight against every face, so there is no empty
  // neighbour anywhere for a spore to land in. Same cell count, same clock; the
  // only difference is whether mold has anywhere to grow.
  fill(packed.grid, SLAB.x0 - 1, SLAB.y0 - 1, SLAB.x1 + 1, SLAB.y1 + 1, STONE);
  fill(packed.grid, SLAB.x0, SLAB.y0, SLAB.x1, SLAB.y1, BREAD);

  const before = count(open.grid, BREAD);
  run(open.sim, open.grid, 300 * HZ);
  run(packed.sim, packed.grid, 300 * HZ);
  const openLeft = count(open.grid, BREAD);
  const packedLeft = count(packed.grid, BREAD);
  check(
    '곰팡이가 핀 쪽이 훨씬 빨리 상한다 — 전염은 곰팡이를 타고 간다',
    count(open.grid, MOLD) > 0 && openLeft * 3 < packedLeft,
    `open ${openLeft} vs sealed ${packedLeft} of ${before} left at 300s ` +
      `(${count(open.grid, MOLD)} 곰팡이 vs ${count(packed.grid, MOLD)})`,
  );
}

// ── 11. 곰팡이를 죽이는 법 ───────────────────────────────────────────────────
{
  for (const [t, label] of [
    [80, '60℃ 위로 익히면'],
    [-10, '0℃ 아래로 얼리면'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    fill(grid, 0, 22, 39, 24, STONE);
    fill(grid, 10, 20, 29, 21, MOLD);
    const before = count(grid, MOLD);
    run(sim, grid, 5 * HZ, { x0: 0, y0: 18, x1: 39, y1: 24, t });
    check(`${label} 곰팡이가 죽는다`, count(grid, MOLD) === 0, `${before} → ${count(grid, MOLD)}`);
  }

  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 22, 39, 24, STONE);
  fill(grid, 10, 21, 29, 21, MOLD);
  fill(grid, 10, 20, 29, 20, ALCOHOL); // poured straight on
  const before = count(grid, MOLD);
  run(sim, grid, 5 * HZ);
  check(
    '알콜을 부으면 곰팡이가 죽는다',
    count(grid, MOLD) === 0,
    `${before} → ${count(grid, MOLD)}`,
  );
}

// ── 12. 부패물 — 태우면 재, 얼리면 그대로 ────────────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 25, 39, 27, STONE);
  fill(grid, 10, 23, 29, 24, SPOILED);
  const before = count(grid, SPOILED);
  run(sim, grid, 5 * HZ, { x0: 9, y0: 22, x1: 30, y1: 25, t: 400 });
  check(
    '부패물은 250℃가 넘으면 재가 된다',
    count(grid, SPOILED) === 0 && count(grid, ASH) === before,
    `${before} 부패물 → ${count(grid, ASH)} 재`,
  );

  reseed();
  const cold = makeWorld();
  fill(cold.grid, 0, 25, 39, 27, STONE);
  fill(cold.grid, 10, 23, 29, 24, SPOILED);
  const coldBefore = count(cold.grid, SPOILED);
  run(cold.sim, cold.grid, 600 * HZ, { x0: 0, y0: 0, x1: 39, y1: 29, t: -10 });
  check(
    '얼려 두면 부패물인 채로 멈춘다 — 퇴비도 공짜가 아니다',
    count(cold.grid, SPOILED) === coldBefore,
    `${count(cold.grid, SPOILED)} of ${coldBefore} left after 600s frozen`,
  );
}

// ── 13. 죽은 물고기는 사라지지 않고 썩는다 ───────────────────────────────────
// The one existing behaviour this round changed. A corpse used to vanish; now its
// mass stays in the world and ends up as soil.
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 26, 39, 29, STONE);
  fill(grid, 8, 24, 31, 25, DEAD_FISH);
  const before = count(grid, DEAD_FISH);
  run(sim, grid, 1500 * HZ);
  check(
    '사체는 삭아 없어지는 게 아니라 썩어서 남는다',
    count(grid, DEAD_FISH) === 0 && chainMass(grid, DEAD_FISH) === before,
    `${before} 사체 → ${ateMold(grid)} 곰팡이 + ${count(grid, SPOILED)} 부패물 + ` +
      `${count(grid, COMPOST)} 퇴비 (합 ${chainMass(grid, DEAD_FISH)})`,
  );
}

// ── 14. 퇴비는 밭이다 ────────────────────────────────────────────────────────
{
  // 14a. A seed germinates on it, exactly as it does on dirt.
  reseed();
  const { grid, sim } = makeWorld(40, 30);
  fill(grid, 0, 20, 39, 29, COMPOST);
  fill(grid, 0, 26, 39, 27, WATER); // a water table under the bed
  put(grid, 20, 19, SEED);
  run(sim, grid, 60 * HZ);
  check(
    '퇴비 위에 심은 씨앗도 싹이 튼다',
    count(grid, PLANT) > 0,
    `${count(grid, PLANT)} 식물 cells`,
  );

  // 14b. The payoff. Same watering, same clock, same everything but the bed — and
  // the compost plot has to grow more.
  //
  // Two things about the scene are load-bearing and were both learned by getting
  // them wrong. **The water is poured on top**, not buried inside the bed: a layer
  // of standing water sandwiched in a powder bed churns (the grains sink through
  // it and it wells back up), and compost churns differently from dirt because
  // dirt drinks a touching Water cell and becomes Mud while compost deliberately
  // does not — so the scene was comparing two different disturbances rather than
  // two soils. **And it sows six plants per bed, not one.** The L-system's
  // run-to-run spread is enormous; a single plant per side flipped the result
  // outright on one seed in six. Six plants average it down to a margin that holds
  // on every seed tried.
  const grow = (bed: number): number => {
    reseed();
    const { grid: g, sim: s } = makeWorld(80, 60);
    fill(g, 0, 55, 79, 59, STONE); // floor
    fill(g, 0, 48, 79, 54, bed); // the plot
    fill(g, 0, 45, 79, 47, WATER); // watered from above, soaks down and drains
    run(s, g, 60 * HZ); // let it drain before anything is sown
    for (let x = 8; x < 80; x += 14) put(g, x, 47, SEED);
    run(s, g, 600 * HZ);
    return count(g, PLANT);
  };
  const onCompost = grow(COMPOST);
  const onDirt = grow(DIRT);
  check(
    '퇴비 밭에서는 같은 물로 훨씬 무성하게 자란다',
    onCompost > onDirt,
    `퇴비 ${onCompost}칸 vs 흙 ${onDirt}칸 after 600s (6 plants each)`,
  );
}

// ── 6b. 반죽 — 발효가 멈춘 것만 썩는다 ───────────────────────────────────────
// 발효 and 부패 are the same kind of process, and the first round that shipped
// 부패 had to drop 반죽 from the roster because running both at once meant the
// rise always lost (a 200-cell dough that should have doubled proofed 0 of 200 —
// see test/cooking.ts, which owns that measurement).
//
// `keptWhile` (batter.ts `isFermenting`) is what lets the material have both: a
// dough that is actively working is *kept*, exactly the way a salted one is, and
// starts its clock when it stops. So the two claims are 방치한 반죽은 상한다 and
// 부풀고 있는 반죽은 상하지 않는다, and neither is worth much without the other.
{
  // Read off the declaration rather than copied, so a change to the layout moves
  // this scene with it instead of quietly measuring the wrong three bits.
  const BATTER_SPOIL_SHIFT = getMaterial(BATTER).spoil!.auxShift;
  // These are private to batter.ts (nothing outside it has any business reading
  // a leaven level), so they are restated here. The aux check in section 1 is
  // what holds them and the spoil counter apart.
  const LEAVEN_MASK = 0b111;
  const CULTURED_BIT = 0b1000;
  const LEAVEN_MAX = 7;
  /** Total 부패 진행도 over batter cells matching `want` — progress rather than
   *  cell count, so a pause is visible long before anything turns. */
  const doughProgress = (grid: Grid, want: (aux: number) => boolean): number => {
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== BATTER) continue;
      const aux = grid.aux[i];
      if (want(aux)) n += (aux >> BATTER_SPOIL_SHIFT) & SPOIL_MASK;
    }
    return n;
  };
  const fermenting = (aux: number): boolean =>
    (aux & CULTURED_BIT) !== 0 && (aux & LEAVEN_MASK) < LEAVEN_MAX;

  // Plain dough, nothing worked into it: not fermenting, so it is on the clock
  // from the first tick.
  reseed();
  const plain = makeWorld();
  fill(plain.grid, 10, 18, 29, 22, BATTER);
  const plainBefore = count(plain.grid, BATTER);
  run(plain.sim, plain.grid, 5 * HZ);
  const plainMoved = doughProgress(plain.grid, () => true);
  check(
    '맨 반죽은 놔두면 바로 시계가 돈다 (아래 비교의 전제)',
    plainMoved > 0,
    `${plainMoved} 진행도 over ${plainBefore}칸 after 5s`,
  );

  // The same dough with a live culture in every cell. While it is climbing toward
  // LEAVEN_MAX it must not advance at all.
  reseed();
  const proofing = makeWorld();
  fill(proofing.grid, 10, 18, 29, 22, BATTER);
  for (let y = 18; y <= 22; y++)
    for (let x = 10; x <= 29; x++) proofing.grid.aux[proofing.grid.idx(x, y)] = CULTURED_BIT;
  run(proofing.sim, proofing.grid, 5 * HZ);
  const stillRising = doughProgress(proofing.grid, fermenting);
  let risingCells = 0;
  for (let i = 0; i < proofing.grid.cells.length; i++)
    if (proofing.grid.cells[i] === BATTER && fermenting(proofing.grid.aux[i])) risingCells++;
  check(
    '부풀고 있는 반죽은 한 칸도 안 썩는다 — 발효가 시계를 잡는다',
    stillRising === 0 && risingCells > 0,
    `${stillRising} 진행도 over ${risingCells} 발효 중인 칸`,
  );

  // …and it is a pause, not an exemption: once the rise finishes, the dough is
  // food like any other.
  run(plain.sim, plain.grid, 400 * HZ);
  check(
    '방치한 반죽은 결국 전부 썩는다',
    count(plain.grid, BATTER) === 0,
    `${plainBefore} → ${count(plain.grid, BATTER)} 반죽`,
  );
}

// ── 6c. 마른 식품 — 썩기는 하는데 아주 느리다 ────────────────────────────────
// 옥수수(1200초) and 팝콘(900초) are the slow end of the roster on purpose: a
// sack of grain is the one food you can leave in a corner and mostly forget
// about. "Mostly" is the point — a store room is something you maintain, not
// something you fill once — so both halves are measured: still there when a loaf
// of bread (420초) would be long gone, and gone in the end.
{
  // The comparison runs **packed in stone**, with no empty cell anywhere against
  // the food, so mold cannot grow and the only thing running is the declared
  // clock. That is the whole reason for the setup: in an open pile 침식 compounds
  // — every eaten cell becomes another eater — so the survivor count is a
  // fat-tailed function of *when the first cell crossed the mold stage*, and it
  // swung 9~26 of 32 across seeds. Thresholding that would have meant tuning
  // against noise. Sealed, each cell is an independent counter and the spread is
  // ordinary binomial.
  const SLAB = { x0: 4, y0: 26, x1: 35, y1: 26 } as const;
  /** One row of `id` with stone laid tight against every face, run for 420s — the
   *  bread clock, i.e. long enough that the fastest spoiler on the shelf is
   *  mostly gone. */
  const sealedFor = (id: number): { kept: number; before: number } => {
    reseed();
    const { grid, sim } = makeWorld();
    fill(grid, SLAB.x0 - 1, SLAB.y0 - 1, SLAB.x1 + 1, SLAB.y1 + 1, STONE);
    fill(grid, SLAB.x0, SLAB.y0, SLAB.x1, SLAB.y1, id);
    const before = count(grid, id);
    run(sim, grid, 420 * HZ);
    return { kept: count(grid, id), before };
  };
  const bread = sealedFor(BREAD);
  check(
    '밀폐한 빵은 420초에 절반쯤 넘어간다 (아래 비교의 기준선)',
    bread.kept < bread.before * 0.75,
    `${bread.kept} of ${bread.before} left after 420s (선언 420초)`,
  );

  for (const { id, topic, clock } of [
    { id: CORN_KERNEL, topic: '옥수수는', clock: 1200 },
    { id: POPCORN, topic: '팝콘은', clock: 900 },
  ] as const) {
    const { kept, before } = sealedFor(id);
    check(
      `${topic} 같은 조건에서 빵보다 훨씬 많이 남는다`,
      kept > bread.kept && kept >= before * 0.75,
      `${kept} of ${before} left after 420s vs 빵 ${bread.kept}칸 (선언 ${clock}초)`,
    );
  }

  // …but it is a clock, not an exemption. Run in the open, where mold is allowed
  // to pull the tail forward the way it does for everything else — the claim here
  // is only that a dry food does eventually leave the shelf.
  for (const { id, topic, clock } of [
    { id: CORN_KERNEL, topic: '옥수수도', clock: 1200 },
    { id: POPCORN, topic: '팝콘도', clock: 900 },
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    fill(grid, 12, 24, 27, 25, id);
    const before = count(grid, id);
    run(sim, grid, clock * 3 * HZ);
    check(
      `…그래도 ${topic} 끝내 썩는다 — 마른 것도 영원하진 않다`,
      count(grid, id) === 0,
      `${before} → ${count(grid, id)} after ${clock * 3}s`,
    );
  }
}

console.log(failures === 0 ? '\nAll 부패 checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
