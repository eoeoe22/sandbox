import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_GLASS, GLASS_MELT_TEMP } from './moltenglass';
import { BROKEN_GLASS } from './brokenglass';
import { tryPhaseChange } from './phasechange';

// Solid: a clear, rigid pane — what Molten Glass sets into once it cools (see
// moltenglass.ts). Like Stone it just sits there, but it's `acidResistant`
// (acid runs off it, so it makes acid-proof containers) and, heated back past
// its melting point (GLASS_MELT_TEMP — lower than raw sand's, since fused glass
// only has to soften), it re-melts into Molten Glass — the exact mirror of
// Stone↔Lava, so a glass wall against a hot enough source (Lava, Blue Flame,
// Molten Iron, a Thermite burn) softens and flows away. It's not
// indestructible, though: a Blast shatters it like any other non-Wall solid.
//
// Brittle, too: a shock it can't be fully broken by — a Gunpowder concussion, a
// weak blast, or a Woofer's power-0 shockwave — still CRAZES it into Broken
// Glass (가루) rather than leaving it untouched (`shatterId`, applied by the
// crater flood and the pressure wave in blast.ts). A strong enough blast still
// obliterates the pane outright (the ordinary crater flash), the same as any
// other solid — only the weaker shocks it survives leave a heap of shards.
function updateGlass(x: number, y: number, sim: SimContext): void {
  if (tryPhaseChange(x, y, sim)) return;
}

export const GLASS = register({
  id: 32,
  name: 'Glass',
  phase: Phase.Solid,
  color: rgb(200, 225, 235),
  density: 1000,
  acidResistant: true,
  // A shock too weak to shatter the pane outright (Gunpowder/weak blast/Woofer)
  // still crazes it into Broken Glass instead of leaving it intact — see
  // blast.ts's shatter hook and brokenglass.ts.
  shatterId: BROKEN_GLASS.id,
  category: 'solid',
  thermal: { conductivity: 0.4 },
  // 녹는점 — lower than loose Sand's, because a fused pane only has to soften.
  phaseChange: { at: () => GLASS_MELT_TEMP, when: 'atOrAbove', into: () => MOLTEN_GLASS.id },
  update: updateGlass,
});
