// Central material barrel. Importing this module registers every material as a
// side effect. To add a material: create its file, then add two lines here
// (the import and the MATERIALS entry) — nothing else in the codebase changes.
export * from './registry';

import { EMPTY_MAT } from './empty';
import { WALL } from './wall';
import { SAND } from './sand';
import { WATER } from './water';
import { STONE } from './stone';
import { OBSIDIAN } from './obsidian';
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
import { LPG } from './lpg';
import { PETROLEUM_VAPOR } from './petroleumvapor';
import { KEROSENE } from './kerosene';
import { DIESEL } from './diesel';
import { ASPHALT } from './asphalt';
import { COAL } from './coal';
import { WOOD } from './wood';
import { SAWDUST } from './sawdust';
import { IRON } from './iron';
import { MOLTEN_IRON } from './molteniron';
import { MOLTEN_GLASS } from './moltenglass';
import { BROKEN_GLASS } from './brokenglass';
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
import { U238 } from './u238';
import { MOLTEN_U238 } from './moltenu238';
import { NUKE_WASTE } from './nukewaste';
import { NUCLEAR_RAY } from './nuclearray';
import { HEAT_RAY } from './heatray';
import { LASER } from './laser';
import { COAL_POWDER } from './coalpowder';
import { METAL_POWDER } from './metalpowder';
import { SLAG } from './slag';
import { LIMESTONE } from './limestone';
import { IRON_ORE } from './ironore';
import { MOLTEN_IRON_ORE } from './moltenironore';
import { DEBRIS } from './debris';
import { CLUSTER } from './cluster';
import { BOMBLET } from './bomblet';
import { NAPALM } from './napalm';
import { NAPALM_GEL } from './napalmgel';
import { C4 } from './c4';
import { SHAPED_CHARGE } from './shapedcharge';
import { SODA } from './soda';
import { NICHROME } from './nichrome';
import { LFP_BATTERY } from './lfpbattery';
import { HEATPIPE } from './heatpipe';
import { TURBINE } from './turbine';
import { MESH } from './mesh';
import { SODIUM } from './sodium';
import { CO2 } from './co2';
import { HYDROGEN_PEROXIDE } from './hydrogenperoxide';
import { YEAST } from './yeast';
import { SEED } from './seed';
import { CORAL } from './coral';
import { BLEACHED_CORAL } from './bleachedcoral';
import { SLIME } from './slime';
import { ACID_SLIME } from './acidslime';
import { RESIN } from './resin';
import { AMBER } from './amber';
import { WHITE_PHOSPHORUS } from './whitephosphorus';
import { SUGAR } from './sugar';
import { SUGAR_WATER } from './sugarwater';
import { CHLORINE } from './chlorine';
import { HELIUM } from './helium';
import { AEROGEL } from './aerogel';
import { AMMONIUM_NITRATE } from './ammoniumnitrate';
import { CONVEYOR } from './conveyor';
import { SOAPY_WATER } from './soapywater';
import { BUBBLE } from './bubble';
import { SOAP } from './soap';
import { WOOFER } from './woofer';
import { TERMITE } from './termite';
import { NANOBOT } from './nanobot';
import { FAN } from './fan';
import { RUST } from './rust';
import { RUST_POWDER } from './rustpowder';
import { GALLIUM } from './gallium';
import { LIQUID_GALLIUM } from './liquidgallium';
import { MERCURY_VAPOR } from './mercuryvapor';
import { PUMP } from './pump';
import { ELECTROMAGNET } from './electromagnet';
import { SULFUR } from './sulfur';
import { SALTPETER } from './saltpeter';
import { ALUMINUM_POWDER } from './aluminumpowder';
import { FIREWORKS } from './fireworks';
import { FIREWORK_STAR } from './fireworkstar';
import { FIREWORK_BURST } from './fireworkburst';
import { WIRE } from './wire';
import { SOLAR_PANEL } from './solarpanel';
import { MOLTEN_ALUMINUM } from './moltenaluminum';
import { ALUMINUM } from './aluminum';
import { FLASH_POWDER } from './flashpowder';
import { FLASH } from './flash';
import { ETHYLENE } from './ethylene';
import { CATALYST } from './catalyst';
import { POLYETHYLENE } from './polyethylene';
import { ACTIVATED_ALUMINUM } from './activatedaluminum';
import { AMMONAL } from './ammonal';

