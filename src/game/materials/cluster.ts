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
import { BLAST, detonate, type DetonateOptions } from './blast';
import { launchBomblet } from './bomblet';

// Cluster shell (클러스터탄) — a two-stage strike. Its main charge craters
// normally, but from that crater's rim it also lobs a scatter of Bomblets
// (bomblet.ts) that arc out and touch off their own small secondary craters
// where they land — so one detonation becomes a spreading field of little ones:
// "쿵—포물선—파바바밧". Built entirely on the `detonate` rim seam (blast.ts): the
// only custom part is a rimHandler that launches submunitions instead of embers.
const BLAST_RADIUS = 10;
const AUTOIGNITE_TEMP = 240;
// Chance each rim cell throws a bomblet. The rim of an R10 crater is ~60 cells,
// so this yields roughly 8–16 submunitions — enough for a convincing spread
// without flooding the field.
const BOMBLET_RIM_CHANCE = 0.16;

function clusterRim(sim: SimContext, x: number, y: number, dirX: number, dirY: number): void {
  if (sim.chance(BOMBLET_RIM_CHANCE)) launchBomblet(sim, x, y, dirX, dirY);
}

const CLUSTER_OPTS: DetonateOptions = { rimHandler: clusterRim };

function updateCluster(x: number, y: number, sim: SimContext): void {
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

  if (trigger) detonate(sim, x, y, 0, CLUSTER_OPTS);
  // Otherwise it just sits there — a Solid has no phase-default movement.
}

export const CLUSTER = register({
  id: 74,
  name: 'Cluster',
  phase: Phase.Solid,
  color: rgb(96, 122, 62), // military olive-green
  density: 1000,
  explosive: true,
  blastRadius: BLAST_RADIUS,
  category: '폭발',
  thermal: { conductivity: 0.3 },
  update: updateCluster,
});
