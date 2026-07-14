import type { Material, MatId } from '../engine/types';
import { defaultUpdate } from '../engine/behaviors';

// Flat lookup by id — `getMaterial(id)` is on the render/simulation hot path,
// so it must be a plain array index.
const byId: Material[] = [];

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
  return material;
}

export function getMaterial(id: MatId): Material {
  return byId[id];
}

/** All registered materials, in id order (used to build the palette). */
export function allMaterials(): Material[] {
  return byId.filter(Boolean);
}
