// The codex's icon sprite — one `<symbol>` per material and object, emitted into
// the page once and referenced with `<use>` from everywhere it appears.
//
// The palette can afford to inline a fresh copy of a chip's SVG at every use
// site (that is exactly what `materialSvgFor` is built for — see spriteSvg.ts's
// note on why those strings carry no `id`), because a palette shows a few dozen
// chips at a time. The codex shows all 127 at once, twice over: once in the grid
// and again at four times the size in the detail view. Inlining there would put
// every icon in the HTML twice and then a third time inside the island's
// serialized props, where every quote costs six bytes as `&quot;`. A sprite
// pays for each drawing exactly once and leaves `<use href="#codex-m-3"/>` — a
// few dozen bytes — at the use sites.
//
// The conversion is a wrapper swap, and it is deliberately strict: `svgSymbol`
// asserts the exact `<svg …>` shape `pixelSvg` produces and throws otherwise, so
// a change to that helper breaks the build here instead of quietly emitting
// symbols with no drawing in them.

import { MATERIALS } from '../materials';
import { materialSvgFor } from '../render/materialSvg';
import { objectSvgFor } from '../render/objectSvg';
import { OBJECT_KINDS } from '../../state/store';

/** `<symbol>` id for a material's icon. */
export const materialSymbolId = (id: number): string => `codex-m-${id}`;

/** `<symbol>` id for an object's icon. */
export const objectSymbolId = (kind: string): string => `codex-o-${kind}`;

/** The `viewBox` and body of a `pixelSvg` string, or a throw if it isn't one. */
function svgParts(svg: string, what: string): { viewBox: string; inner: string } {
  const match = /^<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/.exec(svg);
  if (match === null) {
    throw new Error(
      `codex: the icon for ${what} is not the <svg viewBox="…">…</svg> shape pixelSvg emits — ` +
        `render/spriteSvg.ts changed and src/game/codex/icons.ts has to follow.`,
    );
  }
  return { viewBox: match[1], inner: match[2] };
}

function svgSymbol(id: string, svg: string, what: string): string {
  const { viewBox, inner } = svgParts(svg, what);
  // `preserveAspectRatio` and `shape-rendering` ride on the symbol so a `<use>`
  // site needs no attributes of its own to get the same crisp, centred drawing
  // the palette gets.
  return (
    `<symbol id="${id}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" ` +
    `shape-rendering="crispEdges">${inner}</symbol>`
  );
}

/**
 * The whole sprite as one hidden `<svg>`, ready to be dropped into the page.
 * Build-time only — it pulls in the registry and the renderer.
 */
export function buildIconSprite(): string {
  const symbols = [
    ...MATERIALS.map((m) => svgSymbol(materialSymbolId(m.id), materialSvgFor(m), m.name)),
    ...OBJECT_KINDS.map((k) => svgSymbol(objectSymbolId(k), objectSvgFor(k), k)),
  ];
  // `aria-hidden` plus zero size: the sprite is a definition block, not a
  // picture. `position:absolute` keeps it out of layout even if a stylesheet
  // ever gives `svg` a default display.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ` +
    `style="position:absolute;width:0;height:0;overflow:hidden">${symbols.join('')}</svg>`
  );
}
