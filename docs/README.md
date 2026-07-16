# 개발 문서 (docs)

이 폴더는 프로젝트의 상세 개발·레퍼런스 문서를 **분야별**로 나눠 담는다. Cloudwiki의 "Web sandbox 프로젝트" 페이지는 이제 가벼운 소개 문서로 두고, 세부 기록은 여기에 둔다.

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 아키텍처 & 스택: 개요·스택·디렉터리 구조·스레딩·배포/PR 프리뷰.
- [FEATURES.md](./FEATURES.md) — 기능(UI·UX·편의): 화면비·경계 모드·HUD·브러시·컨트롤 UI·저장/복원·속도·연기·중력·오버레이·검색·즐겨찾기 등.
- [PHYSICS.md](./PHYSICS.md) — 물리·엔진 시스템: 열전도·어는점·밀도 변위·색상 틴트·물리 엔진 고도화 1~3차.
- [MATERIALS.md](./MATERIALS.md) — 물질 도감: 전체 물질과 핵심 상호작용 카탈로그(카테고리별 표·상호작용 사슬).
- [MATERIAL-SYSTEMS.md](./MATERIAL-SYSTEMS.md) — 물질군·시스템 노트: 물질군 도입 라운드의 엔진/인프라 설계 노트(공용 헬퍼·데이터 태그·크로스-물질 메커니즘)와 플레이 가이드 링크.
- [OBJECTS.md](./OBJECTS.md) — 독립 오브젝트 시스템: 고무공·드럼통·다이너마이트, 오브젝트 물리/상호작용/브러시 연동.
- [WASM-ENGINE-PORTING.md](./WASM-ENGINE-PORTING.md) — 성능·이식 계획 + 착수 기록: WASM/멀티스레드 핵심 엔진 포팅 로드맵(측정→오프메인스레드→수치 커널 WASM→조건부 CA 스캔). **Phase 2 첫 커널(열확산 `diffuseHeat`)이 Rust/WASM으로 착수 완료**(§9) — 비트 동일 골든 테스트 + JS 폴백. 물질 89개는 워커 안 JS로 유지(포팅 부채 0)라는 결론은 그대로. 커널 빌드/구조는 [`wasm/README.md`](../wasm/README.md).
- [PWA.md](./PWA.md) — PWA·오프라인 지원: 매니페스트/아이콘/서비스 워커 구성과
  콘텐츠 해시 캐시 무효화 정책과의 상호작용(network-first 셸 / cache-first
  해시 자산).
- [PERFORMANCE.md](./PERFORMANCE.md) — 성능 계측: Phase 0 측정 하네스(인앱 패스별 프로파일러 `?perf`, 고정 벤치 장면 `?bench=`, 열 커널 JS-vs-WASM 마이크로벤치)와 **실측 결과**. 결론: 점유 장면에서 **CA 물질 스캔이 틱의 80%+** 로 지배적. **§4 활성-타일 CA 스캔**으로 그 스캔의 빈 영역을 스킵 — 비트 동일(전면 스캔과 매 틱 동일, 결정론 검증)·전형적 장면 ~1.8×·빈 장면 ~30×·밀집 중립.
