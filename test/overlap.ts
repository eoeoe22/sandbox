// Headless behavioural harness for the 겹침 (overlap) layer's two blind spots —
// what happens to a fluid soaked INTO a grain when the world acts on that grain.
// Both were silent: nothing errored, matter just quietly stopped existing or
// stopped reacting.
//
//   • **충격파가 스며든 액체를 지우던 문제.** A shove writes a Debris fragment over
//     the cell it is throwing, and that write used to destroy the cell's overlap
//     occupant — so a concussion over a wet sand bed deleted the water it soaked
//     through, every time. `Material.overlapCarrier` (debris.ts) makes the
//     fragment carry it instead, and the crater's own paths hand the fluid its own
//     fate (blast.ts's `resolveSoaked`: wet sand blown up puffs Steam, and mass is
//     never silently lost).
//   • **스며든 액체의 상호작용이 꺼져 있던 문제.** A soaked fluid only ever moved. So
//     acid poured on sand vanished into a bed it should have been eating, and
//     materials that needed their liquid to keep reacting had to refuse overlap
//     outright. Now the two co-occupants meet as a contact pair: the declarative
//     table across the seam (reactions.ts's `tryReactSoaked`) and the fluid's own
//     `Material.overlapUpdate` hook (Acid's `tryCorrodeSoaked`).
//
// The controls matter as much as the positives here, so each scene has one: a dry
// bed beside the wet one, an acid-resistant powder beside the corrodible one, a
// sealed pocket with no primary liquid anywhere (so a reaction can only have come
// through the seam), and ANFO's diesel soak — the palette's one recipe that fires
// off the overlap slot rather than off primary-cell contact.
//
// Run: `node test/run-overlap.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { inspectCells } from '../src/game/engine/brushTools';
import { EMPTY, Phase } from '../src/game/engine/types';
import { detonate } from '../src/game/materials/blast';
import { fireShockwave } from '../src/game/materials/woofer';
import { GLASS } from '../src/game/materials/glass';
import { MOLTEN_GLASS } from '../src/game/materials/moltenglass';
import { DEBRIS } from '../src/game/materials/debris';
import { STEAM } from '../src/game/materials/steam';
import { WATER } from '../src/game/materials/water';
import { ACID } from '../src/game/materials/acid';
import { SAND } from '../src/game/materials/sand';
import { STONE } from '../src/game/materials/stone';
import { WALL } from '../src/game/materials/wall';
import { BROKEN_GLASS } from '../src/game/materials/brokenglass';
import { IRON_POWDER } from '../src/game/materials/ironpowder';
import { HYDROGEN } from '../src/game/materials/hydrogen';
import { ACTIVATED_ALUMINUM } from '../src/game/materials/activatedaluminum';
import { ACID_VAPOR } from '../src/game/materials/acidvapor';
import { MESH } from '../src/game/materials/mesh';
import { PUMP } from '../src/game/materials/pump';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { LIQUID_GALLIUM } from '../src/game/materials/liquidgallium';
import { YEAST } from '../src/game/materials/yeast';
import { HYDROGEN_PEROXIDE } from '../src/game/materials/hydrogenperoxide';
import { CEMENT } from '../src/game/materials/cement';
import { CONCRETE } from '../src/game/materials/concrete';
import { AMMONIUM_NITRATE } from '../src/game/materials/ammoniumnitrate';
import { ANFO } from '../src/game/materials/anfo';
import { DIESEL } from '../src/game/materials/diesel';
import { SAWDUST } from '../src/game/materials/sawdust';
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
Math.random = mulberry32(7);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function makeWorld(w = 60, h = 60): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE.id): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.set(x, yy, id);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function countOverlay(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++) if (grid.overlay[i] === id) n++;
  return n;
}
/** A block of `id`, every grain of it soaked with `fluid` — the state the engine
 *  reaches by pouring the fluid over the bed, written straight into the overlap
 *  slot so a scene starts from it deterministically. */
function bed(
  grid: Grid,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  id: number,
  fluid = EMPTY,
): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, id);
      if (fluid !== EMPTY) grid.setOverlay(x, y, fluid);
    }
}
/** A block of `id` placed the way the game places powder: with a random per-cell
 *  tint. `Grid.set` alone leaves the tint byte at 0, and for a Powder that byte
 *  *is* the 액체 겹침 계수 roll (SimContext.canOverlapAt) — a bed written with the
 *  raw setter is therefore uniformly tint 0, i.e. every grain permeable, which
 *  silently disables the "some grains are sealed" half of any scene about soaking.
 *  `SimContext.set`/the brush both seed this; a scene that skips it isn't testing
 *  the bed the player gets. */
