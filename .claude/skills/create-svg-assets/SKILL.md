---
name: create-svg-assets
description: 이 샌드박스 프로젝트의 픽셀아트 에셋(독립 오브젝트 스프라이트, 물질 팔레트 아이콘, 캔버스 안에 그려지는 장식)을 만들거나 고칠 때 쓴다. 색 포맷(packed 0xAABBGGRR), 저작 형식 3종(fillRect / ASCII 행 / 벡터 예외), 해상도·종횡비 법칙, 음영·실루엣 하우스 스타일, 팔레트 SVG 내보내기, 크기 예산까지의 지침. "스프라이트 만들어줘", "오브젝트 아트", "물질 아이콘", "SVG 에셋" 같은 요청에서 파일을 열기 전에 읽을 것.
---

# 픽셀아트 · SVG 에셋 저작 지침

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

## 7. 물질 팔레트 아이콘에만 적용되는 추가 규칙

오브젝트가 아니라 **물질** 아이콘을 만들 때는 위 규칙에 더해:

- **캔버스와 같은 공식을 재생한다.** 물질의 인게임 질감은 전부
  `src/game/tint.ts` + `CanvasRenderer`의 분기 사슬에서 나온다. 아이콘이 눈대중
  근사를 하면 팔레트와 캔버스가 따로 논다. 진폭은 `varyAmplitude(m)`,
  모드는 `varyMode(m)`, 밝기 오프셋은 `d = ((src - 128) * amp) >> 7` 뒤
  채널별 클램프(`CanvasRenderer.ts:928-935, 553`).
- **`Math.random()` 금지.** 캔버스의 틴트는 셀에 저장된 바이트라 아이콘이
  읽을 수 없다. 대신 `(id, x, y)`의 **순수 해시**로 0..255를 합성해 같은 공식에
  넣는다. 랜덤을 쓰면 같은 물질 칩이 플라이아웃과 검색 결과에서 다르게 보인다.
- **읽히는 크기가 셋이다**: 팔레트 스와치 18×18, 피커 트리거 16×16, 돋보기
  11×11 CSS px. 11px에서 진흙이 되는 패턴은 실패다. 타일 주기는 아이콘 한 변에
  최소 2회는 반복돼야 한다.
- **엔진이 이미 그리는 타일 패턴은 1:1로 재생**한다. 눈대중 금지:
  `lattice` = `(x^y)&1`, `checker2x2` = `((x>>1)^(y>>1))&1`,
  `batteryPattern` = 4×5 타일 계단
  (`px===1&&(py===1||py===2) || px===2&&(py===2||py===3)`, 패턴 픽셀은
  하드 블랙 `0xff000000`), `solarPattern` = `x%4===3 || y%6===5`.
  ⚠️ `types.ts`의 `batteryPattern` 주석은 "14x14"라고 적혀 있지만 **문서 버그**다;
  렌더러 구현(`CanvasRenderer.ts:899-910`)이 정답이다.
- **`glow` 물질**은 base color 하나로는 정체가 드러나지 않는다.
  `shade()`가 `cool → color`로 보간하는 램프 자체를 아이콘에 보여준다
  (`CanvasRenderer.ts:585`, `buildGlow` `:568`).
- **`freeze` 서리 상태는 아이콘에서 무시**하고(팔레트는 따뜻한 상태만 보여준다)
  그 생략을 문서에 적는다. 13종이 해당된다.
- 배경(빈 칸) 색은 `rgb(16, 16, 22)` (`materials/empty.ts:11`) — 어두운 물질
  아이콘의 대비를 볼 때 이 색을 기준으로 판단한다.

세부 설계와 물질별 분류는 **[docs/MATERIAL-ICONS.md](../../../docs/MATERIAL-ICONS.md)** 참고.

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

## 9. 읽을 파일

| 파일 | 무엇의 표준인가 |
|---|---|
| `src/game/render/dynamiteSprite.ts` | 형식 A(fillRect)의 최단 예시 |
| `src/game/render/woodenBoxSprite.ts` | 형식 B(ASCII 행) + 아트가 물리를 유도 |
| `src/game/render/drumSprite.ts` | 공유 실루엣 + 색 스왑 변형 |
| `src/game/render/smokeBombSprite.ts` | 그리기 순서, 읽힘 우선 결정 |
| `src/game/render/objectSvg.ts` | 팔레트 SVG 생성(`spriteRects`/`pixelSvg`) |
| `src/game/render/color.ts` | `rgb()` / `toCss()` |
| `src/game/tint.ts` | 물질 질감 공식의 단일 진실 공급원 |
| `docs/OBJECTS.md` | 오브젝트 레이어 전체 설계 기록 |
| `temp/*.svg` | 디자인 핸드오프 원본(런타임 미사용) |
