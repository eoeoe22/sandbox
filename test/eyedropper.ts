// Headless harness for the 스포이드 (휠클릭 물질 선택) — the middle-click pick that
// turns whatever is under the cursor into the palette selection.
//
// The pick itself is pointer plumbing and can be tried by hand; what can't be
// tried by hand is whether it still *covers the palette*. Its two rules are both
// mappings from the world back to a chip, and both go stale silently:
//
//   • A material that isn't in `MATERIALS` must pick nothing. Add a chip and
//     forget this and nothing breaks — the chip simply can't be picked off the
//     canvas, which reads as "the 스포이드 is flaky", not as a missing entry.
//   • Every 독립 오브젝트 kind must map back to itself. `spawnObject` builds a body
//     from a kind and `paletteKindOf` reads a kind off a body, and the two are
//     written in different places from different directions: the three drums
//     collapse into one capsule that differs only by `fill`, and both the drum
//     and the crate carry a `part` whose shard values have no chip at all. A
//     ninth object, or a fourth drum fill, is exactly the kind of addition that
//     would leave one side behind.
//
// So the object sweep runs over `OBJECT_KINDS` rather than over a hand-written
// list, the same way test/codex.ts holds the codex to that roster: a kind nobody
// taught the 스포이드 about fails here instead of quietly picking nothing.
//
// Run: `node test/run-eyedropper.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { paletteKindOf, pickedMaterialAt } from '../src/game/input/PointerPainter';
import {
  createRubberBall,
  createDrum,
  createDrumPiece,
  createDynamite,
  createFlashbang,
  createWoodBox,
  createMolotov,
} from '../src/game/engine/objects';
import type { SimBody } from '../src/game/engine/objects';
import { OBJECT_KINDS, type ObjectKind } from '../src/state/store';
import { MATERIALS, isPaletteMaterial } from '../src/game/materials';
import { EMPTY } from '../src/game/engine/types';
import { SAND } from '../src/game/materials/sand';
import { WATER } from '../src/game/materials/water';
import { ACID } from '../src/game/materials/acid';
import { EMBER } from '../src/game/materials/ember';
import { DEBRIS } from '../src/game/materials/debris';
import { HEAT_RAY } from '../src/game/materials/heatray';
import { BUBBLE } from '../src/game/materials/bubble';
import { DEAD_FISH } from '../src/game/materials/deadfish';
import '../src/game/materials';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── 1. 겹침: the host wins ──────────────────────────────────────────────────
// The rule the feature was asked for in as many words: 모래+물이면 모래. A soaked
// cell is one grain with a fluid inside it, and the grain is the thing that was
// pointed at.
{
  const grid = new Grid(20, 20);
  grid.set(5, 5, SAND.id);
  grid.setOverlay(5, 5, WATER.id);
  check('스며든 물보다 호스트(모래)를 집는다', pickedMaterialAt(grid, 5, 5) === SAND.id);

  grid.set(6, 5, SAND.id);
  grid.setOverlay(6, 5, ACID.id);
  check('…소킹된 액체가 무엇이든 마찬가지다', pickedMaterialAt(grid, 6, 5) === SAND.id);

  grid.set(7, 5, WATER.id);
  check('겹침이 없는 액체는 그 액체를 집는다', pickedMaterialAt(grid, 7, 5) === WATER.id);

  // Not a state the sim produces — a soaked fluid has nowhere to live without a
  // host — but the rule needs an answer rather than a hole, and this is it.
  grid.set(8, 5, EMPTY);
  grid.setOverlay(8, 5, WATER.id);
  check('호스트가 비었으면 겹침으로 떨어진다', pickedMaterialAt(grid, 8, 5) === WATER.id);
}

// ── 2. Empty space and out of bounds pick nothing ──────────────────────────
// Silently: the Eraser is a real material with a real id (0), so "empty" would
// otherwise pick the eraser brush — a click on the sky quietly disarming your
// build is exactly the surprise this is here to prevent.
{
  const grid = new Grid(20, 20);
  check('빈 칸은 아무것도 집지 않는다 (지우개로 바뀌지 않는다)', pickedMaterialAt(grid, 3, 3) === null);
  check('…경계 밖도 마찬가지', pickedMaterialAt(grid, -1, 3) === null && pickedMaterialAt(grid, 20, 3) === null);
}

