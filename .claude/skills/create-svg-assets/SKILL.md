---
name: create-svg-assets
description: 이 샌드박스 프로젝트의 픽셀아트 에셋(독립 오브젝트 스프라이트, 물질 팔레트 아이콘, 캔버스 안에 그려지는 장식)을 만들거나 고칠 때 쓴다. 색 포맷(packed 0xAABBGGRR), 저작 형식 3종(fillRect / ASCII 행 / 벡터 예외), 해상도·종횡비 법칙, 음영·실루엣 하우스 스타일, 팔레트 SVG 내보내기, 크기 예산. 손으로 그리는 물질 아이콘 SVG의 규격은 시스템 프롬프트에 그대로 붙여 넣도록 쓴 자체 완결 문서(MATERIAL-ICON-BRIEF.md)로 따로 빠져 있어, 저장소도 스크립트 실행도 없는 외부 채팅 AI에게 그 파일과 대상 물질·기본색만 넘기면 된다. "스프라이트 만들어줘", "오브젝트 아트", "물질 아이콘", "SVG 에셋" 같은 요청에서 파일을 열기 전에 읽을 것.
---

# 픽셀아트 · SVG 에셋 저작 지침

## 0. 먼저 — 어느 쪽 일인가

이 스킬은 성격이 다른 두 가지 일을 담고 있다. **자기가 어느 쪽인지 먼저 정하고
해당하는 곳만 읽는다.**

| 하려는 일 | 읽을 것 | 저장소 필요? |
|---|---|---|
| **물질 아이콘 SVG를 손으로 그린다** | **[MATERIAL-ICON-BRIEF.md](./MATERIAL-ICON-BRIEF.md)** + 발주받은 물질·기본색 | ❌ 불필요 |
| 들어온 손그림 SVG를 검수한다 | 이 파일 §7.2 | ✅ |
| 캔버스 안에 들어갈 오브젝트 스프라이트를 만든다 | 이 파일 §1~§6 | ✅ |
| 물질 아이콘 **생성기 코드**를 고친다 | 이 파일 §7 | ✅ |

**`MATERIAL-ICON-BRIEF.md`는 규격만 담은 자체 완결 문서다.** 작업 절차·파일 형식·
금지 목록·그리기 규격·점검표가 전부 그 안에 인라인돼 있다. 상정 소비자는 **저장소도
렌더링 도구도 없고 스크립트도 실행할 수 없는 채팅 AI**라, 그대로 시스템 프롬프트에
붙여 넣으면 된다. 들어온 결과물을 기계로 검수하는 스크립트는 발주자 쪽인 §7.2에 있다.

**단 "무엇을 그릴지"는 브리프에 없다.** 대상 물질과 그 기본색은 그때그때 달라지는
발주 내용이지 규격이 아니므로, 목록은 `docs/MATERIAL-ICONS.md` §7.1에 두고 작업을
맡길 때 함께 전달한다. 브리프 자체는 발주가 바뀌어도 손댈 일이 없다.

브리프를 고칠 때는 **자체 완결성을 유지해야 한다.** 새 규칙을 넣으면서 근거를
`CanvasRenderer.ts:912` 같은 참조로만 남기면 받는 쪽에서 확인할 방법이 없어진다.
**값은 브리프 안에 적고, 그 값이 어디서 왔는지는 이 파일 §7.1이 기억한다.**

---

이 프로젝트에는 **이미지 파일이 없다.** 모든 아트는 TypeScript 안에서 코드로
빌드되는 `Uint32Array` 픽셀 버퍼이고, 팔레트에 보이는 SVG는 그 버퍼에서
**생성**된다. 따라서 "에셋을 만든다"는 건 그림 파일을 넣는 게 아니라
`src/game/render/` 에 스프라이트 모듈을 하나 추가하는 일이다.

`temp/` 에 있는 `.svg`들(`wooden-crate.svg`, `piece1~3.svg`)은 디자인 핸드오프
원본일 뿐 **런타임에 절대 로드되지 않는다.** 유일하게 번들되는 `.svg` 파일은
`src/assets/favicon.svg` 하나다(`astro.config.mjs`가 `assetsInlineLimit: 0`이라
base64 인라인도 일어나지 않는다).

