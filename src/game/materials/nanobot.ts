import { register } from './registry';
import { EMPTY, Phase } from '../engine/types';
import { rgb } from '../render/color';
import type { SimContext } from '../engine/SimContext';
import { IRON } from './iron';
import { IRON_POWDER } from './ironpowder';
import { MOLTEN_IRON, IRON_MELT_TEMP } from './molteniron';
import { ALUMINUM } from './aluminum';
import { ALUMINUM_POWDER } from './aluminumpowder';
import { ACTIVATED_ALUMINUM } from './activatedaluminum';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from './moltenaluminum';
import { SALTWATER } from './saltwater';
import { RUST } from './rust';
import {
  crawl,
  crawlerState,
  setCrawlerState,
  eatAndReproduce,
  touchingBlast,
  EAT_CHANCE,
  type FeedOptions,
} from './crawler';
import { DIR8 } from '../engine/directions';

// Nanobot (나노봇) — a metal-eating machine that crawls along surfaces, the
// mechanical twin of the Termite (same locomotion — see crawler.ts). It gnaws
// through iron and aluminum, converting each cell it eats into another nanobot,
// so a swarm devours a metal structure and self-replicates as it spreads.
//
// **그것이 먹은 금속이 곧 그것의 몸이다.** A nanobot doesn't have a body of its own —
// it rebuilds itself out of whatever it just chewed through, and remembers which
// metal that was (its 금속 기억, parked in the spare `aux` bits the locomotion
// layer leaves free — see crawlerState in crawler.ts). Both the eater and the
// newborn it spawns take the metal of the meal, so a swarm that walks off an iron
// beam onto an aluminum one converts itself over as it goes. Everything about how
// that cell then *fails* follows the remembered metal (see BODY below):
//   • 녹는점 — an iron-bodied bot melts at Iron's 1200° into Molten Iron; an
//     aluminum-bodied one slumps at Aluminum's 660° into Molten Aluminum. So a
//     fire that an iron swarm walks through unharmed puddles an aluminum one.
//   • 파괴 — a blast shatters it back into loose powder of its own metal (Iron
//     Powder or Aluminum Powder), at the crater's epicenter (blastDeathIdFor) and
//     at its rim alike.
//   • 소금물 부식 — an *iron* bot exposed to Saltwater slowly corrodes into Rust.
//     Aluminum doesn't rust, so an aluminum-bodied bot is immune — the trade that
//     comes with its miserable melting point. Neither one consumes or interacts
//     with the Rust series (Rust / Rust Powder).
// The memory only distinguishes those two metals (철/알루미늄 한정); anything else
// it eats leaves it iron-bodied, which is also what a bot placed straight from the
// palette (and every cell in a save written before the memory existed) reads as.
//
// Being a machine, it ignores water entirely — it swims straight through a pool
// and keeps crawling on whatever metal it finds submerged ("액체를 무시하고 돌아다님",
// via the 'ignore' liquid policy). It has no drowning or low-temperature death.
// A shockwave too weak to break it (a Woofer's silent thump, a Gunpowder
// concussion) doesn't destroy it, but it doesn't stand in one either: a machine
// this small is unanchored, so the wave picks it up and throws it like a grain of
// powder (`shockLoose`) — it lands intact and crawls on, unlike the Termite, whose
// soft body the same wave crushes half the time.

/** 금속 기억 — the index into BODY stored in the cell's crawler state. Iron is 0
 *  deliberately: a spawned/placed cell reads 0, so "no memory yet" and "iron" are
 *  the same thing and old saves need no migration. */
const METAL_IRON = 0;
const METAL_ALUMINUM = 1;

/** Which properties a nanobot inherits from the metal it is built out of. */
interface MetalBody {
  /** Where this body slumps, and what it slumps into. */
  readonly meltTemp: number;
  readonly molten: number;
  /** What a blast shatters this body into. */
  readonly powder: number;
  /** Does salt water eat it? (Iron rusts; aluminum passivates and doesn't.) */
  readonly corrodes: boolean;
}
const BODY: readonly MetalBody[] = [
  { meltTemp: IRON_MELT_TEMP, molten: MOLTEN_IRON.id, powder: IRON_POWDER.id, corrodes: true },
  {
    meltTemp: ALUMINUM_MELT_TEMP,
    molten: MOLTEN_ALUMINUM.id,
    powder: ALUMINUM_POWDER.id,
    corrodes: false,
  },
];

// Both metals in both of their palette forms, plus the gallium-activated dust —
// still aluminum, and a swarm that eats it comes out aluminum-bodied.
const FOOD = [
  IRON.id,
  IRON_POWDER.id,
  ALUMINUM.id,
  ALUMINUM_POWDER.id,
  ACTIVATED_ALUMINUM.id,
] as const;

const RUST_CHANCE = 0.001; // 소금물 노출 시 부식 확률 (0.1%)

/** Which body a mouthful of `id` builds. Anything outside the aluminum group —
 *  including the iron foods and any future addition to FOOD — is iron-bodied. */
function metalOf(eatenId: number): number {
  return eatenId === ALUMINUM.id ||
    eatenId === ALUMINUM_POWDER.id ||
    eatenId === ACTIVATED_ALUMINUM.id
    ? METAL_ALUMINUM
    : METAL_IRON;
}

