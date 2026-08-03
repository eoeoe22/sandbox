// Build-time extraction: the live material registry → the plain data the codex
// page ships.
//
// This is the seam that keeps the simulation out of the guide page. Everything
// here runs in Astro's frontmatter at build time, where importing the registry
// (and with it every `update` closure, the blast solver, the object layer) costs
// nothing; what crosses into the browser is only the return value, which is
// numbers, strings and ids. If something in this file ever ends up holding a
// function, the island's props stop serializing — that is the guard rail, and it
// fails at build rather than in production.
//
// The roster is `MATERIALS`, the palette's own list, not `allMaterials()`. The
// difference is the dozen effect-only cells (Ember, Debris, a heat ray in
// flight) that exist for a few ticks mid-blast and can't be placed by hand — a
// codex is a catalogue of what you can *use*, and the palette already draws that
// line (see materials/index.ts for the roll-call and the reasons).

import { MATERIALS } from '../materials';
import { categoryOf } from '../materials/categories';
import { STAT_SPECS } from './stats';
import { TRAIT_SPECS } from './traits';
import type { CodexEntry, CodexReaction, CodexStat, CodexTrait } from './types';
import type { Material } from '../engine/types';

/** The numeric table rows this material declares, in STAT_SPECS order. */
export function statsFor(m: Material): CodexStat[] {
  const out: CodexStat[] = [];
  for (const spec of STAT_SPECS) {
    const hit = spec.read(m);
    if (hit !== undefined) out.push({ key: spec.key, unit: spec.unit, ...hit });
  }
  return out;
}

/** The trait cards this material declares, in TRAIT_SPECS order. */
export function traitsFor(m: Material): CodexTrait[] {
  const out: CodexTrait[] = [];
  for (const spec of TRAIT_SPECS) {
    const hit = spec.read(m);
    if (hit !== undefined) out.push({ key: spec.key, ...hit });
  }
  return out;
}

/** `Material.reactions`, stripped to the serializable fields the codex shows. */
function reactionsFor(m: Material): CodexReaction[] {
  return (m.reactions ?? []).map((r) => ({
    with: r.with,
    produce: r.produce,
    otherBecomes: r.otherBecomes,
    byproduct: r.byproduct,
    catalyst: r.catalyst,
    probability: r.probability,
    tempMin: r.tempMin,
    tempMax: r.tempMax,
    heat: r.heat,
  }));
}

/** The whole codex, in palette order. Call from build-time code only. */
export function buildCodexEntries(): CodexEntry[] {
  return MATERIALS.map((m) => ({
    id: m.id,
    name: m.name,
    category: categoryOf(m),
    stats: statsFor(m),
    traits: traitsFor(m),
    reactions: reactionsFor(m),
  }));
}
