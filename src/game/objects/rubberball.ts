import { registerObject } from './registry';
import { rgb } from '../render/color';

/**
 * 고무공 — 순수 물리 장난감. 트리거/이벤트가 하나도 없는 가장 단순한
 * 오브젝트로, 레이어의 물리(중력·부력·높은 반발)를 그대로 보여준다.
 * 밀도 2.4 < 물 3 이라 물에 뜨고, 반발 0.85라 바닥에서 기분 좋게 튄다.
 */
export const RUBBER_BALL = registerObject({
  id: 1,
  name: '고무공',
  shape: { kind: 'circle', r: 2 },
  density: 2.4,
  restitution: 0.85,
  drag: 0.12,
  color: rgb(214, 69, 65),
  outline: rgb(130, 36, 34),
});
