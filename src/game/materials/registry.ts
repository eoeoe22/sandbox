import type { Material, MatId } from '../engine/types';
import { defaultUpdate } from '../engine/behaviors';

// Flat lookup by id — `getMaterial(id)` is on the render/simulation hot path,
// so it must be a plain array index.
const byId: Material[] = [];

// ── 가용성 쌍 (see Material.miscible) ─────────────────────────────────────────
// A pair is declared on ONE of its two materials, and both of the readings below
// are built from that declaration in both directions — which is what lets the
// pair behave symmetrically without the two files having to agree on anything:
//
//  • `areMiscible(a, b)` — a packed-key Set, because SimContext.tryMove asks it
//    on every fluid-meets-fluid displacement and wants one hash lookup, not a
//    scan of somebody's list.
//  • `misciblePartnersOf(id)` — the list form, for the two places that need to
//    *enumerate* a material's partners rather than test one: the interdiffusion
//    step (behaviors.ts) and the 도감 trait card. Diffusion in particular has to
//    read this and not `Material.miscible`, or only the declaring half of a pair
//    would stir and mixing would run at half rate from one side of the boundary.
const MISCIBLE_STRIDE = 1024; // > any material id; `check:material-ids` keeps ids small
const misciblePairs = new Set<number>();
const misciblePartners: MatId[][] = [];

/** True if `a` and `b` form a solution rather than two layers — symmetric, and
 *  cheap enough for `tryMove` to ask on every fluid-meets-fluid displacement. */
export function areMiscible(a: MatId, b: MatId): boolean {
  return misciblePairs.size > 0 && misciblePairs.has(a * MISCIBLE_STRIDE + b);
}

/** Every material `id` forms a solution with, whichever side declared the pair.
 *  Empty (a shared frozen array, so the caller can loop without a null check)
 *  for the vast majority of materials, which mix with nothing. */
export function misciblePartnersOf(id: MatId): readonly MatId[] {
  return misciblePartners[id] ?? NO_PARTNERS;
}
const NO_PARTNERS: readonly MatId[] = [];

/** Record one direction of a pair. Idempotent, so a pair declared on both of its
 *  materials (harmless, if redundant) doesn't list a partner twice. */
function linkMiscible(a: MatId, b: MatId): void {
  misciblePairs.add(a * MISCIBLE_STRIDE + b);
  const list = (misciblePartners[a] ??= []);
  if (!list.includes(b)) list.push(b);
}

/**
 * Register a material. Adding a material = create one file that calls this.
 * If `update` is omitted, the phase's default behavior is attached.
 */
export function register(def: Material): Material {
  // Two materials silently claiming the same id used to mean the
  // later-imported one clobbered the earlier one in `byId` with no error —
  // one vanished from the palette while its `.id` resolved to the wrong
  // material everywhere else. Fail loudly instead.
  if (byId[def.id] !== undefined) {
    throw new Error(
      `Material id ${def.id} already registered to "${byId[def.id].name}" — cannot register "${def.name}" with the same id.`,
    );
  }
  const material: Material = {
    ...def,
    update: def.update ?? defaultUpdate(def.phase),
  };
  byId[def.id] = material;
  if (def.miscible !== undefined) {
    for (const other of def.miscible) {
      if (other === def.id) continue; // a liquid is trivially miscible with itself
      linkMiscible(def.id, other);
      linkMiscible(other, def.id);
    }
  }
  return material;
}

export function getMaterial(id: MatId): Material {
  return byId[id];
}

/** All registered materials, in id order (used to build the palette). */
export function allMaterials(): Material[] {
  return byId.filter(Boolean);
}
