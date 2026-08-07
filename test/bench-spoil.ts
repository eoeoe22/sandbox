// 부패 계통의 **성능** 하네스. 통과/실패가 없고 시간만 찍는다 — `spoil.ts` 의 잠김
// 광선(`isSubmerged`)을 건드릴 때 돌려 보는 물건이다. 실행: `npm run bench:spoil`.
//
// 네 장면 전부 판(360×203)을 식품으로 꽉 채운다. 그게 **광선이 가지치기를 못 하는
// 유일한 배치**이기 때문이다: 트인 곳이 하나도 없으면 `open` 이 무한이라 네 방향 모두
// SUBMERGE_MAX_DEPTH 까지 달리고, 네 칸 선행 판정도 안 걸린다(옆 칸이 전부 식품이다).
// 즉 여기 찍히는 값이 이 규칙이 낼 수 있는 최댓값이다.
//
// 뒤의 두 장면이 부패 카운터를 미리 꽉 채우는 것이 요점이다. 잠김 광선으로 내려가는
// 문 둘(포자 관문과 `moldCanEat`)이 **부패 단계 4 이상에서만** 열리므로, 갓 놓인
// 고기로는 그 문이 거의 안 열려 비용이 과소평가된다.
//
// 이 상자의 벽시계는 같은 코드에서 15%씩 흔들린다. 그래서 장면마다 새로 세워 여러 번
// 재고 최솟값을 쓴다 — 한 번만 재면 변경의 **부호조차** 못 읽는다.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { GRID_W, GRID_H } from '../src/game/config';
import { getMaterial } from '../src/game/materials/registry';
import '../src/game/materials';

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};

// 같은 장면을 여러 번 새로 세워 재고 **최솟값**을 쓴다. 이 상자의 벽시계는 같은
// 코드에서 15%씩 흔들려서, 한 번 재면 변경의 부호조차 못 읽는다.
const REPS = Number(process.env.REPS ?? 5);
function bench(label: string, fill: (g: Grid) => void, ticks: number): void {
  let best = Infinity;
  for (let r = 0; r < REPS; r++) {
    const grid = new Grid(GRID_W, GRID_H);
    fill(grid);
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    const sim = new Simulation(grid);
    for (let i = 0; i < 30; i++) sim.step(); // warm-up
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ticks; i++) sim.step();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / ticks;
    if (ms < best) best = ms;
  }
  console.log(`${label.padEnd(46)} ${best.toFixed(2)} ms/tick (best of ${REPS})`);
}

const RAW_MEAT = ID('Raw Meat');
const MOLD = ID('Mold');
const TICKS = Number(process.env.TICKS ?? 120);

bench(
  '판 전체가 생고기',
  (g) => g.cells.fill(RAW_MEAT),
  TICKS,
);
bench(
  '판 전체가 생고기 + 곰팡이 1/4',
  (g) => {
    g.cells.fill(RAW_MEAT);
    for (let i = 0; i < g.cells.length; i += 4) g.cells[i] = MOLD;
  },
  TICKS,
);

// 리뷰가 지적한 자리: `moldCanEat` 은 부패 단계 4 이상에서만 광선까지 내려간다.
// 위 두 장면은 120틱이라 그 문이 거의 안 열리므로, 카운터를 미리 꽉 채워 **문이 항상
// 열려 있는** 최악을 따로 잰다. 생고기의 부패 카운터는 aux 비트 4-6(meat.ts SPOIL_SHIFT).
const ROTTEN = 7 << 4;
bench(
  '판 전체가 부패도 만점 생고기',
  (g) => {
    g.cells.fill(RAW_MEAT);
    g.aux.fill(ROTTEN);
  },
  TICKS,
);
bench(
  '…거기에 곰팡이 1/4 (침식 경로 최악)',
  (g) => {
    g.cells.fill(RAW_MEAT);
    g.aux.fill(ROTTEN);
    for (let i = 0; i < g.cells.length; i += 4) {
      g.cells[i] = MOLD;
      g.aux[i] = 0;
    }
  },
  TICKS,
);
