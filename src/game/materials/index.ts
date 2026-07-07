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
import { SALT } from './salt';
import { STEAM } from './steam';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { GUNPOWDER } from './gunpowder';
import { NITRO } from './nitro';
import { BLAST } from './blast';
import { SEED } from './seed';
import { VINE } from './vine';

export {
  EMPTY_MAT,
  WALL,
  SAND,
  WATER,
  STONE,
  SALTWATER,
  SMOKE,
  SALT,
  STEAM,
  FIRE,
  LAVA,
  ACID,
  ACID_VAPOR,
  GUNPOWDER,
  NITRO,
  BLAST,
  SEED,
  VINE,
};

/** Palette order (also drives the toolbar). */
export const MATERIALS = [
  EMPTY_MAT,
  WALL,
  SAND,
  WATER,
  STONE,
  SALTWATER,
  SMOKE,
  SALT,
  STEAM,
  FIRE,
  LAVA,
  ACID,
  ACID_VAPOR,
  GUNPOWDER,
  NITRO,
  BLAST,
  SEED,
  VINE,
];
