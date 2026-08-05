// Headless harness for the 물질 도감 — the build-time extraction in
// src/game/codex/ that turns the live registry into the plain data the guide
// page ships.
//
// The page itself is markup and can be looked at; what can't be looked at is
// whether the extraction still *covers the registry*. Every check here is a
// sweep rather than a hand-picked scene, for the same reason the acid+metal and
// 소화 계통 harnesses are: a codex's failure mode is not a crash, it is a hole —
// a material added last week with no description, a tag added to the engine that
// no card explains, a tag named on the page that nothing here explains. None of
// those break anything at runtime. They just quietly leave the page wrong.
//
// So: the field ledger has to be exhaustive, both locales have to be complete,
// and every icon has to resolve. Each failure prints the missing roster.
//
// Run: `node test/run-codex.mjs`.
import { allMaterials, getMaterial } from '../src/game/materials/registry';
import type { Material } from '../src/game/engine/types';
import { MATERIALS } from '../src/game/materials';
import { OBJECT_KINDS } from '../src/state/store';
import { STAT_SPECS } from '../src/game/codex/stats';
import { TRAIT_SPECS } from '../src/game/codex/traits';
import { EXCLUDED_FIELDS } from '../src/game/codex/fields';
import { buildCodexEntries } from '../src/game/codex/entries';
import { buildObjectEntries } from '../src/game/codex/objects';
import { buildIconSprite, materialSymbolId, objectSymbolId } from '../src/game/codex/icons';
import { buildTagGroups, GROUPED_TRAIT_KEYS, TAG_GROUP_KEYS } from '../src/game/codex/tags';
import { entryMarkdown, listMarkdown } from '../src/game/codex/format';
import {
  buildCategories,
  categoriesOf,
  categoryOf,
  CATEGORY_META,
  PHASE_KEYS,
} from '../src/game/materials/categories';
import { materialCodexKo, objectCodexKo } from '../src/i18n/codex.ko';
import { materialCodexEn, objectCodexEn } from '../src/i18n/codex.en';
import { codexTerms } from '../src/i18n/codexTerms';
import { codexTerm, materialDescription, objectDescription } from '../src/i18n/codex';
import { ko as uiKo } from '../src/i18n/ui.ko';
import { en as uiEn } from '../src/i18n/ui.en';
import { $locale, LOCALES } from '../src/i18n/locale';
import { categoryLabel, materialName, objectLabel, t } from '../src/i18n';
import '../src/game/materials';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── 1. Every `Material` field is claimed by a stat, a trait, or the ledger ──
// The check that keeps the codex honest as the engine grows. A tag added to
// Material and set by any material has to be given a home — a table row, a
// trait card, or an explicit line in fields.ts saying why it is left out. This
// prints whatever is orphaned, so the fix is always obvious.
{
  const claimed = new Set<string>();
  for (const s of STAT_SPECS) for (const f of s.fields) claimed.add(f);
  for (const t of TRAIT_SPECS) for (const f of t.fields) claimed.add(f);
  for (const f of Object.keys(EXCLUDED_FIELDS)) claimed.add(f);

  // A structured field is claimed part by part, by dotted path, and gets swept
  // that way — so a new `thermal.capacity` is an orphan just as a new top-level
  // tag would be. Claiming the parts is also claiming the whole: `thermal` needs
  // no entry of its own once `thermal.conductivity` and `thermal.init` have one.
  //
  // Every *proper prefix* of a claimed path counts, and the sweep below recurses,
  // because otherwise the rule only reaches one level down and the hole simply
  // moves: claim `thermal.exotic` whole and its own contents go unaudited at a
  // depth nothing looks at. Depth is not the invariant — "no struct is claimed
  // whole" is.
  const descend = new Set<string>();
  for (const path of claimed) {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) descend.add(parts.slice(0, i).join('.'));
  }

  const orphans = new Set<string>();
  // Structs the codex shows but claims only as a whole. Not orphans — they ARE
  // covered — but the claim is the shape that would let a new part slip in
  // unnoticed, which is the hole this whole check exists to close.
  const unopened = new Set<string>();

  const sweep = (obj: object, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (!claimed.has(path) && !descend.has(path)) {
        orphans.add(path);
        continue;
      }
      // Arrays are homogeneous lists of ids, not structs with named parts, so
      // there is nothing to descend into (`overlapFluids`; `reactions` is an
      // excluded field the page renders as its own section). An excluded path is
      // exempt too: we have decided not to show it at all, so its parts don't
      // matter either — and since this is a plain string lookup, a nested
      // exclusion can be written as `'glow.min'` if one is ever wanted.
      const isStruct = typeof value === 'object' && value !== null && !Array.isArray(value);
      if (!isStruct || path in EXCLUDED_FIELDS) continue;
      if (!descend.has(path)) {
        unopened.add(path);
        continue;
      }
      sweep(value, path);
    }
  };
  for (const m of allMaterials()) sweep(m, '');
  check(
    'every Material field in use is a stat, a trait, or a documented exclusion',
    orphans.size === 0,
    orphans.size
      ? `orphaned: ${[...orphans].join(', ')}`
      : `${claimed.size} claims cover ${allMaterials().length} materials`,
  );
  check(
    '…and every struct the codex shows is claimed part by part, not whole',
    unopened.size === 0,
    unopened.size
      ? `claimed whole (list their parts by dotted path instead): ${[...unopened].join(', ')}`
      : `${[...descend].length} structs opened up`,
  );
}

