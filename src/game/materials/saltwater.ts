import { register } from './registry';
import { Phase } from '../engine/types';
import { rgb } from '../render/color';

// Liquid: denser than fresh water (3) so it sinks below it, still far lighter
// than sand (5). Inherits the default flow/spread behavior (updateLiquid).
export const SALTWATER = register({
  id: 5,
  name: 'Saltwater',
  phase: Phase.Liquid,
  color: rgb(84, 140, 175),
  density: 4,
});