function pile(grid: Grid, x0: number, x1: number, y0: number, y1: number, id: number): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, id);
      grid.tint[grid.idx(x, y)] = (Math.random() * 256) | 0;
    }
}
/** Every cell of `fluid` in the world, wherever it currently lives: a primary
 *  cell, an overlap occupant, or the payload of a Debris fragment in flight
 *  (which carries its grain in `aux` and that grain's soak in the overlap slot).
 *  Conservation checks are phrased in this, so "the shockwave moved it" and "the
 *  shockwave deleted it" can't be confused for one another. */
function fluidTotal(grid: Grid, fluid: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === fluid) n++;
    else if (grid.cells[i] === DEBRIS.id && grid.aux[i] === fluid) n++;
    if (grid.overlay[i] === fluid) n++;
  }
  return n;
}
/** The (host, overlay) invariant, restated here as data rather than borrowed from
 *  the engine: an overlap occupant only ever sits on a host that can actually hold
 *  it. Mirrors `SimContext.canHostOverlap` — the phase rule, the `overlapFluids`
 *  allowlist a host may narrow it with, and the carrier exemption — because a
 *  stranded overlay is the shape every bug in this file's subject matter takes,
 *  and the engine's own predicate is module-private on purpose. */
function strandedOverlays(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++) {
    const fluid = grid.overlay[i];
    if (fluid === 0) continue;
    const host = grid.cells[i];
    if (host === EMPTY) {
      n++;
      continue;
    }
    const m = getMaterial(host);
    // Clause order follows the engine's, not convenience: the allowlist is
    // checked before the carrier exemption there, and a mirror that reorders them
    // would disagree with it the day a material declares both.
    if (m.overlapFluids !== undefined && !m.overlapFluids.includes(fluid)) {
      n++;
      continue;
    }
    if (m.overlapCarrier === true) continue; // carries anything handed to it
    const fluidPhase = getMaterial(fluid).phase;
    if (m.porous === true) {
      if (fluidPhase === Phase.Liquid || fluidPhase === Phase.Gas) continue;
      if (m.porousPowder === true && fluidPhase === Phase.Powder) continue;
      n++;
      continue;
    }
    if (m.phase !== Phase.Powder || fluidPhase !== Phase.Liquid) n++;
  }
  return n;
}

// ── 1. 충격파 — a shove must not eat the soak ────────────────────────────────
// A weak blast (power under a powder's durability, over a liquid's) can't break
// the bed: it flings the grains as Debris. The water they were holding has to
// come with them.
{
  const { grid, sim } = makeWorld();
  floor(grid, 50);
  bed(grid, 15, 45, 40, 50, SAND.id, WATER.id);
  const before = fluidTotal(grid, WATER.id);
  // Straight into the wet bed, deliberately too weak to destroy sand (durability
  // 35) — the shove path, which is where the deletion used to happen.
  detonate(sim.context, 30, 45, 0, { reach: 9, power: 30 });
  const after = fluidTotal(grid, WATER.id);
  check(
    '충격파: 젖은 모래를 밀어내도 스며든 물이 그대로다',
    after === before,
    `${before} → ${after} cells`,
  );
  const wetFragments = (() => {
    let n = 0;
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === DEBRIS.id && grid.overlay[i] === WATER.id) n++;
    return n;
  })();
  check(
    '…그리고 실제로 파편이 젖은 채로 난다 (overlapCarrier)',
    wetFragments > 0,
    `${wetFragments} wet fragments in flight`,
  );
  check('…호스트 없는 겹침이 생기지 않는다', strandedOverlays(grid) === 0);

  // 돋보기(InspectPanel)도 화물의 온도를 사람에게 그대로 보여준다 — 그리드가 아니라
  // UI로 새는 같은 누출이다. inspectCells는 SimContext를 거치지 않고 grid를 직접
  // 읽으므로 엔진 쪽 가드 둘이 닿지 않는 자리이고, 캐리어 이전엔 파편이 겹침을 가질
  // 수 없어 이 분기가 죽은 코드였다. 지금 비행 중인 젖은 파편들을 그대로 훑는다.
  {
    const fp: number[] = [];
    for (let y = 30; y < 50; y++) for (let x = 15; x < 45; x++) fp.push(x, y);
    const water = inspectCells(grid, fp).entries.find((e) => e.id === WATER.id);
    check(
      '…돋보기가 읽는 물 온도도 실온이다 (파편의 비행 상태가 UI로 새지 않음)',
      water !== undefined && (water.avgTemp === null || water.avgTemp <= 25),
      `avgTemp ${water?.avgTemp?.toFixed(0) ?? 'null'}°`,
    );
  }

  // And it is still there when the fragments come back down: run the flight out
  // and count again. Steam is counted as water here — the blast leaves stray Fire
  // in the crater, and a drop that boils on it has been moved, not deleted.
  for (let t = 0; t < 60; t++) sim.step();
  const landed = fluidTotal(grid, WATER.id) + count(grid, STEAM.id);
  check(
    '…착지 후에도 총량이 보존된다',
    landed >= before,
    `${before} → ${landed} (water + steam)`,
  );
  check('…착지한 모래는 젖은 채로 남는다', countOverlay(grid, WATER.id) > 0,
    `${countOverlay(grid, WATER.id)} soaked cells`);
  check('…착지 후에도 호스트 없는 겹침이 없다', strandedOverlays(grid) === 0);
}

