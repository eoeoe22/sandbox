// 손그림 물질 아이콘 SVG의 파서 겸 검수기 — 규칙이 사는 곳.
//
// 두 곳이 이걸 쓴다: 납품 검수(`check-icon-svg.mjs`)와 배선용 모듈 생성
// (`build-hand-icons.mjs`). 둘이 각자 파싱하면 "검수는 통과했는데 배선은 다르게
// 읽는" 상태가 생길 수 있어 한 구현으로 묶어 둔다.
//
// **규격 자체의 단일 진실 공급원은
// `.claude/skills/create-svg-assets/MATERIAL-ICON-BRIEF.md`다.** 여기서 반려하는
// 모든 조건은 브리프에 글로도 적혀 있어야 한다 — 작성자는 저장소도 스크립트도
// 없이 브리프만 보고 그리므로, 여기에만 있는 규칙은 그에게 발견 불가능하다.

/** 타일 한 변(셀). */
export const TILE = 24;
/** 기본색이 차지해야 하는 최소 비율. */
export const BASE_SHARE = 0.6;
/** 따라서 기본색이 아닌 칸의 상한. */
export const MAX_PAINTED = Math.floor(TILE * TILE * (1 - BASE_SHARE));
/** rect 개수 상한. 출하량을 실제로 묶는 유일한 규칙이다(§7.2 참고). */
export const MAX_RECTS = 100;
/** 색 가짓수 상한. */
export const MAX_COLORS = 5;

/**
 * 아이콘 SVG 한 장을 검사하고, 출하 형태로 정규화한 `<rect>` 목록을 돌려준다.
 * 규격 위반이면 throw 한다.
 *
 * @param {string} raw 파일 내용 그대로
 * @returns {{ inner: string, rects: number, colors: number, painted: number, overlap: number }}
 *   `inner` 는 소비 측이 래퍼만 다시 씌우면 되는 정규화된 rect 나열.
 */
export function parseIconSvg(raw) {
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
  if (!new RegExp(`viewBox="0 0 ${TILE} ${TILE}"`).test(root[1]))
    throw new Error(`viewBox가 0 0 ${TILE} ${TILE} 가 아님`);
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
  let inner = '';
  for (const m of s.matchAll(/<rect\s+([^>]*?)\s*\/>/g)) {
    rects++;
    const a = {};
    // 중복 속성은 조용히 덮어쓰면 안 된다 — 브라우저는 첫 값을 쓰고 뒤를 버리는데,
    // 마지막 값만 남기면 검사기가 실제로 그려지는 색과 다른 색을 보게 된다.
    for (const [, k, v] of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
      if (k in a) throw new Error(`속성 ${k} 중복 — 브라우저는 첫 값만 쓴다: ` + m[0]);
      a[k] = v;
    }
    if (Object.keys(a).sort().join(',') !== 'fill,height,width,x,y')
      throw new Error('rect 속성이 x/y/width/height/fill 이 아님(값은 큰따옴표로): ' + m[0]);
    if (!/^#[0-9a-f]{6}$/.test(a.fill)) throw new Error('fill 형식 오류: ' + a.fill);
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(a[k]));
    if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0)
      throw new Error('좌표/크기 오류: ' + m[0]);
    if (x + w > TILE || y + h > TILE) throw new Error('타일 밖으로 나감: ' + m[0]);
    // 총 도포량이 576이어도 배경 rect 없이 조각을 이어 붙인 것일 수 있다. 규격은
    // 맨 앞 한 장이 타일 전체를 덮을 것을 요구하므로 그것부터 본다.
    if (rects === 1 && !(x === 0 && y === 0 && w === TILE && h === TILE))
      throw new Error('첫 rect가 24×24 배경이 아님: ' + m[0]);
    // 출하되는 형태로 다시 찍는다. 원본 문자열을 그대로 쓰면 속성 사이 공백처럼
    // 소비 측이 재작성하며 버릴 것까지 딸려 간다.
    inner += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${a.fill}"/>`;
    colors.add(a.fill);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.add(j * TILE + i);
    // 배경 rect를 뺀 실제 도포 면적. Set이라 겹쳐도 중복으로 세지 않는다.
    if (rects > 1)
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) {
          if (painted.has(j * TILE + i)) overlap++;
          painted.add(j * TILE + i);
        }
  }
  if (rects !== (s.match(/<rect/g) || []).length) throw new Error('형식에 안 맞는 rect가 있음');
  if (cells.size !== TILE * TILE)
    throw new Error(`빈 칸 ${TILE * TILE - cells.size}개 — 배경 rect 누락?`);
  if (painted.size > MAX_PAINTED)
    throw new Error(`기본색 ${TILE * TILE - painted.size}칸 — ${TILE * TILE - MAX_PAINTED}칸(60%) 미만`);
  if (rects > MAX_RECTS) throw new Error(`rect ${rects}개 — ${MAX_RECTS} 초과`);
  if (colors.size > MAX_COLORS) throw new Error(`색 ${colors.size}개 — ${MAX_COLORS} 초과`);
  // 원본 파일 크기는 검사하지 않는다. 소비 측이 <rect> 목록만 읽고 래퍼를 다시
  // 씌우므로 작성자의 들여쓰기·공백·<svg> 속성값은 애초에 출하되지 않고, 규격은
  // 그것들을 자유라고 명시한다 — 따라서 어떤 바이트 상한을 걸어도 규격을 전부
  // 지킨 파일이 공백만으로 그 위로 넘어갈 수 있다. 실제 출하량은 rect 개수로만
  // 정해지고, 그건 위에서 이미 묶었다.
  return { inner, rects, colors: colors.size, painted: painted.size, overlap };
}

/** 물질 영문명 → 아이콘 파일명(확장자 제외). 배선의 키이기도 하다. */
export function iconKey(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}
