// English description texts for the material codex — material and object descriptions.
//
// Names and descriptions of property tags are in codexTerms.ts.
// Keys are `Material.id` and `ObjectKind`.
//
// This file is a faithful translation of codex.ko.ts, which is the source of
// truth. When Korean changes, retranslate the English to match — do not leave
// stale English standing next to updated Korean.
//
// --- Writing style (mirrors codex.ko.ts's guide, adapted for English) -------
//
// 1-2 sentences per material. State observable facts (thresholds, results,
// conditions) only — never explain the "why" or the underlying mechanism.
// Plain present-tense, declarative, game-codex voice — not flavour text.
//
// 1. Cut mechanism explanations. Keep only the outcome.
//    "Grains touched by water darken as they wet, then slowly cure into
//    concrete." — not a paragraph about per-grain cure timing.
// 2. Don't repeat what another entry already covers (e.g. acid's interaction
//    with slime lives in the acid-slime entry, not in acid's own entry).
// 3. No metaphor, em dashes, **bold**, or parenthetical asides — plain
//    sentences only.
// 4. List conditions as plain "if X, then Y" facts — no tactical advice, no
//    justification for why a condition kills or blocks something.
// 5. Keep numeric thresholds and comparisons to other materials (they're
//    facts: "660°C", "stronger than TNT"). Cut unsupported superlatives
//    ("the fastest fuse in the game").
// 6. Match established English material names from each material's `name`
//    field and existing i18n — don't invent new ones.
// 7. End every sentence as a plain statement. No rhetorical questions, no
//    ellipses.

import type { ObjectKind } from '../state/store';

// --- Material Codex (English) ------------------------------------------------

