// English description texts for the material codex — material and object descriptions.
//
// Names and descriptions of property tags are in codexTerms.ts.
// Keys are `Material.id` and `ObjectKind`.

import type { ObjectKind } from '../state/store';

// --- Material Codex (English) ------------------------------------------------

export const materialCodexEn: Record<number, string> = {
  // Solids
  1: 'An indestructible wall. It is completely excluded from the thermal conduction system.',
  4: 'Melts into lava at 1100°C or higher.',
  124: 'A black volcanic glass formed when lava directly contacts water. Immune to most explosions, but like stone, it melts back into lava at 1100°C and corrodes in acid.',
  28: 'A metal with high thermal and electrical conductivity. Slowly turns to rust when in contact with saltwater, and releases hydrogen gas when dissolving in acid.',
  113: 'Rusted metal. Can be smelted back into iron in a blast furnace, but with low yield.',
  116: 'A metal that melts at 30°C. Slowly releases hydrogen gas and dissolves when in contact with acid.',
  136: 'Melts at 660°C and becomes embrittled and crumbles into powder when touching liquid gallium. Dissolves releasing hydrogen when contacting acid. When heated above 250°C, it burns with flames and white smoke in contact with chlorine gas.',
  32: 'Transparent and acid-resistant. Melts into molten glass at 1150°C or higher, and shatters when exposed to explosive shockwaves.',
  46: 'The hardened result of mixing cement with water. Solid, but vulnerable to explosions and acid.',
  57: 'Extremely high thermal conductivity, immune to explosions, high temperatures, and acid. However, it is destroyed by shaped charges and nuclear explosions.',
  85: 'The solid with the highest thermal conductivity.',
  83: 'A sieve that blocks powder particles and allows only liquids and gases to pass through.',
  93: 'A solid formed by tree resin hardening over a long period. Burns slowly, and melts back into sticky pine resin upon heating.',
  98: 'The ultimate thermal insulator.',

  // Powders
  2: 'The most common powder. Melts into molten glass at 1250°C and turns into glass upon cooling.',
  7: 'Dissolves easily in water. Becomes molten salt at 800°C or higher.',
  101: 'Turns into soapy water upon contact with water.',
  119: 'Broken glass powder fragments.',
  80: 'Powder fire extinguisher and acid neutralizer. Immediately extinguishes adjacent fires, and neutralizes acid into saltwater upon contact. Decomposes and vanishes when heated above 150°C.',
  43: 'Turns into mud when mixed with water.',
  45: 'Grains touched by water get dark and wet, then slowly cure into concrete. The hardening timing varies slightly per grain, so the slab hardens gradually like a spreading wave rather than all at once. It remains powder while curing so water can pass through, and a single block of water wets multiple grains on its way, allowing poured water to seep deep into the heap. Grains that water cannot reach harden alongside neighboring curing grains, leaving no uncured spots in a dry wall.',
  55: 'Combustion residue powder. Extremely light, so it floats on water.',
  105: 'Magnetic, so it is attracted to electromagnets, and slowly corrodes into rust powder in saltwater. When poured into acid, it dissolves and releases hydrogen much faster than solid iron.',
  128: 'Mix with rust powder to make thermite, with niter to make flash powder, or with ammonium nitrate to make ammonal explosive. Burns when directly touched by flames, and melts into molten aluminum at 660°C or higher. Causes a dust explosion when airborne. Burns with flames and white smoke upon contact with chlorine gas even without an ignition source.',
  144: 'State where liquid gallium has stripped the oxide film off aluminum powder. Immediately generates hydrogen bubbles upon contact with water, and melts back into regular aluminum at 660°C. Lacking an oxide layer, it burns twice as fast as normal aluminum powder in chlorine gas.',
  114: 'Rusted metal powder. Can be returned to iron through smelting.',
  86: 'Reacts violently with flames and hydrogen discharge upon contact with water or acid, causing an explosion. Reacts with chlorine gas to produce salt.',
  95: 'Water-soluble sugar. Caramelizes and then carbonizes (ashes) when heated above 200°C, and ferments into alcohol and CO₂ when contacting yeast.',

  // Liquids
  3: 'Evaporates into steam at 100°C and turns into snow/ice below zero. Decomposes into hydrogen and oxygen when electricity flows through it.',
  5: 'Heavier than water, so it sinks. Boiling precipitates salt, and it freezes at -18°C. Has high electrical conductivity.',
  104: 'Water with dissolved sugar. Non-conductive, and ferments into alcohol and CO₂ upon contact with yeast.',
  11: 'Corrodes solids and powders. Becomes acid gas when boiled and freezes at -20°C. Releases hydrogen bubbles when corroding metals with high reactivity. Turns slime into acid slime upon contact, consuming acid only occasionally like when corroding solids. Since slime drinks acid just as it drinks water, poured acid eventually turns into acid slime, increasing its volume.',
  40: 'Liquid metal at room temperature. Becomes mercury vapor when heated. Being less reactive than hydrogen, it does not produce hydrogen when dissolving in acid.',
  117: 'Molten gallium. Activates aluminum by stripping its oxide film, and solidifies into solid gallium below 28°C.',
  41: 'Viscous, slow-flowing flammable liquid. Solidifies below 5°C.',
  42: 'Light liquid fuel. Highly flammable, freezing at -80°C. Eradicates viruses.',
  102: 'Liquid soap dissolved in water. Forms bubbles and cleans viruses. Also mixes with oils (crude oil, gasoline, kerosene, diesel).',
  44: 'Wet soil. Hardens into dirt when dried, and freezes at -3°C.',
  88: 'Releases water and oxygen as it decomposes. Released oxygen feeds nearby fires and strongly sterilizes viruses.',
  92: 'Sticky tree sap. Gradually hardens into amber (solid) if left alone.',

  // Gases
  8: 'Gaseous water. Condenses into water upon cooling.',
  6: 'Smoke produced during combustion. Vanishes after a certain time.',
  16: 'Evaporated acid gas. Corrodes materials it touches and returns to acid upon cooling.',
  36: 'A combustion-supporting gas. Produces an ultra-high temperature blue flame during fires.',
  37: 'Light flammable gas. Reacts with oxygen when ignited to create steam.',
  118: 'High-temperature toxic vapor from evaporated mercury.',
  87: 'Heavy gas. Sinks downward and has a fire-extinguishing effect.',
  96: 'Heavy toxic gas. Kills living creatures and reacts with sodium to form salt. Burns aluminum powder.',
  97: 'Ultra-light inert gas. Rises to the top and does not react with other substances.',

  // Fire / Heat
  9: 'Ignites flammable substances.',
  19: 'Ultra-high-temperature flame generated by oxygen supply.',
  10: 'Molten stone.',
  29: 'Molten iron. Becomes solid iron when cooled.',
  31: 'Molten sand and glass. Becomes solid glass when cooled.',
  56: 'Molten salt.',
  143: 'Molten aluminum above 660°C. Flows easily like water and becomes solid aluminum when cooled below 560°C.',
  25: 'A classic solid fuel. Burns slowly for a long time, and is used as a reducing agent in smelting to convert molten iron ore back into iron.',
  26: 'A classic solid fuel. Burns easily and is eaten by termites.',
  27: 'Powder fuel produced when wood breaks down. Light and easily ignited.',
  94: 'Spontaneously ignites in air. Must be stored in water to remain stable.',

  // Smelting
  67: 'Reddish-brown ore powder. Melts above 850°C and solidifies into slag if cooled without coal.',
  71: 'Molten iron ore. Flows easily like water. Reduced to molten iron upon contact with coal, and hardens into slag when cooled below 750°C.',
  70: 'Powdered coal. Reduces molten iron ore.',
  69: 'Flux that increases smelting yield. Reduces slag formation during iron smelting when added in the proper ratio.',
  68: 'Smelting byproduct waste. Rises to the upper layer inside the blast furnace.',

  // Petroleum
  23: 'Raw material for the distillation process. Evaporates under indirect heating and burns upon direct contact with flames.',
  59: 'Vapor generated from heated crude oil. Separated into fuel types when captured and condensed.',
  24: 'Highly flammable liquid fuel.',
  60: 'Moderately flammable liquid fuel.',
  61: 'Slow-burning liquid fuel.',
  62: 'Byproduct of crude oil fractional distillation. Melts viscously above 200°C.',
  58: 'Light flammable gas that evaporates first.',

  // Polymers
  139: 'Gas produced when petroleum vapor breaks down upon contact with catalyst. Raw material for polymerization.',
  140: 'Cracks petroleum vapor into ethylene or polymerizes ethylene into polyethylene.',
  141: 'Finished plastic solid.',

  // Explosives
  12: 'Black powder. Can be made by combining sulfur, niter, and coal powder. Low destructive power.',
  125: 'Low ignition point fuel that spontaneously ignites at 250°C, used as gunpowder ingredient.',
  126: 'An oxidizer that decomposes above 400°C to release oxygen, used in various explosives.',
  13: 'Liquid explosive nitroglycerin.',
  20: 'Explosive flammable gas.',
  52: 'Powerful solid explosive.',
  53: 'Fuse wire that slowly transmits sparks.',
  54: 'Metal mixture producing ultra-high oxidation heat.',
  17: 'Explosive shockwave phenomenon.',
  74: 'After primary explosion, submunitions spread causing secondary explosions.',
  77: 'Incendiary bomb that sticks and burns continuously.',
  79: 'Military explosive detonated by electricity. Will not explode when ignited with fire.',
  127: 'Directional penetration explosive. Forms a focused penetration wave in the direction of placement drag.',
  137: 'Flash charge made from aluminum powder and niter.',
  145: 'Explosive mixed from ammonium nitrate and aluminum powder.',
  129: 'Firework explosive creating colorful sparks.',

  // Cooling
  21: 'Solid ice. Turns into water when melted.',
  22: 'Light freezing powder. Turns into water when melted and freezes into ice upon further cooling.',
  33: 'Cryogenic coolant at -196°C.',
  34: 'Solid CO₂ at -78°C. Emits cold CO₂ gas as it sublimates.',
  99: 'Causes a powerful endothermic reaction upon contact with water, producing a cooling effect. Ingredient in various explosives.',

  // Electricity
  39: 'Power supply unit emitting electricity. Explodes when exposed to high heat.',
  82: 'Battery with excellent thermal stability.',
  133: 'Generates electricity upon receiving laser light.',
  132: 'Insulated electrical wiring. Conducts power without leakage.',
  81: 'Heating wire that generates heat between 750–1050°C when power flows. Acid-resistant.',
  109: 'Generates acoustic shockwaves when powered to push nearby particles away.',
  112: 'Creates wind to push gases/particles and cool down heat.',
  121: 'Device emitting a powerful heat beam.',
  122: 'Pumps powders and liquids upward when powered.',
  123: 'Device attracting magnetic substances such as iron powder.',
  100: 'Conveyor belt that runs only when powered. Transports accumulated particles column by column in the drag direction rather than scraping thin layers, and stops immediately when power cut off. Arranging like stairs moves cargo up slopes, and shaping into a U-trough prevents cargo from being trapped and carries it over to the opposite side.',
  84: 'Steam turbine that generates electricity when steam passes through.',

  // Life
  47: 'Absorbs water to grow and burns easily.',
  48: 'Spreads by eroding surrounding flammable materials. Sterilized by alcohol, soapy water, and radiation.',
  89: 'Ferments sugars (sugar water, honey) to generate CO₂ and alcohol.',
  90: 'Germinates into plants on wet soil.',
  91: 'Viscous fluid that absorbs water to multiply. Radiation resistant and can be decomposed with electricity.',
  115: 'A variant formed when slime absorbs acid instead of water, having the same corrosive power as acid. Can be diluted by pouring water. Decomposes more easily with electricity.',
  110: 'Biological unit that gnaws on wood. Leaves sawdust when killed.',
  111: 'Gnaws on metal. Immune to radiation.',
  146: 'Fish swimming in water. Can live only in water (saltwater), dies from high heat, explosive shockwaves, or radiation, and gets electrocuted if electricity flows through water.',
  134: 'Reef organism growing in saltwater. Turns into bleached coral when exposed to radiation or high heat.',
  135: 'Calcareous skeleton left when coral dies. Regenerates in saltwater at an appropriate temperature.',

  // Radioactive
  63: 'Highly enriched uranium. Generates heat and undergoes meltdown when overheated.',
  65: 'Uranium in meltdown state. Explodes quickly and decays all surrounding materials.',
  106: 'Low-enriched uranium. Turns into molten U-238 upon meltdown.',
  107: 'Meltdown U-238. Flows easily like water and turns into nuclear waste when cooled.',
  108: 'Waste emitting residual radiation.',

  // Special
  49: 'Continuously duplicates the first material it touches.',
  50: 'Instantly annihilates all particles it touches.',
  51: 'Mutually annihilates 1:1 with neighboring materials.'
};

// --- Object Codex (English) --------------------------------------------------

export const objectCodexEn: Record<ObjectKind, string> = {
  ball: 'A rubber ball with high elasticity. Bounces off walls and solids, and floats on water.',
  drum: 'A metal drum barrel. Responds to electromagnets and floats on water.',
  oildrum: 'A drum barrel that leaks crude oil when broken.',
  aciddrum: 'A drum barrel that leaks acid when broken.',
  dynamite: 'A stick of dynamite spawned in an ignited state that explodes shortly.',
  smokebomb: 'Emits a large amount of smoke.',
  crate: 'A wooden crate destroyed by strong impacts or fire.',
  molotov: 'A Molotov cocktail that shatters to ignite alcohol flames.',
};
