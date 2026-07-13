import type { MatId } from '../engine/types';

/**
 * 독립 오브젝트 레이어의 타입들. 오브젝트는 셀 그리드 *밖에* 사는 개체다: 여러
 * 셀을 차지하는 원/캡슐이 float 위치·속도로 움직이며, 그리드는 읽기(부력 샘플,
 * 고체 충돌, 열/폭발 노출)와 제한된 쓰기(터미널 이벤트의 spawn/detonate, 발자국
 * 액체 밀어내기)로만 만난다. 회전 상태는 없다 — 캡슐 축은 항상 화면 세로다.
 *
 * 오브젝트 타입 id는 물질 id와 별개의 네임스페이스다 (objects/registry.ts).
 */

/** 오브젝트의 형태. 반지름/반길이는 셀 단위. 캡슐은 세로 축 고정(회전 없음):
 *  중심에서 위아래로 halfLen 만큼 뻗은 선분을 반지름 r로 부풀린 모양. */
export type ObjectShape =
  | { kind: 'circle'; r: number }
  | { kind: 'capsule'; r: number; halfLen: number };

/** 오브젝트 상태머신. Intact가 기본; Leaking은 메탄탱크의 누출-추력 비행,
 *  Defused는 물에 심지가 꺼진 다이너마이트 (타이머 영구 정지). engine/types의
 *  Phase처럼 일반 enum — isolatedModules 트랜스파일과 호환된다. */
export enum ObjState {
  Intact = 0,
  Leaking = 1,
  Defused = 2,
}

/** 살아있는 오브젝트 하나. 위치/속도는 float 셀 단위 (셀/틱). */
export interface SandboxObject {
  /** ObjectDef id (objects/registry.ts). */
  type: number;
  /** 중심 좌표, 셀 단위 float. 캡슐은 축 선분의 중점. */
  x: number;
  y: number;
  /** 속도, 셀/틱. */
  vx: number;
  vy: number;
  /** ObjState 값. */
  state: number;
  /** 다용도 카운트다운(틱): Intact 다이너마이트는 남은 심지, Leaking 탱크는
   *  남은 누출 시간. 타이머 없는 오브젝트는 0. */
  timer: number;
  /** 누출 노즐 방향 (단위 벡터). Leaking 상태에서만 의미. */
  leakDx: number;
  leakDy: number;
  /** 직전 틱에 액체에 잠겨 있었는지 — 공기→액체 진입(스플래시) 감지용.
   *  런타임 전용; 세이브에는 실리지 않는다. */
  wasInLiquid: boolean;
}

/**
 * 오브젝트 타입 정의 — 물질의 Material처럼 선언적 데이터. 타입 추가 = 파일 하나
 * 만들어 registerObject() 호출. 물리 계수와 트리거→이벤트 배선이 전부 여기 있고,
 * ObjectLayer의 적분기/상태머신은 타입을 모른 채 이 데이터만 읽는다.
 */
export interface ObjectDef {
  /** 안정적인 타입 id (1부터; 0은 예약). 세이브에 저장되는 값. */
  id: number;
  /** 팔레트에 표시되는 이름. */
  name: string;
  shape: ObjectShape;
  /** Material.density와 같은 스케일의 상대 밀도 (물=3, 공기≈OBJECT_AIR_DENSITY).
   *  주변 매질의 평균 밀도와 직접 비교되어 부력을 만든다. */
  density: number;
  /** 반발 계수 0..1 — 고체 충돌에서 법선 속도가 얼마나 살아남는지. */
  restitution: number;
  /** 액체 잠김 시 추가 저항(틱당 감쇠 비율, 잠긴 비율로 스케일). */
  drag: number;
  /** 채움 색 (packed 0xAABBGGRR — render/color.ts). */
  color: number;
  /** 윤곽선 색 (packed). */
  outline: number;

  /** 트리거: 만족되면 primary `event`(또는 leak)가 발화한다. 전부 선택적 —
   *  아무것도 없는 오브젝트(고무공)는 순수 물리 장난감. */
  triggers?: {
    /** 발자국+경계 링의 최고 온도가 이 값 이상 → primary event. */
    heatTemp?: number;
    /** FIRE/LAVA/BLUE_FLAME 접촉 → primary event (화염 직접 접촉). */
    fire?: boolean;
    /** BLAST(폭발 전선) 접촉 → primary event (유폭/파열). */
    blast?: boolean;
    /** 고체 충돌의 법선 속도가 이 값 이상 → primary event (충격 파열). */
    impactSpeed?: number;
    /** 스폰 시점부터 심지 카운트다운(틱); 만료 → primary event (다이너마이트). */
    timerTicks?: number;
    /** WATER/SALTWATER 접촉이 타이머를 영구 정지 (심지가 꺼진다). */
    waterDefuse?: boolean;
    /** 경계 온도가 [leakTemp, heatTemp) 구간이면 파열 대신 누출 시작 —
     *  약하게 가열된 메탄탱크는 새고, 강열은 그대로 터진다. */
    leakTemp?: number;
    /** 고체 충돌 법선 속도가 이 값 이상이면 누출 시작 (거친 착지로 밸브 파손).
     *  impactSpeed(파열)보다 낮게 잡아 "약한 충격은 누출, 강한 충격은 파열". */
    leakImpactSpeed?: number;
  };

  /** primary 이벤트 — 트리거 만족 시 한 번 발화하고 오브젝트는 제거된다
   *  (leak 제외: leak은 상태 전이라 events가 아니라 `leak`에 산다). */
  event?:
    | { kind: 'rupture'; spawn: MatId }
    | { kind: 'detonate'; radius: number }
    | { kind: 'pop' };

  /** 누출 스펙 (메탄탱크): 매 틱 노즐 방향 경계에 `spawn`을 `rate`개 뿌리고
   *  반대 방향으로 `thrust` 가속 — 로켓처럼 날아다닌다. duration 틱 뒤 소진. */
  leak?: { spawn: MatId; rate: number; thrust: number; duration: number };
}

/** 세이브 봉투에 실리는 직렬화 형태 (persistence.ts). 필드명은 짧게. */
export interface SavedObject {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  st: number;
  tm: number;
  ldx: number;
  ldy: number;
}
