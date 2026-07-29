# 물질 아이콘 · 패턴 (계획)

> **상태: 설계 단계.** 아직 구현된 코드는 없다. 이 문서는 전체 물질에 아이콘/패턴을
> 입히는 작업의 설계·분류·순서를 확정해 두는 곳이고, 구현이 끝나면 실측치와 결정
> 사항으로 갱신한다. 에셋 저작 지침은
> [`.claude/skills/create-svg-assets/SKILL.md`](../.claude/skills/create-svg-assets/SKILL.md).

## 0. 문제

오브젝트는 팔레트 칩이 **인월드 스프라이트 그대로**라 직관적이다
(`objectSvgFor` → `MaterialPalette.svelte`). 반면 이 게임의 주 구성요소인 물질은
**전부 18×18 단색 사각형**이다 — 실제 캔버스에서는 모래가 알갱이마다 밝기가 다르고,
메시는 격자로 짜여 있고, 컨베이어는 화살표가 흐르고, 용암은 온도로 달아오르는데,
팔레트에서는 그 정보가 하나도 보이지 않는다.

이미 렌더러가 물질별로 **9가지 질감·패턴 계통**을 그리고 있다. 새 아트를 지어내는
게 아니라 **이미 그리고 있는 것을 아이콘에 되비추는 것**이 이 작업의 본체다.

## 1. 원칙

1. **아이콘은 캔버스의 축소판이다.** 눈대중 근사 금지 — 렌더러가 쓰는 공식과
   타일 수식을 그대로 재생한다.
2. **자동 유도가 기본, 전용 아트는 예외.** 물질 파일에 아무것도 안 써도
   `phase` / `colorVary` / 패턴 플래그만으로 올바른 아이콘이 나와야 한다.
   전용 SVG는 "정체성이 색이 아니라 개념인" 소수에만.
3. **결정론.** 아이콘 생성에 `Math.random()` 금지. 같은 물질 칩이 플라이아웃과
   검색 결과에서 달라 보이면 안 된다.
4. **세 크기에서 읽혀야 한다**: 팔레트 스와치 18×18, 피커 트리거 16×16,
   돋보기 11×11 CSS px.

## 2. 현재 구조 (구현 전 기준선)

### 2.1 스와치가 그려지는 곳 — 전부 인라인 단색

| 위치 | 파일 | 박스 |
|---|---|---|
| 카테고리 플라이아웃 칩 | `components/MaterialPalette.svelte` | 18×18 |
| `starChip` 스니펫(즐겨찾기·검색 결과) | `components/MaterialPalette.svelte` | 18×18 |
| 블렌드 브러시 피커 트리거 | `components/MaterialPicker.svelte` | 16×16 |
| 블렌드 브러시 칩 | `components/MaterialPicker.svelte` | 18×18 |
| 돋보기 결과 행 | `components/InspectPanel.svelte` | 11×11 |
| 블렌드 비율 바(색만 사용) | `components/BlendBrush.svelte` | — |

전부 `style={\`background:${toCss(m.color)}\`}` 한 줄이다. `MaterialPicker`의
`.swatch` CSS 규칙은 `MaterialPalette`의 것과 **중복 정의**돼 있다.

### 2.2 캔버스가 실제로 그리는 것

`CanvasRenderer.render()`의 배타적 분기 사슬(순서 그대로):

```
heat-overlay 우회 → renderAsAux → auxPalette → tintPalette → arrow → windArrow
→ triArrow → coilPattern → stripePattern → solarPattern → checker2x2 → lattice
→ batteryPattern → glow → freeze 서리 → 기본색 → wind streak 덮어쓰기 → 겹침 습윤 블렌드
```

아이콘이 재생해야 할 수식:

| 계통 | 수식 |
|---|---|
| 밝기 틴트 | `d = ((src - 128) * amp) >> 7`, 채널별 가산 후 클램프 |
| 진폭 `amp` | `colorVary ?? (glow ? 0 : petroleum ? 7 : Powder ? 18 : Liquid ? 22 : 0)` |
| `lattice` | `(x ^ y) & 1` |
| `checker2x2` | `((x >> 1) ^ (y >> 1)) & 1` + 틴트 |
| `batteryPattern` | 4×5 타일: `px===1&&(py===1\|\|py===2) \|\| px===2&&(py===2\|\|py===3)`, 패턴 픽셀 `0xff000000` |
| `solarPattern` | `x % 4 === 3 \|\| y % 6 === 5` |
| `arrow` | 주기 4 텐트 `fold = y&2 ? 3-(y&3) : y&3` |
| `glow` | `shade()`가 `cool → color`로 선형 보간 |
| `freeze` 서리 | base와 `rgb(210,232,248)`를 45:55 |