// ── 1b. 우퍼 충격파 — 파괴력 0은 아무것도 만들어선 안 된다 ────────────────────
// The bug this scene exists for, reported from play: 단순 모래 + 물에 우퍼 충격파를
//가했더니 수증기와 깨진 유리가 나왔다. A Woofer's pulse has destructive power 0 —
// it cannot break anything, so a wet sand bed may only be REARRANGED by it.
//
// The mechanism was the carrier's own bookkeeping leaking into its passenger: a
// Debris fragment packs flight state into `temp` (Material.packedTemp), and a
// carried drop that percolated out of the fragment on its own surfaced "at the
// temperature it shared with its host" — a five-digit number. It flashed to
// Steam, fused the sand it landed in to Glass, and the next pulse crazed that to
// Broken Glass. So the pins here are the *absence* of matter that a power-0 wave
// has no business creating, plus the temperature reading that explains it.
//
// The bed is soaked by the engine itself (pour water on sand and let it settle),
// not by hand-writing overlay slots, so the scene also proves the ordinary soak
// path feeds this one.
{
  const { grid, sim } = makeWorld();
  floor(grid, 50);
  bed(grid, 15, 45, 42, 50, SAND.id);
  bed(grid, 15, 45, 34, 42, WATER.id);
  for (let t = 0; t < 200; t++) sim.step();
  const soakedBefore = countOverlay(grid, WATER.id);
  const waterBefore = fluidTotal(grid, WATER.id);
  check('전제: 부은 물이 실제로 모래에 스몄다', soakedBefore > 0, `${soakedBefore} soaked cells`);

  // The 충격파 브러시 fires the real Woofer pulse over the wet bed, on its own
  // cadence, exactly as PointerPainter does while the brush is held.
  const footprint: number[] = [];
  for (let y = 40; y < 48; y++) for (let x = 22; x < 38; x++) footprint.push(x, y);
  let hottest = -Infinity;
  for (let t = 0; t < 300; t++) {
    if (t < 60 && t % 12 === 0) fireShockwave(sim.context, footprint);
    sim.step();
    for (let i = 0; i < grid.cells.length; i++) {
      // A packedTemp cell's `temp` is flight state, not a reading — skip those and
      // measure what the world actually thinks its temperature is.
      const id = grid.cells[i];
      if (id !== EMPTY && !getMaterial(id).packedTemp && grid.temp[i] > hottest) {
        hottest = grid.temp[i];
      }
    }
  }
  const junk =
    count(grid, STEAM.id) +
    count(grid, GLASS.id) +
    count(grid, BROKEN_GLASS.id) +
    count(grid, MOLTEN_GLASS.id);
  check(
    '우퍼 충격파(파괴력 0)는 젖은 모래에서 수증기도 유리도 만들지 않는다',
    junk === 0,
    `steam ${count(grid, STEAM.id)}, glass ${count(grid, GLASS.id)}, broken ${count(grid, BROKEN_GLASS.id)}, molten ${count(grid, MOLTEN_GLASS.id)}`,
  );
  check(
    '…그 원인이던 온도도 실온을 넘지 않는다 (파편의 비행 상태가 새어 나오지 않음)',
    hottest <= 25,
    `hottest real cell ${hottest.toFixed(0)}°`,
  );
  check(
    '…물 총량도 정확히 보존된다 (밀어냈을 뿐 부수지 않았다)',
    fluidTotal(grid, WATER.id) === waterBefore,
    `${waterBefore} → ${fluidTotal(grid, WATER.id)}`,
  );
  check('…호스트 없는 겹침도 없다', strandedOverlays(grid) === 0);
}

// ── 2. 크레이터 — a soaked bed that IS destroyed puffs steam ─────────────────
// Full-power blast: the grains go, and the water in them flash-boils exactly
// like a bare puddle in the same crater would (blast.ts's resolveSoaked), rather
// than disappearing with its host.
{
  const wet = makeWorld();
  floor(wet.grid, 50);
  bed(wet.grid, 15, 45, 40, 50, SAND.id, WATER.id);
  detonate(wet.sim.context, 30, 45, 12);
  const steamWet = count(wet.grid, STEAM.id);

  const dry = makeWorld();
  floor(dry.grid, 50);
  bed(dry.grid, 15, 45, 40, 50, SAND.id);
  detonate(dry.sim.context, 30, 45, 12);
  const steamDry = count(dry.grid, STEAM.id);

  check('크레이터: 젖은 모래가 부서지면 수증기가 난다', steamWet > 0, `${steamWet} steam cells`);
  check('…대조군: 마른 모래는 같은 폭발에서 수증기 0', steamDry === 0);
}