// ── 3. The admission test is exactly the palette roster ────────────────────
{
  const missing = MATERIALS.filter((m) => !isPaletteMaterial(m.id));
  check(
    '팔레트의 모든 물질이 스포이드로 집힌다',
    missing.length === 0,
    `${MATERIALS.length}종${missing.length ? ' — 빠짐: ' + missing.map((m) => m.name).join(', ') : ''}`,
  );

  // The effect-only cells: things that exist for a few ticks mid-blast and have
  // no chip (see the roll-call above MATERIALS). Picking one would leave the
  // palette showing a selection that isn't there.
  const effectOnly = [EMBER, DEBRIS, HEAT_RAY, BUBBLE, DEAD_FISH];
  const admitted = effectOnly.filter((m) => isPaletteMaterial(m.id));
  check(
    '팔레트에 없는 효과 전용 물질은 집히지 않는다',
    admitted.length === 0,
    admitted.length ? admitted.map((m) => m.name).join(', ') : `${effectOnly.length}종 확인`,
  );
  check('…지우개(id 0)도 물질이 아니다', !isPaletteMaterial(EMPTY));

  // And the same thing through the grid path, so the two can't disagree.
  const grid = new Grid(20, 20);
  grid.set(2, 2, EMBER.id);
  check('불티가 놓인 칸을 집어도 선택은 안 바뀐다', pickedMaterialAt(grid, 2, 2) === null);
}

// ── 4. Every 독립 오브젝트 kind maps back to its own chip ────────────────────
{
  // What `spawnObject` builds for each palette kind. Restated here rather than
  // borrowed, which is the point: if the two ever disagree, this fails.
  const spawn: Record<ObjectKind, () => SimBody> = {
    ball: () => createRubberBall(5, 5, 4),
    drum: () => createDrum(5, 5, 'empty'),
    oildrum: () => createDrum(5, 5, 'oil'),
    aciddrum: () => createDrum(5, 5, 'acid'),
    dynamite: () => createDynamite(5, 5),
    flashbang: () => createFlashbang(5, 5),
    crate: () => createWoodBox(5, 5),
    molotov: () => createMolotov(5, 5),
  };

  const wrong = OBJECT_KINDS.filter((k) => paletteKindOf(spawn[k]()) !== k);
  check(
    '스폰한 오브젝트는 자기 칩으로 되짚힌다',
    wrong.length === 0,
    `${OBJECT_KINDS.length}종${wrong.length ? ' — 어긋남: ' + wrong.join(', ') : ''}`,
  );

  // The shards. Wreckage only — a burst drum and a smashed crate leave these,
  // and neither has a palette entry to select.
  const shards: SimBody[] = [
    createDrumPiece(5, 5, 'empty', 'piece1'),
    createDrumPiece(5, 5, 'oil', 'piece2'),
    createDrumPiece(5, 5, 'acid', 'piece3'),
    createWoodBox(5, 5, 'piece1'),
    createWoodBox(5, 5, 'piece2'),
    createWoodBox(5, 5, 'piece3'),
  ];
  const picked = shards.filter((o) => paletteKindOf(o) !== null);
  check(
    '파편은 아무 칩도 아니다 (조용히 실패)',
    picked.length === 0,
    picked.length ? picked.map((o) => o.kind).join(', ') : `${shards.length}개 확인`,
  );

  // A drum with an unknown fill would fall through the ternary chain to 빈 드럼통
  // rather than to null, which is worth knowing: the fill values are a closed
  // union, so this is a statement about the three that exist, not a guess.
  const fills = new Set(
    (['empty', 'oil', 'acid'] as const).map((f) => paletteKindOf(createDrum(5, 5, f))),
  );
  check('드럼 세 종이 서로 다른 칩으로 갈린다', fills.size === 3, [...fills].join(', '));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
