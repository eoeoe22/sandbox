## 개요

사용자가 명시한 5개 물질(벽·흑요석·소금물·설탕물·베이킹소다)에 대해 **물질별 맞춤 다단계 데모**를 구현한다. 각 데모는 `tickOverlap` 스타일(누적 틱 + 단계별 early-return + 끝에 `loop()` 초기화)의 타임라인 대본으로 짠다. 흑요석·소다는 "생성/반응 액트 → 장면전환 → 내성/반응 액트" 두 액트 구조.

이 데모들은 phase 기반이 아니라 **물질 id로 지정**하므로, `GuideDemoKind`에 신규 kind 5종을 추가하고 `Codex.svelte`의 `cardDemo`에 id→kind 오버라이드 맵을 둔다.

## 가정(되돌리기 싼 값들 — 상수/배치 바꾸면 되므로 명시 후 진행)

1. **중앙 블록**: 정사각형, 격자 중앙, 변은 격자 높이의 약 1/4(예: 56×28 → 7×7). Wall·Obsidian 공통.
2. **산/소다 "줄기"**: 위(STREAM_Y)에서 떨어뜨리는 `dropStream` 패턴(기존 겹침 데모와 동일 손놀림). "산 웅덩이/반죽 웅덩이"는 바닥에 미리 까는 고정 액체 층(build에서 배치).
3. **소금물·설탕물 형태**: 액체 데모의 `buildBowl`(그릇)을 재사용해 그 안에 물→소금/설탕 순차 부어 섞이게. 열린 공간은 가루가 흩어져 반응이 안 보임.
4. **Wall 데모 "다음 단계 반복"**: 전체 사이클(TNT→산→U235→초기화)을 반복(loop). 각 사이클마다 랜덤 위치가 달라짐.
5. **녹은 U235 배치**: 2×2 덩어리(임계 도달 보장 — 단일 셀은 5초 안에 임계 못 옴). spawn으로 놓아 1600° 보장.
6. **TNT 격발**: 1초(30틱) 후 TNT 인접 빈 칸에 `context.spawn(FIRE)` → 다음 틱에 TNT `updateTNT`가 이웃 검사로 기폭(게임의 자연스러운 기폭 경로).
7. **흑요석·소다 "장면전환"**: 해당 틱에 `grid.clear()` 후 두 번째 액트 고정 배치(중앙 흑요석 블록 / 바닥 반죽 웅덩이)를 직접 호출. 첫 액트 결과(생성된 흑요석/중화된 산)는 버림.

## 구현 — 3개 파일

### 1. `src/game/materials/demo.ts` — 신규 물질 import + DEMO_* 별칭

데모 장면 코드는 demo.ts에서만 물질을 가져오는 규칙. 현재 WALL/WATER/FIRE만 있으므로 추가:
- OBSIDIAN, SALTWATER, SUGAR_WATER, SODA, TNT, ACID, MOLTEN_URANIUM, LAVA, SALT, SUGAR, BATTER
- 각각 `DEMO_OBSIDIAN`/`DEMO_SALTWATER`/… 별칭 export

### 2. `src/game/guideDemo.ts` — kind 5종 추가 + 대본

**선언부(컴파일 강제 지점):**
- `GuideDemoKind` 유니온에 `'wall'|'obsidian'|'saltwater'|'sugarwater'|'soda'` 추가
- `GUIDE_DEMO_KINDS` 배열에 추가(basics 탭 `GameGuideDoc`은 이 배열을 안 쓰고 하드코딩 PHASE_ORDER+overlap/heat만 쓰므로 basics에 영향 없음; 단 테스트 순회용으로는 필요)
- `GUIDE_DEMO_SPECS`: 5종 모두 `cols: 56, aspect: 2, borderMode: 'wall'`(기존 overlap 화면비 — 가로장면이 다단계 연출에 넉넉). 튜닝 가능.
- `GUIDE_DEMO_STILL_TICKS`: 각 데모 대본 길이의 약 60~70% 지점(첫 액트 결론이 보이는 틱)

**대본 상수(DEMO_TPS * 초):** 각 단계 길이. 예:
- Wall: TNT배치 0 + 대기 1초 + 격발여유 2초 + 산 2초 + U235대기 5초 + 테일 1초 ≈ 11초/사이클
- Obsidian: 물 1.5초 + 대기 4초 + 전환대기 1초 + TNT1(1초+격발) + TNT2(1초+격발) + 테일 ≈ 13초
- Saltwater/Sugarwater: 물 3초 + 소금/설탕 1초 + 관찰 3초 ≈ 7초
- Soda: 소다 2초 + 대기 3초 + 전환 + 소다 2초 + 대기 3초 ≈ 10초

