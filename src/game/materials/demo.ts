// 가이드 데모 물질 배럴 — `/guide?tab=basics` 의 여섯 데모 캔버스가 로드하는 최소
// 물질 집합. 시작 화면의 `materials/lite.ts` 와 같은 이유로 존재한다: 전체
// 배럴(`./index`)은 150종 가까운 물질과 그 `update` 클로저를 한꺼번에 끌어오는데,
// 가이드 문서가 보여 주는 것은 벽·돌·체·모래·물·연기·히트파이프·불·Clone 아홉뿐이다.
//
// 시작 화면 배럴을 그대로 쓰지 않은 이유는 집합이 다르기 때문이다 — 저쪽은
// 휘발유·톱밥을 떨어뜨리고 벽/연기/히트파이프/Clone 을 모르며, 이쪽은 그 반대다.
// 두 배럴이 겹치는 물질(모래·물·불)은 같은 모듈 인스턴스라 등록이 두 번 일어나지
// 않는다(`register()` 는 모듈 평가의 부수효과이고 모듈은 한 번만 평가된다).
//
// ES 모듈 그래프가 각자의 반응 상대를 알아서 끌어오므로 **여기 적힌 것보다 조금 더
// 많은 물질이 등록된다**(물 → 얼음/수증기·용암, 모래 → 용융 유리, 불 → 연기·소화
// 계통). 그 확장은 "이 여덟이 실제로 변할 수 있는 것들" 로 닫혀 있다.
//
// 돌을 이름으로 들인 것이 그 그래프를 넓히지는 않는다 — `water.ts` 가 `lavaTouching`
// 을 쓰고 `lava.ts` 가 `STONE`/`OBSIDIAN` 을 물고 있어서, 돌은 물만으로도 이미 등록돼
// 있었다. 여기 한 줄이 하는 일은 **장면 코드가 이름으로 집을 수 있게** 하는 것뿐이다.

import type { Material } from '../engine/types';

export * from './registry';

// id 0 (Empty). 렌더러의 팔레트가 빈 칸 색을 여기서 읽으므로 반드시 등록돼야 한다.
import { EMPTY_MAT } from './empty';
import { WALL } from './wall';
import { STONE } from './stone';
import { MESH } from './mesh';
import { SAND } from './sand';
import { WATER } from './water';
import { SMOKE } from './smoke';
import { HEATPIPE } from './heatpipe';
import { FIRE } from './fire';
import { CLONE } from './clone';

// EMPTY_MAT은 값으로 쓰이지 않고 등록 부수효과만 필요하다. import 자체는 tree
// shaking으로 사라지지 않지만(모듈 부수효과), 미사용 경고를 피하려고 한 번 참조한다.
void EMPTY_MAT;

/** 데모 장면이 직접 놓는 물질들. 장면 코드는 여기서만 물질을 가져온다 — 전체
 *  배럴을 실수로 import 하면 가이드 페이지가 시뮬레이션 전체를 내려받게 된다. */
export const DEMO_WALL: Material = WALL;
export const DEMO_STONE: Material = STONE;
export const DEMO_MESH: Material = MESH;
export const DEMO_SAND: Material = SAND;
export const DEMO_WATER: Material = WATER;
export const DEMO_SMOKE: Material = SMOKE;
export const DEMO_HEATPIPE: Material = HEATPIPE;
export const DEMO_FIRE: Material = FIRE;
export const DEMO_CLONE: Material = CLONE;