// ── 3. 스며든 산의 부식 ──────────────────────────────────────────────────────
// The headline case: acid that soaked into a corrodible powder used to sit inside
// it forever.
//
// The pocket is sealed AND packed solid — the bed fills the walls exactly, with
// no free cell anywhere in it. That is what makes the scene decisive rather than
// merely suggestive: with no gap to fall into, no grain moves, and with every
// overlap slot already taken, no soaked drop can percolate or surface. So nothing
// in this pocket can reach a *primary* acid cell on its own. If the bed dissolves,
// the first bite was taken from the inside — and once it is, the vacated cell
// hands the acid back (SimContext.set's release rule) and the ordinary surface
// pass carries on from there, which is exactly the intended chain.
function acidPocket(powderId: number, ticks = 400): { left: number; acid: number; cells: number } {
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, powderId, ACID.id);
  const start = count(grid, powderId);
  for (let t = 0; t < ticks; t++) sim.step();
  return {
    left: count(grid, powderId) / start,
    acid: count(grid, ACID.id) + countOverlay(grid, ACID.id),
    cells: start,
  };
}
{
  const sand = acidPocket(SAND.id);
  check(
    '스며든 산이 부식 내성 없는 가루를 녹인다',
    sand.left < 0.9,
    `${(sand.left * 100) | 0}% of the bed left`,
  );
  check(
    '…그리고 산 자신도 소모된다 (촉매가 아니다)',
    sand.acid < sand.cells,
    `${sand.acid}/${sand.cells} acid left`,
  );
  const glass = acidPocket(BROKEN_GLASS.id);
  check(
    '…대조군: 부식 내성 가루(깨진 유리)는 스며들어도 멀쩡',
    glass.left === 1 && glass.acid === glass.cells,
    `${(glass.left * 100) | 0}% left, ${glass.acid} acid`,
  );
}

// ── 3b. 기체도 스며든다 — 다공성 고체 속 산성 증기 ───────────────────────────
// A gas can't soak into a powder, but it CAN into a porous solid — so Acid Vapor
// drifting into a screen used to park inside the very thing it should be eating.
// Mesh admits only its light checkerboard cells (`latticeFilter`), so the scene
// seeds exactly those; the rest of the screen is packed solid, leaving the fumes
// nowhere to surface.
//
// The control is the same porous screen holding a HARMLESS gas (Steam), which
// must come out untouched — that is what proves the scene reports "eaten" because
// the vapor is acid, not merely because a gas is sitting inside a solid.
//
// It used to be the Pump instead: same porous hosting, but `acidResistant`. 산 내성
// is now the Solar Panel's alone among the 전기 category, and the panel is not
// porous, so no acid-proof host exists to play that part. The Pump keeps its line
// here as a positive: every porous solid in the game (Mesh, Turbine, Pump) is
// corrodible now, and vapor parked in any of them eats it.
function vaporScreen(
  hostId: number,
  gasId: number = ACID_VAPOR.id,
  ticks = 400,
): { left: number; start: number } {
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  for (let y = 8; y < 22; y++)
    for (let x = 8; x < 22; x++) {
      grid.set(x, y, hostId);
      if (((x ^ y) & 1) === 0) grid.setOverlay(x, y, gasId);
    }
  const start = count(grid, hostId);
  for (let t = 0; t < ticks; t++) sim.step();
  return { left: count(grid, hostId), start };
}
{
  const mesh = vaporScreen(MESH.id);
  check(
    '스며든 산성 증기가 자기가 들어앉은 체를 녹인다',
    mesh.left < mesh.start,
    `${mesh.start} → ${mesh.left} mesh`,
  );
  const pump = vaporScreen(PUMP.id);
  check(
    '…펌프도 마찬가지 — 전기 기계의 산 내성이 사라졌다',
    pump.left < pump.start,
    `${pump.start} → ${pump.left} pump`,
  );
  const steamed = vaporScreen(MESH.id, STEAM.id);
  check(
    '…대조군: 무해한 기체(증기)가 든 같은 체는 멀쩡 (검사가 실패할 수 있다)',
    steamed.left === steamed.start,
    `${steamed.start} → ${steamed.left} mesh`,
  );
}

// ── 4. 스며든 산 + 금속 = 수소 ──────────────────────────────────────────────
// The fizz (corrosion.ts's `acidHydrogen` path) reaches through the seam too: the
// grain dissolves and the acid inside it is spent AS the bubble, 1:1, the same
// trade the two make as neighbours.
{
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, IRON_POWDER.id, ACID.id); // packed solid — see acidPocket
  let maxH2 = 0;
  for (let t = 0; t < 300; t++) {
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
  }
  check('스며든 산도 금속 가루를 만나면 수소를 낸다', maxH2 > 0, `${maxH2} cells at once`);

  const dry = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) dry.grid.set(x, y, WALL.id);
  bed(dry.grid, 8, 22, 8, 22, IRON_POWDER.id);
  let dryH2 = 0;
  for (let t = 0; t < 300; t++) {
    dry.sim.step();
    dryH2 = Math.max(dryH2, count(dry.grid, HYDROGEN.id));
  }
  check('…대조군: 산이 없으면 수소도 없다', dryH2 === 0);
}

