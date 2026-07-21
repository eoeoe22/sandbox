// Shared 4-direction aux encoding for materials whose facing is set by the
// drag direction used to paint them. Conveyor established the convention
// (0/unset and 1 ⇒ right, 2 ⇒ left; see conveyor.ts's CONVEYOR_RIGHT/LEFT,
// which hold these exact same numeric values) back when it only ever ran
// left/right; Fan (fan.ts) needs all four cardinals, so this module is the one
// place both agree on what the aux byte means, and CanvasRenderer's `arrow`
// chevron draw (see Material.arrow) reads these same values generically
// across every arrow material instead of each one inventing its own.
export const DIR_RIGHT = 1;
export const DIR_LEFT = 2;
export const DIR_UP = 3;
export const DIR_DOWN = 4;

/** Unit (dx,dy) step for a packed direction aux value. Unrecognized/0 ⇒ RIGHT,
 *  matching Conveyor's original default. */
export function dirVecFor(aux: number): readonly [number, number] {
  switch (aux) {
    case DIR_LEFT:
      return [-1, 0];
    case DIR_UP:
      return [0, -1];
    case DIR_DOWN:
      return [0, 1];
    default:
      return [1, 0];
  }
}
