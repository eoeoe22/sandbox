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
  // Black with a violet cast (the Minecraft read) — black first, violet as a hint,
  // still clearly lighter than the empty-cell background so a shell reads against
  // open air.
  //
  // Two steps down from the original `rgb(48, 36, 68)`, which read as a dark *purple
  // stone* rather than as black glass, via `rgb(43, 31, 60)`, which was darker but
  // still carried enough chroma to read as purple. This one takes another eighth of
  // the light out and, as much to the point, takes a third of the chroma out with it:
  // blue sits 18 above green here where it sat 29 in the first colour. Nearly a
  // quarter darker than the original overall, and the violet is now a cast rather
  // than a hue.
  //
  // **How dark it can go is set by the grain, not by taste.** The floor is the eraser's
  // `rgb(16, 16, 22)`, and what has to clear it is not this colour but the material's
  // DARKEST flake — the base taken down by the full `colorVary` + `tintCellVary`. At
  // the 14 + 4 this material first carried, that was 18 steps and *no* colour dark
  // enough to read as black could clear the bar: `rgb(36, 26, 51)` put the darkest
  // flake at luminance 13.8 against the board's 16.7, so the deep flakes of a shell
  // would have been darker than open air — holes punched through it. Going darker
  // therefore meant narrowing the grain, which is what happened (see below). Every
  // step this colour goes down, the amplitudes have to give one back.
  //
  // `test/materialicons.ts` measures the margin in luminance rather than per channel —
  // the green is deliberately the low channel here, so a per-channel floor would be a
  // floor on the hue instead of on the contrast — and states it as a *ratio* to the
  // board (1.5×), because at these levels the eye judges by relative difference. This
  // colour clears it at 1.55×, so there is a little headroom left but not much: the
  // next darkening step needs the grain to narrow again.
  color: rgb(36, 30, 48),
  // A glassy, conchoidal fracture, drawn as a TWO-LEVEL grain: a wide spread
  // between 2×2 flakes and a narrow one inside each. Coal carries the same structure
  // for the same reason — both are dark rock that breaks into broad faces, and this
  // is the one texture that says so — at its own, much wider 14 + 4, because Coal's
  // colour is not being pushed against the same floor.
  //
  // **The wide level went 14 → 6 → 14 → 6, and the round trip is the point.** 14 was
  // the original value and it came out as coarse noise, so it was narrowed to 6. That
  // diagnosis was half right: the base is near-black, so the same number does swing
  // further here than on a mid-tone material — but what actually made it noise was
  // that its features were ONE CELL across, which reads as dust settled on the
  // surface rather than as stone. Narrowing the spread hid the symptom and cost the
  // material its contrast. Blocking the sample (below) fixed the real cause, so the
  // spread went back to 14 as a facet-to-facet difference rather than as static.
  //
  // It is back at 6 now for a different reason, and not as a retraction of that: the
  // colour above went darker again, and amplitude and darkness trade one for one
  // against the legibility floor (see the colour). 6 + 2 is the widest grain that
  // leaves room for a base this black. The *structure* is what carries the material —
  // faces several cells across with grit inside them — and that survives the
  // narrowing; the 3:1 ratio between the two levels is held exactly as it was.
  //
  // Both numbers are shared by the canvas and the icon generator (`varyAmplitude` /
  // `varyCellAmplitude`), so this pair narrows or widens both at once.
  colorVary: 6,
  tintCellVary: 2,
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