**build() 확장:** kind별 고정 배치 분기 추가:
- wall: 중앙 정사각형 WALL 블록(`buildWallBlock`)
- obsidian: 바닥 LAVA 웅덩이(`buildLavaPool`) — 액트1용. 액트2 전환은 대본 내에서 별도 배치
- saltwater/sugarwater: `buildBowl` 재사용(기존 메서드)
- soda: 바닥 ACID 웅덩이(`buildAcidPool`) — 액트1용

**장면전환 헬퍼:** 흑요석/소다의 액트2 진입용. `grid.clear()` 후 두 번째 액트 배치(흑요석 중앙 블록 / 반죽 웅덩이)를 놓는 private 메서드.

**tick() switch + 5개 tick 메서드** (모두 tickOverlap 패턴):

- **tickWall**: [랜덤 위치 TNT 배치(벽 피함) → 1초 후 인접 FIRE 스폰으로 격발] → [위에서 산 2초 dropStream] → [랜덤 위치 MOLTEN_URANIUM 2×2 spawn → 5초 대기(임계→핵광→Wall 생존)] → loop()
- **tickObsidian**: 액트1 [위에서 물 1.5초 → 용암과 만나 흑요석 급냉 생성 → 4초 관찰] → 액트2 전환[clear + 중앙 흑요석 블록] → [TNT 랜덤 배치+1초 후 격발] ×2 → loop()
- **tickSaltwater**: 그릇에 물 3초 dropStream → 같은 자리 소금 1초 dropStream(소금이 물 주머니를 소금물로 변환) → 관찰 → loop()
- **tickSugarwater**: tickSaltwater와 동일, 소금 대신 설탕(하나의 private `tickDissolve(soluteId)`로 공유, 두 case에서 호출)
- **tickSoda**: 액트1 [산 웅덩이 위 소다 2초 → 중화(소다+산→소금물+가스) → 3초 관찰] → 액트2 전환[clear + 반죽 웅덩이] → [소다 2초 → 반죽과 반응(팽창 준비) → 3초 관찰] → loop()

**랜덤 위치 헬퍼:** "벽/흑요석 블록과 겹치지 않는 랜덤 위치"를 고르는 함수(블록 영역 bbox 피해서 this.rand()로 선택).

### 3. `src/components/Codex.svelte` — cardDemo 오버라이드 맵

```ts
const DEMO_OVERRIDE = new Map<number, GuideDemoKind>([
  [WALL.id, 'wall'],
  [OBSIDIAN.id, 'obsidian'],
  [SALTWATER.id, 'saltwater'],
  [SUGAR_WATER.id, 'sugarwater'],
  [SODA.id, 'soda'],
]);
```
`cardDemo` 파생에서 phase 기반 매핑 **앞에** override 조회를 끼운다. override 우선, 없으면 기존 phase 매핑. `WALL`/`OBSIDIAN`/... import는 동적 import된 전체 배럴에서(이미 onMount에서 `import '../game/materials'`로 평가됨).

## 검증
- `npm run test:guidedemo` — GUIDE_DEMO_KINDS 순회 루프 2곳(세워짐 + windToStill 점유율>10)이 신규 5종에 자동 실행. 각 대본이 물질을 충분히 놓아 통과해야 함.
- `npm run check:material-ids` — 빌드 선행 검사.
- `svelte-check`/`tsc` — Record 강제 지점(SPECS/STILL_TICKS) 보완 확인.
- 브라우저 테스트는 AGENTS.md 정책상 유저에게 요청(`/guide`에서 5개 물질 카드 열어 연출 확인).

## 워크플로우
새 브랜치 → 구현 → push & PR → 서브에이전트 코드리뷰 → no issues까지 반복 → `docs/` 갱신(likely `docs/CODEX.md` §14 확장 또는 FEATURES.md).

## 유의사항
- 흑요석은 산·핵광엔 약하지만 이 데모에선 산/핵광 안 나옴 → 명세와 충돌 없음.
- Wall 데모의 녹은 U235 핵광은 격자를 쓸어버리지만 Wall(isWall)은 살아남 → "벽은 파괴 불가" 메시지가 한 장면에 담김. 단 windToStill 점유율이 10 밑으로 떨어지면 테스트 실패 가능 → 테일/관찰 구간에서 장면이 너무 비워지지 않게 튜닝.
- 가로 56칸에서 TNT blastRadius 16이면 폭발이 화면 대부분을 덮음 → 시각적 효과는 좋지만 벽 블록이 폭발에 가려지지 않도록 블록과 TNT 거리 조정 필요.