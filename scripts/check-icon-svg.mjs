// 손그림 물질 아이콘 SVG 검수 CLI.
//
//   node scripts/check-icon-svg.mjs svg-assets/material-icons/foo.svg
//
// 규칙 자체는 `icon-svg.mjs` 에 있고(배선 생성기와 공유한다), 규격의 단일 진실
// 공급원은 `.claude/skills/create-svg-assets/MATERIAL-ICON-BRIEF.md` 다.
import { readFileSync } from 'node:fs';
import { parseIconSvg } from './icon-svg.mjs';

const r = parseIconSvg(readFileSync(process.argv[2], 'utf8'));
console.log(
  `OK — rect ${r.rects}개, 색 ${r.colors}개, ` +
    `기본색 ${((576 - r.painted) / 5.76).toFixed(0)}%, 출하 ${r.inner.length} B`,
);
// 겹침은 반려 사유가 아니다(화면에는 제대로 나온다). 다만 작업자가 브리프의
// 격자 절차를 따르지 않았다는 신호라, 나머지도 눈으로 더 봐야 한다는 뜻이다.
if (r.overlap) console.warn(`주의 — rect가 ${r.overlap}칸 겹침. 격자 절차를 안 거쳤을 수 있음`);
