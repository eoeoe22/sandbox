import { registerObject } from './registry';
import { rgb } from '../render/color';
import { METHANE } from '../materials/methane';

/**
 * 메탄가스 통 — 2단 위험물. 약한 자극(완만한 가열 400°, 거친 착지)은 밸브를
 * 따서 누출-추력 비행을 시작한다: 노즐로 메탄을 뿜으며 로켓처럼 이리저리
 * 날아다니고, 흘린 메탄 구름은 불씨를 만나면 methane.ts의 자체 규칙으로
 * 유폭한다. 강한 자극(강열 900°·폭발 전선·아주 강한 충격)은 통째로 터진다.
 * 소진된 통은 빈 껍데기로 남는다.
 */
export const METHANE_TANK = registerObject({
  id: 5,
  name: '메탄탱크',
  shape: { kind: 'capsule', r: 2, halfLen: 3 },
  density: 2.2,
  restitution: 0.3,
  drag: 0.12,
  color: rgb(214, 168, 62),
  outline: rgb(122, 92, 28),
  triggers: {
    heatTemp: 900,
    blast: true,
    impactSpeed: 1.8,
    leakTemp: 400,
    leakImpactSpeed: 1.1,
  },
  event: { kind: 'detonate', radius: 7 },
  leak: { spawn: METHANE.id, rate: 2, thrust: 0.035, duration: 300 },
});
