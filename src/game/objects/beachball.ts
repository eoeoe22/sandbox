import { registerObject } from './registry';
import { rgb } from '../render/color';

/**
 * 비치볼 — 크고 아주 가벼운 공 (밀도 0.8: 공기보다는 무거워 천천히 떨어지고,
 * 물(3)에서는 살짝만 잠긴 채 높이 뜬다). 파도풀에 띄워 놓고 물살에 흔들리는
 * 그림이 본업. 공기막이라 화염·열(200°)·폭발에 터져 사라진다.
 */
export const BEACH_BALL = registerObject({
  id: 2,
  name: '비치볼',
  shape: { kind: 'circle', r: 3 },
  density: 0.8,
  restitution: 0.6,
  drag: 0.25,
  color: rgb(240, 205, 90),
  outline: rgb(150, 118, 40),
  triggers: { heatTemp: 200, fire: true, blast: true },
  event: { kind: 'pop' },
});