// ── 5. 반응 테이블이 겹침 너머로도 물린다 ────────────────────────────────────
// Activated Aluminum declares `with: WATER → HYDROGEN` in the ordinary contact
// table. Sealed pocket again, and this time there is NO primary water anywhere in
// the world — every drop is soaked into the powder, so a bubble can only have come
// through the seam (tryReactSoaked). It also exercises the surfacing rule: the
// product is a gas, which no powder can hold, so it takes the cell its host just
// vacated.
{
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, ACTIVATED_ALUMINUM.id, WATER.id); // packed solid — see acidPocket
  check('전제: 시작 시 1차 셀 물은 0칸 (전부 스며든 상태)', count(grid, WATER.id) === 0);
  const startPowder = count(grid, ACTIVATED_ALUMINUM.id);
  let maxH2 = 0;
  for (let t = 0; t < 200; t++) {
    sim.step();
    maxH2 = Math.max(maxH2, count(grid, HYDROGEN.id));
  }
  check('겹침 반응: 스며든 물이 활성 알루미늄과 수소를 만든다', maxH2 > 0, `${maxH2} cells at once`);
  check(
    '…가루도 실제로 소모된다',
    count(grid, ACTIVATED_ALUMINUM.id) < startPowder,
    `${startPowder} → ${count(grid, ACTIVATED_ALUMINUM.id)}`,
  );
  check('…호스트 없는 겹침이 생기지 않는다', strandedOverlays(grid) === 0);
}

// ── 5a. 겹침 반응의 반대 방향 — 표를 든 쪽이 유체다 ──────────────────────────
// The two directions are separate code paths, so both get a scene. Here the rule
// is declared by the SOAKED side, and each case pins a different write:
//   • Liquid Gallium + Aluminum Powder → the host is transformed (`otherBecomes`)
//     and the fluid is deliberately NOT consumed, so it has to still be in the
//     slot afterwards (the drop that keeps eating — see MATERIALS.md 갈륨 취화);
//   • Hydrogen Peroxide + Yeast → the fluid itself is the one transformed
//     (`produce: WATER`), which is the slot-rewrite path (`setOverlay`).
function soakedPair(hostId: number, fluidId: number, ticks = 200): Grid {
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, hostId, fluidId); // packed solid — see acidPocket
  for (let t = 0; t < ticks; t++) sim.step();
  return grid;
}
{
  const g = soakedPair(ALUMINUM_POWDER.id, LIQUID_GALLIUM.id);
  check(
    '겹침 반응(유체 쪽 표): 스며든 액체 갈륨이 알루미늄 가루를 활성화한다',
    count(g, ACTIVATED_ALUMINUM.id) > 0,
    `${count(g, ACTIVATED_ALUMINUM.id)} activated`,
  );
  check(
    '…갈륨은 소모되지 않는다 (촉매처럼 남는 쪽)',
    countOverlay(g, LIQUID_GALLIUM.id) + count(g, LIQUID_GALLIUM.id) === 196,
    `${countOverlay(g, LIQUID_GALLIUM.id)} still soaked`,
  );

  const h = soakedPair(YEAST.id, HYDROGEN_PEROXIDE.id);
  check(
    '겹침 반응: 스며든 과산화수소가 효모에 분해돼 물이 된다',
    countOverlay(h, WATER.id) > 0 && countOverlay(h, HYDROGEN_PEROXIDE.id) < 196,
    `${countOverlay(h, HYDROGEN_PEROXIDE.id)} peroxide → ${countOverlay(h, WATER.id)} water in the slots`,
  );
  check('…산물은 겹침 슬롯에 그대로 남는다 (효모가 담을 수 있는 액체)', strandedOverlays(h) === 0);
}

// ── 5b. 호스트 쪽 하드코드 규칙 — 시멘트 ──────────────────────────────────────
// The mirror of the acid case, from the host's side: Cement's water rule is code,
// not a table row, and it scanned only its four neighbours — so the water that
// soaked *into* a grain never set it. Same packed pocket, no primary water
// anywhere, so a cured grain can only have cured on its own soak.
{
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, CEMENT.id, WATER.id);
  for (let t = 0; t < 400; t++) sim.step(); // > CURE_TICKS with room to spare (cement.ts)
  check(
    '시멘트: 스며든 물로도 굳는다',
    count(grid, CONCRETE.id) > 0 && count(grid, CEMENT.id) === 0,
    `${count(grid, CONCRETE.id)} concrete, ${count(grid, CEMENT.id)} cement left`,
  );
  check('…굳은 자리에 물이 남지 않는다 (양생에 소모)', countOverlay(grid, WATER.id) === 0);
}

