import type { SimContext } from '../engine/SimContext';
import { EMPTY, Phase } from '../engine/types';
import { getMaterial } from '../materials/registry';
import { FIRE } from '../materials/fire';
import { LAVA } from '../materials/lava';
import { BLUE_FLAME } from '../materials/blueflame';
import { BLAST, detonate } from '../materials/blast';
import { WATER } from '../materials/water';
import { SALTWATER } from '../materials/saltwater';
import { ObjState, type SandboxObject } from './types';
import type { RegisteredObjectDef } from './registry';
import { coreHalfLen, forEachCellNear } from './footprint';

/**
 * 오브젝트의 이산 이벤트: 노출 감지 → 상태머신 → 터미널 이벤트. 물리 적분
 * (ObjectLayer.integrate)과 분리된, 그리드에 *쓰는* 제한적 양방향의 한 축이다.
 * 모든 쓰기는 SimContext.spawn(moved 마킹)과 detonate(자체 틱 예산)로만 나가고,
 * 트리거 감지는 methane.ts/tnt.ts의 관례(온도 임계 + 특정 id 접촉 스캔)를
 * 오브젝트 발자국+경계 링으로 들어올린 것이다.
 */

/** 한 틱의 노출 스캔 결과 (발자국 + 경계 링 1셀). */
interface Exposure {
  maxTemp: number;
  flame: boolean;
  blast: boolean;
  water: boolean;
}

function scanExposure(ctx: SimContext, o: SandboxObject, def: RegisteredObjectDef): Exposure {
  const exp: Exposure = { maxTemp: -Infinity, flame: false, blast: false, water: false };
  forEachCellNear(o.x, o.y, def.shape, 1, ctx.width, ctx.height, (cx, cy) => {
    const t = ctx.getTemp(cx, cy);
    if (t > exp.maxTemp) exp.maxTemp = t;
    const id = ctx.get(cx, cy);
    if (id === EMPTY) return;
    if (id === FIRE.id || id === LAVA.id || id === BLUE_FLAME.id) exp.flame = true;
    else if (id === BLAST.id) exp.blast = true;
    else if (id === WATER.id || id === SALTWATER.id) exp.water = true;
  });
  return exp;
}

/**
 * 트리거 평가와 상태 전이, 그리고 터미널 이벤트 실행. 오브젝트가 소멸했으면
 * true (호출부가 리스트에서 뗀다). `impact`는 이 틱 고체 충돌의 최대 법선
 * 속도 (충돌 없음 = 0).
 *
 * 우선순위: 폭발 노출(유폭) → 열/화염 → 충격 → 심지 꺼짐 → 타이머 → 누출
 * 시작/진행. 물에 젖어 심지가 꺼진(Defused) 다이너마이트도 폭발 전선에는
 * 반응한다 — 물이 막는 건 불이지 충격파가 아니다.
 */
