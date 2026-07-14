# 아키텍처 & 스택

브라우저에서 돌아가는 **파우더 토이류 파티클 샌드박스** 게임. 그리드 위에 물질 파티클을 그려 낙하·확산·밀도 상호작용을 실험한다. 백엔드 없이 정적 파일만 Cloudflare Workers(Static Assets)로 배포한다.

- 저장소: [eoeoe22/sandbox](https://github.com/eoeoe22/sandbox)
- 배포: Cloudflare Workers Builds (`main` 푸시 시 `npm run build` → `dist/` 자동 배포)
- PR 프리뷰: 열린 PR마다 `<branch>-sandbox.eoe253326.workers.dev` 프리뷰 URL이 자동 생성되어 PR 코멘트로 게시됨

## 개요

셀룰러 오토마타 기반 모래·물 시뮬레이터다. 물질은 각각 하나의 파일로 정의되며(`register({...})`), `update` 를 생략하면 phase(고체/가루/액체/기체)의 기본 거동을 자동 상속한다. 엔진은 프레임워크 독립적인 순수 TypeScript이고, UI만 Svelte 아일랜드로 하이드레이션한다.

## 스택

- **Astro** (`output: 'static'`) — 순수 정적 산출물, 어댑터 없음
- **TypeScript** — 프레임워크 독립 시뮬레이션 엔진
- **Svelte** (Astro island) — 컨트롤 패널 UI만 하이드레이션
- **nanostores** — UI ↔ 엔진 프레임워크 중립 브리지
- **Canvas 2D** (Uint32 픽셀 버퍼) — 렌더링, `Renderer` 인터페이스로 교체 가능
- **Cloudflare Workers Static Assets** — assets-only 배포

## 아키텍처

```
src/
├─ pages/index.astro          # 전체 화면 캔버스 + 컨트롤 패널 마운트
├─ components/                # Svelte 아일랜드 (컨트롤 UI)
├─ state/store.ts             # nanostores — UI ⇄ 엔진 브리지
└─ game/                      # 프레임워크 독립 순수 TS 엔진
   ├─ Game.ts                 # 조립 + rAF 루프 (메인 스레드)
   ├─ layout.ts               # 동적 화면비 → 그리드 해상도 계산
   ├─ engine/                 # Grid, Simulation, SimContext, behaviors
   ├─ materials/              # 물질 정의 (물질 추가 = 파일 하나)
   ├─ render/                 # Renderer 인터페이스 + CanvasRenderer
   └─ input/                  # PointerPainter(그리기+브러시 커서/휠), floatingOverlay(공용 오버레이 DOM 헬퍼)
```

시뮬레이션은 메인 스레드에서 고정 틱으로 스텝하고(기본 30Hz — 컨트롤 패널 속도 옵션 ×2로 60Hz 복원), 렌더링은 디스플레이 주사율로 매 프레임 수행한다. Grid + Simulation은 자족적이라 추후 Web Worker나 WASM 코어로 옮겨도 물질/UI 코드는 그대로다.

## 배포 및 PR 프리뷰

Cloudflare Workers Builds가 GitHub 저장소에 연결되어 있다.

- **`main` 브랜치**: push 시 `npm run build` → `wrangler deploy`로 프로덕션에 자동 배포.
- **PR 브랜치(non-production)**: PR에 push할 때마다 빌드가 트리거되며, `npx wrangler versions upload`로 프로덕션을 건드리지 않고 버전만 업로드해 프리뷰 URL을 생성한다.
- `wrangler.toml`의 `preview_urls = true`는 `[assets]` 테이블보다 위(루트 레벨)에 있어야 인식된다.
- PR 코멘트에 Commit Preview URL과 Branch Preview URL(브랜치 최신 커밋을 항상 가리키는 고정 링크)이 함께 게시된다.
