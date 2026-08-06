// Shared palette-categorization logic. A material shows up under its declared
// `category`; a material that declares none falls back to the tab derived from
// its phase (so untagged materials still land somewhere sensible and the
// "add a material = one file" rule is preserved). The simulation ignores
// `category` — it's purely a UI grouping.
//
// A material may also list extra tabs in `alsoIn`, and then appears under each
// of them as well — the same material object, in more than one bucket. Two
// levels to keep straight:
//
//   categoryOf(m)   → the one canonical shelf. What the codex chip says, what
//                     `m.category === 'life'` style checks mean. Single, always.
//   categoriesOf(m) → every tab it shows up under, canonical first. What the
//                     palette buckets by and what the codex filter matches.
//
// Only the two *placement* surfaces (palette tabs, codex category filter) use
// the plural form; everything else keeps reading the canonical one, which is why
// making a material multi-homed can't change its identity anywhere else.
//
// Both the main material palette (MaterialPalette.svelte) and the blend brush's
// custom material picker (MaterialPicker.svelte) build their category > material
// UI from these helpers, so the two selectors always group and order materials
// identically.
//
// Category keys are stable ASCII identifiers (see src/i18n/materials.ko.ts /
// materials.en.ts for the displayed labels). A material's `category:` field may
// name any key present in CATEGORY_META, or omit it to fall back to a phase key.
import { Phase, type Material } from '../engine/types';
import { categoryLabel } from '../../i18n';

/** Thematic palette tabs, in display order, each with a Bootstrap Icon class.
 *  The `key` is a stable identifier; the label shown in the UI is localized. */
export const CATEGORY_META: { key: string; icon: string }[] = [
  { key: 'solid', icon: 'bi-box-fill' },
  { key: 'powder', icon: 'bi-hourglass-split' },
  { key: 'liquid', icon: 'bi-droplet-fill' },
  { key: 'gas', icon: 'bi-cloud-fill' },
  { key: 'fire', icon: 'bi-fire' },
  // 금속. The one tab whose whole roster arrives through `alsoIn` — every metal
  // is already filed somewhere by what it *is* (Iron is a solid, Iron Powder a
  // powder, Molten Iron a 불·열 liquid), and that spread is exactly the problem:
  // "the metals" was the one question the palette couldn't answer. Sits next to
  // 제련 because that's where most of them are going.
  { key: 'metal', icon: 'bi-nut-fill' },
  { key: 'smelt', icon: 'bi-hammer' },
  { key: 'oil', icon: 'bi-fuel-pump-fill' },
  { key: 'polymer', icon: 'bi-hexagon-fill' },
  { key: 'explosive', icon: 'bi-asterisk' },
  { key: 'cooling', icon: 'bi-snow' },
  { key: 'electric', icon: 'bi-lightning-charge-fill' },
  { key: 'life', icon: 'bi-flower1' },
  // 요리. Sits next to 생명 because the two are the same kind of thing — the
  // world's organic matter — and because half this tab's chemistry is borrowed
  // from that one (the Yeast that proofs a dough is the Yeast that ferments a
  // mash). Like 금속 it is partly an `alsoIn` tab: the sugars, salt and soda that
  // were already here are as much kitchen materials as the flour is.
  { key: 'food', icon: 'bi-egg-fried' },
  { key: 'radioactive', icon: 'bi-radioactive' },
  { key: 'exotic', icon: 'bi-stars' },
];

/** Stable phase keys (the displayed labels are localized). Doubles as the
 *  category fallback for a material that declares none — which is why the four
 *  real phases share their keys with the first four CATEGORY_META tabs. */
export const PHASE_KEY: Record<Phase, string> = {
  [Phase.Empty]: 'eraser',
  [Phase.Solid]: 'solid',
  [Phase.Powder]: 'powder',
  [Phase.Liquid]: 'liquid',
  [Phase.Gas]: 'gas',
};

/** The phases a material can actually be in, in the palette's own order. The
 *  codex's 상태 filter offers exactly these; `eraser` is the empty cell, not a
 *  state of matter anything is in. */
export const PHASE_KEYS: readonly string[] = ['solid', 'powder', 'liquid', 'gas'];

/** Stable phase key of a material — its state of matter, independent of which
 *  thematic tab it was filed under (Molten Iron is a liquid in 제련). */
export const phaseKeyOf = (m: Material): string => PHASE_KEY[m.phase];

/** The material's canonical category — the single shelf it "is" filed under. */
export const categoryOf = (m: Material): string => m.category ?? PHASE_KEY[m.phase];

/**
 * Every category tab a material appears under: its canonical one first, then any
 * `alsoIn` extras, deduped (declaring the canonical key again is harmless). The
 * canonical-first order is what makes the palette's leading tabs keep their
 * usual members — an extra listing appends to a later tab, it never reorders.
 */
export function categoriesOf(m: Material): string[] {
  const canonical = categoryOf(m);
  if (!m.alsoIn || m.alsoIn.length === 0) return [canonical];
  const out = [canonical];
  for (const key of m.alsoIn) if (!out.includes(key)) out.push(key);
  return out;
}

export const iconFor = (key: string): string =>
  CATEGORY_META.find((c) => c.key === key)?.icon ?? 'bi-tag-fill';

export interface PaletteCategory {
  key: string;
  index: number;
  label: string;
  icon: string;
  materials: Material[];
}

/**
 * Bucket the given materials by resolved category, then order the tabs: the
 * known categories (in CATEGORY_META order) that actually have members, followed
 * by any not-yet-known category present (future materials can introduce a new tab
 * just by naming it — nothing here needs editing).
 *
 * A material with `alsoIn` lands in several buckets, so the tab counts sum to
 * more than the registry size. That's the point: the counts say "how many things
 * are on this shelf", not "how many exist", and a material that belongs on three
 * shelves is worth finding three times. Each bucket holds the same `Material`
 * object; nothing downstream mutates it, and the palette renders one tab's
 * flyout at a time so keying chips by `m.id` stays unique per list.
 */
export function buildCategories(materials: readonly Material[]): PaletteCategory[] {
  const grouped = new Map<string, Material[]>();
  for (const m of materials) {
    for (const key of categoriesOf(m)) {
      const bucket = grouped.get(key);
      if (bucket) bucket.push(m);
      else grouped.set(key, [m]);
    }
  }
  const orderedKeys = [
    ...CATEGORY_META.map((c) => c.key).filter((k) => grouped.has(k)),
    ...[...grouped.keys()].filter((k) => !CATEGORY_META.some((c) => c.key === k)),
  ];
  return orderedKeys.map((key, index) => ({
    key,
    index,
    label: categoryLabel(key),
    icon: iconFor(key),
    materials: grouped.get(key)!,
  }));
}
