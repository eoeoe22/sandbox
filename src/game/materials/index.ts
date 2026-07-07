// Central material barrel. Importing this module registers every material as a
// side effect. To add a material: create its file, then add two lines here
// (the import and the MATERIALS entry) — nothing else in the codebase changes.
export * from './registry';

import { EMPTY_MAT } from './empty';
import { WALL } from './wall';
import { SAND } from './sand';
import { WATER } from './water';
import { STONE } from './stone';
import { SALTWATER } from './saltwater';
import { SMOKE } from './smoke';

export { EMPTY_MAT, WALL, SAND, WATER, STONE, SALTWATER, SMOKE };

/** Palette order (also drives the toolbar). */
export const MATERIALS = [EMPTY_MAT, WALL, SAND, WATER, STONE, SALTWATER, SMOKE];
