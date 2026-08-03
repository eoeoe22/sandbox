// 독립 오브젝트 entries — the eight rigid bodies that live above the grid rather
// than in it (engine/objects.ts).
//
// A caveat worth stating plainly, because it is the one place this page is not
// self-maintaining: a body has no `Material`, and the object layer keys every
// judgement off its `kind` in imperative code (a drum splits and then runs as
// Molten Iron, a crate burns, a ball scorches — see the note above
// `isMagneticBody`). There is
// no tag registry up there to sweep, so the trait list below is hand-written
// against that code, and it can drift from it in a way the material side cannot.
//
// What is NOT hand-written is the numbers: every stat here reads the very
// constant the physics reads, so a retuned density or ignition point moves the
// codex with it. And test/codex.ts holds the roster to `OBJECT_KINDS`, so a
// ninth object fails the build rather than quietly missing its page.

import {
  RUBBER_BALL_DENSITY,
  RUBBER_BALL_RESTITUTION,
  BALL_BURN_TEMP,
  BALL_BURN_TICKS,
  DRUM_DENSITY,
  DRUM_RESTITUTION,
  DRUM_FRICTION,
  DRUM_MELT_TEMP,
  DRUM_MELT_TICKS,
  DRUM_PIECE_MELT_TEMP,
  DRUM_PIECE_MELT_TICKS,
  DYNAMITE_DENSITY,
  DYNAMITE_RESTITUTION,
  DYNAMITE_AUTOIGNITE_TEMP,
  DYNAMITE_FUSE_MIN_TICKS,
  SMOKE_BOMB_DENSITY,
  SMOKE_BOMB_RESTITUTION,
  SMOKE_BOMB_IGNITE_TEMP,
  SMOKE_BOMB_FUSE_TICKS,
  SMOKE_BOMB_VENT_TICKS,
  WOOD_BOX_DENSITY,
  WOOD_BOX_RESTITUTION,
  WOOD_BOX_IGNITE_TEMP,
  WOOD_BOX_SMASH_SPEED,
  MOLOTOV_DENSITY,
  MOLOTOV_RESTITUTION,
  MOLOTOV_IGNITE_TEMP,
  MOLOTOV_SMASH_SPEED,
  MOLOTOV_FUEL_TICKS,
  MOLOTOV_BURST_TEMP,
} from '../engine/objects';
import { OBJECT_KINDS, type ObjectKind } from '../../state/store';
import { WATER } from '../materials/water';
import { OIL } from '../materials/oil';
import { ACID } from '../materials/acid';
import { MOLTEN_IRON } from '../materials/molteniron';
import { ALCOHOL } from '../materials/alcohol';
import { SAWDUST } from '../materials/sawdust';
import type { CodexStat, CodexTrait, ObjectCodexEntry } from './types';

/** A body lighter than water floats in it — derived rather than declared, so it
 *  can't disagree with the buoyancy the object layer actually computes. */
const floats = (density: number): boolean => density < WATER.density;

interface ObjectSpec {
  stats: CodexStat[];
  traits: CodexTrait[];
}

/**
 * The three drums are one steel shell with different contents, and the physics
 * treats them that way (one `kind`, one set of constants) — so they get one stat
 * table too, rather than three copies that could drift apart.
 *
 * The melt is TWO rows because it is two stages: at `DRUM_MELT_TEMP` the barrel
 * only splits into its three shards, and only a shard held at the higher
 * `DRUM_PIECE_MELT_TEMP` runs as Molten Iron (see `drumMeltTemp` in
 * engine/objects.ts). A single row naming Molten Iron at 1200° would promise a
 * puddle that a fire sitting in the 1200–1300° band never actually produces —
 * there it opens the barrel and leaves the wreckage lying.
 */
const drumStats = (): CodexStat[] => [
  { key: 'density', unit: 'number', value: DRUM_DENSITY },
  { key: 'elasticity', unit: 'ratio', value: DRUM_RESTITUTION },
  { key: 'friction', unit: 'ratio', value: DRUM_FRICTION },
  { key: 'shellMeltPoint', unit: 'temp', value: DRUM_MELT_TEMP },
  { key: 'shellMeltTicks', unit: 'ticks', value: DRUM_MELT_TICKS },
  { key: 'pieceMeltPoint', unit: 'temp', value: DRUM_PIECE_MELT_TEMP, refId: MOLTEN_IRON.id },
  { key: 'pieceMeltTicks', unit: 'ticks', value: DRUM_PIECE_MELT_TICKS },
];

