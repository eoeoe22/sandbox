// Central material barrel. Importing this module registers every material as a
// side effect. To add a material: create its file, then add two lines here
// (the import and the MATERIALS entry) — nothing else in the codebase changes.
export * from './registry';

import { EMPTY_MAT } from './empty';
import { WALL } from './wall';
import { SAND } from './sand';
import { WATER } from './water';
import { STONE } from './stone';
import { SALTWATER } from './saltwater';
import { SMOKE } from './smoke';
import { SALT } from './salt';
import { STEAM } from './steam';
import { FIRE } from './fire';
import { LAVA } from './lava';
import { ACID } from './acid';
import { ACID_VAPOR } from './acidvapor';
import { GUNPOWDER } from './gunpowder';
import { NITRO } from './nitro';
import { BLAST } from './blast';
import { EMBER } from './ember';
import { BLUE_FLAME } from './blueflame';
import { METHANE } from './methane';
import { ICE } from './ice';
import { SNOW } from './snow';
import { OIL } from './oil';
import { GASOLINE } from './gasoline';
import { PETROLEUM_GAS } from './petroleumgas';
import { PETROLEUM_VAPOR } from './petroleumvapor';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';
import { ASPHALT } from './asphalt';
import { COAL } from './coal';
import { WOOD } from './wood';
import { SAWDUST } from './sawdust';
import { IRON } from './iron';
import { MOLTEN_METAL } from './moltenmetal';
import { MOLTEN_GLASS } from './moltenglass';
import { GLASS } from './glass';
import { LIQUID_NITROGEN } from './liquidnitrogen';
import { DRY_ICE } from './dryice';
import { OXYGEN } from './oxygen';
import { HYDROGEN } from './hydrogen';
import { SPARK } from './spark';
import { BATTERY } from './battery';
import { MERCURY } from './mercury';
import { HONEY } from './honey';
import { ALCOHOL } from './alcohol';
import { DIRT } from './dirt';
import { MUD } from './mud';
import { CEMENT } from './cement';
import { CONCRETE } from './concrete';
import { PLANT } from './plant';
import { VIRUS } from './virus';
import { CLONE } from './clone';
import { VOID } from './void';
import { ANTIMATTER } from './antimatter';
import { TNT } from './tnt';
import { FUSE } from './fuse';
import { THERMITE } from './thermite';
import { ASH } from './ash';
import { MOLTEN_SALT } from './moltensalt';
import { DIAMOND } from './diamond';
import { URANIUM } from './uranium';
import { MOLTEN_URANIUM } from './moltenuranium';
import { HEAT_RAY } from './heatray';
import { LPG } from './lpg';
import { COAL_POWDER } from './coalpowder';
import { SLAG } from './slag';
import { LIMESTONE } from './limestone';
import { IRON_ORE } from './ironore';
import { MOLTEN_IRON_ORE } from './moltenironore';

export {
  EMPTY_MAT,
  WALL,
  SAND,
  WATER,
  STONE,
  SALTWATER,
  SMOKE,
  SALT,
  STEAM,
  FIRE,
  LAVA,
  ACID,
  ACID_VAPOR,
  GUNPOWDER,
  NITRO,
  BLAST,
  EMBER,
  BLUE_FLAME,
  METHANE,
  ICE,
  SNOW,
  OIL,
  GASOLINE,
  PETROLEUM_GAS,
  PETROLEUM_VAPOR,
  KEROSENE,
  DIESEL,
  ASPHALT,
  COAL,
  WOOD,
  SAWDUST,
  IRON,
  MOLTEN_METAL,
  MOLTEN_GLASS,
  GLASS,
  LIQUID_NITROGEN,
  DRY_ICE,
  OXYGEN,
  HYDROGEN,
  SPARK,
  BATTERY,
  MERCURY,
  HONEY,
  ALCOHOL,
  DIRT,
  MUD,
  CEMENT,
  CONCRETE,
  PLANT,
  VIRUS,
  CLONE,
  VOID,
  ANTIMATTER,
  TNT,
  FUSE,
  THERMITE,
  ASH,
  MOLTEN_SALT,
  DIAMOND,
  URANIUM,
  MOLTEN_URANIUM,
  HEAT_RAY,
  LPG,
  COAL_POWDER,
  SLAG,
  LIMESTONE,
  IRON_ORE,
  MOLTEN_IRON_ORE,
};

/** Palette order (also drives the toolbar). Three materials are deliberately
 *  absent — all transient effect particles that only make sense when the
 *  simulation spawns them, never when painted by hand:
 *   • EMBER — blast ejecta an explosion launches with a real velocity (see
 *     ember.ts); painted by brush it would just die on its first turn.
 *   • SPARK — the one-tick electric pulse that only exists while a conductor is
 *     energized (see spark.ts); it's produced by a Battery or handed on from a
 *     neighboring spark, and painted onto bare ground it would simply fizzle.
 *   • HEAT_RAY — the searing beam a critical uranium mass emits with a real
 *     flight direction (see heatray.ts); hand-placed it would die on its first
 *     turn just like an unlaunched ember. */
export const MATERIALS = [
  EMPTY_MAT,
  WALL,
  SAND,
  WATER,
  STONE,
  SALTWATER,
  SMOKE,
  SALT,
  STEAM,
  FIRE,
  LAVA,
  ACID,
  ACID_VAPOR,
  GUNPOWDER,
  NITRO,
  BLAST,
  BLUE_FLAME,
  METHANE,
  ICE,
  SNOW,
  OIL,
  GASOLINE,
  PETROLEUM_GAS,
  PETROLEUM_VAPOR,
  KEROSENE,
  DIESEL,
  ASPHALT,
  COAL,
  WOOD,
  SAWDUST,
  IRON,
  MOLTEN_METAL,
  MOLTEN_GLASS,
  GLASS,
  LIQUID_NITROGEN,
  DRY_ICE,
  OXYGEN,
  HYDROGEN,
  BATTERY,
  MERCURY,
  HONEY,
  ALCOHOL,
  DIRT,
  MUD,
  CEMENT,
  CONCRETE,
  PLANT,
  VIRUS,
  CLONE,
  VOID,
  ANTIMATTER,
  URANIUM,
  MOLTEN_URANIUM,
  TNT,
  FUSE,
  THERMITE,
  MOLTEN_SALT,
  DIAMOND,
  ASH,
  LPG,
  IRON_ORE,
  MOLTEN_IRON_ORE,
  COAL_POWDER,
  LIMESTONE,
  SLAG,
];
