/**
 * Create a fixed-position `<div>` appended to `document.body`, the shared
 * shape behind every screen-space overlay (the sandbox resize handle, the
 * brush cursor outline): positioned in CSS px, styled via its own class.
 */
export function createFloatingOverlay(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  document.body.appendChild(el);
  return el;
}