/** The body of the bot at (x,y), defaulting to iron for a cell with no memory. */
function bodyAt(x: number, y: number, sim: SimContext): MetalBody {
  return BODY[crawlerState(sim, x, y)] ?? BODY[METAL_IRON];
}

/** Stamp a newborn with the metal it was made from (crawler.ts calls this the
 *  instant it spawns, before anything can read the cell). Declared once at module
 *  scope, not rebuilt per tick. */
const FEED: FeedOptions = {
  onBorn: (sim, x, y, eatenId) => setCrawlerState(sim, x, y, metalOf(eatenId)),
};

/** Transform this cell into `id`, clearing the 금속 기억 on the way out — `set`
 *  keeps `aux` for a non-empty write, and every material reads that word as its
 *  own private state. None of the three materials this hands off to reads `aux`
 *  today, but the *melt* path reaches one two steps on: the pour freezes back into
 *  solid Iron/Aluminum (again via `set`, which again keeps the word), and there
 *  `aux` is the post-spark refractory countdown — so an uncleared memory would
 *  land as a cast bar that refuses to be energized for its first few ticks. The
 *  temperature is deliberately kept, so fresh Molten Iron/Aluminum reads as molten
 *  instead of re-freezing next tick (mirrors Iron/Aluminum's own melt). */
function becomes(x: number, y: number, sim: SimContext, id: number): void {
  sim.set(x, y, id);
  sim.setAux(x, y, 0);
}

function touchingSaltWater(x: number, y: number, sim: SimContext): boolean {
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (sim.inBounds(nx, ny)) {
      if (sim.get(nx, ny) === SALTWATER.id || sim.getOverlay(nx, ny) === SALTWATER.id) {
        return true;
      }
    }
  }
  return false;
}

function updateNanobot(x: number, y: number, sim: SimContext): void {
  const body = bodyAt(x, y, sim);
  if (sim.getTemp(x, y) >= body.meltTemp) {
    becomes(x, y, sim, body.molten);
    return;
  }
  if (touchingBlast(x, y, sim)) {
    becomes(x, y, sim, body.powder); // shattered by the shockwave into loose grains
    return;
  }
  if (body.corrodes && sim.chance(RUST_CHANCE) && touchingSaltWater(x, y, sim)) {
    sim.setTemp(x, y, sim.getTemp(x, y) + 100);
    becomes(x, y, sim, RUST.id);
    return;
  }
  // 갉아먹은 금속을 기억 — the newborn is stamped by FEED.onBorn, and the eater
  // rebuilds its own body out of the same meal.
  const eaten = eatAndReproduce(x, y, sim, NANOBOT.id, FOOD, EAT_CHANCE, FEED);
  if (eaten !== EMPTY) setCrawlerState(sim, x, y, metalOf(eaten));
  crawl(x, y, sim, NANOBOT.id, 'ignore'); // swims through liquid, crawls on metal
}

export const NANOBOT = register({
  id: 111,
  name: 'Nanobot',
  phase: Phase.Solid,
  // A cool cyan-steel machine tone, clearly reading as a swarm of tiny robots
  // rather than the grey metal it consumes.
  color: rgb(120, 208, 202),
  colorVary: 22,
  density: 1000,
  category: 'life',
  // Shattered to loose powder when a blast destroys it at the epicenter, matching
  // the death-by-shockwave its update handles for rim survivors. `blastDeathIdFor`
  // reads the cell's 금속 기억 so an aluminum-bodied bot leaves Aluminum Powder;
  // `blastDeathId` is the iron default for any path that can't consult the cell.
  blastDeathId: IRON_POWDER.id,
  blastDeathIdFor: (sim, x, y) => bodyAt(x, y, sim).powder,
  // Only nominally a solid (it walks instead of piling), so a shockwave it can't be
  // broken by still throws it around like loose matter instead of being shadowed by
  // it. No shockDeathChance: the machine survives the ride and keeps crawling.
  shockLoose: true,
  // A metal machine small enough to be dragged: an Electromagnet's field plucks a
  // crawling swarm off the floor and pins it, which is the one way to *catch* the
  // things short of destroying them (see materials/electromagnet.ts). Pullable
  // despite being a Solid for the same reason `shockLoose` is set — it walks
  // instead of piling, so it isn't structure. Deliberately NOT keyed to the 금속
  // 기억, even though cast aluminum itself isn't magnetic: the magnet trap is the
  // only counter a player has to a swarm, and a bot that could eat its way out of
  // being catchable would take that away.
  magnetic: true,
  // No `radiationDeath`, deliberately — it is the one thing in the 생명 tab that a
  // 방사능 source doesn't kill (see engine/radiation.ts). A nanobot is a machine,
  // not life: it has no drowning death and no cooking death either, and letting it
  // work in a hot zone gives the fallout the player *can't* clear with anything
  // living a swarm that eats its way through it regardless.
  // Metallic, so it conducts heat about as well as loose Iron Powder — it warms
  // toward its melting point at a metal's pace, not an insulator's.
  thermal: { conductivity: 0.35 },
  update: updateNanobot,
});
