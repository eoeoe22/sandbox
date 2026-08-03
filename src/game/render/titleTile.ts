// 시작 화면(`/`) 타이틀의 픽셀 틴트 타일.
//
// 타이틀 두 줄은 자기가 이름 붙인 물질의 색을 쓴다 — PARTICLE은 물, SANDBOX는
// 모래. 예전엔 그걸 CSS `linear-gradient` 두 개로 칠했는데, 부드러운 세로
// 그라디언트는 이 게임이 한 번도 그리지 않는 것이다 — 캔버스는 안티에일리어싱이
// 전혀 없는 최근접 렌더러라 그라디언트가 밴딩으로 깨지고, 그래서 인월드의 부피감은
// 언제나 밴드와 틴트로 만들어진다. 화면 밖에서 온 색처럼 보이던 이유다. 여기서는
// 캔버스가 실제로 그리는 것을 그대로 만든다: **평면 기본색 + 셀별 밝기 틴트**.
//
// 그리는 것은 작은 정사각 타일 하나뿐이고, CSS가 그걸 `background-repeat`로
// 글자 안에 깔면 된다(`background-clip: text`). 셀 색은 `tintNoise.grain` —
// 팔레트 아이콘과 같은 함수, 즉 렌더러와 같은 산술이다. 물(액체)은 위치 기반
// 배경 필드를, 모래(가루)는 알갱이별 흰 노이즈를 표본하므로, 두 줄의 결이 다른
// 것까지 인월드와 같은 이유로 다르다.
//
// 정적 페이지의 빌드 타임에 한 번 돌고 결과 문자열이 HTML에 인라인되므로
// 런타임 비용은 0이다. 해시가 순수 함수라 빌드마다 같은 바이트가 나온다.
import type { Material } from '../engine/types';
import { grain } from './tintNoise';
import { spritePaths, pixelSvg } from './spriteSvg';

/**
 * 타일 한 변의 셀 수.
 *
 * 노이즈 타일이라 이어지는 자리에 솔기가 보이지는 않지만, 주기가 짧으면 같은
 * 얼룩이 되풀이되는 게 눈에 띈다. 16이면 0.1em 셀 기준 한 변이 1.6em이라 큰
 * 제목 한 줄에 대여섯 번만 반복되고, 마크업은 256셀 = 4 KB 남짓에서 멎는다
 * (`spritePaths`가 색별로 묶어 주므로 셀당 십여 글자다).
 */
export const TITLE_TILE_CELLS = 16;

/** 한 물질의 타일 픽셀 버퍼. 모든 칸이 칠해진다 — 투명 센티넬 0은 쓰지 않는다
 *  (배경 이미지라 뚫린 칸이 있으면 그대로 구멍이 된다). */
function buildTile(m: Material): Uint32Array {
  const n = TITLE_TILE_CELLS;
  const buf = new Uint32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) buf[y * n + x] = grain(m, m.color, x, y);
  }
  return buf;
}

/** 물질 id → 완성된 `url(...)` 문자열. 페이지 하나가 같은 물질을 여러 번 물어도
 *  타일은 한 번만 만든다. */
const CACHE = new Map<number, string>();

/**
 * `background-image`에 그대로 넣을 수 있는 CSS `url("data:image/svg+xml,…")`.
 *
 * 래퍼는 팔레트 칩과 같은 `pixelSvg`다 — `shape-rendering="crispEdges"`가 여기서도
 * 하는 일이 같다(셀 경계에 안티에일리어싱을 넣지 않는다). 칩용 속성(`class`,
 * `aria-hidden`)은 배경 이미지 안에서 아무 일도 하지 않으므로, 래퍼를 한 벌 더
 * 만드는 것보다 공유하는 편이 낫다. `viewBox`가 정사각이고 CSS가 `background-size`도
 * 정사각으로 주므로 `meet`은 정확히 꽉 채운다.
 *
 * `encodeURIComponent`는 `#`·`<`·`>`·`"`를 모두 이스케이프하므로 결과에 CSS
 * `url("…")`를 깨뜨릴 문자가 남지 않는다(SVG 쪽에는 괄호가 없다).
 */
export function titleTileUrl(m: Material): string {
  const hit = CACHE.get(m.id);
  if (hit !== undefined) return hit;
  const n = TITLE_TILE_CELLS;
  const svg = pixelSvg(n, n, spritePaths(buildTile(m), n, n), 'title-tile');
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  CACHE.set(m.id, url);
  return url;
}
