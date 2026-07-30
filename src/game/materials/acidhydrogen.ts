import { getMaterial } from './registry';
import type { SimContext } from '../engine/SimContext';
import { HYDROGEN } from './hydrogen';

// 산 + 금속 → 수소 — the one place the acid-metal reaction lives, shared by every
// acidic medium (liquid Acid, Acid Vapor, Acid Slime) and driven by one number on
// the metal (`Material.acidHydrogen`).
//
// **Which metals, and why.** A metal displaces hydrogen from an acid only if it
// sits *above* hydrogen in the activity series (이온화 경향) — that single fact is
// the whole design, and it is what decides who gets tagged:
//
//   | metal            | 물질                     | acidHydrogen | 근거 |
//   |------------------|--------------------------|--------------|------|
//   | Na (−2.71 V)     | Sodium                   | own path     | 산은 물보다 격렬 — sodium.ts |
//   | Al (−1.66 V)     | Activated Aluminum       | 0.2          | 산화 피막이 없는 활성 표면 |
//   | Al               | Aluminum Powder          | 0.12         | 가루 = 표면 전부가 반응면 |
//   | Zn (−0.76 V)     | Zinc                     | 0.08         | 실험실의 표준 수소 발생 금속 |
//   | Al               | Aluminum (cast)          | 0.04         | 덩어리 = 젖은 한 면만 |
//   | Fe (−0.44 V)     | Metal Powder (철가루)    | 0.05         | 철이지만 가루 |
//   | Fe               | Iron                     | 0.03         | 느리지만 확실히 녹는다 |
//   | Ga (−0.55 V)     | Gallium                  | 0.015        | 양쪽성이지만 산에는 아주 느리다 |
//
// and who deliberately does **not**:
//
//   • **Mercury** — below hydrogen (+0.85 V). 묽은 산에 수은을 담가도 수소는 나오지
//     않는다. It is also a Liquid, which acid's phase-gated corrosion pass never
//     touches, so it needs no tag to be inert here — but the reason it *shouldn't*
//     have one is the activity series, not the phase.
//   • **Nichrome** — `acidResistant` already (a passive chromium-oxide film), the
//     honest answer for a corrosion-resistant alloy: acid doesn't get to the metal
//     at all, so there is nothing to give off.
//   • **Rust / Iron Ore / Slag** — already oxidized. 산이 산화철을 녹이면 염화철과
//     물이 되고, 수소는 나오지 않는다. Acid still eats them, silently, as before.
//   • **Uranium / U-238** — genuinely above hydrogen and genuinely gives off H₂ in
//     HCl, but the uranium family carries reactor-containment invariants of its own
//     (see uranium.ts); left untagged on purpose rather than by chemistry.
//
// **Why a tag instead of a `reactions` row.** The aluminum trio each declared a
// near-identical row against Acid, and each one *raced* acid's own phase-only
// corrosion pass for the same cell — so the interesting outcome (a bubble) only
// usually won, and each rate had to be set well above 0.03 to beat the boring one
// (see docs/MATERIAL-IDEAS.md, which asked for exactly this generalization once a
// fourth material needed it). Reading the number inside the corrosion pass instead
// means the two paths *are* one path: acid dissolves the metal at the metal's own
// rate, and every cell it dissolves gives off gas. The rates above are therefore
// per *contact face* now (submerged metal is eaten from up to four sides at once),
// which is the same convention plain corrosion has always used.
const HYDROGEN_HEAT = 25;

/**
 * Per-tick chance that an acidic cell corroding at `base` dissolves the
 * neighbouring material `id` this tick. A hydrogen-releasing metal answers with
 * its own declared rate instead, scaled by `metalScale` — the medium's strength
 * relative to liquid Acid, which is what the rates in the table above are quoted
 * against (1 for Acid and Acid Slime, 0.5 for the weaker fumes).
 */
export function corrodeChance(id: number, base: number, metalScale: number): number {
  const rate = getMaterial(id).acidHydrogen;
  return rate === undefined ? base : rate * metalScale;
}

/**
 * Turn the acidic cell at (x,y) — which has just dissolved a hydrogen-releasing
 * metal neighbour — into the hydrogen bubble that reaction liberated. The caller
 * must stop corroding afterwards: its cell is no longer acid, and both sides being
 * consumed 1:1 is what keeps a puddle a bounded generator rather than a free
 * catalyst.
 *
 * The bubble replaces the acid *in place* rather than venting into an adjacent
 * empty cell, because the metal a player drops in acid ends up at the bottom of the
 * pool where there is no empty neighbour at all — venting would hide the signature
 * product exactly when it matters. In place, the bubble rises through the pool.
 * Its heat is deliberately small: enough to warm the pool, but short of Hydrogen's
 * own 200° autoignition point (hydrogen.ts) from a room-temperature start, so the
 * gas gets to rise and collect somewhere instead of lighting itself at birth.
 */
export function releaseHydrogen(x: number, y: number, sim: SimContext): void {
  const temp = sim.getTemp(x, y);
  sim.set(x, y, HYDROGEN.id);
  sim.setTemp(x, y, temp + HYDROGEN_HEAT);
}
