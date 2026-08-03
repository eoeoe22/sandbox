// 수치 표 — the `Material` fields that come out as a number, and so belong in the
// codex's stat table rather than on a trait card.
//
// One entry per row. A material shows only the rows it actually declares, so a
// stone gets three lines and a stick of C4 gets eight; nothing renders a column
// of dashes. The order here is the order the table reads in, grouped roughly the
// way a player would ask: what is it made of, how does it move, how does it
// answer heat, what does it do when provoked.
//
// `fields` on each spec is not decoration — test/codex.ts sweeps the registry
// for every `Material` field any material actually sets and fails if one is
// claimed by neither a stat, a trait, nor the deliberate exclusion list in
// fields.ts. So a new tag can't be added to the engine and silently miss the
// codex; the test prints the orphan's name.

import type { StatSpec } from './types';

export const STAT_SPECS: readonly StatSpec[] = [
  // --- 물성 ---------------------------------------------------------------
  {
    key: 'density',
    unit: 'number',
    fields: ['density'],
    read: (m) => ({ value: m.density }),
  },
  {
    key: 'conductivity',
    unit: 'ratio',
    fields: ['thermal.conductivity'],
    read: (m) => (m.thermal?.conductivity === undefined ? undefined : { value: m.thermal.conductivity }),
  },
  {
    key: 'initTemp',
    unit: 'temp',
    fields: ['thermal.init'],
    read: (m) => (m.thermal?.init === undefined ? undefined : { value: m.thermal.init }),
  },

  // --- 거동 ---------------------------------------------------------------
  {
    key: 'viscosity',
    unit: 'ratio',
    fields: ['viscosity'],
    read: (m) => (m.viscosity === undefined ? undefined : { value: m.viscosity }),
  },
  {
    key: 'friction',
    unit: 'ratio',
    fields: ['friction'],
    read: (m) => (m.friction === undefined ? undefined : { value: m.friction }),
  },
  {
    key: 'elasticity',
    unit: 'ratio',
    fields: ['elasticity'],
    read: (m) => (m.elasticity === undefined ? undefined : { value: m.elasticity }),
  },
  {
    key: 'surfaceTension',
    unit: 'ratio',
    fields: ['surfaceTension'],
    read: (m) => (m.surfaceTension === undefined ? undefined : { value: m.surfaceTension }),
  },
  {
    key: 'liquidOverlap',
    unit: 'ratio',
    fields: ['liquidOverlap'],
    read: (m) => (m.liquidOverlap === undefined ? undefined : { value: m.liquidOverlap }),
  },

  // --- 온도 ---------------------------------------------------------------
  // The two `phaseChange` directions are separate rows because the sentence a
  // player reads is different: one is "heat it past this and it becomes X", the
  // other "let it fall below this and it becomes X".
  {
    key: 'meltPoint',
    unit: 'temp',
    fields: ['phaseChange.at', 'phaseChange.when', 'phaseChange.into'],
    read: (m) =>
      m.phaseChange === undefined || m.phaseChange.when !== 'atOrAbove'
        ? undefined
        : { value: m.phaseChange.at(), refId: m.phaseChange.into() },
  },
  {
    key: 'setPoint',
    unit: 'temp',
    fields: ['phaseChange.at', 'phaseChange.when', 'phaseChange.into'],
    read: (m) =>
      m.phaseChange === undefined || m.phaseChange.when !== 'atOrBelow'
        ? undefined
        : { value: m.phaseChange.at(), refId: m.phaseChange.into() },
  },
  {
    key: 'freezeTemp',
    unit: 'temp',
    fields: ['freeze.temp'],
    read: (m) => (m.freeze === undefined ? undefined : { value: m.freeze.temp }),
  },

  // --- 연소 ---------------------------------------------------------------
  {
    key: 'autoIgniteTemp',
    unit: 'temp',
    fields: ['combustion.autoIgniteTemp'],
    read: (m) => (m.combustion === undefined ? undefined : { value: m.combustion.autoIgniteTemp }),
  },
  {
    key: 'burnChance',
    unit: 'chance',
    fields: ['combustion.burnChance'],
    read: (m) => (m.combustion === undefined ? undefined : { value: m.combustion.burnChance }),
  },
  {
    key: 'burnTemp',
    unit: 'temp',
    fields: ['combustion.burnTemp'],
    read: (m) => (m.combustion?.burnTemp === undefined ? undefined : { value: m.combustion.burnTemp }),
  },
  {
    key: 'ashChance',
    unit: 'chance',
    fields: ['combustion.ashChance'],
    read: (m) => (m.combustion?.ashChance === undefined ? undefined : { value: m.combustion.ashChance }),
  },

  // --- 폭발 ---------------------------------------------------------------
  {
    key: 'blastRadius',
    unit: 'cells',
    fields: ['blastRadius'],
    read: (m) => (m.blastRadius === undefined ? undefined : { value: m.blastRadius }),
  },
  {
    key: 'blastYield',
    unit: 'number',
    fields: ['blastYield'],
    read: (m) => (m.blastYield === undefined ? undefined : { value: m.blastYield }),
  },
  {
    key: 'destructivePower',
    unit: 'number',
    fields: ['destructivePower'],
    read: (m) => (m.destructivePower === undefined ? undefined : { value: m.destructivePower }),
  },
  {
    key: 'durability',
    unit: 'number',
    fields: ['durability'],
    read: (m) => (m.durability === undefined ? undefined : { value: m.durability }),
  },
  {
    key: 'shockDeathChance',
    unit: 'chance',
    fields: ['shockDeathChance'],
    read: (m) => (m.shockDeathChance === undefined ? undefined : { value: m.shockDeathChance }),
  },

  // --- 기타 ---------------------------------------------------------------
  {
    key: 'sparkLoss',
    unit: 'number',
    fields: ['sparkLoss'],
    read: (m) => (m.sparkLoss === undefined ? undefined : { value: m.sparkLoss }),
  },
  {
    key: 'radiation',
    unit: 'number',
    fields: ['radiation'],
    read: (m) => (m.radiation === undefined ? undefined : { value: m.radiation }),
  },
  {
    key: 'acidHydrogenChance',
    unit: 'chance',
    fields: ['acidHydrogen.chance'],
    read: (m) => (m.acidHydrogen === undefined ? undefined : { value: m.acidHydrogen.chance }),
  },
  {
    key: 'lifetime',
    unit: 'ticks',
    fields: ['life.ticks', 'life.into'],
    read: (m) => (m.life === undefined ? undefined : { value: m.life.ticks, refId: m.life.into }),
  },
];
