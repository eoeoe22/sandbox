// 손그림 물질 아이콘 SVG 검수기.
//
// 원본은 `.claude/skills/create-svg-assets/SKILL.md` §7.2다. 여기 있는 건 그것을
// 실행 가능한 형태로 뽑아 둔 것이고, 규격 자체의 단일 진실 공급원은
// `.claude/skills/create-svg-assets/MATERIAL-ICON-BRIEF.md`다 — 이 스크립트가
// 반려하는 모든 조건은 브리프에 글로 적혀 있어야 한다. 작성자는 저장소도
// 스크립트도 없이 브리프만 보고 그리므로, 여기에만 있는 규칙은 그에게
// 발견 불가능한 규칙이 된다.
//
//   node scripts/check-icon-svg.mjs temp/material-icons/foo.svg

import { readFileSync } from 'node:fs';
const raw = readFileSync(process.argv[2], 'utf8');
// 주석은 규격상 금지다. 지우고 넘어가면 규칙이 영영 강제되지 않고, 주석 처리된
// rect가 커버리지에 세어져 진짜 빈 칸을 가릴 수도 있으므로 여기서 반려한다.
if (/<!--/.test(raw)) throw new Error('주석 금지');
const bad = /\bid=|\bclass=|\bstyle=|url\(|opacity|stroke|fill="none"|<\?xml|<!DOCTYPE/i.exec(raw);
if (bad) throw new Error('금지 요소: ' + bad[0]);
// 루트를 통째로 떼어내고 그 **안쪽만** 검사한다. 문자열 전체를 훑으면
// </svg> 뒤에 붙은 rect나, 자기닫힌 루트 옆에 나란히 놓인 rect까지 칠해진
// 것으로 세어진다 — 둘 다 인라인 삽입 시 실제로는 아무것도 그리지 않는다.
// 여는 태그는 따옴표를 인식하며 훑는다. `[^>]*` 로 두면 속성값 안의 `>` 에서
// 잘려, 규격이 값을 자유라고 명시한 shape-rendering 같은 속성 때문에 멀쩡한
// 파일이 엉뚱한 사유("viewBox가 아님")로 반려된다.
const root = /^\s*(<svg\b(?:[^>"]|"[^"]*")*>)([\s\S]*)<\/svg>\s*$/.exec(raw);
if (!root) throw new Error('루트가 <svg>…</svg> 하나로 감싸여 있지 않음');
if (root[1].endsWith('/>')) throw new Error('루트 <svg>가 자기닫혀 있음 — 내용이 밖에 있다');
if (!/viewBox="0 0 24 24"/.test(root[1])) throw new Error('viewBox가 0 0 24 24 가 아님');
const s = root[2];
// 루트 안에는 <rect>만. 허용 목록이라 <circle>·<path>는 물론 중첩 <svg>(자체
// viewBox로 배율이 바뀐다)와 자기닫는 <g/>도 같이 걸린다.
for (const t of s.matchAll(/<\/?([a-zA-Z][\w:-]*)/g))
  if (t[1] !== 'rect') throw new Error('허용되지 않은 요소: <' + t[1] + '>');
const cells = new Set();
const painted = new Set();
const colors = new Set();
let rects = 0;
let overlap = 0;
let canon = '';
for (const m of s.matchAll(/<rect\s+([^>]*?)\s*\/>/g)) {
  rects++;
  const a = {};
  // 중복 속성은 조용히 덮어쓰면 안 된다 — 브라우저는 첫 값을 쓰고 뒤를 버리는데,
  // 마지막 값만 남기면 검사기가 실제로 그려지는 색과 다른 색을 보게 된다.
  for (const [, k, v] of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    if (k in a) throw new Error(`속성 ${k} 중복 — 브라우저는 첫 값만 쓴다: ` + m[0]);
    a[k] = v;
  }
  const keys = Object.keys(a).sort().join(',');
  if (keys !== 'fill,height,width,x,y')
    throw new Error('rect 속성이 x/y/width/height/fill 이 아님(값은 큰따옴표로): ' + m[0]);
  if (!/^#[0-9a-f]{6}$/.test(a.fill)) throw new Error('fill 형식 오류: ' + a.fill);
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(a[k]));
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0)
    throw new Error('좌표/크기 오류: ' + m[0]);
  if (x + w > 24 || y + h > 24) throw new Error('타일 밖으로 나감: ' + m[0]);
  // 총 도포량이 576이어도 배경 rect 없이 조각을 이어 붙인 것일 수 있다. 규격은
  // 맨 앞 한 장이 타일 전체를 덮을 것을 요구하므로 그것부터 본다.
  if (rects === 1 && !(x === 0 && y === 0 && w === 24 && h === 24))
    throw new Error('첫 rect가 24×24 배경이 아님: ' + m[0]);
  // 출하되는 형태로 다시 찍어 둔다. 원본 문자열을 그대로 세면 속성 사이 공백
  // 같은, 소비 측이 재작성하면서 버릴 것까지 세게 된다.
  canon += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${a.fill}"/>`;
  colors.add(a.fill);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.add(j * 24 + i);
  // 배경 rect를 뺀 실제 도포 면적. Set이라 겹쳐도 중복으로 세지 않는다.
  if (rects > 1)
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        if (painted.has(j * 24 + i)) overlap++;
        painted.add(j * 24 + i);
      }
}
if (rects !== (s.match(/<rect/g) || []).length) throw new Error('형식에 안 맞는 rect가 있음');
if (cells.size !== 576) throw new Error(`빈 칸 ${576 - cells.size}개 — 배경 rect 누락?`);
if (painted.size > 230) throw new Error(`기본색 ${576 - painted.size}칸 — 346칸(60%) 미만`);
if (rects > 100) throw new Error('rect ' + rects + '개 — 100 초과');
if (colors.size > 5) throw new Error('색 ' + colors.size + '개 — 5 초과');
// 원본 파일 크기는 검사하지 않는다. 소비 측이 <rect> 목록만 읽고 래퍼를 다시
// 씌우므로 작성자의 들여쓰기·공백·<svg> 속성값은 애초에 출하되지 않고, 규격은
// 그것들을 자유라고 명시한다 — 따라서 어떤 바이트 상한을 걸어도 규격을 전부
// 지킨 파일이 공백만으로 그 위로 넘어갈 수 있다. 실제로 출하되는 양은 rect
// 개수로만 정해지고 그건 위에서 이미 100개로 묶었다. 아래 숫자는 재작성 후
// 실제 크기라 참고용으로만 찍는다.
console.log(`OK — rect ${rects}개, 색 ${colors.size}개, 기본색 ${((576 - painted.size) / 5.76).toFixed(0)}%, 출하 ${canon.length} B`);
// 겹침은 반려 사유가 아니다(화면에는 제대로 나온다). 다만 작업자가 브리프의
// 격자 절차를 따르지 않았다는 신호라, 나머지도 눈으로 더 봐야 한다는 뜻이다.
if (overlap) console.warn(`주의 — rect가 ${overlap}칸 겹침. 격자 절차를 안 거쳤을 수 있음`);
