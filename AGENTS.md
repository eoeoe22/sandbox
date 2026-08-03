# 이 프로젝트는 웹 브라우저 기반 샌드박스 파티클 시뮬레이터이다.
1순위 : 재미
2순위 : 편의성
3순위 : 과학적 고증

# 문서 정책

**정본은 [`CLAUDE.md`](./CLAUDE.md) 다.** 요약하면 문서는 읽는 사람으로 가른다 —
유저는 **인게임 도감·툴팁**만 읽고, 작업자는 저장소 **`docs/`** 를 읽고, Cloudwiki 는
만든 사람의 포트폴리오 겸 공유 문서다. 세 곳에 같은 내용을 두지 않는다.

이 파일은 CLAUDE.md 보다 오래됐다. **어긋나면 CLAUDE.md 를 따른다.**


# 워크플로우

1. 새 브랜치에서 작업 수행
2. 작업 후 1차 Push 및 gh CLI 를 통해 Pull Request 생성
3. 서브에이전트 호출을 통해 코드리뷰
4. 리뷰에서 지적사항이 있다면 조치후 리뷰 재시도 (no issues 확정 까지 반복)
5. 사용자의 승인 대기 (Merge는 사용자가 진행)
6. 개발 기록은 `docs/` 폴더의 해당 분야 문서를 갱신한다. 유저에게 설명이 필요한
   변경이면 인게임 도감(`src/i18n/codex.*.ts` · `codexTerms.ts`)도 같이 고친다.

# 검증 스크립트

- **물질 id 중복 검사** — `npm run check:material-ids`
  (내부적으로 `node scripts/check-material-ids.mjs` 실행). `src/game/materials/`
  의 모든 `register({ ... })`에서 `id`를 정적으로 스캔해 중복이 있으면 목록을
  출력하고 종료 코드 1로 실패한다. `npm run build`(따라서 `deploy`)의 첫 단계에
  묶여 있어 **Cloudflare Workers 빌드 시 자동 실행되고, id가 겹치면 빌드가 강제
  실패한다.** 새 물질 추가 시 id 충돌 여부를 먼저 확인할 것.