> ⚠️ `types.ts`의 `batteryPattern` 주석은 "fixed 14x14"라고 적혀 있으나 구현은
> **4×5 타일**이다. 이 작업 중에 주석을 고칠 것.
>
> ⚠️ `types.ts`의 `colorVary` 주석은 "가루는 움직일 때만 틴트를 다시 굴린다"고
> 하지만, `tint.ts`와 `SimContext.swap()`에 따르면 틴트 바이트는 **생성 시 한 번
> 심기고 알갱이를 따라다닐 뿐 재추첨되지 않는다.** `tint.ts` 쪽이 맞다.

### 2.3 틴트 필드는 아이콘이 읽을 수 없다

- 가루/고체: `Grid.tint` — 셀당 1바이트, 파티클 생성 시 한 번 심고 이동 시 따라감.
- 액체: `Grid.bgTint` — 위치 기반 필드, 매 틱 1/8씩 OU 드리프트.

둘 다 **월드 상태**라 팔레트에서 접근할 수 없다. 따라서 아이콘은
`(id, x, y)`의 **순수 해시**로 0..255를 합성해 같은 공식에 넣는다. 캔버스와 픽셀
단위로 같지는 않지만 **통계적으로 같은 질감**이 나오고, 결정론이 보장된다.

## 3. 채택 방향

**Seam 1 — `materialSvgFor(m: Material): string`** — `objectSvgFor`의 구조를 그대로
미러링한다. 이미 출하되어 리뷰까지 통과한 선례라서 위험이 가장 낮다.

- 새 파일 `src/game/render/materialSvg.ts`.
- `objectSvg.ts`의 `spriteRects`(런 병합) / `pixelSvg`(crispEdges 래퍼)를 재사용
  — 두 헬퍼를 공유 위치로 export 한다.
- 8×8 또는 12×12 `Uint32Array` 패치를 렌더러 분기 로직으로 채운 뒤 `<rect>`로
  런 병합. 8×8이면 병합 후 rect 40개 내외 — 오브젝트 예산(상한 240) 대비 여유.
- **모듈 스코프에서 `Map<MatId, string>`으로 메모**한다. `MaterialPalette`의
  `categories`/`matches`는 `$derived.by`라 **로케일이 바뀔 때마다 재실행**되므로,
  컴포넌트 안에서 계산하면 126개가 매번 다시 만들어진다.
- 소비 측: 위 표의 5개 지점을 `{@html materialSvgFor(m)}`로 교체하고
  `.swatch.obj` 옆에 `.swatch.mat` 규칙을 추가. `MaterialPicker`의 중복 CSS는
  이때 정리한다.

**선행 리팩터**: `CanvasRenderer`의 `private static tinted()` / `shade()` /
`frosted()`를 `render/color.ts`로 올려 렌더러와 아이콘 생성기가 **한 구현을
공유**하게 한다. 이게 "아이콘이 캔버스와 어긋나지 않는다"를 구조적으로 보장하는
유일한 방법이다.

**Seam 2를 함께 쓴다**: `types.ts`에 UI 전용 선택 필드 하나
(`icon?` 또는 `swatchPattern?`)를 `category` 옆에 추가해 전용 아트와 버킷 강제
지정의 선언적 자리를 만든다. 자동 유도(Seam 1)를 **대체하지 않고 덮어쓰기 계층**
으로만 쓴다.

**기각한 대안**

- **CSS `background-image` / 그라디언트**: 픽셀 단위 노이즈도, battery의 4×5 계단도
  표현할 수 없다. 결국 SVG data URI로 가게 되는데 그건 Seam 1보다 모든 면에서 나쁘다
  (URI 이스케이프, `crispEdges` 제어 불가, 테스트 난이도).
- **칩마다 `<canvas>`**: 캔버스와 픽셀 동일하다는 장점이 있지만, 팔레트에 **현재
  DPR 처리가 전혀 없다**(`devicePixelRatio`를 읽는 곳은 `Game.ts` 한 곳뿐).
  검색 결과에 캔버스 126개가 뜨고, `$derived.by` 재실행마다 재생성된다.

## 4. 물질 분류 (팔레트 126종 전수)

