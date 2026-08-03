// The codex's tag vocabulary: what every stat row and trait card is *called*,
// and the sentence that explains it. Both languages, side by side.
//
// This file is display text and nothing else. The code side — game/codex/stats.ts
// and traits.ts — decides which tags exist and how to read one off a `Material`;
// what a tag is named and how it is explained is decided here, so rewording the
// page never touches the engine or the extraction. The keys are those specs'
// `key` values (a trait with variants asks for `key.variant`), which is the only
// place the two sides meet.
//
// Korean and English sit together under one key rather than in two per-locale
// tables, so touching a tag's wording is one edit in one place instead of the
// same edit twice, in two files, hundreds of lines apart. `Record<Locale, …>`
// then makes a half-translated tag a *type* error — the failure that used to
// need a test to notice. What still needs the test (test/codex.ts) is the other
// two holes: a tag the page shows with no entry here, and an entry here that
// nothing on the page shows.
//
// Material and object descriptions are prose about one thing each, not shared
// vocabulary, so they stay in codex.ko.ts / codex.en.ts.

import type { CodexTerm } from '../game/codex/types';
import type { Locale } from './locale';

export const codexTerms: Record<string, Record<Locale, CodexTerm>> = {
  // Stats — matter
  density: {
    ko: { label: '밀도', desc: '무거운 물질이 가벼운 유체를 밀어내고 가라앉습니다.' },
    en: { label: 'Density', desc: 'Heavier matter pushes lighter fluid aside and sinks through it.' },
  },
  conductivity: {
    ko: { label: '열전도율', desc: '0에 가까울수록 단열재이고, 1에 가까울수록 열이 그대로 지나갑니다.' },
    en: { label: 'Heat conductivity', desc: 'Near 0 is an insulator; near 1 lets heat pass straight through.' },
  },
  initTemp: {
    ko: { label: '생성 온도', desc: '갓 놓인 셀이 가지고 시작하는 온도입니다.' },
    en: { label: 'Spawn temperature', desc: 'The temperature a freshly placed cell starts at.' },
  },

  // Stats — motion
  viscosity: {
    ko: { label: '점성', desc: '높을수록 수평으로 잘 퍼지지 않고 뭉쳐 흐릅니다.' },
    en: { label: 'Viscosity', desc: 'Higher means it clings together instead of levelling out flat.' },
  },
  friction: {
    ko: { label: '마찰(안식각)', desc: '높을수록 가루 더미가 무너지지 않고 가파르게 쌓입니다.' },
    en: { label: 'Friction (angle of repose)', desc: 'Higher piles steeper without collapsing.' },
  },
  elasticity: {
    ko: { label: '탄성', desc: '충돌 후 남는 속도의 비율입니다. 높을수록 잘 튑니다.' },
    en: { label: 'Elasticity', desc: 'How much speed survives an impact. Higher bounces more.' },
  },
  surfaceTension: {
    ko: { label: '표면장력', desc: '높을수록 방울이 동그랗게 뭉치고 얇은 막이 끊어집니다.' },
    en: { label: 'Surface tension', desc: 'Higher rounds droplets up and pinches thin films off into beads.' },
  },
  liquidOverlap: {
    ko: { label: '액체 겹침 계수', desc: '가루 알갱이 중 액체가 스며들 수 있는 비율입니다.' },
    en: { label: 'Liquid overlap', desc: 'The fraction of grains that will let a liquid soak into them.' },
  },

  // Stats — temperature
  meltPoint: {
    ko: { label: '상전이점(가열)', desc: '이 온도 이상으로 데우면 다른 물질로 바뀝니다.' },
    en: { label: 'Transition (heating)', desc: 'Heated past this, it becomes another material.' },
  },
  setPoint: {
    ko: { label: '상전이점(냉각)', desc: '이 온도 이하로 식으면 다른 물질로 바뀝니다.' },
    en: { label: 'Transition (cooling)', desc: 'Cooled past this, it becomes another material.' },
  },
  freezeTemp: {
    ko: { label: '동결 온도', desc: '이 아래에서는 흐르지 않고 그 자리에서 굳습니다. 다시 데우면 풀립니다.' },
    en: { label: 'Freezing point', desc: 'Below this it stops flowing and acts solid in place. Warming frees it again.' },
  },

  // Stats — combustion
  autoIgniteTemp: {
    ko: { label: '발화점', desc: '불씨 없이도 이 온도에 이르면 스스로 불이 붙습니다.' },
    en: { label: 'Autoignition point', desc: 'At this temperature it catches by itself, with no flame needed.' },
  },
  burnChance: {
    ko: { label: '연소 확률', desc: '한 틱에 불이 번질 확률입니다. 높을수록 빠르게 타 없어집니다.' },
    en: { label: 'Burn rate', desc: 'The per-tick chance the fire spreads. Higher burns away faster.' },
  },
  burnTemp: {
    ko: { label: '화염 온도', desc: '탈 때 주변에 내놓는 온도입니다.' },
    en: { label: 'Flame temperature', desc: 'The heat it puts out while burning.' },
  },
  ashChance: {
    ko: { label: '재 생성 확률', desc: '다 타고 난 자리에 재가 남을 확률입니다.' },
    en: { label: 'Ash chance', desc: 'The chance ash is left where it finished burning.' },
  },

  // Stats — blast
  blastRadius: {
    ko: { label: '폭발 반경', desc: '한 덩이가 혼자 터졌을 때 미치는 거리입니다.' },
    en: { label: 'Blast radius', desc: 'How far a single charge reaches on its own.' },
  },
  blastYield: {
    ko: { label: '폭발 위력', desc: '뭉쳐 놓았을 때 한 칸이 전체 위력에 보태는 양입니다.' },
    en: { label: 'Blast yield', desc: 'What one cell adds to the total when the charge is packed together.' },
  },
  destructivePower: {
    ko: { label: '파괴력', desc: '내구력이 이 값보다 높은 물질은 부수지 못하고 밀어내기만 합니다.' },
    en: { label: 'Destructive power', desc: 'Anything tougher than this is shoved aside rather than broken.' },
  },
  shockDeathChance: {
    ko: { label: '충격파 치사율', desc: '부수지 못하는 충격파에도 그냥 죽어 버릴 확률입니다.' },
    en: { label: 'Shock lethality', desc: 'The chance a shockwave too weak to break it kills it anyway.' },
  },

  // Stats — other
  sparkLoss: {
    ko: { label: '전기 저항', desc: '한 칸 지날 때마다 잃는 세기입니다. 0이면 아무리 멀어도 그대로 도달합니다.' },
    en: { label: 'Electrical resistance', desc: 'Strength lost per cell travelled. At 0 the pulse arrives at full strength however far it runs.' },
  },
  radiation: {
    ko: { label: '방사선량', desc: '한 칸 옆에 전달되는 선량입니다. 거리에 반비례해 약해집니다.' },
    en: { label: 'Radiation dose', desc: 'The dose delivered one cell away. It falls off with distance.' },
  },
  acidHydrogenChance: {
    ko: { label: '수소 발생 확률', desc: '산에 닿은 한 칸이 수소 거품으로 바뀔 확률입니다.' },
    en: { label: 'Hydrogen chance', desc: 'The chance an acid cell touching it becomes a hydrogen bubble.' },
  },
  lifetime: {
    ko: { label: '수명', desc: '평균 이만큼의 틱이 지나면 사라집니다.' },
    en: { label: 'Lifetime', desc: 'It disappears after about this many ticks.' },
  },

  // Stats — objects only
  shellMeltPoint: {
    ko: { label: '통 융점', desc: '이 온도에 오래 두면 통이 열려 조각 3개로 무너집니다.' },
    en: { label: 'Shell melting point', desc: 'Held here long enough, the barrel gives way and collapses into three shards.' },
  },
  shellMeltTicks: {
    ko: { label: '통 용융 시간', desc: '통 융점 이상에 이만큼 머물러야 열립니다.' },
    en: { label: 'Shell melt time', desc: 'How long it must sit past the shell melting point before it opens.' },
  },
  pieceMeltPoint: {
    ko: { label: '조각 융점', desc: '조각은 통보다 높은 이 온도에서야 쇳물이 됩니다. 그 사이 온도에서는 조각으로 남습니다.' },
    en: { label: 'Shard melting point', desc: 'A shard only runs as molten iron at this higher temperature. In between, the wreckage just lies there.' },
  },
  pieceMeltTicks: {
    ko: { label: '조각 용융 시간', desc: '찢긴 조각은 밀폐된 통보다 훨씬 빨리 녹습니다.' },
    en: { label: 'Shard melt time', desc: 'A torn scrap gives way far faster than a sealed drum does.' },
  },
  fuseTicks: {
    ko: { label: '도화선 시간', desc: '불이 붙고 나서 터지기까지 걸리는 시간입니다.' },
    en: { label: 'Fuse time', desc: 'How long from lighting to going off.' },
  },
  ventTicks: {
    ko: { label: '분출 시간', desc: '연기를 뿜어내는 시간입니다.' },
    en: { label: 'Vent time', desc: 'How long it pours out smoke.' },
  },
  fuelTicks: {
    ko: { label: '연료 지속 시간', desc: '심지가 다 타서 빈 병이 될 때까지의 시간입니다.' },
    en: { label: 'Fuel time', desc: 'How long until the wick burns out and leaves an empty bottle.' },
  },
  smashSpeed: {
    ko: { label: '파괴 속도', desc: '이보다 빠르게 부딪히면 깨집니다.' },
    en: { label: 'Smash speed', desc: 'An impact faster than this breaks it.' },
  },
  burnTicks: {
    ko: { label: '연소 시간', desc: '불에 닿은 채로 이만큼 버티면 타 없어집니다.' },
    en: { label: 'Burn time', desc: 'How long it survives held in fire before it is gone.' },
  },
  burstTemp: {
    ko: { label: '유폭 온도', desc: '이 온도에 노출되면 그 자리에서 터집니다.' },
    en: { label: 'Cook-off temperature', desc: 'Exposed to this, it goes off where it stands.' },
  },

  // Traits — electricity
  conductive: {
    ko: { label: '전기 전도', desc: '스파크가 이 물질을 타고 옆 칸으로 흘러갑니다.' },
    en: { label: 'Conductive', desc: 'A spark travels through it from cell to cell.' },
  },
  insulated: {
    ko: { label: '피복', desc: '전류가 밖으로 새지 않습니다. 물웅덩이나 철벽을 가로질러 배선해도 그쪽은 감전되지 않습니다.' },
    en: { label: 'Insulated', desc: 'Current never leaks out. A cable run through a puddle or across a steel wall electrifies neither.' },
  },
  wiring: {
    ko: { label: '배선재', desc: '제대로 된 배선으로 취급됩니다. 터빈처럼 배선에만 전기를 보내는 전원이 이것을 골라 먹입니다.' },
    en: { label: 'Wiring', desc: 'Counts as proper wiring — what a source that only feeds cable (the turbine) picks out.' },
  },
  appliance: {
    ko: { label: '전기 장치', desc: '전기가 닿으면 작동합니다. 전류를 소비할 뿐 옆으로 넘기지는 않습니다.' },
    en: { label: 'Electric appliance', desc: 'Runs when current reaches it. It consumes the pulse rather than passing it along.' },
  },
  photoelectric: {
    ko: { label: '광전 반응', desc: '레이저 빛을 흡수해 열이 아닌 다른 것으로 바꿉니다. 빔 속에 있어도 달아오르지 않습니다.' },
    en: { label: 'Photoelectric', desc: 'Absorbs laser light and converts it instead of soaking it up as heat, so it never cooks in a beam.' },
  },
  magnetic: {
    ko: { label: '자성', desc: '통전된 전자석이 끌어당깁니다.' },
    en: { label: 'Magnetic', desc: 'A powered electromagnet drags it in.' },
  },

  // Traits — light
  laserReflective: {
    ko: { label: '레이저 반사', desc: '열선을 흡수하지 않고 거울처럼 튕겨 냅니다.' },
    en: { label: 'Laser mirror', desc: 'Reflects a heat ray cleanly instead of absorbing it.' },
  },

  // Traits — fire
  flammable: {
    ko: { label: '인화성', desc: '불이나 용암이 닿으면 곧바로 불로 바뀝니다.' },
    en: { label: 'Flammable', desc: 'Fire or lava in contact turns it straight into fire.' },
  },
  fuel: {
    ko: { label: '연료', desc: '표면부터 번져 들어가며 탑니다. 불이 덩어리 전체로 기어갑니다.' },
    en: { label: 'Fuel', desc: 'Burns as a front creeping in from the surface, so the fire walks through the whole body.' },
  },
  'fireClass.A': {
    ko: { label: 'A급 화재', desc: '일반 가연물입니다. 물이 가장 잘 듣습니다.' },
    en: { label: 'Class A fire', desc: 'Ordinary combustibles. Water is the right tool.' },
  },
  'fireClass.B': {
    ko: { label: 'B급 화재', desc: '유류 화재입니다. 물은 겉돌기만 할 뿐 꺼뜨리지 못합니다.' },
    en: { label: 'Class B fire', desc: 'A fuel fire. Water runs off it and does nothing.' },
  },
  'fireClass.D': {
    ko: { label: 'D급 화재', desc: '금속 화재입니다. 물을 부으면 오히려 수소가 나옵니다.' },
    en: { label: 'Class D fire', desc: 'A metal fire. Water makes it worse — it cracks into hydrogen.' },
  },
  'douses.evaporate': {
    ko: { label: '소화제(증발)', desc: '불에 닿으면 불을 끄고, 그 한 칸은 증발합니다.' },
    en: { label: 'Extinguisher (evaporates)', desc: 'Puts fire out on contact, and that cell evaporates doing it.' },
  },
  'douses.melt': {
    ko: { label: '소화제(융해)', desc: '불에 닿으면 불을 끄고, 그 한 칸은 녹아 물이 됩니다. 남은 물이 계속 싸웁니다.' },
    en: { label: 'Extinguisher (melts)', desc: 'Puts fire out on contact and melts to water, which carries on fighting.' },
  },
  easyDouse: {
    ko: { label: '쉽게 꺼짐', desc: '적은 물로도 쉽게 진화됩니다.' },
    en: { label: 'Doused easily', desc: 'A little water is enough to put it out.' },
  },
  petroleum: {
    ko: { label: '석유계', desc: '원유 계열입니다. 물 위에 떠서 타며, 그 아래 물은 끓지 않습니다.' },
    en: { label: 'Petroleum', desc: 'Part of the crude-oil family. It burns floating on water, and the water below never boils.' },
  },

  // Traits — acid
  acidResistant: {
    ko: { label: '내산성', desc: '어떤 부식성 물질도 이것을 녹이지 못합니다.' },
    en: { label: 'Acid-proof', desc: 'No corrosive touches it.' },
  },
  acidHydrogen: {
    ko: { label: '산 + 금속 수소 발생', desc: '이온화 경향이 수소보다 큰 금속입니다. 산에 녹으면서 수소 거품을 냅니다.' },
    en: { label: 'Hydrogen on acid', desc: 'A metal above hydrogen in the reactivity series — it fizzes hydrogen as acid dissolves it.' },
  },

  // Traits — radiation
  radiationDeath: {
    ko: { label: '피폭사', desc: '방사선을 쬐면 죽습니다.' },
    en: { label: 'Dies of radiation', desc: 'Radiation kills it.' },
  },
  radiationHit: {
    ko: { label: '피폭 반응', desc: '방사선을 즉사가 아니라 자기 나름의 손상으로 받습니다.' },
    en: { label: 'Radiation damage', desc: 'Takes radiation as its own kind of damage rather than dying outright.' },
  },

  // Traits — blast
  explosive: {
    ko: { label: '폭발물', desc: '타는 게 아니라 터집니다. 이어 붙은 덩어리 전체가 한 번에 기폭합니다.' },
    en: { label: 'Explosive', desc: 'Detonates rather than burning. A whole connected mass goes off at once.' },
  },
  electricDetonate: {
    ko: { label: '전기 기폭', desc: '전류가 닿으면 그 자리에서 기폭합니다.' },
    en: { label: 'Electrically fired', desc: 'A current reaching it sets it off on the spot.' },
  },
  explosionProof: {
    ko: { label: '방폭', desc: '폭발을 막아 서고, 뒤쪽에 그늘을 만들어 줍니다.' },
    en: { label: 'Blast-proof', desc: 'Stops a blast front and casts a shadow over what is behind it.' },
  },
  jetProof: {
    ko: { label: '관통 제트 방호', desc: '방폭을 뚫는 성형작약의 관통파에도 견딥니다.' },
    en: { label: 'Jet-proof', desc: 'Survives even a shaped charge’s armor-piercing jet.' },
  },
  indestructible: {
    ko: { label: '불괴', desc: '세상의 어떤 힘으로도 부술 수 없습니다. 지우개와 전체 지우기만이 치웁니다.' },
    en: { label: 'Indestructible', desc: 'No force in the world can remove it. Only the eraser and a full clear will.' },
  },
  isWall: {
    ko: { label: '경계 벽', desc: '세계의 테두리를 이루는 벽입니다.' },
    en: { label: 'Boundary wall', desc: 'The wall that forms the edge of the world.' },
  },
  shockLoose: {
    ko: { label: '충격파에 휩쓸림', desc: '고체지만 구조물이 아니라 낱개로 취급되어, 충격파에 날아갑니다.' },
    en: { label: 'Blown by shockwaves', desc: 'A solid, but treated as loose matter — a shockwave flings it rather than being blocked.' },
  },
  blastDeath: {
    ko: { label: '폭발 잔재', desc: '폭발에 부서지면 이것을 남깁니다.' },
    en: { label: 'Blast residue', desc: 'What it leaves behind when a blast destroys it.' },
  },
  shatter: {
    ko: { label: '파쇄', desc: '부수지 못하는 충격파에도 금이 가 다른 물질이 됩니다.' },
    en: { label: 'Shatters', desc: 'Crazes into another material under a shockwave too weak to break it.' },
  },

  // Traits — overlap
  porous: {
    ko: { label: '다공성', desc: '액체와 기체가 그대로 통과합니다. 가루와 고체는 위에 얹힙니다.' },
    en: { label: 'Porous', desc: 'Liquids and gases pass straight through. Powders and solids rest on top.' },
  },
  porousPowder: {
    ko: { label: '가루 투과', desc: '가루까지 통과시킵니다.' },
    en: { label: 'Passes powder', desc: 'Powder gets through it too.' },
  },
  latticeFilter: {
    ko: { label: '격자 여과', desc: '격자무늬의 밝은 칸만 유체를 받아들입니다.' },
    en: { label: 'Lattice filter', desc: 'Only the light cells of its woven pattern admit fluid.' },
  },
  soakedUpdate: {
    ko: { label: '스며든 상태 반응', desc: '다른 물질에 스며든 채로도 제 할 일을 합니다.' },
    en: { label: 'Acts while soaked', desc: 'Goes on doing its job while soaked into another material.' },
  },
  miscible: {
    ko: {
      label: '섞이는 액체',
      desc: '이 액체들과는 층으로 갈리지 않고 골고루 섞여 한 용액이 됩니다.',
    },
    en: {
      label: 'Mixes with',
      desc: 'Never separates into layers with these — the two stir together into one solution.',
    },
  },
  overlapFluids: {
    ko: { label: '겹침 허용 유체', desc: '이 유체만 안으로 스며들 수 있고, 나머지는 바깥에 그대로 남습니다.' },
    en: { label: 'Soaks up only', desc: 'Only these fluids may soak in; the rest stay outside as ordinary cells.' },
  },

  // Traits — objects only
  floats: {
    ko: { label: '부유', desc: '물보다 가벼워 물 위에 뜹니다.' },
    en: { label: 'Floats', desc: 'Lighter than water, so it floats on it.' },
  },
  bouncy: {
    ko: { label: '높은 반발력', desc: '벽과 고체에 세게 튕깁니다.' },
    en: { label: 'Highly elastic', desc: 'Bounces hard off walls and solids.' },
  },
  blastOnly: {
    ko: { label: '폭발에만 파괴', desc: '아무리 세게 부딪혀도 멀쩡하고, 폭발에만 열립니다.' },
    en: { label: 'Breaks only to blasts', desc: 'No impact however hard opens it — only an explosion does.' },
  },
  spills: {
    ko: { label: '내용물 유출', desc: '부서지면 안에 든 것이 한 번에 쏟아집니다.' },
    en: { label: 'Spills its contents', desc: 'Breaking it pours out everything inside at once.' },
  },
  'fuse.waterproof': {
    ko: { label: '도화선', desc: '심지가 타들어 가는 동안 진짜 불을 뿌립니다. 물속에서도 꺼지지 않고 계속 탑니다.' },
    en: { label: 'Lit fuse', desc: 'Throws real fire while the wick burns down. It keeps burning underwater — dunking it does nothing.' },
  },
  'fuse.quenchable': {
    ko: { label: '도화선(소화 가능)', desc: '심지가 타들어 가는 동안 진짜 불을 뿌립니다. 물에 잠기면 꺼지고, 연료는 남아 있어 다시 붙일 수 있습니다.' },
    en: { label: 'Lit fuse (douseable)', desc: 'Throws real fire while the wick burns down. Submerging it puts it out, and the fuel keeps, so it can be lit again.' },
  },
  smashable: {
    ko: { label: '충돌 파괴', desc: '빠르게 부딪히면 조각으로 부서집니다.' },
    en: { label: 'Smashes on impact', desc: 'A fast enough impact breaks it into pieces.' },
  },
  acidSoluble: {
    ko: { label: '산에 용해', desc: '산 웅덩이에 닿으면 녹아 무너집니다.' },
    en: { label: 'Dissolves in acid', desc: 'Contact with an acid pool eats it away.' },
  },
  fragile: {
    ko: { label: '약한 내구', desc: '웬만한 낙하에도 깨질 만큼 약합니다.' },
    en: { label: 'Fragile', desc: 'Weak enough that an ordinary fall will break it.' },
  },
};
