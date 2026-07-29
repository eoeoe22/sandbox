# 물질 아이콘 SVG 규격

파티클 샌드박스의 팔레트에 붙는 **물질 아이콘 SVG**를 손으로 그릴 때의 규격.
저장소 접근 없이 이 문서만으로 성립한다.

**그릴 물질과 그 기본색은 이 문서가 아니라 발주와 함께 전달된다.** 여기 있는 건
"어떻게 그리느냐"뿐이다.

두 가지를 먼저 머리에 넣을 것:

1. **최종 표시 크기는 18×18 CSS 픽셀이다.** 24×24로 그리지만 0.75배로 줄어든다.
2. **타일에 빈 곳이 있으면 안 된다.** 576칸 전부 칠해진 상태여야 한다(§2).

---

## 1. 파일 규격

| 항목 | 값 |
|---|---|
| 루트 | `<svg>` 하나. XML 선언(`<?xml …?>`)·DOCTYPE **없이** |
| `viewBox` | `0 0 24 24` — **정사각 고정** |
| 도형 | **`<rect>`만.** 다른 도형 요소 일절 금지 |
| 좌표·크기 | `x` `y` `width` `height` 모두 **0 이상 정수**, `width`/`height`는 1 이상, 타일 밖으로 나가지 않을 것 |
| 색 | `fill="#rrggbb"` — 6자리 **소문자** 16진수. 이름 색·`rgb()`·8자리 금지 |
| 첫 rect | **타일 전체를 덮어야 한다**: `<rect x="0" y="0" width="24" height="24" fill="#기본색"/>` |
| 개수·용량 | rect **200개 이하**, 파일 **6 KB 이하** |
| 색 수 | **5개 이하** |
| 파일명 | 물질 영문명 kebab-case + `.svg` (예: `dry-ice.svg`) |

`<rect>`의 **`height`가 1일 필요는 없다.** 같은 색 덩어리는 큰 사각형 하나로 묶는다.

`<svg>` 태그의 `width` / `height` / `shape-rendering` / `xmlns`는 **미리보기
편의용이라 무엇이든 상관없다.** 소비하는 쪽은 `<rect>` 목록만 읽고 래퍼를 다시
씌운다. `width="384" height="384"`(24의 16배)로 두면 파일을 그냥 열었을 때 크게
보여 작업하기 편하다.

---

## 2. 금지 목록

`id` · `class` · `<defs>` · `<style>` · `<filter>` · `<mask>` · `<clipPath>` ·
`<use>` · `<image>` · `<text>` · `<g>` · `url(#…)` · `<linearGradient>` ·
`<radialGradient>` · `fill="none"` · `fill-opacity` · `opacity` · `stroke` 계열 ·
외부 파일/폰트/URL 참조 · CSS 변수

**취향이 아니라 기술적 제약이다.** 이 SVG는 파일로 로드되지 않고 마크업이 HTML
문서에 그대로 인라인 삽입되며, **같은 마크업이 한 화면에 여러 벌 동시에 존재할 수
있다.** 따라서 — `id`/`url(#…)`는 자기 복제본과 이름이 충돌한다(그라디언트·마스크·
필터가 전부 이 방식이라 통째로 못 쓴다). 인라인 SVG 안의 `<style>` 규칙은 그 SVG가
아니라 **문서 전체에 적용된다.** 반투명·미채색 fill은 뒤 배경을 비치게 하는데 그
배경색은 선택 여부에 따라 바뀌어, 클릭할 때마다 아이콘 색이 변한다.

그라디언트가 필요하면 같은 색 계열 rect를 3~5장 겹쳐 계단으로 만든다.

---

## 3. 그리기 규격

### 크기

- **최소 특징 두께 2유닛.** 1유닛 선·점은 축소에서 사라질 수 있다. 외곽선도 2유닛.
- 요소는 **3~4개까지.** 18px에 그 이상 안 들어간다.
- 작업 중 **24×24를 18×18로 줄여 보고** 형태가 남는지 확인한다. 남지 않으면
  디테일을 줄이고 형태를 키운다.

### 색

- **지정된 기본색이 면적의 60% 이상**을 차지해야 한다. 사용자는 이미 그 색으로
  물질을 외우고 있다.
- 파생색은 기본색에서 **밝기만** 옮겨 만든다. 색상(hue)을 크게 틀지 않는다.
- 한 면에 명암 **3톤 이하**.
- **순백 `#ffffff` / 순흑 `#000000`을 넓게 쓰지 않는다.** UI가 어두워 튄다.
  밝은 끝은 `#e8e8ee`, 어두운 끝은 `#0d0d12`.

### 형태

