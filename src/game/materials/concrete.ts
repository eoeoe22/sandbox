import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Concrete — hardened Cement (see cement.ts): a static, rigid solid you build
// structures out of. Like Stone it just sits there and, being an ordinary
// (non-Wall) solid, it can still be shattered by a Blast or eaten by Acid — it's
// strong, not indestructible. The whole point of the Cement→Concrete pair is
// letting you *pour* a shape and set it, rather than only painting solids
// directly.
export const CONCRETE = register({
  id: 46,
  name: 'Concrete',
  phase: Phase.Solid,
  color: rgb(110, 112, 118),
  colorVary: 7,
  density: 1000,
  category: '고체',
  thermal: { conductivity: 0.4 },
});
