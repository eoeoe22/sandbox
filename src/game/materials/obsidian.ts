import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { LAVA } from './lava';
import { STONE_MELT_TEMP } from './stone';

// Obsidian (흑요석) — what Lava turns into where it *directly touches Water*
// (see lava.ts's quench branch, which is the only thing that produces it): the
// melt is chilled far too fast to grow the crystals Stone gets, so it sets as a
// black volcanic glass instead of grey rock.
//
// 고증보다 재미 우선: real obsidian is a brittle glass that shatters at a tap,
// but the familiar Minecraft reading of "water + lava = the blast-proof block"
// is far more fun to build with, so this one is `explosionProof` — a Blast
// front stops at it and casts a shadow over what's behind, and a flying Ember
// shatters on it, exactly like Diamond and the Wall. Quench a lava lake and you
// get a bomb shelter, which is the whole point of the material.
//
// It is *not* invincible, though — two deliberate ways out:
//  • Heat. It melts at STONE_MELT_TEMP, the exact same 1100° as Stone (shared
//    straight from stone.ts so the two can never drift apart), and melting it
//    just gives Lava back. So an obsidian shell is only permanent while it
//    keeps shedding heat: leave a thin one against a big molten pool with no
//    water left to cool it and the pool eats its way back out.
//  • Acid. It isn't `acidResistant`, so Acid dissolves it like any ordinary
//    solid — the counter-play to an otherwise blast-proof wall.
//
// STONE_MELT_TEMP is read *inside* updateObsidian rather than copied into a
// module-level constant here on purpose: stone.ts → lava.ts → obsidian.ts →
// stone.ts is a live import cycle, so at the moment this module's body runs,
// stone.ts's own body may not have executed yet and the binding would still be
// in its temporal dead zone. Reading it from inside the update — long after
// every module has finished loading — is always safe. (Same reason lava.ts and
// stone.ts only ever touch each other's `.id` from inside a function.)
function updateObsidian(x: number, y: number, sim: SimContext): void {
  if (sim.getTemp(x, y) >= STONE_MELT_TEMP) {
    // In-place `set` keeps the cell's (now high) temperature, so the fresh Lava
    // reads as molten instead of instantly re-setting next tick — the same
    // hand-off Stone↔Lava uses.
    sim.set(x, y, LAVA.id);
  }
}

export const OBSIDIAN = register({
  id: 124,
  name: 'Obsidian',
  phase: Phase.Solid,
  // Near-black with a violet cast (the Minecraft read), still clearly lighter
  // than the empty-cell background so a shell reads against open air.
  color: rgb(48, 36, 68),
  // A glassy, uneven fracture — a little per-particle variation keeps a big
  // slab from looking like one flat painted rectangle.
  //
  // Deliberately *narrow* (below Concrete's 7, well below Diamond's 10): the base
  // is near-black, so a channel sits around 36–68 and the ±spread reads as a much
  // larger swing than the same number does on a mid-tone material — at the original
  // 14 a slab (and its palette chip) came out as coarse noise rather than glass.
  // The amplitude is shared by the canvas and the icon generator through
  // `varyAmplitude`, so this one number narrows both.
  colorVary: 6,
  // …and *blocked* into 2×2 flakes rather than left as per-cell noise. Obsidian
  // fractures conchoidally: it breaks into broad curved faces, and a face is many
  // cells wide, not one. Sampling the tint at the cell itself gave a grain whose
  // features were a single cell across, which reads as dust settled on the surface
  // — doubling the sample block makes the same six brightness steps read as facets
  // catching the light. Positional, so it only holds up on a material that doesn't
  // move; Obsidian never does (see Material.tintBlock).
  tintBlock: 2,
  density: 1000,
  explosionProof: true,
  category: 'solid',
  // Volcanic *glass*, so it conducts like Glass (0.4) rather than like Stone
  // (0.5): a shell insulates the lava behind it slightly better than a stone
  // crust would, which is what lets a quenched shell survive.
  thermal: { conductivity: 0.4 },
  update: updateObsidian,
});