---

## 1. 색 포맷

- 모든 색은 **packed Uint32 `0xAABBGGRR`** (ImageData의 `Uint32Array` 뷰에
  한 번에 쓰기 위한 리틀엔디언 RGBA 바이트 순서).
- 만들 때는 항상 `rgb(r, g, b)` — `src/game/render/color.ts:6`.
- **`0` = 투명 센티넬.** `rgb()`가 알파를 항상 255로 채우므로 0은 실제 색과
  절대 충돌하지 않는다. 스프라이트 버퍼의 미기록 칸이 곧 투명이다.
- CSS로 뽑을 땐 `toCss(packed)` (`color.ts:11`), SVG `#rrggbb`로 뽑을 땐
  `objectSvg.ts:22`의 로컬 `hex()`.

색상 상수는 **모듈 안에 지역 상수로, 역할 주석과 함께** 선언한다. 공용 팔레트
모듈은 없고, 앞으로도 만들지 않는다 — 오브젝트마다 색 정체성이 다른 게 의도다.

```ts
/** Dark outline / plank seams (#2a1206). */
const DARK = rgb(0x2a, 0x12, 0x06);
/** Timber face (#ee9422). */
const TIMBER = rgb(0xee, 0x94, 0x22);
```

---

## 2. 저작 형식 — 셋 중 하나를 고른다

### 형식 A — `fillRect` 호출 목록 (기하학적 형태)

축에 정렬된 사각형 몇 개로 그려지는 물건. **색 4개 이하, 블록형**일 때.
표준 예시: `src/game/render/dynamiteSprite.ts`, `drumSprite.ts`,
`smokeBombSprite.ts`.

```ts
export const DRUM_SPRITE_W = 24;
export const DRUM_SPRITE_H = 32;

function buildSprite(body: number): Uint32Array {
  const buf = new Uint32Array(DRUM_SPRITE_W * DRUM_SPRITE_H); // 0 = transparent
  // 1. 검은 실루엣/아웃라인 + 밴딩 림 2개(좌우로 1px씩 넓다).
  fillRect(buf, 2, 0, 20, 9, BLACK);
  ...
  // 2. 몸통 색, 검정 안쪽으로 1px 인셋 — 아웃라인과 밴드가 보이도록.
  fillRect(buf, 3, 1, 18, 8, body);
  ...
}
```

**그리는 순서 자체가 스펙이다.** 나중에 그린 것이 앞을 덮으므로, 번호 주석
(`// 1.`, `// 2.`)으로 레이어 순서를 반드시 남긴다.

### 형식 B — ASCII 행 (그림다운 형태)

대각선·불규칙 실루엣이라 rect 목록이 읽을 수 없게 커질 때. 나무 상자가 이
판단의 선례다 — **rect로 쓰면 240개**라 아예 읽을 수 없는 반면, ASCII 행은
소스에서 판자 대각선과 밴딩이 눈으로 보인다(`woodenBoxSprite.ts:20-26`).
표준 예시: `src/game/render/woodenBoxSprite.ts:33-60`.

문자 범례를 정하고(관례: `'#'` 아웃라인 / `'o'` 몸통 / `'.'` 투명) 행 배열이
곧 그림이 되게 한다 — 소스에서 판자 대각선과 밴딩이 눈으로 보여야 한다.

```ts
const ART: Record<WoodBoxPart, readonly string[]> = {
  crate: [
    '########################',
    '#oooooooooooooooooooooo#',
    '########################',
    '#oo##ooo#ooo#ooo#ooo#oo#',
    ...
  ],
};
```

디코더는 `build()` 한 함수로 문자 → 색 매핑만 한다(`woodenBoxSprite.ts:147-162`).
**각 파트의 픽셀 박스를 행 배열에서 유도**하면 아트가 스프라이트와 물리 지오메트리
양쪽의 단일 진실 공급원이 된다.

