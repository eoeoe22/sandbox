import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from './moltenaluminum';
import { tryPhaseChange } from './phasechange';
import { chlorineMetalBurn } from './chlorine';

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
const ACID_HYDROGEN_CHANCE = 0.04;

// ── 염소 속에서 타는 알루미늄 ────────────────────────────────────────────────
// **Aluminum + Chlorine → 불꽃 + 흰 연기** (2Al + 3Cl₂ → 2AlCl₃; the rule itself
// and why it makes no solid product are in chlorine.ts's `chlorineMetalBurn`).
//
// The bar is the one form of the metal that has to be *hot* first, and that gate
// is the whole reason this row is declared here on the metal's side rather than
// in chlorine.ts: `tempMin` reads the declaring cell, and only the bar knows how
// hot the bar is (chlorine barely conducts heat — 0.06 — so a gas cell against a
// glowing bar can still read ambient).
//
// 250° is picked to sit in the gap the metal already has: it is well clear of
// anything a room reaches on its own, and comfortably under the 660° melt point,
// so the honest sequence is "heat the bar, watch it burn" and not "heat the bar,
// watch it turn into Molten Aluminum first". Real bulk aluminum is protected by
// its oxide skin and needs warming (or a trace of moisture) before chlorine will
// take it, which is the same fact that makes the powders react cold here: dust
// is mostly surface, and the activated dust has no skin left at all.
const CHLORINE_REACT_TEMP = 250;
// …and slowly even then — a sixth of the activated dust's 0.4 and a third of the
// plain powder's 0.2. One flat face against the gas, the same reasoning the acid
// rate above uses.
const CHLORINE_REACT_CHANCE = 0.06;

function updateAluminum(x: number, y: number, sim: SimContext): void {
  // Tick down the post-spark refractory so the cell becomes energizable again
  // (the same one-way "recently energized" memory Iron and Wire keep — see
  // spark.ts).
  const refractory = sim.getAux(x, y);
  if (refractory > 0) sim.setAux(x, y, refractory - 1);

  if (tryPhaseChange(x, y, sim)) return;
}

export const ALUMINUM = register({
  id: 136,
  name: 'Aluminum',
  phase: Phase.Solid,
  // A brighter, cooler silver than Iron's rgb(135, 140, 150) — the same
  // separation its powder keeps from Iron Powder, so cast aluminum and cast
  // iron never read as the same slab.
  color: rgb(186, 192, 200),
  // The structural-solid convention (Iron, Gallium, Heatpipe): a solid never
  // sinks or floats, so the number is only a "never displaced" sentinel.
  density: 1000,
  conductive: true,
  // 배선재: a metal, so a generator gated to "wiring only" (the Turbine — see
  // spark.ts's PulseGate) will feed it. Zero-loss, as all wiring is.
  wiring: true,
  category: 'solid',
  // The real-world mirror metal: a Heat Ray reflects off it cleanly (정반사).
  laserReflective: true,
  // Better than Iron (0.85), short of Diamond (0.95) — the honest ordering for
  // a metal that conducts heat roughly three times as well as iron does.
  thermal: { conductivity: 0.9 },
  // Acid eats it either way (it isn't `acidResistant`), but not silently: a bar
  // standing in acid fizzes, the acid cell becoming the rising hydrogen bubble.
  // Same tag and same reasoning as the powder's (aluminumpowder.ts), just slower.
  acidHydrogen: { chance: ACID_HYDROGEN_CHANCE },
  // 달군 뒤 염소를 쐬면 탄다 — the bar's only reaction row (see the constants
  // above for the gate and chlorine.ts for the reaction).
  reactions: [chlorineMetalBurn(CHLORINE_REACT_CHANCE, CHLORINE_REACT_TEMP)],
  // 녹는점 — mirrors Iron → Molten Iron.
  phaseChange: { at: () => ALUMINUM_MELT_TEMP, when: 'atOrAbove', into: () => MOLTEN_ALUMINUM.id },
  update: updateAluminum,
});
