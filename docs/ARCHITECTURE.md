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
├─ pages/
│  ├─ index.astro             # 시작 페이지 (Homepage/Landing Page, 동적 배경 히어로, 프리셋 갤러리)
│  ├─ sandbox.astro           # 메인 시뮬레이션 캔버스 페이지 (?preset=, ?slot= 로드 지원)
│  └─ guide.astro             # 물질 & 물리학 도감 페이지
├─ components/                # Svelte 아일랜드 (컨트롤 UI, 히어로 백그라운드, 프리셋 갤러리 등)
├─ state/store.ts             # nanostores — UI ⇄ 엔진 브리지
└─ game/                      # 프레임워크 독립 순수 TS 엔진
   ├─ Game.ts                 # 조립 + rAF 루프 (메인 스레드, URL 파라미터 로딩)
   ├─ presets/                # 5종 샌드박스 템플릿 맵 (volcano, blast_furnace, circuit, refinery, ecosystem)
   ├─ layout.ts               # 동적 화면비 → 그리드 해상도 계산
   ├─ engine/                 # Grid, Simulation, SimContext, behaviors
   ├─ materials/              # 물질 정의 (물질 추가 = 파일 하나)
   ├─ render/                 # Renderer 인터페이스 + CanvasRenderer
   └─ input/                  # PointerPainter(그리기+브러시 커서/휠), floatingOverlay(공용 오버레이 DOM 헬퍼)
```

시뮬레이션은 메인 스레드에서 고정 틱으로 스텝하고(기본 30Hz — 컨트롤 패널 속도 옵션 ×2로 60Hz 복원), 렌더링은 디스플레이 주사율로 매 프레임 수행한다. Grid + Simulation은 자족적이라 추후 Web Worker나 WASM 코어로 옮겨도 물질/UI 코드는 그대로다.

### 셀당 상태 레이어 (Grid의 평행 TypedArray들)

`Grid`는 셀 하나를 객체가 아니라 **인덱스를 공유하는 여러 평행 배열**로 표현한다. 주요
레이어와 폭:

| 배열 | 형 | 용도 |
|---|---|---|
| `cells` | `Uint8Array` | 물질 id (그래서 물질 id는 최대 255종) |
| `temp` | `Float32Array` | 셀 온도(열전도 시스템) |
| `aux` | **`Uint16Array`** | 물질이 사적으로 해석하는 상태 워드 |
| `overlay` / `overlayAux` | `Uint8Array` / **`Uint16Array`** | 겹침(소킹) 유체 id + 그 유체의 aux |
| `tint` / `bgTint` | `Uint8Array` | 순수 표현용(비영속) |

**`aux`가 16비트인 이유** — 대부분의 물질은 작은 카운트다운 하나만 쓰지만, **한 셀에
여러 필드를 패킹하는** 물질에서 8비트가 병목이었다. `spark.ts`가 대표적으로 도체
클래스와 펄스 강도를 한 바이트에 나눠 담아, 도체를 하나 추가할 때마다 전기의 전달거리가
반토막나는 제로섬 트레이드가 생겼다. 셀당 1바이트(기본 보드 약 143KB)를 더 써서 두 필드에
각각 한 바이트를 준 결과 그 트레이드가 사라졌다 — 자세한 내용과 저장 포맷 하위호환은
`PHYSICS.md`의 "aux 16비트 확장" 참고. 단, `Clone`/`Debris`/`Blast`/`Heat Ray`처럼
**물질 id를 aux에 담는** 쪽은 여전히 0..255를 쓴다(렌더러의 `renderAsAux` 경로가 그
가정 위에 있다).

## 배포 및 PR 프리뷰

Cloudflare Workers Builds가 GitHub 저장소에 연결되어 있다.

- **`main` 브랜치**: push 시 `npm run build` → `wrangler deploy`로 프로덕션에 자동 배포.
- **PR 브랜치(non-production)**: PR에 push할 때마다 빌드가 트리거되며, `npx wrangler versions upload`로 프로덕션을 건드리지 않고 버전만 업로드해 프리뷰 URL을 생성한다.
- `wrangler.toml`의 `preview_urls = true`는 `[assets]` 테이블보다 위(루트 레벨)에 있어야 인식된다.
- PR 코멘트에 Commit Preview URL과 Branch Preview URL(브랜치 최신 커밋을 항상 가리키는 고정 링크)이 함께 게시된다.

## 정적 파일 해시 & 빌드 난독화

`astro.config.mjs`의 `vite` 설정에서 배포되는 모든 정적 파일(JS/CSS/WASM/이미지)이
`원래이름-해시.확장자` 형식으로 나온다. Astro 7 + Vite 8은 내부적으로 Rollup 대신
**Rolldown**을 쓰기 때문에, 파일명 패턴은 `build.rollupOptions`가 아니라
`build.rolldownOptions.output` / `environments.client.build.rolldownOptions.output`
쪽에서 지정해야 적용된다(클라이언트 번들과 SSR/프리렌더 번들이 서로 다른 environment라
양쪽 다 필요).

- `assetsInlineLimit: 0` — 작은 파일(예: `favicon.svg`)도 base64 data URI로 인라인되지
  않고 항상 별도의 해시 파일로 나오도록 강제. 인라인되면 파일이 바뀌어도 HTML을
  다시 받기 전엔 캐시가 갱신되지 않는 경우가 생길 수 있어서, 파일명 해시 방식으로
  일관되게 캐시 무효화가 되도록 통일했다.
- 정적 아이콘(`favicon.svg`)은 `public/`이 아니라 `src/assets/`에 두고
  `import faviconUrl from '../assets/favicon.svg?url'`로 불러온다. `public/`
  폴더의 파일은 Vite 처리 없이 그대로 복사되어 해시가 붙지 않기 때문
  (`heat.wasm`이 이미 `?url` 임포트로 해시되는 것과 동일한 패턴).
  반대로 PWA 매니페스트/아이콘/서비스 워커(`public/manifest.webmanifest`,
  `public/icons/`, `public/sw.js`)는 브라우저가 고정 URL로 참조해야 해서
  오히려 해시가 붙으면 안 되는 케이스라 `public/`에 둔다 — 자세한 캐싱 전략은
  [PWA.md](./PWA.md).
- `build.minify: 'terser'`로 esbuild 기본 minify 대신 Terser를 사용해 변수명을
  더 짧게 뭉개고(`mangle.toplevel`), `console`/`debugger` 호출을 제거하고
  (`compress.drop_console`/`drop_debugger`), 주석을 모두 제거한다
  (`format.comments: false`). 코드 흐름 난독화(control-flow flattening,
  문자열 암호화 등)는 하지 않았다 — 시뮬레이션 루프 성능에 영향을 줄 수 있는
  별도 obfuscator 플러그인 없이, 표준 minifier 선에서 가독성만 낮추는 선택.