const SPECS: Record<ObjectKind, ObjectSpec> = {
  ball: {
    stats: [
      { key: 'density', unit: 'number', value: RUBBER_BALL_DENSITY },
      { key: 'elasticity', unit: 'ratio', value: RUBBER_BALL_RESTITUTION },
      { key: 'autoIgniteTemp', unit: 'temp', value: BALL_BURN_TEMP },
      { key: 'burnTicks', unit: 'ticks', value: BALL_BURN_TICKS },
    ],
    traits: [{ key: 'bouncy' }, { key: 'flammable' }],
  },
  drum: {
    stats: drumStats(),
    traits: [{ key: 'magnetic' }, { key: 'blastOnly' }],
  },
  oildrum: {
    stats: drumStats(),
    traits: [{ key: 'magnetic' }, { key: 'blastOnly' }, { key: 'spills', refId: OIL.id }],
  },
  aciddrum: {
    stats: drumStats(),
    traits: [{ key: 'magnetic' }, { key: 'blastOnly' }, { key: 'spills', refId: ACID.id }],
  },
  dynamite: {
    stats: [
      { key: 'density', unit: 'number', value: DYNAMITE_DENSITY },
      { key: 'elasticity', unit: 'ratio', value: DYNAMITE_RESTITUTION },
      { key: 'autoIgniteTemp', unit: 'temp', value: DYNAMITE_AUTOIGNITE_TEMP },
      { key: 'fuseTicks', unit: 'ticks', value: DYNAMITE_FUSE_MIN_TICKS },
    ],
    traits: [{ key: 'explosive' }, { key: 'fuse', variant: 'waterproof' }],
  },
  smokebomb: {
    stats: [
      { key: 'density', unit: 'number', value: SMOKE_BOMB_DENSITY },
      { key: 'elasticity', unit: 'ratio', value: SMOKE_BOMB_RESTITUTION },
      { key: 'autoIgniteTemp', unit: 'temp', value: SMOKE_BOMB_IGNITE_TEMP },
      { key: 'fuseTicks', unit: 'ticks', value: SMOKE_BOMB_FUSE_TICKS },
      { key: 'ventTicks', unit: 'ticks', value: SMOKE_BOMB_VENT_TICKS },
    ],
    traits: [{ key: 'magnetic' }, { key: 'fuse', variant: 'waterproof' }],
  },
  crate: {
    stats: [
      { key: 'density', unit: 'number', value: WOOD_BOX_DENSITY },
      { key: 'elasticity', unit: 'ratio', value: WOOD_BOX_RESTITUTION },
      { key: 'autoIgniteTemp', unit: 'temp', value: WOOD_BOX_IGNITE_TEMP },
      { key: 'smashSpeed', unit: 'number', value: WOOD_BOX_SMASH_SPEED },
    ],
    traits: [{ key: 'flammable' }, { key: 'smashable', refId: SAWDUST.id }, { key: 'acidSoluble' }],
  },
  molotov: {
    stats: [
      { key: 'density', unit: 'number', value: MOLOTOV_DENSITY },
      { key: 'elasticity', unit: 'ratio', value: MOLOTOV_RESTITUTION },
      { key: 'autoIgniteTemp', unit: 'temp', value: MOLOTOV_IGNITE_TEMP },
      { key: 'smashSpeed', unit: 'number', value: MOLOTOV_SMASH_SPEED },
      { key: 'fuelTicks', unit: 'ticks', value: MOLOTOV_FUEL_TICKS },
      { key: 'burstTemp', unit: 'temp', value: MOLOTOV_BURST_TEMP },
    ],
    traits: [
      { key: 'fuse', variant: 'quenchable' },
      { key: 'smashable', refId: ALCOHOL.id },
      { key: 'fragile' },
    ],
  },
};

/** The object half of the codex, in palette order. Build-time only. */
export function buildObjectEntries(): ObjectCodexEntry[] {
  return OBJECT_KINDS.map((kind) => {
    const spec = SPECS[kind];
    const density = spec.stats.find((s) => s.key === 'density')?.value ?? 0;
    return {
      kind,
      stats: [...spec.stats],
      traits: floats(density) ? [{ key: 'floats' }, ...spec.traits] : [...spec.traits],
    };
  });
}
