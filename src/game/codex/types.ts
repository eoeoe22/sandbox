// The shape of what the 물질 도감 actually renders — a plain, serializable
// picture of a material, with every function, closure and packed color stripped
// out.
//
// This exists because the codex is generated at BUILD time. The page's Astro
// frontmatter imports the live registry (which drags in every `update` closure,
// the whole simulation), reduces it to the data below, and hands *that* to the
// browser. Nothing here may hold a function or a live `Material` reference: the
// moment one does, Astro can't serialize the island's props and the simulation
// starts leaking into the guide page's bundle.
//
// So a material's traits arrive as *keys*, not as text: `{ key: 'conductive' }`
// rather than "전기 전도". The words are looked up from i18n in the browser, which
// is what lets the language switch redraw the codex without rebuilding it.

import type { MatId } from '../engine/types';

/** How a stat's number should be written out. The suffix words live in i18n. */
export type StatUnit =
  /** A temperature in °C. */
  | 'temp'
  /** A 0..1 probability, shown as a percentage. */
  | 'chance'
  /** A 0..1 coefficient, shown as the bare fraction (0.2, not 20%). */
  | 'ratio'
  /** A distance in grid cells. */
  | 'cells'
  /** A duration in simulation ticks. */
  | 'ticks'
  /** A bare number with no unit (density, yield). */
  | 'number';

/** One row of a material's numeric table. */
export interface CodexStat {
  /** i18n term key (see i18n/codexTerms.ts). */
  key: string;
  value: number;
  unit: StatUnit;
  /** A material this number points at — the target of a 상전이, say. */
  refId?: MatId;
}

/** One of a material's non-numeric traits, rendered as a badge and a card. */
export interface CodexTrait {
  /** i18n term key (see i18n/codexTerms.ts). */
  key: string;
  /** For a trait with several forms (화재 등급 A/B/D), which one this is. The
   *  term key for the text is `${key}.${variant}`. */
  variant?: string;
  /** A material this trait points at — what it leaves behind when destroyed. */
  refId?: MatId;
  /** Several materials this trait points at (the fluids a host will soak up). */
  refIds?: MatId[];
}

/** A declarative contact reaction, flattened from `Material.reactions`. */
export interface CodexReaction {
  with: MatId;
  produce?: MatId;
  otherBecomes?: MatId;
  byproduct?: MatId;
  catalyst?: MatId;
  probability?: number;
  tempMin?: number;
  tempMax?: number;
  heat?: number;
}

/** Everything the codex knows about one material. */
export interface CodexEntry {
  id: MatId;
  /** English name, straight off `Material.name` — the fallback when a locale
   *  table has no entry for this id (the same contract `materialName` uses). */
  name: string;
  /** Stable category key (see materials/categories.ts), for the filter tabs. */
  category: string;
  /** Stable phase key — 'solid' | 'powder' | 'liquid' | 'gas'. Separate from
   *  `category` because a thematic tab says nothing about state of matter:
   *  Molten Iron files under 제련 and Acid under 액체, and a player looking for
   *  "everything that pours" wants both. Objects have no equivalent (they are
   *  rigid bodies above the grid), so `ObjectCodexEntry` has no phase and the
   *  상태 filter simply doesn't match them. */
  phase: string;
  stats: CodexStat[];
  traits: CodexTrait[];
  reactions: CodexReaction[];
}

/** Everything the codex knows about one 독립 오브젝트. */
export interface ObjectCodexEntry {
  /** Stable `ObjectKind` key — the id for both the icon and the i18n lookups. */
  kind: string;
  stats: CodexStat[];
  traits: CodexTrait[];
}

/** The words for one codex term — a stat row's heading or a trait card. Keyed by
 *  the spec's `key` (a trait with a `variant` looks up `${key}.${variant}`) in
 *  i18n/codexTerms.ts, where both locales sit under that one key. */
export interface CodexTerm {
  /** Short heading: the table's row label, the badge's text, the card's title. */
  label: string;
  /** One sentence saying what it means in play. */
  desc: string;
}

/** One heading of the codex's 태그 필터 panel and the tags filed under it.
 *  Built at build time (codex/tags.ts) from the tags the entries actually
 *  declare, so the panel can never offer a filter that matches nothing. */
export interface CodexTagGroup {
  /** i18n key under `codex.tagGroup` (see i18n/ui.*.ts). */
  key: string;
  /** Tag ids, in TRAIT_SPECS order. A tag id is a trait's `key`, or
   *  `${key}.${variant}` for a trait with forms — the same string `codexTerm`
   *  is asked for, so the panel and the trait card always read alike. */
  tags: string[];
}

/** A declaration that one `Material` field becomes one row of the numeric table. */
export interface StatSpec {
  key: string;
  unit: StatUnit;
  /** The `Material` field(s) this row is derived from, for the coverage sweep. */
  fields: readonly string[];
  read: (m: import('../engine/types').Material) => Omit<CodexStat, 'key' | 'unit'> | undefined;
}

/** A declaration that one `Material` field becomes one trait card. */
export interface TraitSpec {
  key: string;
  /** The `Material` field(s) this card is derived from, for the coverage sweep. */
  fields: readonly string[];
  read: (m: import('../engine/types').Material) => Omit<CodexTrait, 'key'> | undefined;
}
