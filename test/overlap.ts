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
// through the seam), and ANFO's diesel soak — which must go on being an inert
// soak, since that is the whole mechanism ammoniumnitrate.ts is built on.
//
// Run: `node test/run-overlap.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { EMPTY, Phase } from '../src/game/engine/types';
import { detonate } from '../src/game/materials/blast';
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
import { DIESEL } from '../src/game/materials/diesel';
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
// A gas can't soak into a powder, but it CAN into a porous solid, and the two
// that admit it (Mesh, Turbine) are both corrodible — so Acid Vapor drifting into
// a screen used to park inside the very thing it should be eating. Mesh admits
// only its light checkerboard cells (`latticeFilter`), so the scene seeds exactly
// those; the rest of the screen is packed solid, leaving the fumes nowhere to
// surface. The Pump is the control: same porous hosting, but `acidResistant`.
function vaporScreen(hostId: number, ticks = 400): { left: number; start: number } {
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  for (let y = 8; y < 22; y++)
    for (let x = 8; x < 22; x++) {
      grid.set(x, y, hostId);
      if (((x ^ y) & 1) === 0) grid.setOverlay(x, y, ACID_VAPOR.id);
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
    '…대조군: 내산성 다공체(펌프)는 증기가 지나가도 멀쩡',
    pump.left === pump.start,
    `${pump.start} → ${pump.left} pump`,
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
  for (let t = 0; t < 200; t++) sim.step();
  check(
    '시멘트: 스며든 물로도 굳는다',
    count(grid, CONCRETE.id) > 0 && count(grid, CEMENT.id) === 0,
    `${count(grid, CONCRETE.id)} concrete, ${count(grid, CEMENT.id)} cement left`,
  );
  check('…굳은 자리에 물이 남지 않는다 (양생에 소모)', countOverlay(grid, WATER.id) === 0);
}

// ── 6. ANFO 무회귀 ──────────────────────────────────────────────────────────
// The soak that is *supposed* to be inert. Ammonium Nitrate hosts Diesel on
// purpose (ANFO), and neither side declares a reaction with the other — so the
// new pass must leave both exactly as it found them. This is the pin that catches
// "the soaked fluid now reacts" turning into "the soaked fluid now disappears".
{
  const { grid, sim } = makeWorld(30, 30);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 30; x++)
      if (x < 8 || x >= 22 || y < 8 || y >= 22) grid.set(x, y, WALL.id);
  bed(grid, 8, 22, 8, 22, AMMONIUM_NITRATE.id, DIESEL.id); // packed solid — see acidPocket
  const prills = count(grid, AMMONIUM_NITRATE.id);
  const soaked = countOverlay(grid, DIESEL.id);
  for (let t = 0; t < 200; t++) sim.step();
  check(
    'ANFO: 프릴에 스민 경유는 그대로 남는다 (반응 상대가 없다)',
    count(grid, AMMONIUM_NITRATE.id) === prills &&
      countOverlay(grid, DIESEL.id) + count(grid, DIESEL.id) === soaked,
    `${prills} prills, ${countOverlay(grid, DIESEL.id)}/${soaked} still soaked`,
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
