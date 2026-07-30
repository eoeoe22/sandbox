import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_ZINC, ZINC_MELT_TEMP } from './moltenzinc';

// Zinc (아연) — the palette's dedicated **수소 발생 금속**. Drop a bar of it in Acid
// and it fizzes hydrogen off every wetted face until one of the two runs out.
//
// Why zinc and not another metal: **Zn + 2HCl → ZnCl₂ + H₂** is *the* acid-metal
// reaction. It is the one in Kipp's apparatus, the one in every school lab's
// hydrogen bottle, and the reason granulated zinc sits in a jar next to the
// hydrochloric acid — because zinc sits comfortably above hydrogen in the activity
// series (−0.76 V) yet is stable enough in air to just leave lying about. Until now
// the game's only answer to "how do I make hydrogen" was aluminum: either the
// powder in acid, or the gallium-activated dust in water. Both are dusts you pour;
// this is a solid you build with, so a generator can be a *structure* — a zinc
// floor in an acid tank, tapped from above — instead of a heap you top up.
//
// Its rate (see `acidHydrogen` below) is double cast Aluminum's for a reason that
// is also the honest one: aluminum's oxide film is what makes bulk aluminum sluggish
// until the acid eats through it, while zinc corrodes evenly and keeps presenting
// fresh metal. So per wetted face, a zinc slab out-fizzes an aluminum slab.
//
// What it is *not*:
//
//  • **Not a mirror.** Zinc is shiny when fresh and dull grey within days (that
//    grey film is the whole point of galvanizing), so it is deliberately not
//    `laserReflective` — a Heat Ray is absorbed by it. Cast Aluminum stays the
//    cheap laser mirror; this is the cheap gas generator. Two metals, two jobs.
//  • **Not magnetic** — zinc is diamagnetic, so like Aluminum it stays put when an
//    Electromagnet sweeps iron filings out of a mixed heap.
//  • **Not heat-proof.** It melts at 420° (see moltenzinc.ts), the lowest melting
//    point of any structural metal here — under Aluminum (660°), Stone (1100°) and
//    Iron (1200°), and under a bare Fire. A zinc structure is for cold, wet places;
//    put a flame near it and you get a puddle you can re-cast.
function updateZinc(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again —
  // the same one-way "recently energized" memory Iron, Aluminum and Wire keep
  // (see spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= ZINC_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten Zinc
    // reads as molten instead of instantly re-freezing next tick (mirrors
    // Iron → Molten Metal and Aluminum → Molten Aluminum).
    sim.set(x, y, MOLTEN_ZINC.id);
  }
}

export const ZINC = register({
  // 146 — the next free id (145 was Ammonal, the last of the previous round). The
  // retired numbers (14, 15, 30, 35, 64, 72, 76, 142) stay retired: save files store
  // material ids verbatim, so recycling one silently renders old worlds wrong.
  id: 146,
  name: 'Zinc',
  phase: Phase.Solid,
  // A distinctly *blue* grey — real zinc is a bluish-white metal, and the blue cast
  // is what separates it at a glance from the palette's other grey metals: Iron
  // rgb(135, 140, 150) is neutral and darker, cast Aluminum rgb(186, 192, 200) is
  // neutral and much brighter, and Gallium rgb(178, 188, 202) is blue but far
  // lighter. Its melt keeps the same cast (see moltenzinc.ts).
  color: rgb(143, 164, 182),
  // The structural-solid convention (Iron, Aluminum, Gallium, Heatpipe): a solid
  // never sinks or floats, so the number is only a "never displaced" sentinel. Its
  // *melt* carries the real density (6.7 — zinc is a heavy metal, see moltenzinc.ts).
  density: 1000,
  conductive: true,
  // 배선재: a metal, so a generator gated to "wiring only" (the Turbine — see
  // spark.ts's PulseGate) will feed it. Zero-loss, as all wiring is — real zinc
  // conducts about a third as well as copper, which is ordinary metal territory and
  // nowhere near the resistive-alloy behavior Nichrome exists to model.
  wiring: true,
  category: 'solid',
  // Between Iron (0.85) and Aluminum (0.9), the honest ordering: zinc conducts heat
  // (116 W/m·K) better than iron (80) and well short of aluminum (237).
  thermal: { conductivity: 0.87 },
  // 산 + 아연 → 수소, the material's whole purpose, and the second-fastest solid on
  // the shared table — twice cast Aluminum's 0.04, still under the loose powders
  // (0.12 / 0.2) that present all of themselves to the acid. The rate table and the
  // activity-series reasoning live in acidhydrogen.ts.
  acidHydrogen: 0.08,
  update: updateZinc,
});