// ── 2. The roster is the palette's, and it is not empty ─────────────────────
{
  const entries = buildCodexEntries();
  check(
    'the codex lists exactly the palette roster',
    entries.length === MATERIALS.length && entries.every((e, i) => e.id === MATERIALS[i].id),
    `${entries.length} entries`,
  );
  const objects = buildObjectEntries();
  check(
    '…and every 독립 오브젝트',
    objects.length === OBJECT_KINDS.length &&
      objects.every((o, i) => o.kind === OBJECT_KINDS[i]),
    `${objects.length} objects`,
  );

  // Non-vacuity, section by section. The detail view draws three blocks, and a
  // spec list that silently stopped matching anything would leave one of them
  // permanently empty — which looks like a design choice rather than a bug. The
  // floors are far below the real counts; they are here to catch zero.
  const withStats = entries.filter((e) => e.stats.length > 0).length;
  const withTraits = entries.filter((e) => e.traits.length > 0).length;
  const withReactions = entries.filter((e) => e.reactions.length > 0).length;
  check(
    'each of the three detail sections is populated for a real share of the roster',
    withStats >= 100 && withTraits >= 40 && withReactions >= 5,
    `${withStats} with stats, ${withTraits} with traits, ${withReactions} with reactions`,
  );
}

// ── 3. Nothing serialized holds a function ──────────────────────────────────
// The island's props are JSON. A spec that accidentally passed a hook straight
// through (`directPulse` is a function, and reporting its *presence* is the
// whole trick) would break the page at build time with a bad error; this says
// what actually went wrong.
{
  const payload = { materials: buildCodexEntries(), objects: buildObjectEntries() };
  let round: unknown;
  let error = '';
  try {
    round = JSON.parse(JSON.stringify(payload));
  } catch (e) {
    error = String(e);
  }
  check(
    'the extracted codex survives a JSON round-trip (no functions, no cycles)',
    error === '' && JSON.stringify(round) === JSON.stringify(payload),
    error,
  );
}

// ── 4. Every stat and trait points at a material that exists ────────────────
// A `refId` is how a card says "it leaves Sawdust behind". A stale id there
// renders as a blank, which reads as a material with no remains at all.
{
  const bad: string[] = [];
  const seen = (id: number, where: string): void => {
    if (getMaterial(id) === undefined) bad.push(`${where} → id ${id}`);
  };
  for (const e of [...buildCodexEntries(), ...buildObjectEntries()]) {
    const who = 'id' in e ? e.name : e.kind;
    for (const s of e.stats) if (s.refId !== undefined) seen(s.refId, `${who}.${s.key}`);
    for (const t of e.traits) {
      if (t.refId !== undefined) seen(t.refId, `${who}.${t.key}`);
      for (const r of t.refIds ?? []) seen(r, `${who}.${t.key}`);
    }
    if ('reactions' in e) {
      for (const r of e.reactions) {
        seen(r.with, `${who}.reaction.with`);
        for (const id of [r.produce, r.otherBecomes, r.byproduct, r.catalyst]) {
          if (id !== undefined) seen(id, `${who}.reaction`);
        }
      }
    }
  }
  check('every refId in the codex resolves to a registered material', bad.length === 0, bad.join('; '));
}