// ── 5c. 시멘트 양생 — 물이 더미 속으로 스며든다 ───────────────────────────────
// The scene 5b's packed pocket can't show, because there the water starts already
// inside every grain: **pouring** water on a deep dry pile. Cement used to set the
// instant it met water, and Concrete is a plain Solid that hosts no 겹침 fluid, so
// the top row flipped into a waterproof lid within a few ticks and everything
// under it stayed powder no matter how much more water you added. A wetted grain
// now cures for CURE_TICKS as *powder* before it sets, and the water that wets it
// is usually not spent doing so — so it goes on down and wets the grains below.
// The pins are therefore depth (did the water get past its own crust?) and the
// delay itself (nothing has set yet while the water is still travelling).
{
  const { grid, sim } = makeWorld(40, 60);
  // A walled shaft, so the pile can't slump sideways and confuse "how deep did the
  // water get" with "where did the grains slide to".
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < 40; x++) if (x < 14 || x >= 26) grid.set(x, y, WALL.id);
  floor(grid, 50, WALL.id);
  pile(grid, 14, 26, 30, 50, CEMENT.id); // 20칸 깊이 — 틴트까지 실제 배치대로
  for (let y = 28; y < 30; y++) for (let x = 14; x < 26; x++) grid.set(x, y, WATER.id); // 2겹만 붓는다

  for (let t = 0; t < 20; t++) sim.step();
  let curing = 0;
  for (let i = 0; i < grid.cells.length; i++)
    if (grid.cells[i] === CEMENT.id && grid.aux[i] > 0) curing++;
  check(
    '시멘트: 물을 먹어도 바로 굳지 않는다 (양생 중에는 아직 가루)',
    count(grid, CONCRETE.id) === 0 && curing > 0,
    `${curing} curing, ${count(grid, CONCRETE.id)} concrete at tick 20`,
  );

  for (let t = 0; t < 400; t++) sim.step();
  // 표면에서 10칸 아래(y ≥ 40) — 옛 규칙이라면 물이 첫 겹에서 전부 소모되고 그 위로
  // 콘크리트 뚜껑이 덮여 절대 닿을 수 없던 깊이.
  let deep = 0;
  for (let y = 40; y < 50; y++)
    for (let x = 14; x < 26; x++) if (grid.get(x, y) === CONCRETE.id) deep++;
  check(
    '…부은 물이 더미 깊숙이 스며들어 아래쪽 알갱이까지 굳힌다',
    deep > 0,
    `${deep} concrete cells 10+ rows deep, ${count(grid, CONCRETE.id)} total`,
  );
  check(
    '…물 한 칸이 알갱이 하나만 굳히지는 않는다 (스며들며 여러 알을 적신다)',
    count(grid, CONCRETE.id) > 24,
    `24 water → ${count(grid, CONCRETE.id)} concrete`,
  );
}

// ── 5d. 시멘트 대조군 — 물이 없으면 아무 일도 없다 ─────────────────────────────
// The counterweight to 5c: the cure is a *timer*, and a timer is exactly the shape
// of bug that fires on its own. A dry pile left alone must still be a dry pile.
{
  const { grid, sim } = makeWorld(30, 40);
  floor(grid, 30, WALL.id);
  for (let y = 20; y < 30; y++) for (let x = 10; x < 20; x++) grid.set(x, y, CEMENT.id);
  const grains = count(grid, CEMENT.id);
  for (let t = 0; t < 400; t++) sim.step();
  check(
    '시멘트: 물이 없으면 스스로 굳지 않는다',
    count(grid, CEMENT.id) === grains && count(grid, CONCRETE.id) === 0,
    `${count(grid, CEMENT.id)}/${grains} cement, ${count(grid, CONCRETE.id)} concrete`,
  );
}