export function updateObjectState(
  ctx: SimContext,
  o: SandboxObject,
  def: RegisteredObjectDef,
  impact: number,
): boolean {
  const trig = def.triggers;
  if (!trig) return false;
  const exp = scanExposure(ctx, o, def);

  // 심지 꺼짐: 물 접촉이 타이머/재점화를 영구히 죽인다. 폭발 노출보다 먼저
  // 볼 이유가 없으므로(같은 틱에 둘 다면 폭발이 이긴다) 트리거 평가 앞에 둔다.
  const primary =
    (trig.blast && exp.blast) ||
    (trig.heatTemp !== undefined && exp.maxTemp >= trig.heatTemp && o.state !== ObjState.Defused) ||
    (trig.fire && exp.flame && o.state !== ObjState.Defused) ||
    (trig.impactSpeed !== undefined && impact >= trig.impactSpeed);
  if (primary) return executeEvent(ctx, o, def);

  if (trig.waterDefuse && o.state === ObjState.Intact && exp.water) {
    o.state = ObjState.Defused;
  }

  // 심지 타이머 (Intact에서만 탄다 — Defused는 꺼진 심지, Leaking엔 심지 없음).
  if (trig.timerTicks !== undefined && o.state === ObjState.Intact) {
    if (--o.timer <= 0) return executeEvent(ctx, o, def);
  }

  // 누출 시작: 약한 가열([leakTemp, heatTemp))이나 거친 착지(leakImpactSpeed ≤
  // impact < impactSpeed)가 밸브를 딴다.
  if (def.leak && o.state === ObjState.Intact) {
    const byHeat = trig.leakTemp !== undefined && exp.maxTemp >= trig.leakTemp;
    const byImpact = trig.leakImpactSpeed !== undefined && impact >= trig.leakImpactSpeed;
    if (byHeat || byImpact) {
      o.state = ObjState.Leaking;
      o.timer = def.leak.duration;
      // 노즐은 아무 방향이나 — 어디로 튈지 모르는 로켓이 재미의 핵심.
      const a = Math.random() * Math.PI * 2;
      o.leakDx = Math.cos(a);
      o.leakDy = Math.sin(a);
    }
  }

  // 누출 진행: 노즐로 가스를 뿜고 반대로 가속. 방향이 조금씩 흔들려 비행이
  // 예측 불가능해진다. 소진되면 빈 껍데기로 비활성(Defused) — 다시 새지 않고,
  // 물리와 (유폭 같은) 충격 트리거만 남는다.
  if (def.leak && o.state === ObjState.Leaking) {
    if (--o.timer <= 0) {
      o.state = ObjState.Defused;
      return false;
    }
    const wobble = (Math.random() - 0.5) * 0.3;
    const cos = Math.cos(wobble);
    const sin = Math.sin(wobble);
    const ndx = o.leakDx * cos - o.leakDy * sin;
    const ndy = o.leakDx * sin + o.leakDy * cos;
    o.leakDx = ndx;
    o.leakDy = ndy;
    o.vx -= o.leakDx * def.leak.thrust;
    o.vy -= o.leakDy * def.leak.thrust;
    // 가스는 노즐이 형태 표면을 뚫고 나가는 지점 언저리의 빈 칸에만 뿌린다
    // (덮어쓰기 없음 — 질량을 만들 뿐 지우지 않는다).
    const hl = coreHalfLen(def.shape);
    const exit = def.shape.r + hl * Math.abs(o.leakDy) + 1.2;
    for (let k = 0; k < def.leak.rate; k++) {
      const jx = (Math.random() - 0.5) * 1.5;
      const jy = (Math.random() - 0.5) * 1.5;
      const gx = Math.round(o.x + o.leakDx * exit + jx);
      const gy = Math.round(o.y + o.leakDy * exit + jy);
      if (ctx.inBounds(gx, gy) && ctx.get(gx, gy) === EMPTY) {
        ctx.spawn(gx, gy, def.leak.spawn);
      }
    }
  }
  return false;
}

/** primary 이벤트 실행. 이벤트 없는 def(순수 장난감)에 트리거만 있으면 그냥
 *  소멸(pop과 동일)로 취급한다. 항상 true — 오브젝트는 소멸한다. */
function executeEvent(ctx: SimContext, o: SandboxObject, def: RegisteredObjectDef): boolean {
  const ev = def.event;
  if (!ev) return true;
  if (ev.kind === 'detonate') {
    // blast.ts의 브러시-Blast 경로와 같은 모양: 고정 yield의 크레이터. 틱당
    // 예산은 detonate가 스스로 캡한다 (다중 유폭 안전).
    detonate(ctx, Math.round(o.x), Math.round(o.y), ev.radius);
    return true;
  }
  if (ev.kind === 'rupture') {
    // 발자국을 내용물로 채운다. 빈 칸과 (얼지 않은) 액체/기체만 덮어쓴다 —
    // 고체/가루/Wall은 파열로 지워질 물건이 아니다. spawn이 moved 마킹과
    // 초기 온도를 처리한다.
    forEachCellNear(o.x, o.y, def.shape, 0, ctx.width, ctx.height, (cx, cy) => {
      const id = ctx.get(cx, cy);
      if (id !== EMPTY) {
        const p = getMaterial(id).phase;
        if (p !== Phase.Liquid && p !== Phase.Gas) return;
        if (ctx.isFrozen(cx, cy)) return;
      }
      ctx.spawn(cx, cy, ev.spawn);
    });
    return true;
  }
  // pop: 흔적 없이 사라진다.
  return true;
}