### 형식 C — 벡터 예외 (드묾)

완전한 원처럼 픽셀 근사가 오히려 나빠 보이는 경우만. 고무공이 유일한 선례:
인월드는 절차적 디스크(`CanvasRenderer.rasterizeBall`), 팔레트는 진짜
`<circle>` (`objectSvg.ts:106-117`) — 그리고 **일부러 `shape-rendering`을 빼서**
매끈하게 둔다. 새로 쓰려면 근거를 주석에 남길 것.

---

## 3. 해상도와 종횡비 — 여기서 실수하면 물리가 어긋난다

- **셀당 스프라이트 픽셀 2개로 그린다.** `OBJECT_SCALE = 2`
  (`CanvasRenderer.ts:31`). 그 이상 해상도를 올려도 렌더러가 최근접 샘플로
  잘라내므로 얻는 게 없다. 24×32 드럼 = 12×16 셀.
- **종횡비는 물리 박스와 같아야 한다.** 캡슐 바디는
  `2·radius × 2·(halfLength + radius)` (`dynamiteSprite.ts:12-14`,
  `docs/OBJECTS.md:206`). 어긋나면 스프라이트가 충돌 형상 밖으로 삐져나오거나
  안쪽에서 뜬다.
- **사각형 물체는 반대로 간다** — 아트가 물리를 정의한다. 나무 상자는
  `WOOD_BOX_CELLS_PER_PX = 0.5`로 스프라이트 픽셀 박스에서 반경/반길이를
  유도한다(`engine/objects.ts:804-812`). 이쪽이 아트와 물리가 절대 어긋날 수
  없는 더 안전한 패턴이니, 새 사각형 오브젝트는 이걸 따를 것.
- **스프라이트 프레임**: 원점 좌상단, `angle = 0`이 그린 그대로의 정립 자세,
  긴 축은 로컬 **+y**. 화면 y가 아래로 증가하므로 양의 각속도가 시계방향이고
  적분기는 `angle -= ω·dt`를 한다(`docs/OBJECTS.md:26`).

---

## 4. 하우스 스타일 (음영·실루엣)

기존 다섯 오브젝트에서 실제로 뽑아낸 규칙이다. 새 아트는 이걸 따라야 나머지와
같은 게임에서 온 것처럼 보인다.

1. **색은 총 2~4개, 한 면에 톤 3개 이하.** 드럼 2색, 상자 2색, 다이너마이트
   4색+도화선 1색, 연막탄 4색, 공 2색.
2. **어두운 하드 실루엣은 필수.** 바깥 테두리를 먼저 어두운 색(대개 순검정)으로
   채우고 몸통 색을 **1px 안쪽으로 인셋**한다. 같은 색조의 지형 위에 놓였을 때
   형태가 읽히게 하는 유일한 장치다(`CanvasRenderer.ts:22-24`).
3. **부피감은 그라디언트가 아니라 밴드/솔기로.** 안티에일리어싱이 전혀 없는
   최근접 렌더러라 그라디언트는 밴딩으로 깨진다.
4. **하이라이트는 많아야 1px 열 하나, 광원은 좌상단.**
5. **모서리 둥글리기 = 모서리 픽셀을 투명으로 뚫기**
   (`dynamiteSprite.ts:37-40`). 별도 곡선 계산 없음.
6. **읽히는 게 고증을 이긴다.** 연막탄 링은 실제로 막힌 부분인데도 가운데를
   일부러 뚫어 놨다(`smokeBombSprite.ts:48-53`).
7. **몸통 색은 그 물건의 내용물을 흉내 낸다** — 빈 드럼 파랑, 원유 드럼 흑갈,
   산 드럼 독성 녹색(`docs/OBJECTS.md:39`).

### 절대 그리지 않는 것

- **불·연기·도화선 불꽃** — 전부 인월드의 진짜 CA 파티클이다
  (`dynamiteSprite.ts:8-10`, `smokeBombSprite.ts:17-19`). 스프라이트에 그리면
  물리와 그림이 어긋난다.
