import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from './moltenaluminum';
import { ACID } from './acid';
import { HYDROGEN } from './hydrogen';

// Aluminum — cast solid metal, the product end of the aluminum line:
// **Aluminum Powder → (heat past 660°) → Molten Aluminum → (cool) → Aluminum**.
// Iron reaches the same place only through the whole 철광석 제련 chain (ore →
// melt → carbon reduction → pour); aluminum gets there from one palette powder
// and any fire, which is the trade the two metals are built around.
//
// What you get for that cheapness is a metal that is *better* than Iron at
// three of the four things Iron is used for, and hopeless at the fourth:
//
//  • Heat: conductivity 0.9 — above Iron's 0.85, below Diamond's 0.95 — so an
//    aluminum bar is a better heat bridge than an iron one. Real aluminum
//    conducts roughly three times the heat iron does, so this is the honest
//    ordering, and it makes a cheap heat spreader for a furnace or a cooler.
//  • Electricity: `conductive` like Iron/Wire, and lossless (registered at
//    CONDUCTOR_LOSS 0 in spark.ts) — a spark runs the full length of an
//    aluminum bus bar. Real transmission lines are aluminum, not copper, for
//    exactly the weight reason. Like Iron, its only per-tick job as a static
//    solid is ticking down the post-spark refractory stamped into its `aux`.
//  • Light: `laserReflective`, so a Heat Ray bounces off it with a clean 정반사
//    (see heatray.ts). Until now every laser mirror was expensive or awkward —
//    Iron needs the smelting line, Mercury and Gallium are liquids that run
//    away, Heatpipe is a late-game solid. Aluminum is *the* real-world mirror
//    metal (every telescope mirror is aluminized), and a pour of it gives the
//    laser toys a cheap, castable mirror for the first time.
//  • Heat *resistance*: none. It melts at 660° — under Stone (1100°), Glass
//    (1150°) and Iron (1200°), and under a bare Fire's ~1000°. So an aluminum
//    wall, mirror or bus bar slumps in the very fire that cast it. Aluminum
//    is the cheap metal you build with everywhere the heat can't reach.
//    (Deliberately *not* phrased as "the lowest melting point of any
//    structural solid" — that superlative has been wrong twice. Gallium melts
//    at 30° and Asphalt softens at 200°, both `Phase.Solid`. The comparison
//    against Stone/Glass/Iron is the point; the ranking isn't, and it breaks
//    every time a low-melting solid joins the roster.)
//
// Deliberately not `magnetic` — aluminum isn't ferrous, exactly as its powder
// isn't (see aluminumpowder.ts), so an Electromagnet won't drag a cast bar
// around either. It has no acid resistance, so Acid dissolves it like Iron —
// but not silently: a bar in acid fizzes hydrogen off the wetted face, the same
// reaction its powder runs (see the `reactions` row below).

// Per-tick, per-contact chance a *cast* face dissolves into a hydrogen bubble —
// a third of the loose powder's rate (0.12, see aluminumpowder.ts). Bulk metal
// presents one flat surface to the acid where dust presents all of itself, and
// the slower rate is what makes the difference visible: a bar fizzes away over
// a while, a pinch of powder is gone in a flurry.
const ACID_REACT_CHANCE = 0.04;
// Matches the powder's, and for the same reason: under Hydrogen's 200°
// autoignition so the gas gets to rise and collect instead of lighting at birth.
const ACID_REACT_HEAT = 25;
function updateAluminum(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again
  // (the same one-way "recently energized" memory Iron and Wire keep — see
  // spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (sim.getTemp(x, y) >= ALUMINUM_MELT_TEMP) {
    // In-place `set` keeps the (now high) temperature so the fresh Molten
    // Aluminum reads as molten instead of instantly re-freezing next tick
    // (mirrors Iron → Molten Metal).
    sim.set(x, y, MOLTEN_ALUMINUM.id);
  }
}

export const ALUMINUM = register({
  id: 136,
  name: 'Aluminum',
  phase: Phase.Solid,
  // A brighter, cooler silver than Iron's rgb(135, 140, 150) — the same
  // separation its powder keeps from Metal Powder, so cast aluminum and cast
  // iron never read as the same slab.
  color: rgb(186, 192, 200),
  // The structural-solid convention (Iron, Gallium, Heatpipe): a solid never
  // sinks or floats, so the number is only a "never displaced" sentinel.
  density: 1000,
  conductive: true,
  category: 'solid',
  // The real-world mirror metal: a Heat Ray reflects off it cleanly (정반사).
  laserReflective: true,
  // Better than Iron (0.85), short of Diamond (0.95) — the honest ordering for
  // a metal that conducts heat roughly three times as well as iron does.
  thermal: { conductivity: 0.9 },
  // Acid eats it either way (it isn't `acidResistant`, so acid.ts's phase-only
  // corrosion pass already dissolved it to nothing) — this row only makes sure
  // the reaction has the product it should: the acid cell becomes a rising
  // hydrogen bubble instead of both cells quietly blinking out. Same shape and
  // same reasoning as the powder's row (aluminumpowder.ts), just slower.
  reactions: [
    {
      with: ACID.id,
      produce: EMPTY,
      otherBecomes: HYDROGEN.id,
      probability: ACID_REACT_CHANCE,
      heat: ACID_REACT_HEAT,
    },
  ],
  update: updateAluminum,
});
