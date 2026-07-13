import { registerObject } from './registry';
import { rgb } from '../render/color';

/**
 * 기름 드럼통 — 캡슐형 컨테이너. 밀도 2.8은 물(3)보다 약간 가벼워서 기획안의
 * 깃발 예시 그대로 움직인다: 떨어뜨리면 관성으로 물속 깊이 잠겼다가 부력에
 * 밀려 떠올라 수면에 낮게 뜬다. 반발이 낮아 바닥에는 퍽 하고 앉는다.
 */
export const OIL_DRUM = registerObject({
  id: 3,
  name: '기름통',
  shape: { kind: 'capsule', r: 2, halfLen: 3 },
  density: 2.8,
  restitution: 0.25,
  drag: 0.12,
  color: rgb(176, 58, 46),
  outline: rgb(96, 32, 26),
});
