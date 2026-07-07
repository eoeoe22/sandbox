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