- **광원은 왼쪽 위.** 밝은 면은 위·왼쪽, 그림자는 아래·오른쪽.
- 입체감은 그라디언트가 아니라 **띠·이음매·면 분할**로 낸다.
- **글자·숫자·기호 금지.** 18px에서 안 읽히고, 앱이 한국어/영어를 전환하므로
  번역과 충돌한다.
- **물질 자체를 그린다. 장면을 그리지 않는다.** 불꽃·연기·폭발·반짝임은 그리지
  않는다 — 게임 안에서 그건 실제로 시뮬레이션되는 별개의 입자다.

### 대비 확인용 참조값

아이콘 뒤·주변에 실제로 오는 색이다. 이 위에서 형태가 보이는지 확인한다.

| 위치 | 색 |
|---|---|
| 칩 배경(평소) | `#1b1b22` |
| 칩 배경(선택됨) | `#232b3a` |
| 타일 테두리 | 흰색 15% 불투명, 1px, 모서리 반경 4px |
| 게임 캔버스 바탕 | `#101016` |

---

## 4. 납품 전 점검

- [ ] `viewBox="0 0 24 24"`, XML 선언·DOCTYPE 없음
- [ ] `<rect>` 외의 도형 요소 없음
- [ ] 좌표·크기 전부 정수, 타일 밖으로 안 나감
- [ ] 모든 `fill`이 `#rrggbb` 6자리 소문자
- [ ] **첫 rect가 24×24로 타일 전체를 덮음**
- [ ] §2 금지 목록이 파일 안에 **한 번도** 등장하지 않음
- [ ] rect 200개 이하, 6 KB 이하, 색 5개 이하
- [ ] 지정 기본색 계열이 면적 60% 이상
- [ ] 가장 얇은 요소가 2유닛 이상
- [ ] **18×18로 줄여서** 무엇인지 알아볼 수 있음
- [ ] `#1b1b22` 배경 위에서 형태가 보임
- [ ] 글자·숫자 없음, 불꽃·연기 이펙트 없음
- [ ] 파일명이 지정된 kebab-case와 정확히 일치

### 기계 검증

규격 위반·빈 칸·영역 이탈·용량 초과를 잡는다(Node, 의존성 없음).

```js
// node check.mjs foo.svg
import { readFileSync } from 'node:fs';
const s = readFileSync(process.argv[2], 'utf8');
const bad = /\bid=|\bclass=|<defs|<style|<g[ >]|<use|<image|<text|url\(|gradient|opacity|stroke|fill="none"|<\?xml|<!DOCTYPE/i.exec(s);
if (bad) throw new Error('금지 요소: ' + bad[0]);
if (!/viewBox="0 0 24 24"/.test(s)) throw new Error('viewBox가 0 0 24 24 가 아님');
const cells = new Set();
const colors = new Set();
let rects = 0;
for (const m of s.matchAll(/<rect\s+([^>]*?)\s*\/>/g)) {
  rects++;
  const a = Object.fromEntries([...m[1].matchAll(/(\w[\w-]*)="([^"]*)"/g)].map((k) => [k[1], k[2]]));
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'fill,height,width,x,y') throw new Error('rect 속성이 x/y/width/height/fill 이 아님: ' + m[0]);
  if (!/^#[0-9a-f]{6}$/.test(a.fill)) throw new Error('fill 형식 오류: ' + a.fill);
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(a[k]));
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0)
    throw new Error('좌표/크기 오류: ' + m[0]);
  if (x + w > 24 || y + h > 24) throw new Error('타일 밖으로 나감: ' + m[0]);
  colors.add(a.fill);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.add(j * 24 + i);
}
if (rects !== (s.match(/<rect/g) || []).length) throw new Error('형식에 안 맞는 rect가 있음');
if (cells.size !== 576) throw new Error(`빈 칸 ${576 - cells.size}개 — 배경 rect 누락?`);
if (rects > 200) throw new Error('rect ' + rects + '개 — 200 초과');
if (colors.size > 5) throw new Error('색 ' + colors.size + '개 — 5 초과');
if (s.length > 6144) throw new Error(s.length + ' B — 6 KB 초과');
console.log(`OK — rect ${rects}개, 색 ${colors.size}개, ${s.length} B`);
```

스크립트가 잡지 못하는 것(눈으로 봐야 하는 것): 18px 축소 후 판독성, 기본색
60% 비중, 광원 방향, 최소 두께 2유닛, 그린 것이 물질로 보이는지.

---

## 5. 납품

파일을 **`temp/material-icons/`** 에 넣는다(없으면 만든다). 한 번에 다 줄 필요
없다 — 한 장씩 들어오는 대로 반영되고, 안 들어온 물질은 자동 생성 아이콘으로 계속
정상 동작한다. 배선은 발주자 쪽에서 한다. 납품물은 `.svg` 파일뿐이다.
