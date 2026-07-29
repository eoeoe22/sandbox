---
name: add-material-or-object
description: 새 물질(파티클) 또는 새 독립 오브젝트를 이 샌드박스에 추가할 때 빠뜨리기 쉬운 전 과정을 순서대로 짚는 체크리스트. id 배정 규칙과 세이브 호환, 등록/카테고리 배선, i18n(한국어명), 아이콘·스와치 지정, 전기·연소 같은 형질별 부가 등록, 검증 스크립트, docs/ 갱신, Cloudwiki 물질 도감·소개문서 갱신, 워크플로(PR → 서브에이전트 리뷰 → call_user)까지. "물질 추가", "새 파티클", "오브젝트 추가" 요청이면 코드를 쓰기 전에 읽을 것.
---

# 새 물질 · 오브젝트 추가 체크리스트

물질 하나를 추가하는 데 실제로 손대야 하는 곳은 **코드 4곳 + 문서 5곳(저장소 3, 위키 2)**
이다. 코드만 넣으면 팔레트에 뜨긴 하지만 한국어명이 빠지고 도감에 안 실린다 —
그리고 **둘 다 빌드를 실패시키지 않으므로 조용히 새어나간다.**

워크플로 자체(브랜치 → PR → 리뷰 → `call_user`)는 CLAUDE.md가 정답이다.
AGENTS.md에도 비슷한 절차가 있지만 더 오래됐고 `call_user`와 위키 갱신이 빠져 있다.
**충돌하면 CLAUDE.md를 따른다.**

---

# A. 새 물질

## A-1. id를 손으로 고른다 (되돌리기 가장 어려운 결정)

- 현재 **138종 등록, 최대 id 145** → **다음 id는 146**.
  (`npm run check:material-ids`가 현재 개수를 찍어 준다.)
- **비어 있는 id를 재활용하지 말 것**: `14, 15, 30, 35, 64, 72, 76, 142`는
  은퇴한 번호다. 세이브는 물질 id 바이트를 RLE+base64로 **그대로** 쓰고
  (`src/state/persistence.ts` `serializeWorld`/`encodeCellsRle`) 이름 테이블도
  리매핑도 없으므로, 번호를 재사용하면 **옛 세이브가 조용히 다른 물질로
  렌더된다.**
- 상한은 **255** (`Grid.cells`가 `Uint8Array`).
- id는 `aux`를 타고도 흐른다(Clone의 대상, Debris의 `renderAsAux`, 스파크의
  도체 클래스). 그래서 더더욱 재활용 금지.

## A-2. 물질 파일 생성

`src/game/materials/<소문자띄어쓰기없이>.ts`:

```ts
export const SAND = register({
  id: 2,
  name: 'Sand',          // 영어명 — i18n 영어 테이블은 비어 있고 이 필드를 읽는다
  phase: Phase.Powder,
  color: rgb(232, 201, 107),
  density: 5,
  friction: 0.3,
  thermal: { conductivity: 0.35 },
  update: updateSand,
});
```

- **필수 필드는 `id`, `name`, `phase`, `color`, `density` 다섯 개**뿐이다.
  나머지는 전부 선택.
- `update`는 생략 가능 — `register()`가 phase 기본 거동을 붙여 준다
  (`materials/registry.ts`, `defaultUpdate(phase)`).
- `register()`는 id가 겹치면 **즉시 throw** 한다.
- 최소 예시는 `src/game/materials/sand.ts`, 필드 전량은
  `src/game/engine/types.ts`의 `Material` 인터페이스 주석.
- ⚠️ **`name`은 나중에 바꾸지 말 것** — 헤드리스 검증 하네스들이 물질을 영어
  `name`으로 찾는다.

## A-3. `src/game/materials/index.ts` 배선 (세 군데)

