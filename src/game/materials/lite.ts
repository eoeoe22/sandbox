// 경량 물질 배럴 — 시작 화면(`/`)의 배경 시뮬레이션이 로드하는 최소 물질 집합.
//
// 전체 배럴(`./index`)은 150종 가까운 물질을 한꺼번에 등록한다. 시작 화면은 그중
// 다섯 줄로 떨어지는 물질과 불만 있으면 되므로, 여기서 그 씨앗들만 import한다.
// ES 모듈 그래프가 각자의 반응 상대(모래→용융 유리, 물→얼음/수증기, 소금→소금물
// 등)를 알아서 끌어오므로, **여기 적힌 것보다 조금 더 많은 물질이 등록된다** —
// 다만 그 확장은 "이 다섯이 실제로 변할 수 있는 것들"로 닫혀 있다.
//
// 등록은 `register()`의 부수효과이고 모듈은 한 번만 평가되므로, 같은 페이지가
// 전체 배럴까지 import하더라도 id 중복 예외는 나지 않는다(같은 모듈 인스턴스).
//
// 새 물질을 시작 화면에 떨어뜨리고 싶으면 여기에 import 한 줄과 LITE_MATERIALS
// 항목 하나를 추가하면 된다 — 시작 화면의 클릭 룰렛(아래 참고)도 같이 늘어난다.

import type { Material } from '../engine/types';

export * from './registry';

// id 0 (Empty). 렌더러의 팔레트가 빈 칸 색을 여기서 읽으므로 반드시 등록돼야 한다.
import { EMPTY_MAT } from './empty';
import { SAND } from './sand';
import { WATER } from './water';
import { GASOLINE } from './gasoline';
import { SAWDUST } from './sawdust';
import { SALT } from './salt';
import { FIRE } from './fire';

// EMPTY_MAT은 값으로 쓰이지 않고 등록 부수효과만 필요하다. import 자체는 tree
// shaking으로 사라지지 않지만(모듈 부수효과), 미사용 경고를 피하려고 한 번 참조한다.
void EMPTY_MAT;

/**
 * 시작 화면이 다섯 줄로 떨어뜨리고, 클릭 룰렛에서 뽑는 물질들. 순서가 곧 화면
 * 왼쪽→오른쪽 스트림 순서다.
 */
export const LITE_MATERIALS: readonly Material[] = [SAND, WATER, GASOLINE, SAWDUST, SALT];

/** 클릭 룰렛의 불 항목 (스트림으로는 떨어지지 않는다). */
export const LITE_FIRE: Material = FIRE;
