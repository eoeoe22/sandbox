import { register, getMaterial } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import { DIR8 } from '../engine/directions';
import type { SimContext } from '../engine/SimContext';
import { FIRE } from './fire';

// Spark — a travelling electric charge, the moving pulse of the electricity
// subsystem. It's never a material you paint (like Ember, it's deliberately
// absent from the palette): it only ever exists for a single tick where a
// conductor is momentarily energized, spawned by a Battery or handed on from an
// adjacent Spark. A pulse therefore reads as a bright dot racing along a wire.
//
// State it needs, and where it lives:
//   • Which conductor to turn back into — stored in this cell's `aux` byte (the
//     conductor's material id). A spark spawned onto Iron reverts to Iron, onto
//     Mercury reverts to Mercury. `aux == 0` means "no conductor underneath"
//     (e.g. a stray painted spark) → it fizzles to Empty.
//   • The conductor's heat — kept in `temp` and carried through untouched, so
//     energizing a hot wire doesn't cool it.
//
// Each turn a spark: (1) energizes every `conductive` neighbor that isn't in its
// post-spark refractory period (aux == 0) — handing the pulse onward; (2) if a
// fuel/explosive is adjacent, drops a lick of Fire into open air beside it so
// the ordinary Fire rules ignite or detonate it (an electric arc lighting the
// gas); then (3) reverts to its conductor and stamps that cell with a refractory
// countdown. That countdown, ticked down by the conductor itself (see
// iron.ts/mercury.ts), is what stops the pulse washing back the way it came:
// the cells just behind the front are briefly un-energizable, so the wave only
// moves forward. Without it a single spark would fill and oscillate across the
// whole conductor forever.
const REFRACTORY_TICKS = 3;

/** Energize one conductor cell: replace it with a Spark that remembers the
 *  conductor (in aux) and preserves the conductor's heat (in temp). */
function energize(sim: SimContext, nx: number, ny: number, conductorId: number): void {
  const heat = sim.getTemp(nx, ny);
  sim.spawn(nx, ny, SPARK.id); // marks moved (won't be re-processed this tick)
  sim.setTemp(nx, ny, heat); // carry the wire's heat through the spark
  sim.setAux(nx, ny, conductorId); // remember what to turn back into
}

/** Seat a lick of Fire in an open cell touching (nx,ny), so Fire's own rules
 *  catch the fuel / trigger the explosive there. Returns whether one was placed. */
function arcFireBeside(sim: SimContext, nx: number, ny: number): boolean {
  for (const [ex, ey] of DIR8) {
    const ax = nx + ex;
    const ay = ny + ey;
    if (sim.inBounds(ax, ay) && sim.isEmpty(ax, ay)) {
      sim.spawn(ax, ay, FIRE.id);
      return true;
    }
  }
  return false;
}

function updateSpark(x: number, y: number, sim: SimContext): void {
  const conductorId = sim.getAux(x, y);

  let arced = false;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!sim.inBounds(nx, ny)) continue;
    const nid = sim.get(nx, ny);
    if (nid === EMPTY) continue;
    const m = getMaterial(nid);
    if (m.conductive && sim.getAux(nx, ny) === 0) {
      energize(sim, nx, ny, nid);
    } else if (!arced && (m.flammable || m.combustible || m.explosive)) {
      // One arc per tick is plenty to light a fuel pocket or set off a charge.
      arced = arcFireBeside(sim, nx, ny);
    }
  }

  // Collapse back to the conductor (or fizzle if there was none), leaving a
  // brief refractory mark so the pulse can't immediately double back.
  if (conductorId === EMPTY) {
    sim.set(x, y, EMPTY);
  } else {
    sim.set(x, y, conductorId);
    sim.setAux(x, y, REFRACTORY_TICKS);
  }
}

export const SPARK = register({
  id: 38,
  name: 'Spark',
  phase: Phase.Solid,
  color: rgb(255, 255, 190),
  density: 1,
  category: '전기',
  // Normal conductivity is fine: the spark only lives one tick and its temp is
  // the wire's heat being ferried across, restored right after spawn.
  thermal: { conductivity: 0.3 },
  update: updateSpark,
});
