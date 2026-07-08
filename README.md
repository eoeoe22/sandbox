# Particle Sandbox

브라우저에서 돌아가는 파우더 토이류 샌드박스 게임. 그리드 위에 물질 파티클을 그려
낙하·확산·밀도 상호작용을 실험한다. 백엔드 없이 **정적 파일만** Cloudflare Workers
(Static Assets)에 배포한다.

샌드박스는 **동적 화면비**를 쓴다 — 기본적으로 기기 화면비에 맞춰 화면을 꽉 채우고
(셀 크기 고정), 우상단 핸들을 드래그하면 크기·화면비를 따로 조절할 수 있다(더블클릭 또는
"기기에 맞춤"으로 초기화). 실제 시뮬레이션 공간은 경계 윤곽선으로 표시된다.

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

## 배포

`main` 브랜치에 푸시하면 Cloudflare Workers Builds가 `npm run build` 후
`dist/` 를 정적 자산으로 자동 배포한다. (`wrangler.toml` 의 `name` 은 연결된 Worker
이름과 일치해야 한다.)