- **손상·그을림 변형 아트** — 지금 저장소에 단 하나도 없다. 상태 표현은 넷 중
  하나로 한다: (1) 공유 실루엣의 **색만 스왑**
  (`Record<DrumFill, …>` — 새 종류를 추가하면 컴파일 에러가 나므로 빠뜨릴 수
  없다, `drumSprite.ts:27-31`), (2) 파괴 시 **조각 바디 스폰**, (3) 진짜 파티클
  방출, (4) 절차적 장식 덧그리기(도화선 nub, `CanvasRenderer.ts:1746-1753`).

---

## 5. 팔레트용 SVG 내보내기

인월드 픽셀과 팔레트 칩이 **같은 데이터에서** 나와야 한다. 손으로 근사한
스와치를 따로 만들지 않는다.

`src/game/render/objectSvg.ts`의 두 헬퍼를 재사용한다:

- `spriteRects(buf, w, h, ox?, oy?)` (`:36-53`) — 같은 색의 가로 런을 `<rect>`
  하나로 병합. 드럼이 ~700개 대신 84개 rect가 되는 이유.
- `pixelSvg(vbW, vbH, inner)` (`:58-64`) — `viewBox="0 0 W H"`,
  `preserveAspectRatio="xMidYMid meet"`, `shape-rendering="crispEdges"`,
  `class="obj-svg"`로 감싼다.

결과 문자열은 **모듈 로드 시 한 번** 만들어 상수에 담는다
(`const OBJECT_SVG: Record<ObjectKind, string>`, `:121-129`). 소비 측은 Svelte
`{@html}`로 꽂는다(`MaterialPalette.svelte:508`) — 문자열이 전부 신뢰된 상수
스프라이트 데이터에서 나오므로 안전하고, 그 근거를 주석으로 남긴다.

파괴 조각처럼 팔레트에서 스폰할 수 없는 파트는 **프리뷰를 만들지 않는다**
(`objectSvg.ts:95-99`).

---

## 6. 크기 · 성능 예산

실측값(현재 저장소):

| 에셋 | rect 수 | 마크업 |
|---|---|---|
| 고무공(벡터 `<circle>`) | — | 240 B |
| 연막탄 | 61 | 3.6 KB |
| 드럼통 | 84 | 4.9 KB |
| 다이너마이트 | 85 | 4.9 KB |
| 나무 상자 | 240 | 13.7 KB |

- **런 병합 후 rect 240개가 현실적인 상한**이다(나무 상자). 그보다 커지면
  그림을 단순화한다.
- 스프라이트 버퍼와 SVG 문자열은 **모듈 로드 시 1회** 빌드하고 그 뒤로 재생성
  금지. 특히 Svelte 쪽에서 `$derived.by` 안에 넣으면 로케일이 바뀔 때마다 전부
  다시 만들어진다(`MaterialPalette.svelte:28-31, 68-77`).
- 회전 스프라이트는 공용 `rasterizeSprite`
  (`CanvasRenderer.ts:1643-1690`)를 쓴다 — 목적지 서브픽셀별 역매핑,
  최근접 `|0`, AA 0, 알파 블렌딩 0. **루프를 복사하지 말 것.**
- 오브젝트 오버레이 `ImageData`는 그리드 리사이즈 때만 할당되고
  (`:625-645`), 오브젝트가 없으면 패스 전체를 건너뛴다(`:1101`).
  `imageSmoothingEnabled = false`는 이미 세팅돼 있다(`:1093`).

---

## 7. 물질 팔레트 아이콘

### 7.0 먼저 — 대부분은 이미 자동 생성된다

`src/game/render/materialSvg.ts`가 `CanvasRenderer.render()`의 분기 사슬을 그대로
재생해 **팔레트 126종 중 99종의 아이콘을 만든다.** 손으로 그리기 전에 그 물질이
이미 패턴을 갖고 있는지 확인할 것 — 스페클·격자·셰브런·배터리 계단·열 램프·구름은
전부 생성물이고, 손으로 덧그리면 캔버스와 어긋난다.

손그림 대상은 **세 부류, 합쳐 31종**이다:

