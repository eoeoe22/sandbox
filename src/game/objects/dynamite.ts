import { registerObject } from './registry';
import { rgb } from '../render/color';

/**
 * 점화된 다이너마이트 — 놓는 순간부터 심지가 탄다 (기본 210틱 ≈ 기본 속도
 * 7초; 렌더러가 깜빡이는 불씨로 보여준다). 타이머 만료나 폭발 전선 노출
 * (유폭), 강열이면 즉시 터진다. 물/소금물에 닿으면 심지가 영구히 꺼져
 * (Defused) 불발탄이 되지만, 폭발 충격파에는 여전히 유폭한다 — 물이 막는 건
 * 불이지 충격이 아니다.
 */
export const DYNAMITE = registerObject({
  id: 6,
  name: '다이너마이트',
  shape: { kind: 'capsule', r: 1, halfLen: 2 },
  density: 4,
  restitution: 0.2,
  drag: 0.15,
  color: rgb(196, 90, 62),
  outline: rgb(110, 44, 30),
  triggers: { timerTicks: 210, waterDefuse: true, blast: true, heatTemp: 400 },
  event: { kind: 'detonate', radius: 9 },
});
