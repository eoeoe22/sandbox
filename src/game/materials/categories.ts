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
import { Phase, type Material } from '../engine/types';

/** Thematic palette tabs, in display order, each with a Bootstrap Icon class. */
export const CATEGORY_META: { key: string; icon: string }[] = [
  { key: '고체', icon: 'bi-box-fill' },
  { key: '가루', icon: 'bi-hourglass-split' },
  { key: '액체', icon: 'bi-droplet-fill' },
  { key: '기체', icon: 'bi-cloud-fill' },
  { key: '불·열', icon: 'bi-fire' },
  { key: '제련', icon: 'bi-hammer' },
  { key: '석유', icon: 'bi-fuel-pump-fill' },
  { key: '폭발', icon: 'bi-asterisk' },
  { key: '냉각', icon: 'bi-snow' },
  { key: '전기', icon: 'bi-lightning-charge-fill' },
  { key: '생명', icon: 'bi-flower1' },
  { key: '방사성', icon: 'bi-radioactive' },
  { key: '특수', icon: 'bi-stars' },
];

const PHASE_FALLBACK: Record<Phase, string> = {
  [Phase.Empty]: '지우개',
  [Phase.Solid]: '고체',
  [Phase.Powder]: '가루',
  [Phase.Liquid]: '액체',
  [Phase.Gas]: '기체',
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
    label: key,
    icon: iconFor(key),
    materials: grouped.get(key)!,
  }));
}
