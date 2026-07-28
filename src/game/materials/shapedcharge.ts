import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { BLUE_FLAME } from './blueflame';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { BLAST, detonate, flashCell, type DetonateOptions } from './blast';
import { launchEmber } from './ember';

// Shaped Charge (성형작약) — a directional penetrator: instead of the ordinary
// round crater, it fires a long, narrow jet ONE way (먼로 효과), reaching several
// times an ordinary charge's radius straight ahead while barely scratching its
// sides and back. The Thermite of holes: where Thermite slowly melts a cut,
// this punches an instant bore through a thick wall — and, uniquely among
// explosives, the focused jet defeats 방폭 armor (Diamond, Obsidian), so the one
// wall it can't breach is the indestructible boundary Wall (and Clone).
//
// Which way it fires is chosen at placement time by the direction you *drag*
// the brush (Fan/Laser/Conveyor 방식 — 상하좌우 4방향), recorded in the low 2
// bits of each cell's `aux` word (it shares the Fan's placement path and
// direction codes; see PointerPainter). The renderer's `triArrow` pattern —
// filled triangles pointing the muzzle, the liner cone made visible — shows a
// placed charge's aim at a glance.
//
// The directionality itself is pure wiring of an existing seam: the blast
// flood's per-direction cost multipliers (DetonateOptions.costMul) stretch the
// budget far forward and choke it sideways/backward, so one detonate() call
// carves a spear-shaped bore instead of a disc. Penetration is proportional to
// the charge's LENGTH along the jet axis (장약 길이 비례 관통): a trigger
// touching any cell of a contiguous same-facing column fires ONE `soloSource`
// jet from the column's front face, its reach scaled by the column's depth (up
// to MAX_JET_CELLS) while the bore width stays fixed — stack deeper for a
// deeper hole. Cells stacked BESIDE the column instead chain off the adjacent
// flash a tick later and fire their OWN columns' jets, so a wide block facing
// right fires an array of parallel bores — a cutting charge — rather than one
// pooled blob: depth buys penetration, width buys coverage. Wired into another
// explosive's connected mass it still contributes a small sympathetic yield
// (blastYield) to that round blast.
//
// Triggers: an adjacent flame/blast or enough radiant heat, like TNT — and a
// deterministic electric detonator via the `directPulse` appliance hook rather
// than `electricDetonate`, because the spark path's generic detonate() call
// would fire the default round blast and drop the jet options; the hook keeps
// the aimed detonation on every trigger, and (unlike the Fire hand-off) works
// even packed flush against the wall it's meant to breach.

/** aux direction codes (low 2 bits) — identical to the Fan's so the shared
 *  drag-to-place path (PointerPainter.fanDir) stamps a Shaped Charge the same
 *  way. */
export const CHARGE_UP = 0;
export const CHARGE_DOWN = 1;
export const CHARGE_LEFT = 2;
export const CHARGE_RIGHT = 3;
/** Low-bit mask isolating the direction (the rest of aux is unused — a charge
 *  has no countdown, so the chevron just stays at its lattice colour). */
const DIR_MASK = 0b11;

// The raw reach budget ONE cell of charge contributes, spent against the
// per-direction costs below (the global 2/3 blast scale applies on top — see
// blast.ts BLAST_REACH_SCALE). At 36 a lone cell bores ~24 cells straight
// ahead: ~2.6× a lone C4's effective radius, squarely in the 기획's "정면 반경
// 2~3배". Penetration scales with the charge's LENGTH along the jet axis
// (장약 길이 비례 관통): a contiguous same-facing column of N cells fires one
// jet of N× this budget from its front face — see detonateJet's column walk.
const JET_REACH = 36;

/** Cap on how many stacked cells lengthen one jet (a 5-deep column bores ~120
 *  effective cells — most of a screen). A column longer than the cap isn't
 *  wasted: the cells behind the counted block survive the jet's tiny backward
 *  reach, see the adjacent flash next tick, and fire a follow-up jet of their
 *  own from the same spot — a double-tap, not a dud. Playtest knob. */
