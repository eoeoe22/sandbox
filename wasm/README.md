# WASM 커널 (Rust) — 핵심 엔진 포팅

엔진 포팅 로드맵의 **Phase 2 (구역 A: 순수 수치 커널)** 실착수분 — 물질 콜백이
전혀 없는 순수 수치 루프만 골라 JS 밖으로 옮긴다. 그 판단의 근거가 된 실측은
[`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md)에 있다.
언어는 **Rust**, 툴체인은 `cargo` 단독(외부 크레이트·`wasm-bindgen` 없음).

## 왜 이런 구조인가

- **커널만 WASM, 물질 코드는 불변.** 여기 있는 건 물질 콜백이 전혀 없는
  자족적 수치 루프뿐이다(현재: 열확산 `diffuse_heat`). 물질 `update` 89개는
  포팅 대상이 아니다 — 물질 코드는 계속 손대는 곳이라 이식 부채를 지면 그때부터
  모든 변경이 비싸진다.
- **산출물 `.wasm`을 커밋한다.** Cloudflare 정적 배포는 `astro build`만
  돌리고 Rust 툴체인이 없다. 그래서 빌드된 `heat.wasm`을
  `src/game/engine/heat.wasm`에 **커밋**해 두고, Vite가 `?url`로 번들한다.
  Rust 소스를 고치면 `wasm/build.sh`를 다시 돌려 아티팩트를 갱신·커밋한다.
- **항상 JS 폴백.** 런타임에서 wasm 로드가 실패하거나 미지원이면 자동으로
  기존 JS 경로로 강등된다(`USE_WASM_HEAT` 플래그 + 비동기 로드). 기능 저하
  없이 느려질 뿐.

## 구성

```
wasm/
├─ heat/            # Rust 크레이트 (cdylib → wasm32-unknown-unknown)
│  ├─ Cargo.toml
│  └─ src/lib.rs    # diffuse_heat 커널 + heat_alloc/heat_free
├─ test/golden.mjs  # JS 레퍼런스 대비 골든 패리티 테스트 (비트 동일 기대)
├─ bench/heat-bench.mjs  # JS vs WASM 처리량 마이크로벤치 (Phase 0, docs/PERFORMANCE.md)
├─ build.sh         # 빌드 + 아티팩트 복사 + 골든 테스트
└─ README.md
```

## 빌드

```bash
rustup target add wasm32-unknown-unknown   # 최초 1회
bash wasm/build.sh
```

`build.sh`는 릴리스 빌드 → (있으면) `wasm-opt -O3` →
`src/game/engine/heat.wasm` 복사 → 골든 테스트까지 수행한다. 갱신된
`heat.wasm`을 커밋해야 배포에 반영된다.

## 정확성 (거동 동일성 = 1순위 재미 보호)

`diffuse_heat`은 JS `Simulation.diffuseHeat`를 **누적 순서까지** 그대로
옮겼다. JS가 `Float32Array`(f32)를 읽어 number(f64)로 누적하고 저장 시 f32로
반올림하는 것과 똑같이, Rust도 `f32`를 읽어 `f64`로 넓혀 같은 좌→우 순서로
계산하고 저장 시 `f32`로 좁힌다. 그래서 결과가 **비트 동일**이고,
`wasm/test/golden.mjs`가 이를 검증한다(`max |diff| = 0`). 즉
`USE_WASM_HEAT`를 켜도 시뮬레이션 거동은 변하지 않는다.

골든 테스트는 이제 **세 경로**를 같은 전면 JS 레퍼런스에 맞붙인다 — WASM 전면 /
WASM 타일 스킵 / 엔진이 실제로 도는 JS 타일 루프. 즉 "타일을 건너뛰어도 같다"까지
같은 자리에서 증명한다. 무작위 dense 장면만으로는 비활성 타일이 사실상 안 생기므로
**sparse 장면**(공기 위주 + 블롭, 일부는 전도율 0 블롭)이 같이 들어 있고, 한 번도
스킵이 안 일어나면 그 자체로 실패시킨다(스킵 경로가 안 돌았으면 검증한 게 없으니까).

여기에 더해 **`tile_bits`를 1·2·3·프로덕션값·6으로 전부 돌린다**(프로덕션값은
`dirtyTiles.ts`에서 읽어 온다). 타일 크기가 인자가 된 이상 커널이 받은 값대로 도는지가
검증 대상이고, 이게 있어야 `dirtyTiles.ts`의 상수를 바꿔도 여기가 따라온다. 마지막으로
**malformed-mask 6종**이 전부 전면 순회 결과와 비트 동일한지 확인한다 — "못 믿을 마스크는
느려질 뿐 틀리지 않는다"는 계약을 고정한다. 6종은 커널의 두 거부 브랜치(크기 상한 /
정확한 기하)에 3종씩 나뉘고, **각각 자기 브랜치가 없으면 반드시 실패하도록** 지어져 있다
— 뮤테이션으로 확인 완료. 그렇게 안 지으면 전부 한쪽 브랜치에만 기대게 돼서 다른 쪽을
지워도 통과한다(첫 판이 실제로 그랬다). 그리고 그 배타성은 주석이 아니라 **하네스가 매
실행마다 단언**한다 — 케이스가 두 브랜치에 다 걸리게 되면 그 자리에서 멈춘다. 설계
함정들은 [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md) §5에 적어 뒀다.

## ABI

`wasm-bindgen` 없이 C-ABI 함수만 export 한다.

- `heat_alloc(bytes) -> ptr` / `heat_free(ptr, bytes)` — 호스트가 그리드 버퍼를
  미러링할 선형 메모리 영역 예약/해제.
- `diffuse_heat(cells, cond, temp, scratch, w, h, rate, substeps, tiles, tiles_x, tiles_y, tile_bits)` —
  substep 횟수만큼 확산을 돌리고 최종 결과를 `temp`에 남긴다(JS `step()`이
  `diffuseHeat`를 substep번 호출한 뒤 `grid.temp`에 최종장이 있는 것과 동일).
  한 틱에 JS↔WASM 경계를 **한 번만** 넘도록 substep 루프를 커널 안에 둔다.
  - `tiles`는 **비활성 타일 마스크**(타일당 1바이트, 1 = 전도 셀 있음). 호스트가
    만들고 커널은 소비만 한다. 마스크가 0인 타일은 전도율 0 셀만 담고 있어
    자기에게도 이웃에게도 no-op이므로 **건너뛰어도 비트 동일**하다 —
    근거와 통과-복사 시드 얘기는 [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md) §5.
  - **타일 크기(`tile_bits`)는 커널 상수가 아니라 인자다.** 마스크 기하를 아는 건
    그걸 만드는 호스트뿐이고, 커널에 같은 숫자를 한 벌 더 두면
    `engine/dirtyTiles.ts`와 조용히 어긋날 수 있다(그래도 WASM 테스트는 *커널 쪽*
    복사본과 일치하니 계속 통과한다). 인자로 받으면 그 split-brain이 **표현
    불가능**해진다. `src/game/engine/dirtyTiles.ts`의 `TILE_BITS`가 유일한 출처다.
  - **못 믿을 마스크는 전면 순회로 강등된다** — null(0), `tile_bits`가 0이거나
    `MAX_TILE_BITS`(16) 초과, 또는 `tiles_x`/`tiles_y`가 그 타일 크기에서의 정확한
    타일 수가 아닐 때. "크기만 충분하면 OK"가 아니라 **정확히 일치**를 요구하는
    이유는, 타일 수는 그럴듯한데 타일 크기가 틀린 마스크가 가장 고약하기
    때문이다 — 크기 검사만으로는 통과하고서 각 타일의 표시를 **엉뚱한 물리 영역**
    것으로 읽어 살아 있는 셀을 건너뛴다. 마스크 영역 할당 실패도 같은 경로로
    "느리지만 동일"이 된다.

호스트 측 배관은 `src/game/engine/heatWasm.ts`.

`cond`는 물질이 선언한 0~1 값이 아니라 **`config.effectiveConductivity`를 통과한
지수 커브 값**이다(호스트가 LUT를 만들 때 한 번 적용 — 커널은 커브의 존재를 모른다).
[`docs/PHYSICS.md`](../docs/PHYSICS.md) "열전도 로그 스케일" 참고.
