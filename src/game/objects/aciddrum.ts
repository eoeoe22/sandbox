import { registerObject } from './registry';
import { rgb } from '../render/color';
import { ACID } from '../materials/acid';

/**
 * 산성 물질 통 — 기름통의 위험한 사촌. 밀도 3.4 > 물 3 이라 가라앉아 바닥에
 * 눕는다 (기획표의 "가라앉음"). 열에는 둔감하지만(내열 용기 — heatTemp/fire
 * 트리거 없음) 폭발 전선이나 강한 충격에는 깨져 산을 쏟는다 — 물탱크 바닥에서
 * 깨지면 산이 아래서부터 번지는 그림이 나온다.
 */
export const ACID_DRUM = registerObject({
  id: 4,
  name: '산성통',
  shape: { kind: 'capsule', r: 2, halfLen: 3 },
  density: 3.4,
  restitution: 0.25,
  drag: 0.12,
  color: rgb(126, 189, 84),
  outline: rgb(58, 96, 38),
  triggers: { blast: true, impactSpeed: 1.5 },
  event: { kind: 'rupture', spawn: ACID.id },
});