1. `import { NEW_MAT } from './newmat';`
2. `export { … }` 블록에 이름 추가
3. **팔레트에 노출할 거라면** `export const MATERIALS = [...]` 배열에 추가.
   — 배열에서의 **위치가 곧 카테고리 탭 안에서의 순서**다.
   — 일부러 뺀 물질들(시스템 파티클)은 그 위 주석 블록에 이유가 적혀 있다.
     빼기로 했으면 그 주석도 갱신한다.

## A-4. 카테고리

`category:` 에 다음 안정 키 중 하나를 준다(`materials/categories.ts` `CATEGORY_META`):

```
solid powder liquid gas fire smelt oil polymer explosive cooling electric life radioactive exotic
```

생략하면 phase에서 유도된 탭으로 떨어진다. **새 카테고리를 만든다면**
`CATEGORY_META` + `categoryLabelsEn`/`categoryLabelsKo`(`src/i18n/materials.ts`)
+ `docs/I18N.md`의 키 목록 + Cloudwiki 소개문서의 카테고리 줄까지 넷을 같이 고친다.

> 참고: Cloudwiki 소개문서의 카테고리 줄은 현재 **13개만 나열하고 🧬 고분자가
> 빠져 있다**(실제로는 14개). 손대는 김에 고칠 것.

## A-5. 아이콘 / 스와치 지정

`docs/MATERIAL-ICONS.md`의 분류(버킷)에 이 물질이 어디로 떨어지는지 확인한다.

- phase·`colorVary`·패턴 플래그로 **자동 유도되는 버킷**이면 할 일 없음.
- 전용 아트가 필요하면 **[create-svg-assets 스킬](../create-svg-assets/SKILL.md)**
  을 읽고 만든 뒤, **18×18 / 16×16 / 11×11 세 크기에서 읽히는지** 확인한다.

## A-6. 형질별 부가 등록 (해당될 때만)

| 형질 | 추가로 손대야 하는 곳 |
|---|---|
| `conductive: true` | `materials/spark.ts`의 `CONDUCTOR_IDS`에 **append**(순서 = 세이브에 패킹되는 클래스 인덱스라 중간 삽입 금지) **+ `CONDUCTOR_LOSS`에 대응 항목**. 빠지면 브라우저 로드 시 가드가 throw 한다. |
| `combustible: true` | `materials/combustion.ts`에 `Combustible` 스펙 정의 + `update`에서 `tryBurn()` 호출 (`wood.ts` 참고) |
| 전기 장치(`directPulse`) | `conductive`를 **켜지 말 것**. `floodDeviceBody(...)` + `SimContext`의 `BodyFlood` 필드 (`docs/ELECTRICITY.md`) |
| `explosive` | `blastRadius`/`blastYield`/`destructivePower` 대 대상의 `durability`. `electricDetonate`는 `explosive`와만, `jetProof`는 `explosionProof`와만, `shockDeathChance`는 `blastDeathId` 필요 |
| `magnetic`, `laserReflective`, `acidResistant`, `explosionProof`, `indestructible` | 데이터 태그뿐, 다른 파일 없음 |

## A-7. i18n

`src/i18n/materials.ts` → `materialNamesKo`에 **숫자 id 키로** 한 줄:

```ts
146: '새 물질 이름',
```

- 영어명은 `Material.name`에서 자동으로 읽히므로 **영어 테이블은 건드리지
  않는다**(`materialNamesEn`은 의도적으로 비어 있다).
- **빠뜨려도 빌드가 실패하지 않는다** — 조용히 영어로 폴백한다. 빌드에 기대지 말 것.

## A-8. 검증

```bash
npm run check:material-ids   # id 중복 — build/deploy의 첫 단계이기도 하다
npm run check                # astro/TS 타입체크
npm run test:<subsystem>     # 건드린 계통의 하네스
```

CLAUDE.md `# 검증 스크립트` 절이 "무엇을 건드리면 무엇을 돌릴지"의 목록이다.
**새 물질군을 도입했다면** 자체 하네스를 만든다:
`test/<name>.ts` + `test/run-<name>.mjs` + `package.json`의 `test:<name>` +
`npm test` 체인 추가 + **CLAUDE.md에 그 스크립트 설명 bullet 추가**.

