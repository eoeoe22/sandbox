import type { ObjectDef, ObjectShape } from './types';
import { toCss } from '../render/color';

/**
 * 오브젝트 타입 레지스트리 — materials/registry.ts와 같은 패턴. 타입 추가 =
 * 파일 하나에서 registerObject() 호출, barrel(index.ts)에 import 두 줄.
 * 물질 id와는 별개의 id 공간이다.
 */

/** 등록 시점에 파생 값(질량, CSS 색 문자열)을 미리 계산해 붙인 정의.
 *  렌더러가 프레임마다 toCss를 부르지 않도록 여기서 한 번만 만든다. */
export interface RegisteredObjectDef extends ObjectDef {
  /** density × 면적(셀²). 오브젝트끼리 충돌할 때 임펄스/분리 배분에 쓰인다. */
  mass: number;
  cssFill: string;
  cssOutline: string;
}

const byId: RegisteredObjectDef[] = [];

/** 형태의 면적 (셀²): 원 πr², 캡슐은 원 + 직사각 몸통. */
function shapeArea(shape: ObjectShape): number {
  const circle = Math.PI * shape.r * shape.r;
  return shape.kind === 'capsule' ? circle + 2 * shape.r * 2 * shape.halfLen : circle;
}

export function registerObject(def: ObjectDef): RegisteredObjectDef {
  const reg: RegisteredObjectDef = {
    ...def,
    mass: Math.max(0.1, def.density * shapeArea(def.shape)),
    cssFill: toCss(def.color),
    cssOutline: toCss(def.outline),
  };
  byId[def.id] = reg;
  return reg;
}

/** 타입 id → 정의. 미등록 id는 undefined (호출부가 걸러야 한다 — 세이브 검증,
 *  스텝의 방어적 스킵). */
export function getObjectDef(id: number): RegisteredObjectDef | undefined {
  return byId[id];
}

/** 등록된 전체 정의, id 순 (팔레트 빌드용). */
export function allObjectDefs(): RegisteredObjectDef[] {
  return byId.filter(Boolean);
}