1. **인월드에서도 실제로 평면 한 색인 물질 27종** — 평면 고체 25 + 수은/액체 갈륨.
   생성기가 그릴 패턴 자체가 없다.
2. **정체성이 색도 질감도 아니라 개념인 물질** — 패턴이 이미 붙어 있어도 그 패턴이
   물질을 설명하지 못한다. 위 27종 중 7종(Clone·Void·Virus·Catalyst·Amber·
   Aerogel·Wall)이 여기 겹치고, 겹치지 않는 건 Fire(구름)·Antimatter(스페클)·
   Nanobot(스페클) 3종이다.
3. **생성 결과가 어색하다고 판정된 것 — 태양광 패널 하나.** 4×6 타일이 9셀 창에
   온전히 안 들어가 위아래 셀 높이가 어긋난다.

즉 27 + 3 + 1 = 31. 전수 분류는
[docs/MATERIAL-ICONS.md](../../../docs/MATERIAL-ICONS.md) §4, 대상 목록은 같은 문서 §7.1.

생성기를 고칠 때의 규칙(손그림이 아니라 코드를 건드릴 때):

- **캔버스와 같은 공식을 재생한다.** 진폭은 `varyAmplitude(m)`, 모드는
  `varyMode(m)`, 밝기 오프셋은 `d = ((src - 128) * amp) >> 7` 뒤 채널별 클램프.
  셰이딩 함수(`tinted` / `frosted` / `buildGlow` / `shade`)는 `render/color.ts`에
  있고 **렌더러와 아이콘이 같은 구현을 공유**한다 — 복사하지 말 것.
- **분기 순서가 곧 동작이다.** Fan은 `lattice`이면서 `windArrow`, Diamond는
  `lattice`이면서 `checker2x2`다. 먼저 걸리는 분기만 그리고, 그런 물질의
  `lattice`는 두 번째 톤을 공급할 뿐이다. 재정렬하면 전기 탭 절반이 조용히
  체커보드가 된다.
- **`Math.random()` 금지.** 캔버스의 틴트는 셀에 저장된 바이트라 아이콘이 읽을 수
  없다. `(id, x, y)`의 순수 해시로 합성한다.
- **패치 크기는 픽셀 정렬로 정한다.** 기본 9(18 CSS px에서 셀당 정확히 2 device px
  @DPR1 / 4 @DPR2), 기체만 18(1px / 2px). 12는 DPR 1에서 네 행마다 한 행이 날아간다.
- **`freeze` 서리는 재생하지 않는다.** 팔레트는 따뜻한 상태만 보여준다.
- 검증은 `npm run test:materialicons`.

### 7.1 손그림 SVG — 규격은 브리프에 있고, 근거는 여기 있다

손으로 그리는 쪽의 규격은 **[MATERIAL-ICON-BRIEF.md](./MATERIAL-ICON-BRIEF.md)**
에 통째로 들어 있다. 여기서 요약을 다시 적지 않는다 — 두 벌이 되면 갈라지고, 갈라진
쪽을 하필 외부 작업자가 받게 된다. 브리프가 단일 진실 공급원이다.

**브리프는 시스템 프롬프트에 붙여 넣는 용도로 쓰여 있다.** 상정하는 소비자는
저장소도 렌더링 도구도 없고 **스크립트도 실행할 수 없는** 채팅 인터페이스의 AI다.
그래서 브리프에는 검증 스크립트가 없고, 대신 **ASCII 격자를 먼저 그리고 그걸 세어서
점검한 뒤 rect로 옮기는 절차**가 들어 있다 — 결과물을 볼 수 없는 작업자에게 눈을
대신 쥐여 주는 장치다. 브리프를 고칠 때 "돌려 보면 된다"류의 문장을 넣지 말 것.

**대상 물질과 기본색은 브리프에 없다** — 발주마다 달라지는 값이라 규격 문서에 두지
않는다. 목록은 `docs/MATERIAL-ICONS.md` §7.1에 있고, 작업을 맡길 때 브리프와 함께
전달한다.