export const materialCodexEn: Record<number, string> = {
  // Solids
  1: 'An indestructible wall. Does not interact with any material and does not conduct heat.',
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
  45: 'Grains touched by water darken as they wet, then slowly cure into concrete.',
  55: 'Combustion residue powder. Extremely light, so it floats on water.',
  105: 'Magnetic, so it is attracted to electromagnets, and slowly corrodes into rust powder in saltwater. When poured into acid, it dissolves and releases hydrogen much faster than solid iron.',
  128: 'Mix with rust powder to make thermite, with niter to make flash powder, or with ammonium nitrate to make ammonal explosive. Burns when directly touched by flames, and melts into molten aluminum at 660°C or higher. Causes a dust explosion when airborne. Burns with flames and white smoke upon contact with chlorine gas even without an ignition source.',
  144: 'State where liquid gallium has stripped the oxide film off aluminum powder. Immediately generates hydrogen bubbles upon contact with water, and melts back into regular aluminum at 660°C. Lacking an oxide layer, it burns twice as fast as normal aluminum powder in chlorine gas.',
  114: 'Rusted metal powder. Can be returned to iron through smelting.',
  86: 'Reacts violently with flames and hydrogen discharge upon contact with water or acid, causing an explosion. Reacts with chlorine gas to produce salt.',
  95: 'Water-soluble sugar. Melts into caramel when heated above 160°C, and ferments into alcohol and CO₂ when contacting yeast.',

  // Liquids
  3: 'Evaporates into steam at 100°C and turns into snow/ice below zero. Decomposes into hydrogen and oxygen when electricity flows through it.',
  5: 'Heavier than water, so it sinks. Boiling precipitates salt, and it freezes at -18°C. Has high electrical conductivity.',
  104: 'Water with dissolved sugar. Non-conductive, and ferments into alcohol and CO₂ upon contact with yeast.',
  11: 'Corrodes solids and powders. Becomes acid gas when boiled, and freezes at -20°C. Releases hydrogen bubbles when corroding highly reactive metals.',
  40: 'Liquid metal at room temperature. Becomes mercury vapor when heated. Being less reactive than hydrogen, it does not produce hydrogen when dissolving in acid.',
  117: 'Molten gallium. Activates aluminum by stripping its oxide film, and solidifies into solid gallium below 28°C.',
  41: 'Viscous, slow-flowing flammable liquid. Solidifies below 5°C.',
  150: 'Hot syrup made by heating sugar above 160°C. It oozes even more thickly than honey, then sets hard where it stopped once it cools below 120°C — reheat it and it runs again. It darkens as it sets, so you can see at a glance whether it is still workable. Pour niter into it while it is still molten (120-250°C) and you get rocket candy; take it past 250°C and it chars to ash.',
  42: 'Light liquid fuel. Extremely flammable, freezing at -80°C. Eradicates viruses.',
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
  118: 'High-temperature vapor from evaporated mercury.',
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
  125: 'Low ignition point fuel that spontaneously ignites at 250°C, used as gunpowder ingredient.',
  126: 'An oxidizer that decomposes above 400°C to release oxygen, used in various explosives.',

  // Smelting
  67: 'Reddish-brown ore powder. Melts above 850°C and solidifies into slag if cooled without coal.',
  71: 'Molten iron ore. Flows easily like water. Reduced to molten iron upon contact with coal, and hardens into slag when cooled below 750°C.',
  70: 'Powdered coal. Burns easily, reduces molten iron ore, and is an ingredient in gunpowder.',
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
  99: 'Causes an endothermic reaction upon contact with water, producing a cooling effect, and is an explosive in its own right. Mixing it with aluminum powder or with diesel/kerosene makes a far more powerful explosive.',
  148: 'Explosive mixed from ammonium nitrate and diesel/kerosene. Rather than misfiring when wet, it detonates far more weakly.',
  145: 'Powerful explosive mixed from ammonium nitrate and aluminum powder. Stronger than TNT.',
  129: 'Firework explosive creating colorful sparks.',
  149: 'A mixture of caramel and niter. Burns very quickly, producing a large amount of smoke. Keeps burning even underwater.',

  // Cooling
  21: 'Solid ice. Turns into water when melted.',
  22: 'Light freezing powder. Turns into water when melted and freezes into ice upon further cooling.',
  33: 'Cryogenic coolant at -196°C.',
  34: 'Solid CO₂ at -78°C. Emits cold CO₂ gas as it sublimates.',

  // Electricity
  39: 'Power supply unit emitting electricity. Explodes when exposed to high heat.',
  82: 'Battery with excellent thermal stability.',
  133: 'Generates electricity upon receiving laser light.',
  132: 'Insulated electrical wiring. Conducts power without leakage.',
  81: 'Heating wire that generates heat between 750–1050°C when power flows. Acid-resistant.',
  109: 'Generates acoustic shockwaves when powered to push nearby particles away.',
  112: 'Blows wind the way you dragged it, pushing gases/particles and cooling down heat.',
  121: 'A device firing a powerful heat beam in the direction you drag. Whatever it hits gets heated; most metals reflect the beam, glass lets it pass through without interacting, and diamond scatters it.',
  122: 'Pumps powders and liquids upward when powered.',
  123: 'Device attracting magnetic substances such as iron powder.',
  100: 'Moves the particles piled on top in the set direction when powered.',
  84: 'Steam turbine that generates electricity when steam passes through.',

  // Life
  47: 'Absorbs water to grow and burns easily.',
  48: 'Erodes surrounding materials. Sterilized by acidic materials, alcohol, soapy water, hydrogen peroxide, radiation, and high heat.',
  89: 'Ferments sugars (sugar water, honey) to produce CO₂ and alcohol, and makes dough rise.',
  90: 'Germinates into plants on wet soil.',
  91: 'Viscous fluid that absorbs water to multiply. Radiation resistant and can be decomposed with electricity.',
  115: 'A variant formed when slime absorbs acid instead of water, with the same corrosive power as acid. Can be diluted by pouring water, and decomposes more easily with electricity.',
  110: 'Biological unit that gnaws on wood. Leaves sawdust when killed.',
  111: 'Gnaws on metal. Immune to radiation.',
  146: 'A fish that swims through water. Can only live in water (saltwater), dies from high heat, explosive shockwaves, or radiation, and gets electrocuted if electricity flows through the water.',
  134: 'Reef organism growing in saltwater. Turns into bleached coral when exposed to radiation or high heat.',
  135: 'The calcareous skeleton left when coral dies. Slowly regenerates in saltwater at an appropriate temperature.',
  159: 'Grows by covering the surface of materials, and spoils food. Cannot spoil food that has been salted, honeyed, steeped in alcohol, or cooled below zero. Dies above 60°C or below 0°C, and dies on contact with alcohol, hydrogen peroxide, soapy water, or acid.',
  161: 'Black earth left when spoiled food fully decomposes. Plants grown in it come up far fuller.',

  // Cooking
  151: 'Fine powder made by grinding wheat. Extremely light, so it drifts as it falls, and ignites instantly when fire touches it while airborne. Turns into dough when mixed with water, salt water, or sugar water.',
  152: 'Thick dough formed when flour meets water, salt water, or sugar water. Bakes into bread when heated above 120°C. Sprinkling on baking soda makes it ready to rise immediately, while sprinkling on yeast takes time but rises much more.',
  153: 'Made by baking dough at 120°C or higher. Faces that were exposed to open air while baking become a dark brown crust.',
  154: 'Becomes cooked meat when heated. Left alone, it grows mold.',
  155: 'Cooked meat. Becomes charred meat when heated further.',
  156: 'Meat charred from overheating. Catches fire, burning slowly like charcoal and leaving mostly ash.',
  157: 'A hard, heavy grain kernel. Past 180°C its hull bursts and it becomes popcorn.',
  158: 'What a corn kernel becomes when it bursts open.',
  160: 'Byproduct of food and corpses spoiling. Over time it becomes compost that helps plants grow.',

  // Radioactive
  63: 'Highly enriched uranium. Generates heat and undergoes meltdown when overheated.',
  65: 'Uranium in meltdown state. Explodes quickly and decays all surrounding materials.',
  106: 'Low-enriched uranium. Turns into molten U-238 upon meltdown.',
  107: 'Meltdown U-238. Flows easily like water and turns into nuclear waste when cooled.',
  108: 'Waste emitting residual radiation.',

  // Special
  49: 'Continuously duplicates the first material it touches.',
  50: 'Instantly annihilates all particles it touches.',
  51: 'Mutually annihilates 1:1 with materials it touches.'
};

// --- Object Codex (English) --------------------------------------------------

export const objectCodexEn: Record<ObjectKind, string> = {
  ball: 'A rubber ball with high elasticity. Bounces off walls and solids, and floats on water.',
  drum: 'A metal drum barrel. Responds to electromagnets and floats on water.',
  oildrum: 'A drum barrel that leaks crude oil when broken.',
  aciddrum: 'A drum barrel that leaks acid when broken.',
  dynamite: 'A stick of dynamite spawned in an ignited state that explodes shortly.',
  flashbang: 'A flashbang that goes off in a blinding white flash three seconds after it is created, with no warning at all. It breaks nothing, but shoves the loose powder and liquid around it aside. Freezing one slows its countdown, and a deep freeze stops it altogether — so you can bury one in ice and set it off by thawing it.',
  crate: 'A wooden crate destroyed by strong impacts or fire.',
  molotov: 'A Molotov cocktail that shatters to ignite alcohol flames. Smashed, it sprays broken glass; heated to glass\'s melting point instead, the whole bottle runs, leaving equal amounts of Molten Glass and Alcohol.',
};
