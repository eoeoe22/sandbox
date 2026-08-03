// 특성 카드 — the `Material` tags that aren't a number, and so read as a claim
// about the material rather than as a table row: it conducts, it's magnetic,
// acid can't touch it, a shockwave blows it away.
//
// Each one becomes a small badge on the grid card and a named card with an
// explanation in the detail view. The text for both lives in i18n under the
// spec's `key`; a trait with several forms (화재 등급 A/B/D) adds a `variant` and
// its text is looked up at `${key}.${variant}`.
//
// A hook-shaped tag (`directPulse`, `lightPulse`, `radiationHit`,
// `overlapUpdate`) is reported by its *presence*: the function itself can't
// cross into the browser, but "this is an electric appliance" is exactly the
// fact a codex wants, and it is what declaring the hook means.
//
// See stats.ts's header for what `fields` is doing here.

import { fireClassOf } from '../materials/suppress';
import { misciblePartnersOf } from '../materials/registry';
import type { TraitSpec } from './types';

const flag =
  (field: keyof import('../engine/types').Material) =>
  (m: import('../engine/types').Material) =>
    m[field] === true ? {} : undefined;

const present =
  (field: keyof import('../engine/types').Material) =>
  (m: import('../engine/types').Material) =>
    m[field] !== undefined ? {} : undefined;

export const TRAIT_SPECS: readonly TraitSpec[] = [
  // --- 전기 ---------------------------------------------------------------
  { key: 'conductive', fields: ['conductive'], read: flag('conductive') },
  { key: 'insulated', fields: ['insulated'], read: flag('insulated') },
  { key: 'wiring', fields: ['wiring'], read: flag('wiring') },
  { key: 'appliance', fields: ['directPulse'], read: present('directPulse') },
  { key: 'photoelectric', fields: ['lightPulse'], read: present('lightPulse') },
  { key: 'magnetic', fields: ['magnetic'], read: flag('magnetic') },

  // --- 빛·열 --------------------------------------------------------------
  { key: 'laserReflective', fields: ['laserReflective'], read: flag('laserReflective') },

  // --- 불 -----------------------------------------------------------------
  { key: 'flammable', fields: ['flammable'], read: flag('flammable') },
  { key: 'fuel', fields: ['combustion'], read: present('combustion') },
  {
    key: 'fireClass',
    fields: ['fireClass'],
    // Resolved through the suppression pass's own `fireClassOf`, not read off the
    // field: `Material.fireClass` is only declared where it is *not* the default,
    // so reading it directly would show a class on the aluminum line and nothing
    // on wood, oil or coal — the classes a player most needs to be told apart.
    // Class A is every fuel's default and class B is derived from `petroleum`,
    // and this is the function that does both (see materials/suppress.ts).
    read: (m) =>
      m.combustion === undefined && m.fireClass === undefined
        ? undefined
        : { variant: fireClassOf(m.id) },
  },
  {
    key: 'douses',
    fields: ['douses'],
    read: (m) => (m.douses === undefined ? undefined : { variant: m.douses }),
  },
  {
    key: 'easyDouse',
    fields: ['combustion.easyDouse'],
    read: (m) => (m.combustion?.easyDouse === true ? {} : undefined),
  },
  { key: 'petroleum', fields: ['petroleum'], read: flag('petroleum') },

  // --- 산 -----------------------------------------------------------------
  { key: 'acidResistant', fields: ['acidResistant'], read: flag('acidResistant') },
  { key: 'acidHydrogen', fields: ['acidHydrogen'], read: present('acidHydrogen') },

  // --- 방사선 -------------------------------------------------------------
  {
    key: 'radiationDeath',
    fields: ['radiationDeath'],
    read: (m) => (m.radiationDeath === undefined ? undefined : { refId: m.radiationDeath }),
  },
  { key: 'radiationHit', fields: ['radiationHit'], read: present('radiationHit') },

  // --- 폭발·파괴 ----------------------------------------------------------
  { key: 'explosive', fields: ['explosive'], read: flag('explosive') },
  { key: 'electricDetonate', fields: ['electricDetonate'], read: flag('electricDetonate') },
  { key: 'explosionProof', fields: ['explosionProof'], read: flag('explosionProof') },
  { key: 'jetProof', fields: ['jetProof'], read: flag('jetProof') },
  { key: 'indestructible', fields: ['indestructible'], read: flag('indestructible') },
  { key: 'isWall', fields: ['isWall'], read: flag('isWall') },
  { key: 'shockLoose', fields: ['shockLoose'], read: flag('shockLoose') },
  { key: 'blastInert', fields: ['blastInert'], read: flag('blastInert') },
  {
    key: 'blastDeath',
    // `blastDeathIdFor` is the per-cell override; it can only exist alongside
    // `blastDeathId`, which is the material-wide answer this card reports.
    fields: ['blastDeathId', 'blastDeathIdFor'],
    read: (m) => (m.blastDeathId === undefined ? undefined : { refId: m.blastDeathId }),
  },
  {
    key: 'shatter',
    fields: ['shatterId'],
    read: (m) => (m.shatterId === undefined ? undefined : { refId: m.shatterId }),
  },

  // --- 가용성(섞임) -------------------------------------------------------
  {
    key: 'miscible',
    fields: ['miscible'],
    // Resolved through the registry's symmetric pair table, not read off the
    // field — the same reason `fireClass` goes through `fireClassOf`. A pair is
    // declared on one of its two materials (Alcohol lists Water, not the other
    // way round), so reading the field directly would tell a player that alcohol
    // mixes with water while water's own card said nothing at all.
    read: (m) => {
      const partners = misciblePartnersOf(m.id);
      return partners.length === 0 ? undefined : { refIds: [...partners] };
    },
  },

  // --- 겹침(스며듦) -------------------------------------------------------
  { key: 'porous', fields: ['porous'], read: flag('porous') },
  { key: 'porousPowder', fields: ['porousPowder'], read: flag('porousPowder') },
  { key: 'latticeFilter', fields: ['latticeFilter'], read: flag('latticeFilter') },
  { key: 'overlapCarrier', fields: ['overlapCarrier'], read: flag('overlapCarrier') },
  { key: 'soakedUpdate', fields: ['overlapUpdate'], read: present('overlapUpdate') },
  {
    key: 'overlapFluids',
    fields: ['overlapFluids'],
    read: (m) => (m.overlapFluids === undefined ? undefined : { refIds: [...m.overlapFluids] }),
  },
];
