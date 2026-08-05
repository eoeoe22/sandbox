// 태그 필터 — the codex's second filter axis, cut across the category tabs
// rather than beside them.
//
// A category answers "what shelf is this on"; a tag answers "what can it do".
// The two are independent questions and the page treats them that way: 내산성 is
// declared by a solid, a liquid and a polymer, and no single tab holds them.
// Selecting several tags narrows (AND) — a filter is a tool for getting to a
// short list, and "acid-proof AND conductive" is the question a player actually
// has when they are building something.
//
// What this file contributes is only the *shape* of the panel: which heading a
// tag sits under, and in what order. The tags themselves are not listed here —
// they are swept out of the built entries, so the panel offers exactly the tags
// something in the codex declares and never a filter that matches nothing. Both
// halves are checked: test/codex.ts fails on a tag in use with no group (it
// would silently vanish from the panel) and on a group heading with no i18n
// label.
//
// Object traits share the table. They are hand-written (objects.ts) rather than
// swept off a registry, but a player filtering for 가연성 wants the wooden crate
// in the answer as much as the plank.

import type { CodexEntry, CodexTagGroup, ObjectCodexEntry } from './types';

/** Which panel heading a trait belongs under, in panel order. Keys are trait
 *  `key`s — the base, without a variant, so 화재 등급 A/B/D file together. */
const GROUPS: readonly { key: string; traits: readonly string[] }[] = [
  {
    key: 'electric',
    traits: ['conductive', 'insulated', 'wiring', 'appliance', 'photoelectric', 'magnetic'],
  },
  { key: 'light', traits: ['laserReflective'] },
  {
    key: 'fire',
    traits: [
      'flammable',
      'fuel',
      'fireClass',
      'flameOnly',
      'douses',
      'easyDouse',
      'petroleum',
      'fuse',
    ],
  },
  { key: 'acid', traits: ['acidResistant', 'acidHydrogen', 'acidSoluble'] },
  { key: 'radiation', traits: ['radiationDeath', 'radiationHit'] },
  {
    key: 'blast',
    traits: [
      'explosive',
      'electricDetonate',
      'explosionProof',
      'jetProof',
      'indestructible',
      'isWall',
      'shockLoose',
      'blastInert',
      'blastDeath',
      'shatter',
      'blastOnly',
      'smashable',
      'fragile',
    ],
  },
  { key: 'mix', traits: ['miscible'] },
  {
    key: 'overlap',
    traits: ['porous', 'porousPowder', 'latticeFilter', 'overlapCarrier', 'overlapFluids'],
  },
  { key: 'body', traits: ['floats', 'bouncy', 'spills'] },
];

/** Every trait key this file files somewhere — what test/codex.ts checks the
 *  entries against, so a new trait card can't quietly miss the filter panel. */
export const GROUPED_TRAIT_KEYS: readonly string[] = GROUPS.flatMap((g) => g.traits);

/** The i18n keys the panel's headings need (`codex.tagGroup.<key>`). */
export const TAG_GROUP_KEYS: readonly string[] = GROUPS.map((g) => g.key);

/** A tag's id: the trait key, or `key.variant` for a trait with forms. The same
 *  string a trait card looks its words up by, so the panel and the card agree. */
export const tagIdOf = (t: { key: string; variant?: string }): string =>
  t.variant === undefined ? t.key : `${t.key}.${t.variant}`;

/**
 * The filter panel, built from what the entries actually declare. Build-time
 * only (it takes the extracted entries, not the registry, so it is really just
 * data reshaping — but it runs in the Astro frontmatter with everything else).
 *
 * A group with no surviving tag is dropped rather than rendered empty, and a
 * tag no group claims is dropped here and reported by the test — silently
 * appending it to a 기타 heading would make the check unfalsifiable.
 */
export function buildTagGroups(
  materials: readonly CodexEntry[],
  objects: readonly ObjectCodexEntry[],
): CodexTagGroup[] {
  // key → the variants in use, so 화재 등급 A and D become two chips while a
  // variantless trait stays one.
  const seen = new Map<string, Set<string>>();
  for (const e of [...materials, ...objects]) {
    for (const t of e.traits) {
      const forms = seen.get(t.key) ?? new Set<string>();
      forms.add(tagIdOf(t));
      seen.set(t.key, forms);
    }
  }

  const out: CodexTagGroup[] = [];
  for (const g of GROUPS) {
    const tags = g.traits.flatMap((k) => [...(seen.get(k) ?? [])].sort());
    if (tags.length > 0) out.push({ key: g.key, tags });
  }
  return out;
}
