# WASM 커널 (Rust) — 핵심 엔진 포팅

`docs/WASM-ENGINE-PORTING.md`의 **Phase 2 (구역 A: 순수 수치 커널)** 실착수분.
언어는 **Rust**, 툴체인은 `cargo` 단독(외부 크레이트·`wasm-bindgen` 없음).

## 왜 이런 구조인가

- **커널만 WASM, 물질 코드는 불변.** 여기 있는 건 물질 콜백이 전혀 없는
  자족적 수치 루프뿐이다(현재: 열확산 `diffuse_heat`). 물질 `update` 89개는
  포팅 대상이 아니다(문서 §1.5).
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

## ABI

`wasm-bindgen` 없이 C-ABI 함수만 export 한다.

- `heat_alloc(bytes) -> ptr` / `heat_free(ptr, bytes)` — 호스트가 그리드 버퍼를
  미러링할 선형 메모리 영역 예약/해제.
- `diffuse_heat(cells, cond, temp, scratch, w, h, rate, substeps)` —
  substep 횟수만큼 확산을 돌리고 최종 결과를 `temp`에 남긴다(JS `step()`이
  `diffuseHeat`를 substep번 호출한 뒤 `grid.temp`에 최종장이 있는 것과 동일).
  한 틱에 JS↔WASM 경계를 **한 번만** 넘도록 substep 루프를 커널 안에 둔다.

호스트 측 배관은 `src/game/engine/heatWasm.ts`.