이 파일이 기억하는 건 **브리프의 값들이 어디서 온 것인지**다. 브리프를 고칠 일이
생기면 여기서 근거를 확인하고, 확인한 값을 브리프 안에 적는다:

| 브리프의 규칙 | 근거 |
|---|---|
| `viewBox="0 0 24 24"` 정사각 | 물질 스와치 CSS 박스가 정사각 18×18 (`MaterialPalette.svelte`의 `.chip .swatch`) |
| 표시 크기 18 CSS px, 최소 두께 2유닛 | 같은 곳. 24→18은 0.75배라 1유닛이 소실될 수 있다 |
| 투명 금지 | `.swatch.mat`가 테두리 있는 채워진 타일이고, 칩 배경이 선택 시 `#1b1b22`→`#232b3a`로 바뀐다 |
| `id`/`<defs>`/`url(#…)`/`<style>` 금지 | 마크업이 `{@html}`로 인라인되고 같은 문자열이 한 문서에 여러 벌 존재한다 |
| 칩 배경 `#1b1b22` / 선택 `#232b3a` / 테두리 흰색 15% | `MaterialPalette.svelte` 스타일 블록 |
| 캔버스 바탕 `#101016` | `materials/empty.ts`의 `rgb(16, 16, 22)` |
| 요소는 `<svg>`/`<rect>`뿐, 속성은 x/y/width/height/fill 로 고정, 값은 큰따옴표 | 소비 측 파서가 그 형태만 읽는다. §7.2의 검수 스크립트도 금지 목록이 아니라 **허용 목록**으로 짜야 `<circle>`처럼 빠뜨린 요소가 새지 않는다 |
| rect 100개 / 8 KB 상한 | 오브젝트 스프라이트 실측 상한(나무 상자 240 rect / 14 KB)보다 아래로 잡되, **바이트 쪽이 rect 쪽보다 먼저 걸리지 않게** — rect 한 줄이 실측 약 63 B라 100개면 최대 6.3 KB다. 예전엔 200 rect / 6 KB로 둘이 서로 모순됐다 |

### 7.2 납품 검수 — 받는 쪽에서 돌리는 스크립트

브리프에는 없다(작업자가 실행할 수 없으므로). **발주자인 우리가** 들어온 `.svg`를
받을 때 이걸 돌린다. 규격 위반·빈 칸·영역 이탈·용량 초과를 잡는다(Node, 의존성 없음).