export {
  EMPTY_MAT,
  WALL,
  SAND,
  WATER,
  STONE,
  OBSIDIAN,
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
  LPG,
  PETROLEUM_VAPOR,
  KEROSENE,
  DIESEL,
  ASPHALT,
  COAL,
  WOOD,
  SAWDUST,
  IRON,
  MOLTEN_IRON,
  MOLTEN_GLASS,
  BROKEN_GLASS,
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
  U238,
  MOLTEN_U238,
  NUKE_WASTE,
  NUCLEAR_RAY,
  HEAT_RAY,
  LASER,
  COAL_POWDER,
  METAL_POWDER,
  SLAG,
  LIMESTONE,
  IRON_ORE,
  MOLTEN_IRON_ORE,
  DEBRIS,
  CLUSTER,
  BOMBLET,
  NAPALM,
  NAPALM_GEL,
  C4,
  SHAPED_CHARGE,
  SODA,
  NICHROME,
  LFP_BATTERY,
  HEATPIPE,
  TURBINE,
  MESH,
  SODIUM,
  CO2,
  HYDROGEN_PEROXIDE,
  YEAST,
  SEED,
  CORAL,
  BLEACHED_CORAL,
  SLIME,
  ACID_SLIME,
  RESIN,
  AMBER,
  WHITE_PHOSPHORUS,
  SUGAR,
  SUGAR_WATER,
  CHLORINE,
  HELIUM,
  AEROGEL,
  AMMONIUM_NITRATE,
  CONVEYOR,
  SOAPY_WATER,
  BUBBLE,
  SOAP,
  WOOFER,
  TERMITE,
  NANOBOT,
  FAN,
  RUST,
  RUST_POWDER,
  GALLIUM,
  LIQUID_GALLIUM,
  MERCURY_VAPOR,
  PUMP,
  ELECTROMAGNET,
  SULFUR,
  SALTPETER,
  ALUMINUM_POWDER,
  FIREWORKS,
  FIREWORK_STAR,
  FIREWORK_BURST,
  WIRE,
  SOLAR_PANEL,
  MOLTEN_ALUMINUM,
  ALUMINUM,
  FLASH_POWDER,
  FLASH,
  ETHYLENE,
  CATALYST,
  POLYETHYLENE,
  ACTIVATED_ALUMINUM,
  AMMONAL,
};

/** Palette order (also drives the toolbar). Several materials are deliberately
 *  absent:
 *   • EMPTY_MAT (the eraser) — erasing is now a dedicated brush tool in the
 *     control panel (alongside heat/cool/mix), not a palette material, so it no
 *     longer needs a "지우개" tab of its own. It stays registered (id 0 is the
 *     background/erase material) and simply isn't listed here.
 *   • EMBER — blast ejecta an explosion launches with a real velocity (see
 *     ember.ts); painted by brush it would just die on its first turn.
 *   • SPARK — the one-tick electric pulse that only exists while a conductor is
 *     energized (see spark.ts); it's produced by a Battery or handed on from a
 *     neighboring spark, and painted onto bare ground it would simply fizzle.
 *   • NUCLEAR_RAY — the searing beam a critical uranium mass emits with a real
 *     flight direction (see nuclearray.ts); hand-placed it would die on its first
 *     turn just like an unlaunched ember.
 *   • HEAT_RAY — the laser beam a powered Laser fires, again with a real flight
 *     direction (see heatray.ts / laser.ts); like the Nuclear Ray it only exists
 *     mid-flight, so hand-placed it would die at once. The Laser emitter itself is
 *     in the palette (전기 tab); the beam it fires is not.
 *   • DEBRIS / BOMBLET / NAPALM_GEL — ballistic ejecta a blast throws with a
 *     real velocity (see ballistic.ts): the loose grains a weak blast shoves
 *     aside (the built-in concussion — see blast.ts/debris.ts), a cluster shell's
 *     submunitions, and a napalm shell's sticky fire-gel. Like Ember they only
 *     exist mid-flight; painted by hand they'd fall inert at once.
 *   • BUBBLE — the air bubble only Soapy Water produces (see bubble.ts); it rises
 *     and pops back to soapy water, so hand-placed in open air it just pops at
 *     once.
 *   • FIREWORK_STAR — a Fireworks charge's submunition (see fireworkstar.ts),
 *     launched with a real velocity and a colour rolled at launch, like the
 *     Cluster shell's Bomblet. Painted by hand it would open its flower on the
 *     spot.
 *   • FIREWORK_BURST — the coloured flower a star opens into (fireworkburst.ts).
 *     It only ever exists as that product: its colour lives in the `aux` a star
 *     stamps, so one placed by brush would be a colour-0 cell that fades at once.
 *   • FLASH — the white light a Flash Powder detonation fills its reach with
 *     (flash.ts), the same kind of thing as the shockwave flash it replaces.
 *     Hand-placed it would be a lone motionless white dot that blinks out.
 *
 *  The Fan's gust is deliberately NOT a material at all: it's a transient wind
 *  *field* (Grid.wind) the Fan stamps and the renderer/object layer read, so there
 *  is no "Wind" material to list or exclude here (see materials/fan.ts). */
