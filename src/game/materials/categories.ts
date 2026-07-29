// Shared palette-categorization logic. A material shows up under its declared
// `category`; a material that declares none falls back to the tab derived from
// its phase (so untagged materials still land somewhere sensible and the
// "add a material = one file" rule is preserved). The simulation ignores
// `category` — it's purely a UI grouping.
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
  { key: 'smelt', icon: 'bi-hammer' },
  { key: 'oil', icon: 'bi-fuel-pump-fill' },
  { key: 'polymer', icon: 'bi-hexagon-fill' },
  { key: 'explosive', icon: 'bi-asterisk' },
  { key: 'cooling', icon: 'bi-snow' },
  { key: 'electric', icon: 'bi-lightning-charge-fill' },
  { key: 'life', icon: 'bi-flower1' },
  { key: 'radioactive', icon: 'bi-radioactive' },
  { key: 'exotic', icon: 'bi-stars' },
];

/** Stable phase-fallback keys (the displayed labels are localized). */
const PHASE_FALLBACK: Record<Phase, string> = {
  [Phase.Empty]: 'eraser',
  [Phase.Solid]: 'solid',
  [Phase.Powder]: 'powder',
  [Phase.Liquid]: 'liquid',
  [Phase.Gas]: 'gas',
};

export const categoryOf = (m: Material): string => m.category ?? PHASE_FALLBACK[m.phase];

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
 */
export function buildCategories(materials: readonly Material[]): PaletteCategory[] {
  const grouped = new Map<string, Material[]>();
  for (const m of materials) {
    const key = categoryOf(m);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(m);
    else grouped.set(key, [m]);
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
