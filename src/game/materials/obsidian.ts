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
  //
  // Darkened from `rgb(48, 36, 68)`: at that value the violet read as a dark *purple
  // stone* rather than as black glass. This keeps the cast (which is what makes it
  // obsidian and not coal) and takes about an eighth of the light out.
  //
  // **How dark it can go is set by the grain, not by taste.** The floor is the eraser's
  // `rgb(16, 16, 22)`, and what has to clear it is not this colour but the material's
  // DARKEST flake — the base taken down by the full `colorVary` + `tintCellVary`, which
  // is 18 steps. It briefly sat at `rgb(36, 26, 51)`, which looked right on its own and
  // put that darkest flake at luminance 13.8 against the board's 16.7: the deep flakes
  // of a shell would have been *darker than open air*, i.e. holes. Every step this
  // colour goes down, the widest grain has to give one back.
  //
  // `test/materialicons.ts` measures the margin in luminance rather than per channel —
  // the green is deliberately the low channel here, so a per-channel floor would be a
  // floor on the hue instead of on the contrast.
  color: rgb(43, 31, 60),
  // A glassy, conchoidal fracture, drawn as a TWO-LEVEL grain: a wide spread
  // between 2×2 flakes and a narrow one inside each. Coal carries exactly the same
  // three settings for the same reason — both are dark rock that breaks into broad
  // faces, and this is the one texture that says so.
  //
  // **The wide level went 14 → 6 → 14, and the round trip is the point.** 14 was the
  // original value and it came out as coarse noise, so it was narrowed to 6. That
  // diagnosis was half right: the base is near-black, so the same number does swing
  // further here than on a mid-tone material — but what actually made it noise was
  // that its features were ONE CELL across, which reads as dust settled on the
  // surface rather than as stone. Narrowing the spread hid the symptom and cost the
  // material its contrast. Blocking the sample (below) fixed the real cause, and once
  // a face is several cells wide a 14-step difference *between* faces is a facet
  // catching the light. So the fix was feature size, not amplitude.
  //
  // What stays narrow is the grain *inside* a face: 4, under Diamond's deliberately
  // low 10. Without it a flake is a flat painted square — the blocked level alone
  // gives shape with no surface.
  //
  // Both numbers are shared by the canvas and the icon generator (`varyAmplitude` /
  // `varyCellAmplitude`), so this pair narrows or widens both at once.
  colorVary: 14,
  tintCellVary: 4,
  // The block that makes the wide level a *facet* rather than static. Obsidian
  // fractures conchoidally: it breaks into broad curved faces, and a face is many
  // cells wide, not one. Positional, so it only holds up on a material that doesn't
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