```js
// node check.mjs foo.svg
import { readFileSync } from 'node:fs';
const raw = readFileSync(process.argv[2], 'utf8');
// 주석은 규격상 금지다. 지우고 넘어가면 규칙이 영영 강제되지 않고, 주석 처리된
// rect가 커버리지에 세어져 진짜 빈 칸을 가릴 수도 있으므로 여기서 반려한다.
if (/<!--/.test(raw)) throw new Error('주석 금지');
const bad = /\bid=|\bclass=|\bstyle=|url\(|opacity|stroke|fill="none"|<\?xml|<!DOCTYPE/i.exec(raw);
if (bad) throw new Error('금지 요소: ' + bad[0]);
// 루트를 통째로 떼어내고 그 **안쪽만** 검사한다. 문자열 전체를 훑으면
// </svg> 뒤에 붙은 rect나, 자기닫힌 루트 옆에 나란히 놓인 rect까지 칠해진
// 것으로 세어진다 — 둘 다 인라인 삽입 시 실제로는 아무것도 그리지 않는다.
const root = /^\s*(<svg\b[^>]*>)([\s\S]*)<\/svg>\s*$/.exec(raw);
if (!root) throw new Error('루트가 <svg>…</svg> 하나로 감싸여 있지 않음');
if (root[1].endsWith('/>')) throw new Error('루트 <svg>가 자기닫혀 있음 — 내용이 밖에 있다');
if (!/viewBox="0 0 24 24"/.test(root[1])) throw new Error('viewBox가 0 0 24 24 가 아님');
const s = root[2];
// 루트 안에는 <rect>만. 허용 목록이라 <circle>·<path>는 물론 중첩 <svg>(자체
// viewBox로 배율이 바뀐다)와 자기닫는 <g/>도 같이 걸린다.
for (const t of s.matchAll(/<\/?([a-zA-Z][\w:-]*)/g))
  if (t[1] !== 'rect') throw new Error('허용되지 않은 요소: <' + t[1] + '>');
const cells = new Set();
const painted = new Set();
const colors = new Set();
let rects = 0;
let overlap = 0;
for (const m of s.matchAll(/<rect\s+([^>]*?)\s*\/>/g)) {
  rects++;
  const a = {};
  // 중복 속성은 조용히 덮어쓰면 안 된다 — 브라우저는 첫 값을 쓰고 뒤를 버리는데,
  // 마지막 값만 남기면 검사기가 실제로 그려지는 색과 다른 색을 보게 된다.
  for (const [, k, v] of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    if (k in a) throw new Error(`속성 ${k} 중복 — 브라우저는 첫 값만 쓴다: ` + m[0]);
    a[k] = v;
  }
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'fill,height,width,x,y')
    throw new Error('rect 속성이 x/y/width/height/fill 이 아님(값은 큰따옴표로): ' + m[0]);
  if (!/^#[0-9a-f]{6}$/.test(a.fill)) throw new Error('fill 형식 오류: ' + a.fill);
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(a[k]));
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0)
    throw new Error('좌표/크기 오류: ' + m[0]);
  if (x + w > 24 || y + h > 24) throw new Error('타일 밖으로 나감: ' + m[0]);
  // 총 도포량이 576이어도 배경 rect 없이 조각을 이어 붙인 것일 수 있다. 규격은
  // 맨 앞 한 장이 타일 전체를 덮을 것을 요구하므로 그것부터 본다.
  if (rects === 1 && !(x === 0 && y === 0 && w === 24 && h === 24))
    throw new Error('첫 rect가 24×24 배경이 아님: ' + m[0]);
  colors.add(a.fill);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.add(j * 24 + i);
  // 배경 rect를 뺀 실제 도포 면적. Set이라 겹쳐도 중복으로 세지 않는다.
  if (rects > 1)
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        if (painted.has(j * 24 + i)) overlap++;
        painted.add(j * 24 + i);
      }
}
if (rects !== (s.match(/<rect/g) || []).length) throw new Error('형식에 안 맞는 rect가 있음');
if (cells.size !== 576) throw new Error(`빈 칸 ${576 - cells.size}개 — 배경 rect 누락?`);
if (painted.size > 230) throw new Error(`기본색 ${576 - painted.size}칸 — 346칸(60%) 미만`);
if (rects > 100) throw new Error('rect ' + rects + '개 — 100 초과');
if (colors.size > 5) throw new Error('색 ' + colors.size + '개 — 5 초과');
// 8 KB. rect 상한 100개가 실제로 구속하는 규칙이 되도록 그 위에 둔다 — 한 줄이
// 실측 약 63 B라 6 KB로 두면 브리프의 규칙을 다 지킨 100 rect 파일이 바이트로
// 거절될 수 있고, 작성자는 그 이유를 알 방법이 없다.
if (raw.length > 8192) throw new Error(raw.length + ' B — 8 KB 초과');
console.log(`OK — rect ${rects}개, 색 ${colors.size}개, 기본색 ${((576 - painted.size) / 5.76).toFixed(0)}%, ${raw.length} B`);
// 겹침은 반려 사유가 아니다(화면에는 제대로 나온다). 다만 작업자가 브리프의
// 격자 절차를 따르지 않았다는 신호라, 나머지도 눈으로 더 봐야 한다는 뜻이다.
if (overlap) console.warn(`주의 — rect가 ${overlap}칸 겹침. 격자 절차를 안 거쳤을 수 있음`);
```