// ── 5e. 시멘트 — 겹침 불가 알갱이가 마른 얼룩으로 남지 않는다 ─────────────────
// The 액체 겹침 계수 is rolled per *grain* off its tint byte, so a minority of any
// powder bed is sealed against liquids no matter how permeable the material is.
// For cement that used to be a dead end rather than a budget: those grains could
// never be reached by water, however much you poured, and stayed behind as dry
// grey specks freckled through the finished slab. A sealed grain now joins a
// curing neighbour. The premise is asserted, not assumed — `SimContext.canHostFluid`
// is the engine's own answer, so the scene can prove it actually contains the
// grains the rule is for instead of trusting a coefficient written down twice.
{
  const { grid, sim } = makeWorld(30, 40);
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 30; x++) if (x < 9 || x >= 21) grid.set(x, y, WALL.id);
  floor(grid, 30, WALL.id);
  pile(grid, 9, 21, 24, 30, CEMENT.id);
  // 확률에 기대지 않는다: 안쪽 몇 알을 확실히 막아 둔다(틴트 255 — 어떤 겹침 계수로도
  // 통과 못 하는 값). 그러고도 **엔진에게 물어서** 세므로 전제가 자기충족이 아니다.
  for (const [sx, sy] of [
    [12, 26],
    [15, 27],
    [18, 25],
  ])
    grid.tint[grid.idx(sx, sy)] = 255;
  const grains = count(grid, CEMENT.id);
  let sealed = 0;
  for (let y = 24; y < 30; y++)
    for (let x = 9; x < 21; x++) if (!sim.context.canHostFluid(x, y, WATER.id)) sealed++;
  // 물은 넉넉히 — 알갱이 수만큼 부어(한 칸이 여러 알을 적시므로 크게 남는다)
  // "물이 모자랐다"가 실패 해석으로 남지 않게 한다.
  for (let y = 18; y < 24; y++) for (let x = 9; x < 21; x++) grid.set(x, y, WATER.id);

  check(
    '전제: 이 시멘트 층에 물이 절대 못 들어가는 알갱이가 실제로 있다',
    sealed > 0,
    `${sealed}/${grains} grains refuse the soak`,
  );
  for (let t = 0; t < 600; t++) sim.step();
  check(
    '시멘트: 겹침 불가 알갱이도 이웃을 따라 굳는다 (마른 얼룩이 안 남는다)',
    count(grid, CEMENT.id) === 0 && count(grid, CONCRETE.id) === grains,
    `${count(grid, CEMENT.id)} cement left, ${count(grid, CONCRETE.id)}/${grains} concrete`,
  );
}

// ── 6. ANFO ────────────────────────────────────────────────────────────────
// The soak that *consumes itself*. Ammonium Nitrate hosts Diesel like any powder
// hosts a liquid, and a grain holding a drop may take it up as ANFO, drinking it
// (ammoniumnitrate.ts) — the palette's one recipe driven by the overlap layer
// rather than by primary-cell contact, so it is this file's pin on the seam
// being readable and writable at all. Sealed in a Wall pocket with no primary
// liquid anywhere: the fuel can only have arrived through the overlap slot, so a
// conversion here cannot be a stray puddle touching the heap from outside.
//
// Conversion is probabilistic (MIX_CHANCE), so this asserts the invariant rather
// than a count: **one drop makes one grain, and no diesel is created or
// destroyed otherwise.** Some fuel is expected to survive — a drop that
// percolates into an already-converted ANFO grain has nothing left to react
// with and just sits there. The yield-vs-charge-size behaviour is
// test/anfo.ts's business, not this file's.
{
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, AMMONIUM_NITRATE.id, DIESEL.id); // packed solid — see acidPocket
  const prills = count(grid, AMMONIUM_NITRATE.id);
  for (let t = 0; t < 200; t++) sim.step();
  const made = count(grid, ANFO.id);
  const left = fluidTotal(grid, DIESEL.id);
  check(
    'ANFO: 프릴에 스민 경유는 프릴을 ANFO로 바꾸고, 쓴 만큼만 소비된다',
    made > 0 && made + count(grid, AMMONIUM_NITRATE.id) === prills && made + left === prills,
    `${made}/${prills} converted, ${left} diesel left`,
  );
}

// ── 7. 이동은 그대로 ────────────────────────────────────────────────────────
// The interaction pass runs before percolation and must not consume its turn: a
// non-reacting soak still drains down through the bed and surfaces below it.
{
  const { grid, sim } = makeWorld(30, 40);
  floor(grid, 30);
  bed(grid, 10, 20, 10, 20, SAND.id, WATER.id);
  const soaked = countOverlay(grid, WATER.id);
  for (let t = 0; t < 120; t++) sim.step();
  check(
    '이동 무회귀: 스며든 물은 여전히 배수된다',
    count(grid, WATER.id) > 0,
    `${soaked} soaked → ${count(grid, WATER.id)} surfaced, ${countOverlay(grid, WATER.id)} still in the bed`,
  );
  check('…배수 중에도 호스트 없는 겹침이 없다', strandedOverlays(grid) === 0);
}

