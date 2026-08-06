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
  95: 'Water-soluble sugar. Melts into caramel when heated above 160°C, and ferments into alcohol and CO₂ when contacting yeast.',

  // Liquids
  3: 'Evaporates into steam at 100°C and turns into snow/ice below zero. Decomposes into hydrogen and oxygen when electricity flows through it.',
  5: 'Heavier than water, so it sinks. Boiling precipitates salt, and it freezes at -18°C. Has high electrical conductivity.',
  104: 'Water with dissolved sugar. Non-conductive, and ferments into alcohol and CO₂ upon contact with yeast.',
  11: 'Corrodes solids and powders. Becomes acid gas when boiled and freezes at -20°C. Releases hydrogen bubbles when corroding metals with high reactivity. Turns slime into acid slime upon contact, consuming acid only occasionally like when corroding solids. Since slime drinks acid just as it drinks water, poured acid eventually turns into acid slime, increasing its volume.',
  40: 'Liquid metal at room temperature. Becomes mercury vapor when heated. Being less reactive than hydrogen, it does not produce hydrogen when dissolving in acid.',
  117: 'Molten gallium. Activates aluminum by stripping its oxide film, and solidifies into solid gallium below 28°C.',
  41: 'Viscous, slow-flowing flammable liquid. Solidifies below 5°C.',
  150: 'Hot syrup made by heating sugar above 160°C. It oozes even more thickly than honey, then sets hard where it stopped once it cools below 120°C — reheat it and it runs again. It darkens as it sets, so you can see at a glance whether it is still workable. Pour niter into it while it is still molten (120-250°C) and you get rocket candy; take it past 250°C and it chars to ash.',
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
  125: 'Low ignition point fuel that spontaneously ignites at 250°C, used as gunpowder ingredient.',
  126: 'An oxidizer that decomposes above 400°C to release oxygen, used in various explosives.',

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
  149: 'Solid propellant made by pouring niter into caramel while the melt is still molten (120-250°C). It carries its own oxidizer, so once lit the flame front jumps to every touching grain each tick and the whole pile is gone in an instant, pouring out enormous amounts of smoke as it goes. It does not explode, but it is the fastest fuse in the game — and water will not put it out.',

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
  112: 'Creates wind to push gases/particles and cool down heat.',
  121: 'Device emitting a powerful heat beam.',
  122: 'Pumps powders and liquids upward when powered.',
  123: 'Device attracting magnetic substances such as iron powder.',
  100: 'Conveyor belt that runs only when powered. Transports accumulated particles column by column in the drag direction rather than scraping thin layers, and stops immediately when power cut off. Arranging like stairs moves cargo up slopes, and shaping into a U-trough prevents cargo from being trapped and carries it over to the opposite side.',
  84: 'Steam turbine that generates electricity when steam passes through.',

  // Life
  47: 'Absorbs water to grow and burns easily.',
  48: 'Spreads by eroding surrounding flammable materials. Oozes downhill like a thick goo and pools in low ground without levelling out flat, so a wall or a pit still contains an outbreak. A colony that seeps into a powder bed survives and infects it from within, out of reach of the chemical disinfectants — only heat or acid clears it. Contact with acid, acid vapor or acid slime kills a cell on the spot — and acid slime neither drains away nor levels flat, so a line of it painted across a corridor is a quarantine wall you never have to re-pour. Plain slime has no effect on it at all. Sterilized by alcohol, soapy water, and radiation.',
  89: 'Ferments sugars (sugar water, honey) to generate CO₂ and alcohol.',
  90: 'Germinates into plants on wet soil.',
  91: 'Viscous fluid that absorbs water to multiply. Radiation resistant and can be decomposed with electricity.',
  115: 'A variant formed when slime absorbs acid instead of water, having the same corrosive power as acid. Like acid, it kills any virus it touches — and since it neither drains away nor levels flat, a line of it works as a standing quarantine wall (something plain slime cannot do). Can be diluted by pouring water. Decomposes more easily with electricity.',
  110: 'Biological unit that gnaws on wood. Leaves sawdust when killed.',
  111: 'Gnaws on metal. Immune to radiation.',
  146: 'Fish swimming in water. Can live only in water (saltwater), dies from high heat, explosive shockwaves, or radiation, and gets electrocuted if electricity flows through water. Dies instantly on contact with chlorine gas. Above 500°, it burns away into smoke, leaving no corpse.',
  134: 'Reef organism growing in saltwater. Turns into bleached coral when exposed to radiation or high heat.',
  135: 'Calcareous skeleton left when coral dies. Regenerates in saltwater at an appropriate temperature.',

  // Cooking
  151: 'Finely milled grain. Light as ash, so it does not drop straight down — it stalls in mid-air, sways sideways and settles slowly, and floats back up if pushed under water. That drifting is also what makes it dangerous. Heaped up it will not burn at all, no matter what flame you hold to it — but the same grains suspended in the air go off as a whole cloud the instant a spark or 350° heat reaches them (a dust explosion). Because it drifts, simply pouring it from a height leaves a cloud hanging long enough for one spark to take nearly all of it; a fan keeps it up longer still. A pile merely heated past 260° simply chars to ash, and even a dust explosion leaves a little scorched ash behind. Touch water and it becomes batter.',
  152: 'Thick dough formed where flour meets water. It creeps even more slowly than mud, so you can shape it before baking, and heating it past 120° bakes it into bread. Sprinkle on baking soda and it is ready to rise at once; sprinkle on yeast instead and it takes time but rises far more. Both work their way through the dough on their own, so a sprinkle on one corner leavens the whole body (soda travels faster), and yeast burps CO₂ and pales the dough as it proofs so you can see how far along it is. Yeast dies above 60°, so proof it first and bake it after.',
  153: 'What batter becomes when baked at 120° or above. Whichever faces met open air while baking become dark browned crust, and whatever the dough closed around becomes ivory crumb — so baking a large body of dough gives you a real crusted cross-section. Leavened dough springs the moment it enters the oven — the gas in it expands and pushes extra dough upward, and the enlarged body then bakes as one: about 40% more with baking soda, up to double for a fully proofed yeast dough. A lid or wall overhead blocks the rise and it bakes dense instead. No oven, however fierce, will set a loaf alight by heat alone — only a flame actually touching it does, which is what lets bread survive long enough to finish baking inside a fire-walled oven. Hold a flame to it and it burns slowly like wood, leaving a lot of ash.',
  154: 'Becomes cooked meat past 70°. Throw it straight into the flames and it is fine — while the water in it is boiling off, the meat itself sits at 110° no matter how fierce the fire around it, so it sears and browns at once but does not char, steaming the whole time. That is what makes grilling over an open fire work. Steam means there is water left; when it stops steaming it can start to burn. A fiercer fire dries it faster, and a thick cut dries from the face against the flame inward, so you still get a black outside and a red middle. Being wet, it will not catch fire on its own.',
  155: 'Meat cooked at 70° or above. Charring takes more than passing 200° — it also has to be bone dry — so a cut sits here for several seconds even in a fire, which is your window to take it back out. It darkens a shade for every bit of moisture it loses, so going black is the warning that it is about to char. Held under 200° it never chars at all, however long you leave it. Once cooked it never goes back to raw, even as it cools.',
  156: 'Meat dried out and then cooked past 200° until black. In this state it will finally catch fire, burning slowly like charcoal and leaving mostly ash — but only from a flame that actually touches it, never from heat alone, so a steak ruined in an oven is merely inedible rather than gone.',
  157: 'A hard, heavy grain. Past 180° the hull bursts and two pieces of popcorn are genuinely launched — they fly a real arc, ricochet off whatever is above them and rain back down, hissing steam as they go. So a bowl of kernels on the heat doubles in volume and erupts out of its container. Blocked overhead there is nowhere for the second puff to go, so it does not gain volume. The kernel itself never burns; popping always wins.',
  158: 'What a corn kernel becomes when it bursts. Lighter than anything in the palette but ash, so it rafts on water and drifts sideways as it falls instead of dropping straight. Bone dry, so a flame takes it very readily — but heat alone never will, because popping corn needs 180° and an iron pot on a coal bed runs far hotter than that, which would otherwise burn every puff the moment it was made.',

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
  flashbang: 'A flashbang that goes off in a blinding white flash three seconds after it is created, with no warning at all. It breaks nothing, but shoves the loose powder and liquid around it aside.',
  crate: 'A wooden crate destroyed by strong impacts or fire.',
  molotov: 'A Molotov cocktail that shatters to ignite alcohol flames.',
};
