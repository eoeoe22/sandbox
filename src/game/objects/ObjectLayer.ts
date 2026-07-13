import type { Grid } from '../engine/Grid';
import type { SimContext } from '../engine/SimContext';
import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from '../materials/registry';
import {
  OBJECT_AIR_DENSITY,
  OBJECT_AIR_DRAG,
  OBJECT_BUOY_GAIN,
  OBJECT_DISPLACE_SEARCH_R,
  OBJECT_FRICTION,
  OBJECT_GRAVITY,
  OBJECT_MAX,
  OBJECT_MAX_SPEED,
  OBJECT_REST_EPSILON,
  OBJECT_SPLASH_MAX_DROPLETS,
  OBJECT_SPLASH_SPEED,
  OBJECT_SUBSTEP,
  OBJECT_SUBSTEP_MAX,
} from '../config';
import { ObjState, type SandboxObject, type SavedObject } from './types';
import { getObjectDef, type RegisteredObjectDef } from './registry';
import {
  containsPoint,
  coreDistance,
  coreHalfLen,
  corePointY,
  distToCore,
  forEachCellNear,
  halfHeight,
} from './footprint';
import { updateObjectState } from './events';

/** 8방향, 각도 순 (변위 탐색의 ±45° 회전이 인덱스 ±1로 떨어지게). */
const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** 단위 벡터를 가장 가까운 8방향 인덱스로. */
function dirIndex(x: number, y: number): number {
  const a = Math.atan2(y, x); // -π..π
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/**
 * 독립 오브젝트 레이어: 셀 그리드와 나란히 살면서 매 틱 O(오브젝트 수 × 발자국)
 * 으로 적분되는 원/캡슐 개체 목록. Simulation이 소유하고, CA 스캔이 끝난 뒤
 * step(ctx)로 호출한다 — 그래서 오브젝트가 그리드에 쓰는 것(스폰/스왑)은 물질
 * update와 같은 moved 마킹 계약 아래에서 다음 틱의 CA가 처리한다.
 *
 * 그리드와의 만남은 좁게 유지한다:
 *  - 읽기: 경계 링의 매질 샘플(부력·저항), 발자국의 고체 셀(충돌), 노출 감지
 *  - 쓰기: SimContext의 공개 seam(spawn/swap)을 통해서만 — 터미널 이벤트와
 *    제한적 양방향(발자국 액체 변위)이 전부다. 속도장 같은 완전 커플링은 없다.
 */
export class ObjectLayer {
  /** 살아있는 오브젝트들. 순회 중 제거가 흔해서(터미널 이벤트) step은 역순. */
  readonly list: SandboxObject[] = [];

  constructor(private grid: Grid) {}

  /**
   * (x,y)를 중심으로 오브젝트를 놓아본다. 발자국이 그리드 안에 들어오도록
   * 중심을 클램프한 뒤, 고체/가루/동결 셀이나 기존 오브젝트와 겹치면 거부
   * (액체/기체 위는 허용 — 물속 스폰은 변위/부력이 알아서 처리한다).
   * 성공 여부를 돌려주고, 실패는 조용한 no-op (브러시의 막힌 칠과 같은 규약).
   */
  trySpawn(type: number, x: number, y: number): boolean {
    if (this.list.length >= OBJECT_MAX) return false;
    const def = getObjectDef(type);
    if (!def) return false;
    const g = this.grid;
    const r = def.shape.r;
    const hh = halfHeight(def.shape);
    if (g.width < 2 * r + 1 || g.height < 2 * hh + 1) return false; // 그리드가 너무 작다
    x = clamp(x, r, g.width - r);
    y = clamp(y, hh, g.height - hh);
    let blocked = false;
    forEachCellNear(x, y, def.shape, 0, g.width, g.height, (cx, cy) => {
      if (this.blockingAt(cx, cy)) blocked = true;
    });
    if (blocked) return false;
    for (const o of this.list) {
      const od = getObjectDef(o.type);
      if (!od) continue;
      const c = coreDistance(o.x, o.y, od.shape, x, y, def.shape);
      if (c === null || c.dist < od.shape.r + r) return false;
    }
    this.list.push({
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      state: ObjState.Intact,
      timer: def.triggers?.timerTicks ?? 0,
      leakDx: 0,
      leakDy: 0,
      wasInLiquid: false,
    });
    return true;
  }

  /** (x,y)를 덮고 있는 오브젝트의 인덱스 (여럿이면 나중에 놓인 쪽), 없으면 -1. */
  hitTest(x: number, y: number): number {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      const def = getObjectDef(o.type);
      if (!def) continue;
      if (distToCore(x, y, o.x, o.y, coreHalfLen(def.shape)) <= def.shape.r) return i;
    }
    return -1;
  }

  removeAt(i: number): void {
    this.list.splice(i, 1);
  }

  clear(): void {
    this.list.length = 0;
  }

  /**
   * 한 틱 적분. Simulation.step()이 CA 스캔 직후에 부른다. 순서:
   * 경계 링 매질 샘플(부력·저항) → 힘 적용 → 서브스텝 이동+고체 충돌 →
   * 이산 이벤트(노출/상태머신 — events.ts) → 오브젝트끼리 충돌.
   * 제거(void 낙하·터미널 이벤트)를 안전하게 하려고 역순 순회.
   */
  step(ctx: SimContext): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      const def = getObjectDef(o.type);
      if (!def) {
        // 등록이 사라진 타입(구버전 세이브 등)은 조용히 걷어낸다.
        this.list.splice(i, 1);
        continue;
      }
      const impact = this.integrate(ctx, o, def);
      if (impact < 0 || updateObjectState(ctx, o, def, impact)) this.list.splice(i, 1);
    }
    this.collidePairs();
  }

  /** 오브젝트 하나의 틱. 이 틱 고체 충돌의 최대 법선 속도를 돌려주고(충돌
   *  없음 = 0), void 경계로 떨어져 제거 대상이면 -1. */
  private integrate(ctx: SimContext, o: SandboxObject, def: RegisteredObjectDef): number {
    // --- 주변 매질 샘플: 경계 링(껍질 바로 밖 1셀)만 읽는다. 발자국 내부가
    // 아니라 링을 읽는 건 의도적 — 제한적 양방향이 발자국의 액체를 밀어내
    // 내부가 비어도, 선체를 '둘러싼' 매질이 부력을 결정하므로 떠 있는 상태가
    // 유지된다. 고체 셀은 매질이 아니니 평균에서 뺀다.
    let mediumCells = 0;
    let densitySum = 0;
    let liquidCells = 0;
    forEachCellNear(o.x, o.y, def.shape, 1, ctx.width, ctx.height, (cx, cy, d) => {
      if (d <= def.shape.r) return; // 내부는 건너뛰고 링만
      const id = ctx.get(cx, cy);
      if (id === EMPTY) {
        mediumCells++;
        densitySum += OBJECT_AIR_DENSITY;
        return;
      }
      const m = getMaterial(id);
      if (m.phase === Phase.Liquid && !ctx.isFrozen(cx, cy)) {
        mediumCells++;
        densitySum += m.density;
        liquidCells++;
      } else if (m.phase === Phase.Gas) {
        mediumCells++;
        densitySum += m.density;
      }
      // Solid/Powder/동결 액체는 매질이 아님 (충돌 담당)
    });
    const avgDensity = mediumCells > 0 ? densitySum / mediumCells : OBJECT_AIR_DENSITY;
    const liquidFrac = mediumCells > 0 ? liquidCells / mediumCells : 0;

    // --- 힘: 중력·부력을 한 항으로 (아르키메데스 — 주변 평균 밀도가 자기
    // 밀도보다 크면 계수가 음수가 되어 중력 반대 방향으로 뜬다). 중력 세기
    // 0이면 부력도 0 — 무중력에선 뜰 이유도 없다. 액체에 잠긴 만큼 부력
    // 증폭(OBJECT_BUOY_GAIN)이 걸린다: 평형점은 그대로, 복원만 빠르게.
    const buoy = 1 - avgDensity / def.density;
    const gain = 1 + (OBJECT_BUOY_GAIN - 1) * liquidFrac;
    const acc = OBJECT_GRAVITY * ctx.gravityStrength * buoy * gain;
    o.vx += ctx.gravityX * acc;
    o.vy += ctx.gravityY * acc;

    // --- 저항: 기본 공기 저항 + 잠긴 비율만큼의 액체 저항. 종단속도를 만든다.
    const keep = 1 - Math.min(0.9, OBJECT_AIR_DRAG + def.drag * liquidFrac);
    o.vx *= keep;
    o.vy *= keep;
    const speed = Math.hypot(o.vx, o.vy);
    if (speed > OBJECT_MAX_SPEED) {
      const s = OBJECT_MAX_SPEED / speed;
      o.vx *= s;
      o.vy *= s;
    }

    // --- 서브스텝 적분 + 충돌: 한 번에 OBJECT_SUBSTEP 셀 이상 움직이지 않게
    // 틱을 쪼갠다 (1셀 벽 터널링 방지).
    const maxV = Math.max(Math.abs(o.vx), Math.abs(o.vy));
    const n = Math.min(OBJECT_SUBSTEP_MAX, Math.max(1, Math.ceil(maxV / OBJECT_SUBSTEP)));
    let collided = false;
    let impact = 0;
    // 입수 스플래시 예산: 공기에 있다가 이 틱에 빠르게 액체를 때렸으면,
    // 변위될 액체 몇 셀이 옆이 아니라 수면 위로 튄다 (재배치 — 질량 보존).
    const speedNow = Math.hypot(o.vx, o.vy);
    let splashBudget =
      !o.wasInLiquid && liquidFrac > 0.2 && speedNow >= OBJECT_SPLASH_SPEED
        ? OBJECT_SPLASH_MAX_DROPLETS
        : 0;
    for (let s = 0; s < n; s++) {
      o.x += o.vx / n;
      o.y += o.vy / n;
      if (ctx.borderMode === 'void') {
        // 열린 경계: 중심이 그리드를 벗어나면 세상 밖으로 떨어진 것.
        if (o.x < 0 || o.x >= ctx.width || o.y < 0 || o.y >= ctx.height) return -1;
      } else {
        const wallHit = this.clampToWalls(ctx, o, def);
        if (wallHit > 0) collided = true;
        if (wallHit > impact) impact = wallHit;
      }
      const hit = this.collideSolids(ctx, o, def);
      if (hit > 0) collided = true;
      if (hit > impact) impact = hit;
      splashBudget = this.displaceFluids(ctx, o, def, splashBudget);
    }

    // --- 정지 처리: 고체에 닿은 틱에 이 속도 미만이면 멈춘 것으로 본다 —
    // 반발 잔진동이 바닥에서 영원히 떨리는 걸 막는다. 부력 흔들림(충돌 없음)은
    // 건드리지 않는다.
    if (collided && Math.hypot(o.vx, o.vy) < OBJECT_REST_EPSILON) {
      o.vx = 0;
      o.vy = 0;
    }
    o.wasInLiquid = liquidFrac > 0.2;
    return impact;
  }

  /** wall 경계: 형태가 그리드 밖으로 나가지 않게 클램프하고 반발 반사.
   *  닿은 면의 법선 속도(충격 세기)를 돌려준다 (안 닿음 = 0). */
  private clampToWalls(ctx: SimContext, o: SandboxObject, def: RegisteredObjectDef): number {
    const r = def.shape.r;
    const hh = halfHeight(def.shape);
    let impact = 0;
    if (o.x < r) {
      o.x = r;
      if (o.vx < 0) {
        impact = Math.max(impact, -o.vx);
        o.vx = -o.vx * def.restitution;
      }
    } else if (o.x > ctx.width - r) {
      o.x = ctx.width - r;
      if (o.vx > 0) {
        impact = Math.max(impact, o.vx);
        o.vx = -o.vx * def.restitution;
      }
    }
    if (o.y < hh) {
      o.y = hh;
      if (o.vy < 0) {
        impact = Math.max(impact, -o.vy);
        o.vy = -o.vy * def.restitution;
      }
    } else if (o.y > ctx.height - hh) {
      o.y = ctx.height - hh;
      if (o.vy > 0) {
        impact = Math.max(impact, o.vy);
        o.vy = -o.vy * def.restitution;
      }
    }
    return impact;
  }

  /**
   * 발자국과 겹친 고체 셀들에서 밀어내고 반사한다. 법선은 겹친 각 셀 중심에서
   * 코어 최근접점으로 향하는 벡터의 침투 깊이 가중 합 — 바닥에 놓이면 위로,
   * 벽에 스치면 옆으로 향한다. 대칭으로 끼어 합이 0이면 중력 반대쪽으로
   * 탈출한다. 충돌의 법선 속도(양수)를 돌려주고, 없으면 0.
   */
  private collideSolids(ctx: SimContext, o: SandboxObject, def: RegisteredObjectDef): number {
    const hl = coreHalfLen(def.shape);
    let impact = 0;
    // 밀어내기 → 재검사 몇 번: 한 번의 밀어내기가 다른 셀과 새로 겹칠 수 있다.
    for (let iter = 0; iter < 3; iter++) {
      let nx = 0;
      let ny = 0;
      let maxPen = 0;
      let count = 0;
      forEachCellNear(o.x, o.y, def.shape, 0, ctx.width, ctx.height, (cx, cy, d) => {
        if (!this.blockingAt(cx, cy)) return;
        const pen = def.shape.r - d;
        if (pen <= 0) return;
        const px = cx + 0.5;
        const py = cy + 0.5;
        const ay = corePointY(py, o.y, hl);
        let dx = o.x - px;
        let dy = ay - py;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          // 셀 중심이 코어 위에 정확히 얹힘 — 방향 정보가 없으니 중력 반대로.
          dx = -ctx.gravityX;
          dy = -ctx.gravityY;
        } else {
          dx /= len;
          dy /= len;
        }
        nx += dx * pen;
        ny += dy * pen;
        if (pen > maxPen) maxPen = pen;
        count++;
      });
      if (count === 0) break;
      let len = Math.hypot(nx, ny);
      if (len < 1e-6) {
        nx = -ctx.gravityX;
        ny = -ctx.gravityY;
        len = Math.hypot(nx, ny);
        if (len < 1e-6) {
          nx = 0;
          ny = -1;
          len = 1;
        }
      }
      nx /= len;
      ny /= len;
      o.x += nx * (maxPen + 0.01);
      o.y += ny * (maxPen + 0.01);
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) {
        // v = (법선 성분) + (접선 성분): 법선은 반발 계수로 반사, 접선은 마찰로
        // 감쇠 — 낮은 반발은 퍽 하고 앉고, 높은 반발은 통통 튄다.
        if (-vn > impact) impact = -vn;
        const vtx = o.vx - vn * nx;
        const vty = o.vy - vn * ny;
        o.vx = vtx * OBJECT_FRICTION - vn * def.restitution * nx;
        o.vy = vty * OBJECT_FRICTION - vn * def.restitution * ny;
      }
    }
    return impact;
  }

  /**
   * 오브젝트끼리의 충돌 — 세로 캡슐/원 사이 최근접 거리로 접촉을 찾아 질량비로
   * 분리하고, 반발 임펄스를 나눈다. n ≤ OBJECT_MAX(40)라 O(n²)이어도 값싸다.
   */
  private collidePairs(): void {
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const a = this.list[i];
      const da = getObjectDef(a.type);
      if (!da) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.list[j];
        const db = getObjectDef(b.type);
        if (!db) continue;
        const minD = da.shape.r + db.shape.r;
        const c = coreDistance(a.x, a.y, da.shape, b.x, b.y, db.shape);
        let dist: number;
        let nx: number;
        let ny: number;
        if (c === null) {
          // 코어가 완전히 겹침 (같은 자리에 스폰 직후 등) — 임의 수평 분리.
          dist = 0;
          nx = Math.random() < 0.5 ? 1 : -1;
          ny = 0;
        } else {
          if (c.dist >= minD) continue;
          dist = c.dist;
          nx = c.nx;
          ny = c.ny;
        }
        const pen = minD - dist;
        const invA = 1 / da.mass;
        const invB = 1 / db.mass;
        const invSum = invA + invB;
        // 위치 분리: 가벼운 쪽이 더 많이 밀린다.
        a.x -= nx * pen * (invA / invSum);
        a.y -= ny * pen * (invA / invSum);
        b.x += nx * pen * (invB / invSum);
        b.y += ny * pen * (invB / invSum);
        // 반발 임펄스 (접근 중일 때만).
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const e = Math.min(da.restitution, db.restitution);
          const imp = (-(1 + e) * vn) / invSum;
          a.vx -= imp * nx * invA;
          a.vy -= imp * ny * invA;
          b.vx += imp * nx * invB;
          b.vy += imp * ny * invB;
        }
      }
    }
  }

  /**
   * 제한적 양방향의 두 번째 축 — 발자국 액체 밀어내기. 발자국 안의 (얼지 않은)
   * 액체 셀을 몸체 바깥의 빈 칸으로 swap 해서, CA에는 보이지 않는 오브젝트가
   * 물에게는 불투과 몸체로 읽히게 한다: 잠긴 만큼 주변 수위가 실제로 올라간다
   * (아르키메데스). 전부 swap이라 질량은 절대 변하지 않고, 밀어낼 곳이 없으면
   * (빽빽한 물속) 그대로 둔다 — "잠김"은 부력 샘플이 이미 읽는 상태다.
   *
   * 탐색: 셀에서 코어 반대(바깥) 방향과 그 ±45°, 그리고 중력 반대 방향으로
   * 최대 OBJECT_DISPLACE_SEARCH_R 셀 걷는다. 발자국 안이나 액체/기체는 지나
   * 가고(수면까지 이어 걷기), 고체/가루/동결에서 끊는다. private pushAside
   * (SimContext)와 같은 규율: 빈 칸에만 swap, 재귀 없음.
   *
   * `splashBudget` > 0이면 (고속 입수 틱) 그 수만큼의 변위가 옆이 아니라
   * 수면 위 2~4셀·수평 ±3셀의 빈 칸으로 간다 — 물보라. 남은 예산을 돌려준다.
   */
  private displaceFluids(
    ctx: SimContext,
    o: SandboxObject,
    def: RegisteredObjectDef,
    splashBudget: number,
  ): number {
    const gx = ctx.gravityX;
    const gy = ctx.gravityY;
    forEachCellNear(o.x, o.y, def.shape, 0, ctx.width, ctx.height, (cx, cy) => {
      const id = ctx.get(cx, cy);
      if (id === EMPTY) return;
      const m = getMaterial(id);
      if (m.phase !== Phase.Liquid || ctx.isFrozen(cx, cy)) return;
      // 스플래시 우선: 수면 위로 던질 빈 칸을 찾으면 예산을 쓴다.
      if (splashBudget > 0 && this.trySplash(ctx, o, def, cx, cy, gx, gy)) {
        splashBudget--;
        return;
      }
      this.tryVacate(ctx, o, def, cx, cy, gx, gy);
    });
    return splashBudget;
  }

  /** 변위 대상 액체 셀 하나를 몸체 바깥 빈 칸으로 swap. 성공 여부 반환. */
  private tryVacate(
    ctx: SimContext,
    o: SandboxObject,
    def: RegisteredObjectDef,
    cx: number,
    cy: number,
    gx: number,
    gy: number,
  ): boolean {
    // 바깥(코어 반대) 방향 — 셀이 코어 위에 정확히 얹혔으면 중력 반대로.
    const hl = coreHalfLen(def.shape);
    const ax = cx + 0.5 - o.x;
    const ay = cy + 0.5 - corePointY(cy + 0.5, o.y, hl);
    const away = Math.hypot(ax, ay) > 1e-6 ? dirIndex(ax, ay) : dirIndex(-gx, -gy);
    const flip = Math.random() < 0.5 ? 1 : -1;
    const up = dirIndex(-gx, -gy);
    const tried = [away, (away + flip + 8) % 8, (away - flip + 8) % 8, up];
    // 발자국 안을 지나는 걸음은 탐색 예산을 쓰지 않는다 — 캡슐 바닥 셀도
    // 몸통을 관통해 반대편/수면 쪽 빈 칸에 닿을 수 있다. 전체 걸음은 형태
    // 지름 + 예산을 덮는 상수로 캡.
    const maxSteps = 2 * Math.ceil(halfHeight(def.shape)) + OBJECT_DISPLACE_SEARCH_R + 2;
    for (const di of tried) {
      const [dx, dy] = DIRS8[di];
      let outside = 0;
      let tx = cx;
      let ty = cy;
      for (let step = 0; step < maxSteps && outside < OBJECT_DISPLACE_SEARCH_R; step++) {
        tx += dx;
        ty += dy;
        if (!ctx.inBounds(tx, ty)) break;
        // 발자국 안은 통과해서 계속 바깥을 찾는다.
        if (containsPoint(tx + 0.5, ty + 0.5, o.x, o.y, def.shape)) continue;
        outside++;
        const tid = ctx.get(tx, ty);
        if (tid === EMPTY) {
          ctx.swap(cx, cy, tx, ty);
          return true;
        }
        const tm = getMaterial(tid);
        // 액체/기체 몸체는 이어 걷어 수면(빈 칸)까지 가 본다; 고체류에서 끊는다.
        if (tm.phase !== Phase.Liquid && tm.phase !== Phase.Gas) break;
        if (ctx.isFrozen(tx, ty)) break;
      }
    }
    return false;
  }

  /** 입수 물보라: 변위 액체 셀을 수면 위(중력 반대 2~4셀, 수평 ±3셀)의 빈
   *  칸으로 swap. 스폰이 아니라 재배치라 질량이 보존된다. */
  private trySplash(
    ctx: SimContext,
    o: SandboxObject,
    def: RegisteredObjectDef,
    cx: number,
    cy: number,
    gx: number,
    gy: number,
  ): boolean {
    // 중력 수직축 (수평 흩뿌림 방향).
    const px = -gy;
    const py = gx;
    for (let attempt = 0; attempt < 3; attempt++) {
      const upN = 2 + ((Math.random() * 3) | 0);
      const side = ((Math.random() * 7) | 0) - 3;
      const tx = Math.round(cx - gx * upN + px * side);
      const ty = Math.round(cy - gy * upN + py * side);
      if (!ctx.inBounds(tx, ty)) continue;
      if (containsPoint(tx + 0.5, ty + 0.5, o.x, o.y, def.shape)) continue;
      if (ctx.get(tx, ty) !== EMPTY) continue;
      ctx.swap(cx, cy, tx, ty);
      return true;
    }
    return false;
  }

  /** 이 셀이 오브젝트를 막는가: Solid/Powder, 동결 액체. (액체/기체는 매질.) */
  private blockingAt(cx: number, cy: number): boolean {
    const id = this.grid.get(cx, cy);
    if (id === EMPTY) return false;
    const m = getMaterial(id);
    if (m.phase === Phase.Solid || m.phase === Phase.Powder) return true;
    const f = m.freeze;
    return f !== undefined && this.grid.getTemp(cx, cy) <= f.temp;
  }

  // -------------------------------------------------------------------------
  // 직렬화 / 리사이즈
  // -------------------------------------------------------------------------

  /** 세이브 봉투용 스냅샷. 좌표는 소수 2자리로 반올림해 3초 자동저장의 JSON
   *  변동 폭을 줄인다. */
  serialize(): SavedObject[] {
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    return this.list.map((o) => ({
      t: o.type,
      x: r2(o.x),
      y: r2(o.y),
      vx: r2(o.vx),
      vy: r2(o.vy),
      st: o.state,
      tm: o.timer,
      ldx: r2(o.leakDx),
      ldy: r2(o.leakDy),
    }));
  }

  /**
   * 세이브에서 복원. 저장 당시 그리드 크기(savedW×savedH)와 현재 크기가 다르면
   * Grid.resizeFrom과 같은 bottom-left 앵커로 옮긴다 (y += 높이 차, x 그대로).
   * 형태가 안 들어가거나 고체에 파묻힌 오브젝트는 버린다 — 셀 쪽에서 unknown
   * id가 Empty로 떨어지는 것과 같은 관용 규칙.
   */
  load(saved: readonly SavedObject[], savedW: number, savedH: number): void {
    this.list.length = 0;
    const g = this.grid;
    const dy = g.height - savedH;
    void savedW; // 열은 왼쪽 앵커라 x 이동 없음 — 클램프만 한다
    for (const s of saved) {
      if (this.list.length >= OBJECT_MAX) break;
      const def = getObjectDef(s.t);
      if (!def) continue;
      const r = def.shape.r;
      const hh = halfHeight(def.shape);
      if (g.width < 2 * r + 1 || g.height < 2 * hh + 1) continue;
      const x = clamp(s.x, r, g.width - r);
      const y = clamp(s.y + dy, hh, g.height - hh);
      let blocked = false;
      forEachCellNear(x, y, def.shape, 0, g.width, g.height, (cx, cy) => {
        if (this.blockingAt(cx, cy)) blocked = true;
      });
      if (blocked) continue;
      this.list.push({
        type: s.t,
        x,
        y,
        vx: clamp(s.vx, -OBJECT_MAX_SPEED, OBJECT_MAX_SPEED),
        vy: clamp(s.vy, -OBJECT_MAX_SPEED, OBJECT_MAX_SPEED),
        state: s.st,
        timer: s.tm,
        leakDx: s.ldx,
        leakDy: s.ldy,
        wasInLiquid: false,
      });
    }
  }

  /**
   * 라이브 리사이즈 뒤 재앵커 (Game.applyLayout). Grid.resizeFrom의 bottom-left
   * 규칙 미러: 행은 바닥 기준(y += 높이 차), 열은 왼쪽 기준(x 불변). 새 크기에
   * 형태가 안 들어가는 오브젝트만 버리고, 클램프로 살릴 수 있으면 살린다.
   */
  reanchor(oldW: number, oldH: number, newW: number, newH: number): void {
    void oldW;
    const dy = newH - oldH;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      const def = getObjectDef(o.type);
      if (!def) {
        this.list.splice(i, 1);
        continue;
      }
      const r = def.shape.r;
      const hh = halfHeight(def.shape);
      if (newW < 2 * r + 1 || newH < 2 * hh + 1) {
        this.list.splice(i, 1);
        continue;
      }
      o.y = clamp(o.y + dy, hh, newH - hh);
      o.x = clamp(o.x, r, newW - r);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