| 버킷 | 수 | 처리 |
|---|---|---|
| **B1. 틴트 노이즈 가루** (`VARY_PARTICLE`, amp 18) | 28 | 합성 해시 패치 + 밝기 오프셋 |
| **B1b. 틴트 노이즈, 커스텀 amp** | 7 | 같은 처리, amp는 `colorVary` (Concrete 7 … Termite/Nanobot 22) |
| **B2. 액체 배경 노이즈** (amp 22) | 14 | 같은 수식. 캔버스는 드리프트하지만 아이콘은 정적 |
| **B3. 석유 액체** (amp 7) | 4 | 거의 평면, 미세 노이즈 (Oil/Gasoline/Kerosene/Diesel) |
| **B4. 평면 고체** (amp 0) | 25 | **가장 문제인 버킷** — 전용 텍스처/아트가 가장 필요 |
| **B5. 평면 기체** (amp 0) | 15 | 꽉 찬 사각형보다 가장자리 페이드/연무 처리 후보 |
| **B6. 평면 액체**(`colorVary: 0` 명시) | 2 | 금속 거울 의도 — 평면 유지, 시트 라인 한 줄 정도 (Mercury, Liquid Gallium) |
| **B7. glow 온도 램프** | 16 | base 하나가 아니라 `cool → color` 램프를 보여준다 (Lava, 각종 Molten, Uranium …) |
| **B8. 엔진 기존 패턴** | 13 | 타일 수식 1:1 재생 (Wire/Woofer/Mesh, Diamond, Battery×2, Conveyor, Fan, Laser, Shaped Charge, Electromagnet, Pump, Solar Panel) |
| **B9. 팔레트 배열 물질** | 2 | 색 하나가 아니라 팔레트 자체를 보여준다 (Fireworks `tintPalette` 3색, Seed `auxPalette` 발아 램프) |
| **B10. 전용 SVG** | 8~15 (미정) | B4/B5/B1b에서 뽑는 **덮어쓰기 계층**, 분할이 아님 |

B1~B9 합 = 126.

**작업량의 실체**: B1+B1b+B2+B3 = **53종은 공식 재생만으로 공짜로 해결**된다.
B8의 13종도 기존 타일 수식 재생이다. 진짜 창작이 필요한 건 **B4+B5+B6의 42종**
(평면)과 **B7의 16종**(램프), 그리고 B10 목록이다.

**B10 후보 씨앗** (색이 아니라 개념이 정체성인 것들): Fire, Blue Flame(불꽃
실루엣), Clone, Void, Antimatter, Virus, Nanobot, Termite, Catalyst, Amber,
Aerogel, Wall. 최종 목록은 구현 시 결정.

**의도적 생략**: `freeze` 서리 상태(13종)는 아이콘에 반영하지 않는다 — 팔레트는
따뜻한 상태만 보여준다.

## 5. 미해결 결정 사항

1. **11×11 돋보기 스와치까지 패턴을 넣을 것인가.** 18px에서 읽히는 패턴이 11px에서는
   진흙이 될 수 있다. 작은 두 곳은 단색을 유지하는 선택지도 있다.
2. **Seed의 아이콘 색.** `auxPalette`(발아 진행 램프, 갈색→녹색)를 쓰는 유일한
   팔레트 노출 물질이라 "맞는 단색"이 존재하지 않는다.
3. **성능 예산 미측정.** 검색 결과 최악 케이스가 **동시 126개 스와치**이고
   가상 스크롤이 없다. 첫 구현 후 1회 실측 필요 — 현재 문서화된 렌더 성능 수치는
   전부 엔진 쪽이라 참고가 안 된다.
4. **`Grid.tint`가 모든 파티클에 항상 새로 심기는가**는 미확인. 브러시로 칠한
   고체(Concrete, Obsidian, Diamond, Plant, Coral …)가 신선한 틴트 바이트를 받는지
   확인되지 않았다. 아이콘은 자체 필드를 합성하므로 이 작업에는 영향이 없지만,
   "모든 파티클은 틴트를 갖는다"고 문서에 쓰기 전에 확인할 것.

## 6. 구현 순서 (제안)

1. `tinted`/`shade`/`frosted`를 `render/color.ts`로 추출 (동작 변화 없음)
2. `spriteRects`/`pixelSvg`를 공유 위치로 export
3. `materialSvg.ts` — B1/B1b/B2/B3(노이즈) + B4/B5/B6(평면) 자동 유도
4. 소비 지점 5곳 교체 + `.swatch.mat` CSS + `MaterialPicker` 중복 CSS 정리
5. B8(타일 패턴 13종) + B7(glow 램프 16종)
6. B9(팔레트 배열 2종)
7. `icon?`/`swatchPattern?` 필드 + B10 전용 아트
8. `types.ts`의 `batteryPattern`·`colorVary` 주석 버그 수정
9. 유저에게 브라우저 확인 요청 → 실측치로 이 문서 갱신