// ── 8. 흘수선 — 겹침이 알갱이를 따라가지 *않는* 자리 ────────────────────────
// The one place the "wet sand carries its water" rule deliberately does NOT
// apply: a buoyant powder column. There the overlay is the raft's WATERLINE, not
// a per-grain property — tryFloatLightPowderStack counts overlay-bearing column
// cells as its submerged depth, and shiftPowderColumnUp/Down keep that count
// anchored to the liquid SURFACE — not to the grains — precisely because each
// overlay stays at its own coordinate while the grains step over it. This scene
// crosses the surface, so here the count does move by one; the scene after it is
// the counter-example that stops "by one" from being read as a law. Both shifts
// are driven directly
// here rather than through a floating raft: the buoyancy loop calls them dozens
// of times a tick under conditions it picks itself, which is no way to see what
// one shift did.
{
  const { grid, sim } = makeWorld(30, 45);
  floor(grid, 40);
  for (let y = 20; y < 40; y++) for (let x = 0; x < 30; x++) grid.set(x, y, WATER.id);
  // A six-cell Sawdust (density 2) column standing on the pond (density 3), its
  // lower three cells already soaked — a raft riding at half draught.
  for (let y = 14; y < 20; y++) grid.set(10, y, SAWDUST.id);
  for (let y = 17; y < 20; y++) grid.setOverlay(10, y, WATER.id);

  const water0 = fluidTotal(grid, WATER.id);
  const soaked0 = countOverlay(grid, WATER.id);
  const rose = sim.context.shiftPowderColumnUp(10, 14, 6);
  const soakedUp = countOverlay(grid, WATER.id);
  check('흘수선: 컬럼이 한 칸 떠오른다', rose && grid.get(10, 13) === SAWDUST.id);
  check(
    '…수면을 넘었으니 잠긴 칸 수가 하나 줄어든다 (겹침을 업고 가면 그대로다)',
    soakedUp === soaked0 - 1,
    `${soaked0} → ${soakedUp}`,
  );
  check(
    '…빠져나온 물은 비워진 칸에 실물로 돌아온다',
    grid.get(10, 19) === WATER.id,
    `vacated cell holds id ${grid.get(10, 19)}`,
  );
  check(
    '…물 총량은 한 칸도 늘지 않는다 (업고 가면 밑칸 것이 복제된다)',
    fluidTotal(grid, WATER.id) === water0,
    `${fluidTotal(grid, WATER.id)}/${water0}`,
  );
  check('…호스트 없는 겹침도 없다', strandedOverlays(grid) === 0);

  // …and the mirror: sinking one cell swallows the liquid at the leading face,
  // so the count goes back up by exactly one.
  const sank = sim.context.shiftPowderColumnDown(10, 13, 6);
  check('흘수선: 같은 컬럼이 다시 한 칸 잠긴다', sank && grid.get(10, 19) === SAWDUST.id);
  check(
    '…수면을 넘었으니 잠긴 칸 수가 하나 늘어난다',
    countOverlay(grid, WATER.id) === soakedUp + 1,
    `${soakedUp} → ${countOverlay(grid, WATER.id)}`,
  );
  check(
    '…이번에도 물 총량은 그대로다',
    fluidTotal(grid, WATER.id) === water0,
    `${fluidTotal(grid, WATER.id)}/${water0}`,
  );
  check('…끝까지 호스트 없는 겹침이 없다', strandedOverlays(grid) === 0);
}

// 완전히 잠긴 채로 하는 시프트는 그 수를 바꾸지 않는다 — 그것도 옳다. 잠긴 칸 수가
// 따라가는 것은 "시프트 한 번당 하나"가 아니라 **수면**이고, 물속에 잠긴 양 끝은 앞면이
// 삼킨 만큼 뒷면이 내놓기 때문이다(푹 잠긴 뗏목은 어느 쪽이든 속까지 젖어 있다).
// 여기서 지키는 것은 그 앵커링과 질량 보존이지 ±1이 아니다. 이 장면은 위 수면 장면과 달리
// 겹침을 같이 복사하는 개조판에서도 통과한다(잠긴 칸 수가 원래 안 변하고, 물속에서는 뒷면
// 물방울이 앞면이 삼킨 자리를 메워 복제도 안 드러난다) — 그래서 회귀를 잡는 못이 아니라
// **위 장면의 "정확히 하나"를 우주 법칙으로 읽지 말라는 반례**로 서 있다.
{
  const { grid, sim } = makeWorld(30, 45);
  floor(grid, 40);
  for (let y = 5; y < 40; y++) for (let x = 0; x < 30; x++) grid.set(x, y, WATER.id);
  // 위도 물, 아래도 물 — 컬럼 전체가 수면 한참 아래에 있고 여섯 칸 모두 젖어 있다.
  for (let y = 14; y < 20; y++) {
    grid.set(10, y, SAWDUST.id);
    grid.setOverlay(10, y, WATER.id);
  }
  const water0 = fluidTotal(grid, WATER.id);
  const soaked0 = countOverlay(grid, WATER.id);
  const rose = sim.context.shiftPowderColumnUp(10, 14, 6);
  check('물속에서도 컬럼은 한 칸 떠오른다', rose && grid.get(10, 13) === SAWDUST.id);
  check(
    '…잠긴 칸 수는 그대로다 (앞면이 삼킨 만큼 뒷면이 내놓는다)',
    countOverlay(grid, WATER.id) === soaked0,
    `${soaked0} → ${countOverlay(grid, WATER.id)}`,
  );
  check(
    '…이 경우에도 물 총량은 한 칸도 안 움직인다',
    fluidTotal(grid, WATER.id) === water0,
    `${fluidTotal(grid, WATER.id)}/${water0}`,
  );
  check('…호스트 없는 겹침도 없다', strandedOverlays(grid) === 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
