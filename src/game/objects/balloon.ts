import { registerObject } from './registry';
import { rgb } from '../render/color';

/**
 * 헬륨 풍선 — 밀도 0.15 < 공기(OBJECT_AIR_DENSITY 0.4)라 공기 중에서도
 * 떠올라 천장이나 구조물 아래에 모여 하늘하늘 걸린다. 열(120°)·화염·폭발
 * 전선에 흔적 없이 터진다. 무너지는 모래 위에 풍선을 가둬 두는 식의 소품용.
 */
export const BALLOON = registerObject({
  id: 7,
  name: '헬륨풍선',
  shape: { kind: 'circle', r: 2 },
  density: 0.15,
  restitution: 0.3,
  drag: 0.2,
  color: rgb(238, 130, 180),
  outline: rgb(150, 62, 104),
  triggers: { heatTemp: 120, fire: true, blast: true },
  event: { kind: 'pop' },
});