## A-9. 저장소 문서

1. **`docs/MATERIALS.md`** (도감) — 해당 이모지 섹션에 표 한 줄.
   - 2열 `| 물질 | 거동 / 상호작용 |` — 고체·기체·불열·폭발·냉각·전기·생명·방사성·특수
   - 3열 `| 물질 | 밀도 | 거동 / 상호작용 |` — 가루·액체·제련·석유·고분자
   - 이름은 영어 `name` + 필요하면 괄호 한글 병기. 문체는 평서형 `-다`,
     핵심어 볼드, 임계값은 `660°↑` 스타일.
   - **레시피/연쇄를 새로 만들었다면 `## 대표 상호작용 사슬`에
     `- **<사슬 이름>:** A → B → C …` bullet도 같이 추가**한다.
2. **`docs/MATERIAL-SYSTEMS.md`** — 맨 아래에 라운드 섹션 append:
   `## <주제> (신규 N종 — …)` → `### 이 라운드가 만든 것` → `### 시스템 노트`
   (bullet마다 볼드로 교훈 형태의 주장 + 백틱으로 소스 파일; **마지막 bullet은
   항상 `**검증(npm run test:X)**:`**). 그리고 머리의
   **`## 물질 총량 · 시스템 파티클` 개수 문장을 갱신**한다.
3. **`docs/MATERIAL-IDEAS.md`** — 백로그에서 온 제안이면 해당 항목을 **삭제하거나
   구현됨으로 주석** 처리(문서 상단 정책).
4. **`docs/README.md`** — 새 분야 문서나 새 테스트 스크립트를 만들었을 때만 bullet 갱신.

## A-10. Cloudwiki

슬러그로 접근한다(표시 제목 아님).

1. **`Web sandbox 프로젝트/가이드/물질`** (표시 제목 "물질 도감") — 해당
   `## <이모지> …` 섹션의 표에 행 추가.
   - 이름은 **영어 볼드**: `| **Activated Aluminum** | … |`
   - 구분선은 **띄어쓴** `| --- | --- |` (저장소의 `|---|---|`와 다르다)
   - 문체는 **존댓말 `-습니다`**, 온도는 `660도` (저장소의 `660°↑`가 아니다),
     1~4문장.
   - 위키 전용 마크업: `{br}` 줄바꿈, `{color:#e15f2d}==강조==`,
     `{bg:#…}{color:#…}==뱃지==`, `[[슬러그|라벨]]`, `{table:center}`.
   - 페이지 맨 끝의 `## 관련 문서` 블록은 **항상 마지막**으로 남긴다.
2. **`Web sandbox 프로젝트`** (소개문서) — **간판이 될 만한 기능일 때만**
   `## 무엇을 하는 게임인가` 아래 bullet 하나. 변경 이력이나 구현 디테일은
   절대 넣지 않는다. CLAUDE.md는 소개문서는 **즉시 반영** 편집을 권장한다.
3. 다단계 공정을 새로 만들었다면 `…/가이드/<공정명>` 자식 페이지 + `…/가이드`의
   `## 공정 가이드`에 `:::card` + 소개문서 `## 플레이 가이드`에 링크.
   템플릿은 `…/가이드/철광석 제련`.

---

# B. 새 독립 오브젝트

오브젝트는 그리드 물질이 아니라 자유 바디다. **세이브에 저장되지 않고**
(`Grid.objects`는 persistence 대상이 아니다) id 체계도 `check:material-ids`도
무관하다. 대신 `Record<ObjectKind, …>` 맵이 여러 개라 **빠뜨리면 타입체크가
잡아 준다** — 물질보다 안전하다.

