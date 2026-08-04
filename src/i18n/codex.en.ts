// English codex text — the description paragraph for each material and object.
// The shared tag vocabulary (stat and trait names) is not here: it lives with
// its Korean twin in codexTerms.ts, one entry per tag.
//
// The Korean table (codex.ko.ts) is the original here, not the other way round:
// its descriptions come from the Cloudwiki 물질 guide, and this file is their
// English rendering. So a new material's Korean line is written first and this
// one follows it — which is also the order test/codex.ts reports a gap in, since
// it checks both tables against the palette roster and prints whichever one is
// short.
//
// Keyed by `Material.id` and `ObjectKind` exactly as the Korean table is.

import type { ObjectKind } from '../state/store';

// --- Material descriptions --------------------------------------------------

export const materialCodexEn: Record<number, string> = {
  // Solid
  1: 'An indestructible wall. Sits entirely outside the heat system.',
  4: 'Melts into Lava above 1100°C.',
  124: 'Black volcanic glass, formed by pouring water straight onto lava. It is as blast-proof as Diamond or Wall, but like stone it melts back to lava at 1100°C, and acid eats it.',
  28: 'A metal with high thermal and electrical conductivity. Brine slowly rusts it, and dissolving in acid gives off hydrogen.',
  113: 'Rusted metal. It can be smelted back into iron, at a poor yield.',
  116: 'A metal that melts at 30°C. Acid dissolves it slowly, releasing hydrogen.',
  136: 'Melts at 660°C. Liquid gallium embrittles it into powder. Acid dissolves it, releasing hydrogen. Heated past 250°C it burns away in chlorine gas, leaving flame and white fume.',
  32: 'Transparent and acid-proof. Melts into molten glass above 1150°C, and a blast shockwave shatters it.',
  46: 'What cement becomes once water has set it. Hard, but weak to explosions and acid.',
  57: 'Extremely conductive to heat and immune to most blasts, heat, cold and acid. Only a shaped charge and a nuclear blast can break it.',
  85: 'A dedicated solid that moves heat very fast.',
  83: 'A screen that blocks powder grains and lets only liquids and gases through.',
  93: 'Resin hardened over a long time. It burns slowly and, when heated, melts back into sticky resin.',
  98: 'An extreme insulator. A blast shockwave still shatters it like any other solid.',

  // Powder
  2: 'The most common powder. Melts into molten glass at 1250°C and becomes glass when cooled.',
  7: 'Dissolves readily in water. Becomes molten salt above 800°C.',
  101: 'Turns into soapy water on contact with water.',
  119: 'Powdered shards of broken glass.',
  80: 'A dry-powder extinguisher and acid neutralizer. It snuffs adjacent fire on the spot and neutralizes acid into brine. Heated past 150°C it decomposes away.',
  43: 'Mixes with water into mud.',
  45: 'Hardens into concrete on contact with water.',
  55: 'The powdery residue of combustion. Light enough to float on water.',
  105: 'Magnetic, so an electromagnet drags it in; brine slowly corrodes it into rust powder. Poured into acid it dissolves far faster than a solid bar, releasing hydrogen.',
  128: 'Mixed with rust powder it makes thermite, with saltpeter flash powder, with ammonium nitrate ammonal. A flame in direct contact lights it, and above 660°C it becomes molten aluminum. Suspended in the air it goes off as a dust explosion. Chlorine gas burns it on contact with no ignition source at all, leaving flame and white fume.',
  144: 'Aluminum powder with its oxide skin stripped off by liquid gallium. Water makes it fizz hydrogen at once; melting it at 660°C returns it to ordinary aluminum. With no film in the way it burns in chlorine twice as fast as ordinary aluminum powder.',
  114: 'Powdered rusted metal. Smelting turns it back into iron.',
  86: 'Water or acid sets off a violent reaction — flame, hydrogen and a detonation. It reacts with chlorine gas to form salt.',
  95: 'Sugar, soluble in water. Heated past 200°C it caramelizes and then chars to ash; in contact with yeast it ferments into alcohol and CO₂.',

  // Liquid
  3: 'Boils to steam at 100°C and turns to snow or ice below freezing. A current running through it splits it into hydrogen and oxygen.',
  5: 'Heavier than water, so it sinks through it. Boiling precipitates the salt back out, and it freezes at -18°C. Highly conductive.',
  104: 'Water with sugar dissolved in it. It carries no current, and yeast ferments it into alcohol and CO₂.',
  11: 'Corrodes solids and powders. Boils into acid vapor and freezes at -20°C. Corroding a metal above hydrogen in the reactivity series produces hydrogen bubbles. Contact turns slime into acid slime, and — as when it eats a solid — only occasionally spends the acid doing it.',
  40: 'A metal that is liquid at room temperature. Heat turns it into mercury vapor. It sits below hydrogen in the reactivity series, so dissolving it in acid gives off none.',
  117: 'Molten gallium. It strips aluminum of its oxide skin and activates it, and sets back into solid gallium below 28°C.',
  41: 'A viscous, slow-flowing flammable liquid. It stiffens below 5°C.',
  42: 'A light fuel liquid. Highly flammable, freezes at -80°C, and kills virus. It mixes into water instead of floating on it, so pouring water on an alcohol fire spreads the fuel through the puddle rather than putting it out.',
  102: 'Soap dissolved in water. It forms bubbles and washes virus away. Being a surfactant it mixes with water and with the oils alike (crude oil, gasoline, kerosene, diesel) — a slick that would ride on plain water in a flat layer is emulsified and stirred through this instead.',
  44: 'Wet dirt. It dries back into dirt and freezes at -3°C.',
  88: 'Decomposes into water and oxygen. The oxygen it releases feeds nearby fires and sterilizes virus.',
  92: 'Sticky tree sap. Left alone it slowly hardens into amber.',

  // Gas
  8: 'Water as a gas. It condenses back to water when cooled.',
  6: 'The smoke a fire gives off. It fades away after a while.',
  16: 'Evaporated acid. It corrodes whatever it touches and condenses back to acid when cooled.',
  36: 'An oxidizing gas that feeds combustion. In a fire it produces an ultra-hot blue flame.',
  37: 'A light flammable gas. Ignited with oxygen present, it produces steam.',
  118: 'The hot, toxic vapor evaporated mercury gives off.',
  87: 'A heavy gas. It settles downward and smothers fire.',
  96: 'A heavy toxic gas. It kills living units and reacts with sodium to form salt. Being an oxidiser in its own right it also burns aluminum in a sealed, airless pocket — that one leaves no solid behind, only white fume.',
  97: 'An ultra-light inert gas. It rises to the very top and reacts with nothing.',

  // Fire / Heat
  9: 'Ignites flammable materials.',
  19: 'The ultra-hot flame that burns where oxygen is supplied.',
  10: 'Molten stone.',
  29: 'Molten iron. It runs as freely as water, and sets back into solid iron as it cools.',
  31: 'Molten sand and glass. It sets back into solid glass as it cools.',
  56: 'Molten salt.',
  143: 'Aluminum melted past 660°C. It runs as freely as water, and sets back into solid aluminum below 560°C.',
  25: 'A staple solid fuel. It burns slowly and long, and in smelting it doubles as the reductant that turns molten iron ore back into iron.',
  26: 'A staple solid fuel. It catches fire readily, and termites eat through it.',
  27: 'The powdered fuel wood leaves when it breaks. Light, and quick to catch.',
  94: 'A material that ignites spontaneously in air. It is only stable stored under water.',

  // Smelting
  67: 'A reddish-brown ore powder. It melts above 850°C and, cooled without coal, sets into slag.',
  71: 'Molten iron ore. It runs as freely as water. Contact with coal reduces it to molten iron; below 750°C it sets into slag.',
  70: 'Coal in powdered form. It sinks into molten iron ore and reduces it from the inside.',
  69: 'A flux that improves smelting yield. Added in the right proportion it cuts down slag.',
  68: 'The waste left behind by smelting. It floats to the top of the furnace.',

  // Petroleum
  23: 'The feedstock of the distillation process. Indirect heat evaporates it; a flame in direct contact burns it.',
  59: 'The vapor heated crude oil gives off. Captured and condensed, it separates out by fraction.',
  24: 'The lightest and most flammable of the liquid fuels.',
  60: 'A liquid fuel of middling flammability.',
  61: 'The heaviest liquid fuel, and the slowest to burn.',
  62: 'The residue left at the bottom of the crude column. Above 200°C it melts into a sticky flow.',
  58: 'The light, flammable gas that boils off first.',

  // Polymer
  139: 'The gas petroleum vapor cracks into on contact with a catalyst. It is the feedstock for polymerization.',
  140: 'A permanent fixture solid. It cracks petroleum vapor into ethylene and polymerizes ethylene into polyethylene.',
  141: 'Finished plastic. It floats on water and insulates well.',

  // Explosive
  12: 'Black powder. It can be made from sulfur, saltpeter and coal powder.',
  125: 'A low-ignition-point fuel that self-ignites at 250°C.',
  126: 'An oxidizer that decomposes above 400°C, releasing oxygen.',
  13: 'Nitroglycerin, a liquid explosive.',
  20: 'An explosive flammable gas.',
  52: 'A powerful solid explosive.',
  53: 'A slow-burning cord that carries a flame along its length.',
  54: 'A metal mixture that gives off extreme oxidation heat.',
  17: 'The blast shockwave itself.',
  74: 'A first blast scatters submunitions that go off as a second.',
  77: 'An incendiary that sticks where it lands and keeps burning.',
  79: 'A military explosive, safe against shock and flame, fired electrically.',
  127: 'A directional penetrating charge. It forms a focused jet along the drag direction it was placed in.',
  137: 'A powerful flash charge made from aluminum powder and saltpeter.',
  145: 'A wide-area explosive made from ammonium nitrate and aluminum powder.',
  129: 'A pyrotechnic charge for colourful firework displays.',

  // Cryo
  21: 'Solid ice. It melts into water.',
  22: 'A light freezing powder. It melts into water and freezes into ice with more cooling.',
  33: 'A cryogenic coolant at -196°C.',
  34: 'Solid CO₂ at -78°C. It sublimates away, giving off cold CO₂ gas.',
  99: 'Contact with water triggers a strong endothermic reaction that chills everything around it.',

  // Electric
  39: 'A power source that emits current. Exposed to high heat it explodes.',
  82: 'A battery with far better thermal stability.',
  133: 'Produces electricity from laser light.',
  132: 'Insulated electrical cable. Current runs along it without leaking out.',
  81: 'A heating element that reaches 750–1050°C while current flows. Acid-proof.',
  109: 'Powered, it thumps out a sonic shockwave that shoves nearby particles away.',
  112: 'Blows wind that pushes gases and particles around and cools things down.',
  121: 'A device that fires a powerful heat-ray beam.',
  122: 'Powered, it lifts powder and liquid upward.',
  123: 'Draws in magnetic matter such as iron powder.',
  84: 'A steam turbine that generates power as steam passes through it.',

  // Life
  47: 'Absorbs water to grow, and burns readily.',
  48: 'Spreads by eating into nearby flammable matter. Alcohol, soapy water and radiation sterilize it.',
  89: 'Ferments sugars (sugar water, honey) into CO₂ and alcohol.',
  90: 'Germinates into a plant on wet dirt.',
  91: 'A viscous fluid that absorbs water and multiplies. Acid poured on it makes acid slime. Radiation-tolerant.',
  115: 'The variant acid makes of slime, corroding just as hard as the acid itself. Half of the water it absorbs comes back as plain slime, and water can rinse the acid out of it entirely. It slowly blends into plain slime it touches.',
  110: 'A living unit that eats through wood. It leaves sawdust when it dies.',
  111: 'An artificial unit that breaks metal down. Immune to radiation.',
  134: 'A reef creature that grows in brine. Radiation and heat turn it into bleached coral.',
  135: 'The limestone skeleton dead coral leaves. Acid dissolves it, and given the right conditions it recolonizes.',

  // Radioactive
  63: 'Highly enriched uranium. It runs hot and melts down into molten U235 when overheated.',
  65: 'Uranium in meltdown. It decays whatever is around it.',
  106: 'Depleted uranium. In meltdown it becomes molten U238.',
  107: 'U238 in meltdown. It runs as freely as water, and cooled it becomes nuclear waste.',
  108: 'Waste that gives off residual radioactivity.',

  // Exotic
  49: 'Endlessly copies the first material it touches.',
  50: 'Instantly annihilates every particle that touches it.',
  51: 'Annihilates 1:1 with the material beside it.',
  100: 'A belt that runs only while it has power. It carries the whole depth of whatever is piled on it — not a thin skim off the top — along the direction it was dragged, lifts a load up a slope if you lay it as a staircase, and ferries it out of a dip rather than letting it settle there. Cut the current and it soon stops.',
};

// --- Object descriptions ----------------------------------------------------

export const objectCodexEn: Record<ObjectKind, string> = {
  ball: 'A rubber ball with strong bounce. It ricochets off walls and solids and floats on water.',
  drum: 'A steel drum. It answers an electromagnet and floats on water.',
  oildrum: 'A drum that spills crude oil when it breaks.',
  aciddrum: 'A drum that spills acid when it breaks.',
  dynamite: 'A stick of dynamite, spawned already lit and about to go off.',
  smokebomb: 'A visual-effect object that pours out a great deal of smoke.',
  crate: 'A wooden crate, broken by a hard impact or by fire.',
  molotov: 'A bottle that smashes and sets off an alcohol fire.',
};
