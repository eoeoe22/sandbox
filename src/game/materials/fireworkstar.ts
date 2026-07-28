import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import {
  GRAVITY_Q,
  clampTo,
  LEGACY_V_MAX_Q,
  cellsThisTick,
  decodeFlight,
  encodeFlight,
  launchBallistic,
  walkFlight,
  advanceFlight,
  type LaunchSpec,
} from './ballistic';
import { detonate } from './blast';
import { BURST_COLORS, burstCell } from './fireworkburst';

// Firework Star (자탄) — the submunition a Fireworks charge scatters, and the
// firework counterpart of the Cluster shell's Bomblet (bomblet.ts). Same skeleton:
// the main charge lobs a handful of these from its crater rim, each arcs out on a
// ballistic parabola and goes off where it lands — but where a Bomblet carves a
// secondary crater, a star opens a *coloured flower* (fireworkburst.ts) and the
// pop that goes with it is Gunpowder-weak, so a volley redecorates the sky
// without redecorating the terrain.
//
// The colour is rolled ONCE, at launch, and carried in the star's `aux` for its
// whole flight (each 자탄의 폭발 색상을 랜덤하게) — so every star of one shell opens
// in its own colour, and a star's burst is a single consistent colour rather than
// a confetti of per-cell rolls. `aux` survives a swap but NOT a spawn (which
// clears it), so every move re-stamps it, exactly as Debris re-stamps its carried
// material id.
//
// Like Ember/Debris/Bomblet it's never painted from the palette: it only exists
// mid-flight, and a hand-placed one (life 0, no velocity) pops on its first turn.

const STAR_LAUNCH: LaunchSpec = {
  speedMinQ: 9,
  speedVarQ: 7,
  jitterQ: 3,
  // A taller loft than the Bomblet's (3): a firework's stars should climb and
  // hang before they open, so the volley reads as an arc of bursts overhead
  // rather than a flat spray.
  upBiasQ: 6,
  lifeMin: 14,
  lifeVar: 14,
};

/** Reach of one star's burst, before blast.ts's global 2/3 scale — so a flower is
 *  a disc of a bit under 5 cells' radius, ~65 cells of colour. Big enough to read
 *  as a burst from across the sandbox, small enough that a dozen of them overlap
 *  into a display rather than one wall of colour. */
const STAR_REACH = 7;
/** Destructive power of a star's pop — the same Gunpowder value the parent
 *  Fireworks charge carries (see fireworks.ts), so a star heaves loose powder and
 *  water around but can't crack stone, metal or glass. */
const STAR_POWER = 6;

/** Fling a Firework Star from a rim cell along its outward normal, rolling the
 *  colour it will open in and stashing that index in `aux`. */
export function launchFireworkStar(
  sim: SimContext,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
): void {
  launchBallistic(sim, x, y, dirX, dirY, FIREWORK_STAR.id, STAR_LAUNCH);
  sim.setAux(x, y, sim.randInt(BURST_COLORS.length));
}

/**
 * Open the flower: a weak, small blast at (cx,cy) whose reached cells of *open
 * air* become Firework Burst cells in this star's colour instead of the ordinary
 * white shockwave flash. Everything that isn't air falls through to the default
 * fate, so the pop still behaves like a Gunpowder-weak charge — it shoves loose
 * powder/liquid aside and is shadowed by solids it can't break — and the colour
 * is purely what the eye sees in the gaps.
 *
 * A star cell the flood reaches is claimed too, and that's load-bearing rather
 * than decorative: a star is a gas-phase cell whose durability (15) sits above
 * this pop's power (6), so the default fate for one would be to fling it as
 * *Debris carrying a Firework Star* — a fragment that deposits a fresh star on
 * landing, which blooms, which flings more. Claiming it (the bursting star's own
 * cell, and any sibling caught in the flower) resolves it to colour instead, so a
 * volley converges. Sibling stars bursting sympathetically is a bonus, not a
 * mechanism — most are still in the air, well outside one flower's reach.
 */
function bloom(sim: SimContext, cx: number, cy: number, colorIndex: number): void {
  detonate(sim, cx, cy, STAR_REACH, {
    reach: STAR_REACH,
    power: STAR_POWER,
    // The star is the only source: it must never sweep a pile of Fireworks powder
    // it happens to land on into one shared mass survey (see soloSource).
    soloSource: true,
    onCell(s, x, y, prevId) {
      if (prevId !== EMPTY && prevId !== FIREWORK_STAR.id) return false; // default weak-blast handling
      burstCell(s, x, y, colorIndex);
      return true;
    },
  });
}

function updateFireworkStar(x: number, y: number, sim: SimContext): void {
  const colorIndex = sim.getAux(x, y);
  const st = decodeFlight(sim.getTemp(x, y));
  if (st.life < 1) {
    // Flight spent with nothing hit → it opens right here, mid-air. This is the
    // usual ending for a star: the loft is tuned so most of them burst at apex.
    bloom(sim, x, y, colorIndex);
    return;
  }
  const vxQ = st.vxQ;
  // Same heavy parabola as the Bomblet: gravity every tick, terminal fall pinned
  // at the legacy ceiling these launch numbers were tuned against.
  const vyQ = clampTo(st.vyQ + GRAVITY_Q, LEGACY_V_MAX_Q);

  walkFlight(sim, x, y, cellsThisTick(sim, vxQ), cellsThisTick(sim, vyQ), {
    siblingId: FIREWORK_STAR.id,
    onImpact(s, sx, sy, cx, cy) {
      // Hit something: clear the cell it flew from (if it moved) and open the
      // flower at the last open cell on the path.
      if (cx !== sx || cy !== sy) s.set(sx, sy, EMPTY);
      bloom(s, cx, cy, colorIndex);
    },
    onArrive(s, sx, sy, cx, cy) {
      advanceFlight(s, sx, sy, cx, cy, FIREWORK_STAR.id, encodeFlight(st.life - 1, vxQ, vyQ));
      s.setAux(cx, cy, colorIndex); // spawn() cleared aux — carry the colour along
    },
  });
}

export const FIREWORK_STAR = register({
  id: 130,
  name: 'Firework Star',
  phase: Phase.Gas,
  color: rgb(255, 236, 170), // a bright travelling ember; the burst carries the colour
  density: 1,
  category: 'explosive',
  thermal: { init: 0, conductivity: 0 },
  packedTemp: true,
  update: updateFireworkStar,
});
