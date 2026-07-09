import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// The lightest cut of crude — the petroleum gas (LPG) that boils off first when
// oil is gently heated (see oil.ts's distillation). It's a *product*, not a
// process fume: unlike Petroleum Vapor it never condenses back to a liquid, it
// just rises and disperses. Lighter than every other gas so it races to the top
// and pools under a lid. Marked `flammable`, so a stray Fire flashes it off with
// the characteristic gas whoosh (Fire's global ignite pass handles it — see
// fire.ts), the way real LPG catches. Inherits the default gas movement.
export const PETROLEUM_GAS = register({
  id: 58,
  name: 'Petroleum Gas',
  phase: Phase.Gas,
  color: rgb(210, 215, 170),
  density: 0.8,
  flammable: true,
  category: '석유',
  thermal: { init: 60, conductivity: 0.08 },
});
