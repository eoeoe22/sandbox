import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';
import { WATER } from './water';
import { SALTWATER } from './saltwater';
import { SOAPY_WATER } from './soapywater';

// Soap (비누) — a flake/bar of soap. Drop it into Water (or Saltwater) and it
// dissolves into Soapy Water: a declarative contact reaction turns both the soap
// grain and the water it touches into 비눗물, so a pile poured into a pool foams it
// up into bubbling suds. It is NOT organic matter, so a Virus can neither infect
// nor erode it (바이러스 침식 불가) — a soap block makes a clean firebreak against a
// plague. Falls and piles like an ordinary powder until it meets water.
const DISSOLVE_CHANCE = 0.25; // per-contact chance a soap grain dissolves into water

export const SOAP = register({
  id: 101,
  name: 'Soap',
  phase: Phase.Powder,
  // A soft pastel-green bar of soap.
  color: rgb(198, 216, 190),
  density: 4, // sinks through water (3) so it dissolves from within a pool
  // Crystalline flakes grip and pile a little (마찰).
  friction: 0.3,
  // Water pools against the grains (reacting at the surface) instead of soaking
  // invisibly in as an overlay fluid, so the dissolve reaction sees real water —
  // the same trick Ammonium Nitrate uses for its cold pack.
  liquidOverlap: 0,
  category: '가루',
  thermal: { conductivity: 0.3 },
  // Dissolves on contact with water: both the soap grain and the water it touches
  // become Soapy Water. Gradual (probability) so a bar melts into suds over a
  // moment rather than flashing away at once.
  reactions: [
    {
      with: WATER.id,
      produce: SOAPY_WATER.id,
      otherBecomes: SOAPY_WATER.id,
      probability: DISSOLVE_CHANCE,
    },
    {
      with: SALTWATER.id,
      produce: SOAPY_WATER.id,
      otherBecomes: SOAPY_WATER.id,
      probability: DISSOLVE_CHANCE,
    },
  ],
});