1. **`src/game/engine/objects.ts`** — `export interface SimFoo { kind: 'foo'; … }`
   (`SimWoodBox` 패턴), `SimBody` 유니온에 추가, 튜닝 상수,
   `export function createFoo(x, y)` (`createWoodBox` 패턴).
   캡슐 물리를 재사용한다 — 상자는 `halfLength = 0`인 캡슐이다.
2. **`src/game/render/<name>Sprite.ts`** — 아트.
   → **[create-svg-assets 스킬](../create-svg-assets/SKILL.md)** 을 먼저 읽을 것.
   요약: 셀당 2px, 색 2~4개, 어두운 실루엣 + 1px 인셋, 불/연기/손상은 그리지 않음.
3. **`src/state/store.ts`** — `ObjectKind` 유니온에 리터럴 추가.
4. **`src/i18n/materials.ts`** — `objectLabelsEn` **과** `objectLabelsKo` 양쪽.
   (타입체크 강제)
5. **`src/game/render/objectSvg.ts`** — `spriteRects` + `pixelSvg`로 만든 항목을
   `OBJECT_SVG`에 추가. (타입체크 강제)
6. **`src/components/MaterialPalette.svelte`** — `OBJECT_KINDS` 배열에 추가.
   라벨·개수·플라이아웃은 따라온다.
7. **`src/game/input/PointerPainter.ts`** — `spawnObject()` 분기 + import.
8. **`src/game/render/CanvasRenderer.ts`** — `rasterizeObjects`에 분기 하나.
   회전 스프라이트는 공용 `rasterizeSprite`를 쓴다(루프 복사 금지).
9. **`objects.ts`의 디스패치 지점** — `evaluateTriggers`(가열/스텝),
   `destroyByproduct`, 전자석에 끌려야 하면 `isMagneticBody`(현재는 강철 바디만).
10. **테스트** — `test/foo.ts` + `test/run-foo.mjs` + `test:foo` + `npm test` 체인
    + CLAUDE.md 검증 bullet. 기존 하네스가 회전/안착, 부유, 점화, 파괴 원인 분기,
    자석 인력, 수중 연기를 이미 커버하니 형태를 그대로 빌려 쓴다.
11. **`docs/OBJECTS.md`** — 새 `##` 섹션. 표를 쓰지 않는 문서다:
    도입 산문(백틱으로 코드 진입점 명시) → 볼드 선두 bullet들 → **실측 숫자가
    들어간 `검증:` 문단** → 필요하면 `성능(…실측):`.
12. **Cloudwiki** — 물리적으로 특기할 게 있으면 `…/가이드/물리`의
    `## 독립 오브젝트` 절에 한 줄. 소개문서는 간판급일 때만.

---

# C. 마무리 (공통)

1. 지정된 브랜치에서 작업 → push → **PR 생성**
2. **Sonnet 서브에이전트로 코드리뷰** → 지적사항 조치 → **"no issues" 나올 때까지 반복**
3. no issues 확정 후 **`call_user`**
4. `docs/` 해당 분야 문서 갱신, 필요 시 Cloudwiki 소개문서 하이라이트 최신화
5. **작업 완료 후 체크인 트리거는 만들지 않는다**
6. **브라우저 테스트(Playwright 등)는 직접 하지 않고 유저에게 요청한다**

## 조용히 실패하는 것들 (빌드가 안 잡아 준다)

- `materialNamesKo` 한국어명 누락 → 영어로 폴백
- `MATERIALS` 배열 추가 누락 → 팔레트에 안 뜨는데 에러 없음
- `docs/MATERIALS.md` / Cloudwiki 물질 도감 행 누락
- `MATERIAL-SYSTEMS.md`의 총량 문장 미갱신
- `CONDUCTOR_LOSS` 누락 → 빌드는 통과하고 **브라우저 로드 시** throw

빌드가 실제로 막아 주는 건 **id 중복**(`check:material-ids`, `build`의 첫 단계라
Cloudflare 배포까지 실패)과 **`Record<ObjectKind, …>` 누락**(`npm run check`)뿐이다.
