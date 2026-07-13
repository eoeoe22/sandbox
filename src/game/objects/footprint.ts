import type { ObjectShape } from './types';

/**
 * 형태 수학 — 원/캡슐이 그리드 셀과 만나는 방식의 단일 소스. 오브젝트 형태는
 * "세로 코어 선분(원은 길이 0)을 반지름 r로 부풀린 것"으로 통일해서, 포함
 * 검사·최근접점·발자국 순회가 전부 선분-점 거리 하나로 환원된다.
 *
 * 셀 (cx,cy)의 중심은 (cx+0.5, cy+0.5)이고, 발자국은 "중심이 형태 안에 있는
 * 셀"이다. 발자국이 작아서(r ≤ 3 → 셀 ~50개) 사전 계산 없이 매번 바운딩
 * 박스를 순회해도 오브젝트 40개 기준 틱당 수천 번의 셀 검사에 그친다 — float
 * 중심 그대로 검사하므로 반올림 양자화 흔들림도 없다.
 */

/** 형태의 코어 선분 반길이 (원은 0). */
export function coreHalfLen(shape: ObjectShape): number {
  return shape.kind === 'capsule' ? shape.halfLen : 0;
}

/** 형태가 중심에서 세로로 뻗는 총 반높이 (r + halfLen). */
export function halfHeight(shape: ObjectShape): number {
  return shape.r + coreHalfLen(shape);
}

/** 점 (px,py)에서, (x,y)를 중점으로 하는 세로 코어 선분까지의 거리. */
export function distToCore(px: number, py: number, x: number, y: number, hl: number): number {
  const cy = py < y - hl ? y - hl : py > y + hl ? y + hl : py;
  return Math.hypot(px - x, py - cy);
}

/** 코어 선분 위에서 (px,py)에 가장 가까운 점의 y (x는 항상 중심 x). */
export function corePointY(py: number, y: number, hl: number): number {
  return py < y - hl ? y - hl : py > y + hl ? y + hl : py;
}

/** 점이 형태 안에 있는지 (표면 포함). */
export function containsPoint(
  px: number,
  py: number,
  x: number,
  y: number,
  shape: ObjectShape,
): boolean {
  return distToCore(px, py, x, y, coreHalfLen(shape)) <= shape.r;
}

/**
 * 형태 표면에서 `pad` 셀 이내에 중심이 든 모든 그리드 셀을 순회한다.
 * pad 0 = 발자국(내부), pad 1 = 발자국+경계 링. 콜백은 코어까지의 거리 `d`를
 * 받아 내부(d ≤ r)와 링(r < d)을 구분할 수 있다. 경계 밖 셀은 건너뛴다.
 */
export function forEachCellNear(
  x: number,
  y: number,
  shape: ObjectShape,
  pad: number,
  gridW: number,
  gridH: number,
  fn: (cx: number, cy: number, d: number) => void,
): void {
  const hl = coreHalfLen(shape);
  const reach = shape.r + pad;
  const x0 = Math.max(0, Math.floor(x - reach));
  const x1 = Math.min(gridW - 1, Math.ceil(x + reach));
  const y0 = Math.max(0, Math.floor(y - hl - reach));
  const y1 = Math.min(gridH - 1, Math.ceil(y + hl + reach));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const d = distToCore(cx + 0.5, cy + 0.5, x, y, hl);
      if (d <= reach) fn(cx, cy, d);
    }
  }
}

/**
 * 두 오브젝트 형태(세로 캡슐/원)의 최근접 거리와 접촉 정보. 둘 다 축이 세로라
 * 최근접점 계산이 구간 겹침 하나로 끝난다. 반환된 (nx,ny)는 a→b 방향 단위
 * 법선, dist는 코어 선분 사이 거리 (접촉 조건: dist < a.r + b.r).
 * 코어가 완전히 겹치면(dist≈0) 법선은 호출부가 정해야 하므로 null을 준다.
 */
export function coreDistance(
  ax: number,
  ay: number,
  aShape: ObjectShape,
  bx: number,
  by: number,
  bShape: ObjectShape,
): { dist: number; nx: number; ny: number } | null {
  const ha = coreHalfLen(aShape);
  const hb = coreHalfLen(bShape);
  const aLo = ay - ha;
  const aHi = ay + ha;
  const bLo = by - hb;
  const bHi = by + hb;
  // 세로 구간이 겹치면 최근접 y는 겹침 구간 안 (수평 거리만 남고), 아니면
  // 서로 가까운 끝끼리.
  let ayC: number;
  let byC: number;
  if (aHi < bLo) {
    ayC = aHi;
    byC = bLo;
  } else if (bHi < aLo) {
    ayC = aLo;
    byC = bHi;
  } else {
    const mid = (Math.max(aLo, bLo) + Math.min(aHi, bHi)) / 2;
    ayC = mid;
    byC = mid;
  }
  const dx = bx - ax;
  const dy = byC - ayC;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return null;
  return { dist, nx: dx / dist, ny: dy / dist };
}