// ── 5. The icon sprite carries one symbol per entry ─────────────────────────
// `svgSymbol` throws on a wrapper it doesn't recognize, so reaching this point
// already means all 135 drawings parsed. What's left to check is that each one
// is actually *in* the sprite under the id the page will ask for.
{
  const sprite = buildIconSprite();
  const missing: string[] = [];
  for (const m of MATERIALS) {
    if (!sprite.includes(`id="${materialSymbolId(m.id)}"`)) missing.push(m.name);
  }
  for (const k of OBJECT_KINDS) {
    if (!sprite.includes(`id="${objectSymbolId(k)}"`)) missing.push(k);
  }
  // An empty `<symbol …></symbol>` means the wrapper parsed but the drawing was
  // dropped — the failure the strict regex exists to prevent, checked from the
  // other end.
  const empty = (sprite.match(/<symbol[^>]*><\/symbol>/g) ?? []).length;
  check(
    'the icon sprite has a non-empty symbol for every entry',
    missing.length === 0 && empty === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${MATERIALS.length + OBJECT_KINDS.length} symbols, ${empty} empty`,
  );
}

// ── 6. Both locales describe every material and every object ───────────────
// The hole this page fails by. A material added without a description renders
// as a card with a name, an icon and a blank where the sentence goes — nothing
// throws, nothing looks broken, it is just missing. Swept per locale so a
// half-translated addition names the language it is short in.
{
  for (const [loc, mats, objs] of [
    ['ko', materialCodexKo, objectCodexKo],
    ['en', materialCodexEn, objectCodexEn],
  ] as const) {
    const missing = MATERIALS.filter((m) => (mats[m.id] ?? '').trim() === '').map((m) => m.name);
    const missingObjects = OBJECT_KINDS.filter((k) => (objs[k] ?? '').trim() === '');
    check(
      `every codex entry has a ${loc} description`,
      missing.length === 0 && missingObjects.length === 0,
      [...missing, ...missingObjects].join(', ') ||
        `${MATERIALS.length} materials, ${OBJECT_KINDS.length} objects`,
    );
  }
  // The other direction: a description keyed to an id nothing registers is a
  // rename or a deletion that left its paragraph behind, and it would never be
  // seen again.
  const known = new Set(MATERIALS.map((m) => m.id));
  const stale = [...Object.keys(materialCodexKo), ...Object.keys(materialCodexEn)]
    .map(Number)
    .filter((id) => !known.has(id));
  check(
    '…and no description is left over for a material the palette no longer lists',
    stale.length === 0,
    stale.length ? `ids ${[...new Set(stale)].join(', ')}` : 'none',
  );
}

// ── 7. Every stat row and trait card is named, in every locale ─────────────
// Same failure in the other half of the page: a term with no entry renders as
// its own key ('shockDeathChance'), which is worse than useless in a codex.
// Swept off what the entries actually use — including each `variant` — rather
// than off the spec lists, so a trait form nothing declares isn't demanded.
//
// One of the two ways this used to break is gone: the tag vocabulary is a single
// table keyed by tag, each entry carrying every locale, so a term can no longer
// exist in Korean and not in English — `Record<Locale, CodexTerm>` refuses to
// compile. What is left for a sweep is a term nobody wrote and a term nobody
// reads, plus the blank string, which types can't see.
{
  const used = new Set<string>();
  for (const e of buildCodexEntries()) {
    for (const s of e.stats) used.add(s.key);
    for (const t of e.traits) used.add(t.variant === undefined ? t.key : `${t.key}.${t.variant}`);
  }
  for (const o of buildObjectEntries()) {
    for (const s of o.stats) used.add(s.key);
    for (const t of o.traits) used.add(t.variant === undefined ? t.key : `${t.key}.${t.variant}`);
  }
  for (const loc of LOCALES) {
    const missing = [...used].filter((k) => {
      const term = codexTerms[k]?.[loc];
      return (term?.label ?? '').trim() === '' || (term?.desc ?? '').trim() === '';
    });
    check(
      `every stat and trait in use has a ${loc} term`,
      missing.length === 0,
      missing.join(', ') || `${used.size} terms`,
    );
  }
  // A term nobody asks for is dead weight that reads as coverage — it makes the
  // sweep above look thorough while describing nothing on the page.
  const unused = Object.keys(codexTerms).filter((k) => !used.has(k));
  check(
    '…and no term is defined for something the codex never shows',
    unused.length === 0,
    unused.length ? unused.join(', ') : `${used.size} terms all in use`,
  );
}

// ── 8. Every entry has a state of matter, and every 상태 chip matches ───────
// The 상태 filter is the one axis that isn't derived from a label the palette
// already draws, so a phase key that stopped resolving would silently empty a
// chip rather than break anything. Both directions: no entry outside the four,
// and none of the four left with nothing under it.
{
  const entries = buildCodexEntries();
  const bad = entries.filter((e) => !PHASE_KEYS.includes(e.phase)).map((e) => `${e.name} → ${e.phase}`);
  check(
    'every codex entry carries one of the four phase keys',
    bad.length === 0,
    bad.length ? bad.join(', ') : `${PHASE_KEYS.join(', ')}`,
  );
  const empty = PHASE_KEYS.filter((p) => !entries.some((e) => e.phase === p));
  check(
    '…and each 상태 filter chip has materials behind it',
    empty.length === 0,
    empty.length
      ? `no material is ${empty.join(', ')}`
      : PHASE_KEYS.map((p) => `${p} ${entries.filter((e) => e.phase === p).length}`).join(', '),
  );
}

// ── 9. A material's extra shelves (`alsoIn`) are real, and never doubled ────
// A material may appear under several category tabs at once. Three ways that
// goes wrong, none of which the palette would tell you about:
//
//   A typo'd key ('powdr') doesn't fail — `buildCategories` treats an unknown
//   key as a brand-new tab, which is deliberate for a *canonical* `category`
//   (a new material can introduce its own tab) but is never what an extra
//   listing means. An extra shelf is a shelf that already exists; a new one is
//   introduced by being some material's canonical home plus a CATEGORY_META
//   entry, so that it has an icon and a place in the order.
//
//   A material listed twice in the same bucket *does* crash: the flyout is a
//   keyed `{#each cat.materials as m (m.id)}`, and Svelte throws on a duplicate
//   key. `categoriesOf` dedupes so it can't happen — this pins that.
//
//   A redundant listing (naming the canonical category again, or the same extra
//   twice) is harmless at runtime for the same reason, but it means the source
//   says something it doesn't mean, so it gets caught here rather than aging.
{
  const known = new Set(CATEGORY_META.map((c) => c.key));
  const withExtras = MATERIALS.filter((m) => m.alsoIn && m.alsoIn.length > 0);

  const unknown = withExtras.flatMap((m) =>
    m.alsoIn!.filter((k) => !known.has(k)).map((k) => `${m.name} → ${k}`),
  );
  check(
    'every `alsoIn` key names a tab CATEGORY_META already has',
    unknown.length === 0,
    unknown.length ? unknown.join(', ') : `${withExtras.length} material(s) list extra tabs`,
  );

  const redundant = withExtras
    .filter((m) => new Set(m.alsoIn).size !== m.alsoIn!.length || m.alsoIn!.includes(categoryOf(m)))
    .map((m) => `${m.name} → ${m.alsoIn!.join(', ')}`);
  check(
    '…and none of them repeats itself or the canonical category',
    redundant.length === 0,
    redundant.length ? redundant.join(', ') : 'no redundant listings',
  );

  // The invariant the palette's keyed each depends on, checked on the real
  // buckets rather than on the declarations that feed them.
  const doubled = buildCategories(MATERIALS)
    .filter((c) => new Set(c.materials.map((m) => m.id)).size !== c.materials.length)
    .map((c) => c.key);
  check(
    'no category tab lists the same material twice',
    doubled.length === 0,
    doubled.length ? doubled.join(', ') : 'every tab holds distinct materials',
  );

  // Both surfaces have to agree on where a material lives, or the codex tab and
  // the palette tab of the same name show different rosters.
  //
  // Read the palette side out of `buildCategories`'s actual output rather than
  // asking `categoriesOf` a second time. Both surfaces are fed by that one
  // function, so comparing two of its answers to each other passes no matter
  // what the palette does with them — an early version of this check did
  // exactly that, and gutting `buildCategories`'s multi-bucket insert (the one
  // line that puts a material in its extra tabs) still went green. Walking the
  // built tabs is what makes the claim about placement rather than declaration.
  const declared = new Map<number, Set<string>>();
  for (const cat of buildCategories(MATERIALS)) {
    for (const m of cat.materials) {
      const seen = declared.get(m.id) ?? new Set<string>();
      seen.add(cat.key);
      declared.set(m.id, seen);
    }
  }
  const sorted = (keys: Iterable<string>): string => [...keys].sort().join('|');
  const entries = buildCodexEntries();
  const mismatched = entries
    .filter((e) => sorted(declared.get(e.id) ?? []) !== sorted(e.categories))
    .map((e) => `${e.name} — 팔레트 [${sorted(declared.get(e.id) ?? [])}] vs 도감 [${sorted(e.categories)}]`);
  check(
    "…and each codex entry's categories are the tabs the palette really built",
    mismatched.length === 0,
    mismatched.length ? mismatched.join(', ') : `${entries.length} entries agree`,
  );

  // …and the tabs are what the materials asked for. Same reason again, one step
  // further back: the pair above would still agree if both surfaces dropped the
  // same extra tab, because the codex reads `categoriesOf` too. So this side
  // reads the declaration off the raw fields — `alsoIn` as written in the
  // material's own file — and never calls `categoriesOf`, which puts the one
  // function everything else trusts under test instead of in the answer.
  const asWritten = (m: Material): Set<string> =>
    new Set([categoryOf(m), ...(m.alsoIn ?? [])]);
  const unplaced = MATERIALS.filter(
    (m) => sorted(declared.get(m.id) ?? []) !== sorted(asWritten(m)),
  ).map((m) => `${m.name} — 탭 [${sorted(declared.get(m.id) ?? [])}] vs 선언 [${sorted(asWritten(m))}]`);
  check(
    '…and every material lands in exactly the tabs it declares',
    unplaced.length === 0,
    unplaced.length ? unplaced.join(', ') : `${MATERIALS.length} materials placed`,
  );

  // 폭발 탭의 첫 자리는 불. Nearly everything on that shelf is inert until a Fire
  // cell reaches it, so Fire is listed there too (fire.ts's `alsoIn`) and belongs
  // at the front of it — the trigger before the things it triggers.
  //
  // Nothing declares that position: a tab holds its materials in MATERIALS array
  // order, so Fire leads the 폭발 tab only because the array lists it ahead of
  // every explosive. That is one careless insertion away from silently changing,
  // which is exactly why it is pinned here rather than left to the array.
  const explosive = buildCategories(MATERIALS).find((c) => c.key === 'explosive');
  check(
    '폭발 탭의 첫 칩은 불이다',
    explosive?.materials[0]?.name === 'Fire',
    explosive === undefined
      ? 'there is no 폭발 tab'
      : `first is ${explosive.materials[0]?.name}, ${explosive.materials.length} chips`,
  );
}

// ── 10. The 태그 필터 panel offers every tag the codex shows ────────────────
// Same failure mode as the coverage sweep at the top, one layer up: a new trait
// card that nothing files under a heading doesn't crash, it just never appears
// in the filter — the page keeps working and the tag is unfindable. And a
// heading with no i18n label renders as its own key.
{
  const used = new Set<string>();
  for (const e of [...buildCodexEntries(), ...buildObjectEntries()]) {
    for (const t of e.traits) used.add(t.key);
  }
  const ungrouped = [...used].filter((k) => !GROUPED_TRAIT_KEYS.includes(k));
  check(
    'every trait the codex shows is filed under a 태그 필터 heading',
    ungrouped.length === 0,
    ungrouped.length
      ? `add these to a group in game/codex/tags.ts: ${ungrouped.join(', ')}`
      : `${used.size} traits grouped`,
  );

  const groups = buildTagGroups(buildCodexEntries(), buildObjectEntries());
  const chips = groups.reduce((n, g) => n + g.tags.length, 0);
  check(
    '…and the panel is built with real chips under real headings',
    groups.length > 0 && chips >= used.size,
    `${groups.length} groups, ${chips} chips`,
  );

  for (const [loc, table] of [['ko', uiKo], ['en', uiEn]] as const) {
    const unlabelled = TAG_GROUP_KEYS.filter(
      (k) => ((table.codex.tagGroup as Record<string, string>)[k] ?? '').trim() === '',
    );
    check(
      `every 태그 필터 heading has a ${loc} label`,
      unlabelled.length === 0,
      unlabelled.join(', ') || `${TAG_GROUP_KEYS.length} headings`,
    );
  }
}

// ── 11. The Markdown export resolves every string it asks for ───────────────
// `t()` answers an unknown key with the key itself, which is exactly how the
// export would fail: silently, as a paste reading `codex.md.value` where a
// column header belongs. So drive the real writers over the real roster in both
// locales and fail on any leaked key. This also exercises the writers against
// every entry shape there is — no stats, no reactions, an object with no phase.
{
  const before = $locale.get();
  const tx = {
    t,
    term: codexTerm,
    refName: (id: number) => (id === 0 ? t('codex.nothing') : materialName(id, String(id))),
    tagLabel: (tr: { key: string; variant?: string }) =>
      codexTerm(tr.variant === undefined ? tr.key : `${tr.key}.${tr.variant}`).label,
  };

  for (const loc of LOCALES) {
    $locale.set(loc);
    const entries = [
      ...buildCodexEntries().map((e) => ({
        name: materialName(e.id, e.name),
        sub: e.name,
        categoryName: categoryLabel(e.category),
        phaseName: categoryLabel(e.phase),
        desc: materialDescription(e.id),
        stats: e.stats,
        traits: e.traits,
        reactions: e.reactions,
      })),
      ...buildObjectEntries().map((o) => ({
        name: objectLabel(o.kind as never),
        sub: '',
        categoryName: t('codex.objects'),
        phaseName: null,
        desc: objectDescription(o.kind as never),
        stats: o.stats,
        traits: o.traits,
        reactions: [],
      })),
    ];

    const docs = [
      listMarkdown(entries, tx, { filters: [t('codex.md.category') + ': x'], total: entries.length }),
      ...entries.map((e) => entryMarkdown(e, tx)),
    ];
    // A leaked key is a dotted lowercase path with no spaces — the shape `t()`
    // hands back on a miss, and nothing the prose contains.
    const leaks = new Set<string>();
    for (const doc of docs) for (const m of doc.match(/\bcodex\.[a-zA-Z.]+/g) ?? []) leaks.add(m);
    check(
      `the ${loc} Markdown export resolves every i18n key it uses`,
      leaks.size === 0,
      leaks.size ? [...leaks].join(', ') : `${docs.length} documents`,
    );
    // A table row per entry plus the two header rows, and a heading per entry.
    const list = docs[0];
    check(
      `…and the ${loc} list export carries every visible entry`,
      list.split('\n').filter((l) => l.startsWith('| ')).length === entries.length + 2 &&
        list.split('\n').filter((l) => l.startsWith('## ')).length === entries.length,
      `${entries.length} entries`,
    );
  }
  $locale.set(before);
}

console.log(failures === 0 ? '\nAll 도감 checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