export const MATERIALS = [
  WALL,
  SAND,
  WATER,
  STONE,
  OBSIDIAN,
  SALTWATER,
  SUGAR_WATER,
  SMOKE,
  SALT,
  SODA,
  STEAM,
  FIRE,
  LAVA,
  ACID,
  ACID_VAPOR,
  GUNPOWDER,
  FLASH_POWDER,
  AMMONAL,
  FIREWORKS,
  SULFUR,
  SALTPETER,
  NITRO,
  BLAST,
  BLUE_FLAME,
  METHANE,
  ICE,
  SNOW,
  OIL,
  GASOLINE,
  LPG,
  PETROLEUM_VAPOR,
  KEROSENE,
  DIESEL,
  ASPHALT,
  ETHYLENE,
  CATALYST,
  POLYETHYLENE,
  COAL,
  WOOD,
  SAWDUST,
  IRON,
  ALUMINUM,
  RUST,
  GALLIUM,
  MOLTEN_IRON,
  MOLTEN_ALUMINUM,
  MOLTEN_GLASS,
  BROKEN_GLASS,
  GLASS,
  LIQUID_NITROGEN,
  DRY_ICE,
  AMMONIUM_NITRATE,
  OXYGEN,
  HYDROGEN,
  BATTERY,
  LFP_BATTERY,
  NICHROME,
  WIRE,
  SOLAR_PANEL,
  WOOFER,
  FAN,
  LASER,
  PUMP,
  ELECTROMAGNET,
  MERCURY,
  MERCURY_VAPOR,
  LIQUID_GALLIUM,
  HONEY,
  ALCOHOL,
  SOAPY_WATER,
  SOAP,
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
  U238,
  MOLTEN_U238,
  NUKE_WASTE,
  TNT,
  FUSE,
  THERMITE,
  CLUSTER,
  NAPALM,
  C4,
  SHAPED_CHARGE,
  MOLTEN_SALT,
  DIAMOND,
  ASH,
  IRON_ORE,
  MOLTEN_IRON_ORE,
  COAL_POWDER,
  METAL_POWDER,
  RUST_POWDER,
  ALUMINUM_POWDER,
  ACTIVATED_ALUMINUM,
  LIMESTONE,
  SLAG,
  HEATPIPE,
  TURBINE,
  MESH,
  SODIUM,
  SUGAR,
  HYDROGEN_PEROXIDE,
  RESIN,
  CO2,
  CHLORINE,
  HELIUM,
  WHITE_PHOSPHORUS,
  AMBER,
  AEROGEL,
  CONVEYOR,
  SEED,
  CORAL,
  BLEACHED_CORAL,
  YEAST,
  SLIME,
  ACID_SLIME,
  TERMITE,
  NANOBOT,
];