const MAX_JET_CELLS = 5;

// Per-direction cost multipliers (>1 = shorter that way). Forward is free,
// the forward diagonals are dear enough that the bore tapers to a spear point,
// and the sides/back are nearly walled off — the "옆·뒤는 거의 0" of the 기획:
// with reach 24 effective, the sides get ~24/9 ≈ 3 cells and the back
// ~24/14 ≈ 2. All four tables index like blast.ts NEIGHBORS:
// [up, down, left, right, up-left, up-right, down-left, down-right].
const F = 1; // forward — the jet
const D = 2.6; // forward diagonals — the taper of the spear
const S = 9; // perpendicular — a scratch
const B = 14; // backward (and back diagonals) — almost nothing
const JET_COST_MUL: ReadonlyArray<readonly number[]> = [
  [F, B, S, S, D, D, B, B], // up
  [B, F, S, S, B, B, D, D], // down
  [S, S, F, B, D, B, D, B], // left
  [S, S, B, F, B, D, B, D], // right
];

/** Unit jet vector for each direction code (indexed by CHARGE_*). */
const DIRV: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // up
  [0, 1], // down
  [-1, 0], // left
  [1, 0], // right
];

/** Yield a cell contributes when another explosive's mass survey sweeps it in
 *  (sympathetic detonation inside a TNT stack, say) — deliberately modest: the
 *  charge's punch lives in its own aimed jet, not in fattening a round blast. */
const SYMPATHETIC_YIELD = 6;

/** Chance a forward rim cell of the bore throws a spall Ember (matches the
 *  default rim chance an ordinary blast uses). Forward faces only — see the
 *  rimHandler in detonateJet. */
const SPALL_EMBER_CHANCE = 0.55;

// Stable like a demolition device should be: hotter than TNT's 240 before
// radiant heat alone cooks it off, so it survives near a fire long enough to
// be triggered on purpose.
const AUTOIGNITE_TEMP = 300;

/** True if (x,y) is a Shaped Charge cell facing direction `dir` — the test for
 *  membership in an aligned column (see detonateJet). */
function isAlignedCharge(sim: SimContext, x: number, y: number, dir: number): boolean {
  return (
    sim.inBounds(x, y) &&
    sim.get(x, y) === SHAPED_CHARGE.id &&
    (sim.getAux(x, y) & DIR_MASK) === dir
  );
}

/** Fire the aimed jet for the charge COLUMN through (x,y): walk the contiguous
 *  run of same-facing charge cells along the jet axis, and fire ONE soloSource
 *  detonation from the column's FRONT cell with reach scaled by the column's
 *  length (장약 길이 비례 관통 — up to MAX_JET_CELLS; the counted cells behind
 *  the muzzle are consumed into the same flash). Cells stacked BESIDE the
 *  column (a wide block) aren't part of it — they chain off the flash next
 *  tick and fire their own columns' jets, so width buys parallel bores while
 *  depth buys one deeper bore.
 *
 *  `pierceProof` is what lets the jet defeat 방폭 solids (Diamond, Obsidian;
 *  the `jetProof` uranium family stays immune) — soloSource carries the
 *  default destructive power, comfortably above every finite durability. The
 *  charge's identity is that everything OUTSIDE the bore stays put, enforced
 *  twice: `pressure` off (no concussion ring shoving the surroundings) and a
 *  custom rimHandler that throws spall Embers only from rim faces pointing
 *  along the jet — the exit hole sprays hot fragments downrange, while the
 *  bore's flanks and the charge's back stay quiet instead of the default rim
 *  seasoning them with fire. seedYield is 0 like the other fixed-reach
 *  soloSource blasts (napalm/cluster): with `opts.reach` set it's never read. */
