/**
 * A rectangle within a display surface. Used for the sandbox's on-screen
 * placement — in CSS pixels for hit-testing and in device pixels for
 * rendering. The scale between the two is uniform, so the same rect math works
 * in either unit.
 */
export interface ViewRect {
  /** Left offset within the container. */
  x: number;
  /** Top offset within the container. */
  y: number;
  /** Rectangle width. */
  width: number;
  /** Rectangle height. */
  height: number;
}

/** A rectangle of the given size, centered inside the container. */
export function centeredRect(
  containerW: number,
  containerH: number,
  rectW: number,
  rectH: number,
): ViewRect {
  return {
    x: (containerW - rectW) / 2,
    y: (containerH - rectH) / 2,
    width: rectW,
    height: rectH,
  };
}
