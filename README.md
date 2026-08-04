# Particle Sandbox

브라우저에서 돌아가는 파우더 토이류 샌드박스 게임. 그리드 위에 물질 파티클을 그려
낙하·확산·밀도 상호작용을 실험한다. 백엔드 없이 **정적 파일만** Cloudflare Workers
(Static Assets)에 배포한다.

UI는 **반응형**이다 — 데스크톱은 화면 왼쪽에 고정 사이드바, 모바일은 화면 아래 두 줄짜리
하단 바를 쓰고, 캔버스는 컨트롤 바를 뺀 나머지 공간을 채운다(사이드바·하단 바와 겹치지
않음). 아이콘은 Bootstrap Icons를 사용한다. 샌드박스는 그 캔버스에 **동적 화면비**로
꽉 차며(셀 크기 고정), 실제 시뮬레이션 공간은 경계 윤곽선으로 표시된다.

## 스택

- **Astro** (`output: 'static'`) — 순수 정적 산출물, 어댑터 없음
- **TypeScript** — 프레임워크 독립적인 시뮬레이션 엔진
- **Svelte** (Astro island) — 컨트롤 패널 UI만 하이드레이션
- **nanostores** — UI ↔ 엔진 프레임워크 중립 브리지
- **Canvas 2D** (Uint32 픽셀 버퍼) — 렌더링, `Renderer` 인터페이스로 교체 가능
- **Cloudflare Workers Static Assets** — `wrangler.toml`(assets-only), `main` 푸시 시 자동 배포

## 개발

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # → dist/ (정적 산출물)
npm run preview    # 빌드 결과 로컬 서빙
```

## 구조

```
src/
├─ pages/index.astro          # 전체 화면 캔버스 + 컨트롤 패널 마운트
├─ components/                # Svelte 아일랜드 (컨트롤 UI)
├─ state/store.ts             # nanostores — UI ⇄ 엔진 브리지
└─ game/                      # 프레임워크 독립 순수 TS 엔진
   ├─ Game.ts                 # 조립 + rAF 루프 (메인 스레드)
   ├─ engine/                 # Grid, Simulation, SimContext, behaviors
   ├─ materials/              # 물질 정의 (물질 추가 = 파일 하나)
   ├─ render/                 # Renderer 인터페이스 + CanvasRenderer
   └─ input/PointerPainter.ts # 마우스/터치 페인팅
```

## 물질 추가하기

1. `src/game/materials/` 에 파일 하나 생성:

   ```ts
   import { register } from './registry';
   import { Phase } from '../engine/types';
   import { rgb } from '../render/color';

   export const OIL = register({
     id: 4,
     name: 'Oil',
     phase: Phase.Liquid, // 기본 액체 거동 상속 (update 생략 가능)
     color: rgb(90, 70, 40),
     density: 2,
   });
   ```

2. `src/game/materials/index.ts` 에 import 한 줄과 `MATERIALS` 항목 추가.

팔레트 버튼은 `MATERIALS` 에서 자동 생성된다. 특수 거동이 필요하면 `update(x, y, sim)` 를
직접 작성한다.

### 물질 데이터 필드

`register({...})` 는 순수 데이터 태그로 대부분의 상호작용을 표현한다 — 로직이 아니라
플래그다:

- `flammable` — 불/용암이 접촉 시 점화 (전역 확률 패스).
- `combustible` — 연료. 공유 "표면 화염 전선" 모델로 서서히 탄다 (`combustion.ts`).
- `explosive` — 폭발물. Blast 파동이 이 셀을 *돌아가서* 연쇄 기폭이 가능하게 한다.
- `acidResistant` — 산이 부식하지 않음.
- `conductive` — 전기 도체. Spark 가 이 물질을 타고 전파된다 (금속·수은).
- `thermal: { init, conductivity }` — 온도장/열전도.
- `glow: { min, max, cool }` — 온도 → 색 그라데이션 (용암·용융물).
- `category` — 팔레트 탭 분류 (생략 시 `phase` 로 자동 유도). 시뮬레이션은 무시.

물리 거동 태그(기본 낙하/흐름 패스가 읽음):

- `viscosity` (0..1) — 액체 **점도**. 옆으로 퍼지는 레벨링만 억제하고 수직 낙하는 막지
  않는다 → 두꺼운 액체가 봉우리를 유지하며 천천히 흐른다 (꿀·진흙·슬라임).
- `friction` (0..1) — 가루 **마찰·안식각**. 대각 미끄럼만 억제 → 값이 클수록 더 가파른
  경사로 쌓인다 (물질별 산 경사 차등).
- `surfaceTension` (0..1) — 액체 **표면장력**. 이웃이 적은(가장자리) 셀만 같은-물질과
  더 많이 닿는 칸으로 끌려가 물방울이 뭉치고 얇은 막이 끊긴다 (수은 구슬).
- `elasticity` (0..1) — **탄성**(반발계수). 폭발/충격파에 날린 파편이 고체에 튕길 때
  남기는 속도 비율. 높으면 오래 통통 튄다 (슬라임). 비행 중일 때만 읽는다.

반응·수명 (데이터 선언):

- `life: { ticks, into? }` — **파티클 수명**. 매 틱 ≈1/ticks 확률로 `into`(기본 Empty)로
  붕괴. 연기가 쓰던 무기억 감쇠를 태그화 — `aux` 를 쓰지 않아 다른 상태와 충돌 없음.
- `reactions: [{ with, produce?, otherBecomes?, probability?, tempMin?, tempMax?, heat?,
  byproduct?, catalyst?, catalystFactor? }]` — **선언적 접촉 반응 테이블**
  (`engine/reactions.ts`). 매 틱 접촉 패스 한 번으로 단순 2체 치환을 처리한다. `heat` 로
  발열(>0)/흡열(<0), `probability` 로 확률 반응, `tempMin/Max` 로 온도 조건부, `catalyst`
  로 촉매(소모 안 됨, 반응률↑), `byproduct` 로 인접 빈칸에 가스 방출. 반응한 두 셀은
  즉시 `moved` 처리되어 이중 반응·스캔순서 폭주를 막는다 (flammable/conductive 태그와
  같은 규율). 복잡한 다단계 거동(폭발 survey, 분별증류)은 여전히 `update` 에 남긴다.

### 셀 상태 (`temp` / `aux`)

셀당 두 개의 상태 슬롯이 있어 상태 기계형 물질을 만들 수 있다:

- `temp` (Float32) — 온도. `conductivity: 0` 물질은 이 슬롯을 불투명 상태로 재사용한다
  (Blast 의 수명·방향, Ember 의 속도).
- `aux` (Uint8) — 정수 상태 바이트. 도체의 스파크 불응 카운트다운, Battery 펄스 주기,
  Clone 이 복제할 물질 id, Thermite 연소 타이머 등. `swap` 시 물질을 따라가고
  셀이 비워지면 초기화된다 (`temp` 과 동일 수명). 런타임 전용(비영속).

## 배포

`main` 브랜치에 푸시하면 Cloudflare Workers Builds가 `npm run build` 후
`dist/` 를 정적 자산으로 자동 배포한다. (`wrangler.toml` 의 `name` 은 연결된 Worker
이름과 일치해야 한다.)