function detonateJet(sim: SimContext, x: number, y: number): void {
  const dir = sim.getAux(x, y) & DIR_MASK;
  const [jx, jy] = DIRV[dir];
  // Walk forward to the column's true front — the muzzle: the jet always exits
  // the charge's front face no matter which cell the trigger touched.
  let fx = x;
  let fy = y;
  while (isAlignedCharge(sim, fx + jx, fy + jy, dir)) {
    fx += jx;
    fy += jy;
  }
  // Count backward from the muzzle, consuming each counted cell behind it
  // into the shared flash. flashCell marks them moved, so none re-triggers its
  // own jet this tick. Anything beyond the cap stays a live charge — including
  // the trigger cell itself when it sits deeper than the cap behind the muzzle
  // — and follows up next tick off the adjacent flash, one cap-sized chunk per
  // tick until the column is spent.
  let n = 1;
  let bx = fx;
  let by = fy;
  while (n < MAX_JET_CELLS && isAlignedCharge(sim, bx - jx, by - jy, dir)) {
    bx -= jx;
    by -= jy;
    n++;
    flashCell(sim, bx, by);
  }
  // Scale the reach budget by the column length, and every NON-forward cost by
  // the same factor, so a longer charge bores DEEPER at the same bore width —
  // sides/back stay "거의 0" instead of fattening with n (a 5-deep column
  // would otherwise scratch ~13 cells sideways instead of ~3). The forward
  // entry is picked by INDEX: NEIGHBORS orders the four orthogonals
  // [up, down, left, right] exactly like the direction codes, so the forward
  // index IS `dir` (robust even if a future tuning pass sets some other
  // multiplier to 1).
  const opts: DetonateOptions = {
    soloSource: true,
    reach: JET_REACH * n,
    costMul: n === 1 ? JET_COST_MUL[dir] : JET_COST_MUL[dir].map((c, i) => (i === dir ? c : c * n)),
    pierceProof: true,
    pressure: false,
    rimHandler: (s, rx, ry, dx, dy) => {
      // Forward faces only: the rim's outward normal must have a component
      // along the jet direction. A lateral (perpendicular) or backward rim
      // cell throws nothing.
      if (dx * jx + dy * jy > 0 && s.chance(SPALL_EMBER_CHANCE)) launchEmber(s, rx, ry, dx, dy);
    },
  };
  detonate(sim, fx, fy, 0, opts);
}

/** The electric-appliance hook (see Material.directPulse): a pulse reaching any
 *  face — Battery/LFP Battery/Turbine in contact or a Spark down a wire —
 *  detonates the touched cell's aimed jet. The same-cell guard covers a cell
 *  several sources pulse in one tick: after the first jet consumes it, the
 *  cell is a Blast flash, and a second detonation from it would be a spurious
 *  full-strength free jet. */
function pulseDetonate(sim: SimContext, x: number, y: number): void {
  if (sim.get(x, y) !== SHAPED_CHARGE.id) return;
  detonateJet(sim, x, y);
}

function updateShapedCharge(x: number, y: number, sim: SimContext): void {
  let trigger = sim.getTemp(x, y) >= AUTOIGNITE_TEMP;
  if (!trigger) {
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!sim.inBounds(nx, ny)) continue;
      const nid = sim.get(nx, ny);
      if (
        nid === FIRE.id ||
        nid === LAVA.id ||
        nid === BLUE_FLAME.id ||
        nid === BLAST.id ||
        nid === MOLTEN_METAL.id ||
        nid === MOLTEN_GLASS.id
      ) {
        trigger = true;
        break;
      }
    }
  }

  if (trigger) detonateJet(sim, x, y);
  // Otherwise it just sits there — a Solid has no phase-default movement.
}

export const SHAPED_CHARGE = register({
  id: 127,
  name: 'Shaped Charge',
  phase: Phase.Solid,
  // Olive-drab casing with copper liner-cone triangles pointing the muzzle
  // (the renderer's triArrow path — filled ▶ wedges along the jet axis, where
  // Fan/Laser draw a thin chevron line).
  color: rgb(96, 104, 72),
  lattice: rgb(228, 148, 64),
  triArrow: true,
  density: 1000,
  explosive: true,
  blastYield: SYMPATHETIC_YIELD,
  category: 'explosive',
  thermal: { conductivity: 0.3 },
  directPulse: pulseDetonate,
  update: updateShapedCharge,
});