스크립트가 잡지 못하는 것 — **눈으로 봐야 한다**: 18px 축소 후 판독성, 광원 방향,
최소 두께 2칸, 그린 것이 실제로 그 물질로 보이는지. 축소 판독성은 24×24 격자를
0.75배 박스 평균으로 눌러 ASCII로 찍어 보면 상당 부분 미리 알 수 있고, 최종 확인은
브랜치 프리뷰에서 유저에게 요청한다(CLAUDE.md — 브라우저 테스트는 직접 하지 않는다).

### 7.3 돋보기 11×11은 제외

`InspectPanel`의 11px 스와치는 **의도적으로 단색을 유지한다.** 18px에서 읽히는
패턴이 11px에서는 진흙이 되고, 그 행에는 물질 이름이 이미 나란히 붙어 있어
스와치가 식별을 떠맡지 않는다. 여기에 패턴을 넣지 말 것.

---

## 8. 새 에셋 완료 체크리스트

- [ ] 형식 A/B/C 중 하나를 골랐고, 고른 이유가 파일 상단 주석에 있다
- [ ] 색 상수 2~4개, 각각 역할 주석 + `#rrggbb` 병기
- [ ] 어두운 실루엣 먼저, 몸통 1px 인셋
- [ ] 그리는 순서에 번호 주석
- [ ] 셀당 2px, 종횡비가 물리 박스와 일치(또는 아트가 물리를 유도)
- [ ] 불/연기/손상은 그리지 않았다
- [ ] `W`/`H` 상수와 프리빌드 버퍼를 export, 모듈 로드 시 1회 빌드
- [ ] 팔레트 프리뷰가 필요하면 `spriteRects` + `pixelSvg`로 같은 데이터에서 생성
- [ ] rect 수가 240 이하
- [ ] `npm run check` 통과 (`Record<...>` 누락은 여기서만 잡힌다)
- [ ] 브라우저 확인은 **직접 하지 않고 유저에게 요청** (CLAUDE.md)

물질 손그림 아이콘이면 위 목록 대신
**[MATERIAL-ICON-BRIEF.md](./MATERIAL-ICON-BRIEF.md) §5의 점검표**를 쓴다. 그 점검표는
**눈으로 읽어서 확인하는 항목만** 담고 있다(브리프의 독자는 스크립트를 못 돌린다).
저장소 쪽에서 추가로 볼 것:

- [ ] 자동 생성이 이미 그 물질을 처리하고 있지 않은지 확인했다 (§7.0)
- [ ] **§7.2의 검수 스크립트를 돌렸다** — 브리프에는 없으므로 여기서 반드시 돌린다
- [ ] 배선 후 `npm run test:materialicons` 통과

## 9. 읽을 파일

| 파일 | 무엇의 표준인가 |
|---|---|
| `src/game/render/dynamiteSprite.ts` | 형식 A(fillRect)의 최단 예시 |
| `src/game/render/woodenBoxSprite.ts` | 형식 B(ASCII 행) + 아트가 물리를 유도 |
| `src/game/render/drumSprite.ts` | 공유 실루엣 + 색 스왑 변형 |
| `src/game/render/smokeBombSprite.ts` | 그리기 순서, 읽힘 우선 결정 |
| `src/game/render/objectSvg.ts` | 오브젝트 팔레트 프리뷰 |
| `src/game/render/spriteSvg.ts` | 공유 SVG 내보내기(`spriteRects`/`spritePaths`/`pixelSvg`) |
| `src/game/render/materialSvg.ts` | 물질 아이콘 생성기 — 분기 사슬 재생의 표준 |
| `src/game/render/color.ts` | `rgb()` / `toCss()` / `hex()` + 공유 셰이딩 |
| `src/game/tint.ts` | 물질 질감 공식의 단일 진실 공급원 |
| `docs/OBJECTS.md` | 오브젝트 레이어 전체 설계 기록 |
| `docs/MATERIAL-ICONS.md` | 물질 아이콘 전체 설계·분류·손그림 대상 |
| `./MATERIAL-ICON-BRIEF.md` | **자체 완결** 손그림 규격 — 외부 AI 시스템 프롬프트에 그대로 붙여 넣는다 |
| `temp/*.svg` | 디자인 핸드오프 원본(런타임 미사용) |
