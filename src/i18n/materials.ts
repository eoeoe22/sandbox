// Display names for materials, objects, and categories, keyed by stable ids.
//
// - Materials are keyed by numeric `Material.id` (stable across renames).
// - Objects are keyed by `ObjectKind`.
// - Categories are keyed by the stable ASCII identifiers in
//   src/game/materials/categories.ts (`CATEGORY_META` / phase fallbacks).
//
// English names come from each material's own `name` field, so the English
// table here only needs to cover categories and objects (material English names
// are read directly from the material via the `fallback` arg of `materialName`).
// The Korean table carries full Korean display names for every material,
// extracted from docs/MATERIALS.md.

import type { ObjectKind } from '../state/store';

// --- Category labels --------------------------------------------------------
// Stable key → localized label. The order matches CATEGORY_META, plus the phase
// fallbacks and the object tab.

export const categoryLabelsEn: Record<string, string> = {
  eraser: 'Eraser',
  solid: 'Solid',
  powder: 'Powder',
  liquid: 'Liquid',
  gas: 'Gas',
  fire: 'Fire / Heat',
  smelt: 'Smelting',
  oil: 'Petroleum',
  explosive: 'Explosive',
  cooling: 'Cryo',
  electric: 'Electric',
  life: 'Life',
  radioactive: 'Radioactive',
  exotic: 'Exotic',
};

export const categoryLabelsKo: Record<string, string> = {
  eraser: '지우개',
  solid: '고체',
  powder: '가루',
  liquid: '액체',
  gas: '기체',
  fire: '불·열',
  smelt: '제련',
  oil: '석유',
  explosive: '폭발',
  cooling: '냉각',
  electric: '전기',
  life: '생명',
  radioactive: '방사성',
  exotic: '특수',
};

// --- Object labels ----------------------------------------------------------
// Keyed by ObjectKind (stable). English mirrors the legacy OBJECT_LABELS values.

export const objectLabelsEn: Record<ObjectKind, string> = {
  ball: 'Rubber Ball',
  drum: 'Empty Drum',
  oildrum: 'Crude Oil Drum',
  aciddrum: 'Acid Drum',
  dynamite: 'Dynamite',
  smokebomb: 'Smoke Bomb',
  crate: 'Wooden Crate',
};

export const objectLabelsKo: Record<ObjectKind, string> = {
  ball: '고무공',
  drum: '빈 드럼통',
  oildrum: '원유 드럼통',
  aciddrum: '산 드럼통',
  dynamite: '다이너마이트',
  smokebomb: '연막탄',
  crate: '나무 상자',
};

// --- Material names ---------------------------------------------------------
// Keyed by Material.id. English names are read straight from each material's
// `name` field (no table needed), so only the Korean table is populated here.
// Names sourced from docs/MATERIALS.md.

export const materialNamesEn: Record<number, string> = {};

export const materialNamesKo: Record<number, string> = {
  // 0 Eraser — palette-invisible, but shown in some fallback paths.
  0: '지우개',
  1: 'Wall',
  2: '모래',
  3: '물',
  4: '돌',
  5: '소금물',
  6: '연기',
  7: '소금',
  8: '수증기',
  9: '불',
  10: '용암',
  11: '산',
  12: '화약',
  13: '니트로',
  16: '산 증기',
  17: '폭발',
  18: '불씨',
  19: '푸른 불꽃',
  20: '메탄',
  21: '얼음',
  22: '눈',
  23: '원유',
  24: '휘발유',
  25: '석탄',
  26: '나무',
  27: '톱밥',
  28: '철',
  29: '용융 철',
  31: '용융 유리',
  32: '유리',
  33: '액체 질소',
  34: '드라이아이스',
  36: '산소',
  37: '수소',
  38: '스파크',
  39: '리튬 배터리',
  40: '수은',
  41: '꿀',
  42: '알코올',
  43: '흙',
  44: '진흙',
  45: '시멘트',
  46: '콘크리트',
  47: '식물',
  48: '바이러스',
  49: '복제',
  50: '공허',
  51: '반물질',
  52: 'TNT',
  53: '도화선',
  54: '테르밋',
  55: '재',
  56: '용융 소금',
  57: '다이아몬드',
  58: 'LPG',
  59: '석유 증기',
  60: '등유',
  61: '경유',
  62: '아스팔트',
  63: 'U235',
  65: '용융 U235',
  66: '핵 광선',
  67: '철광석',
  68: '슬래그',
  69: '석회석',
  70: '석탄 가루',
  71: '용융 철광석',
  73: '파편',
  74: '집속탄',
  75: '소이탄',
  77: '네이팜',
  78: '네이팜 젤',
  79: 'C4',
  80: '베이킹소다',
  81: '니크롬',
  82: 'LFP 배터리',
  83: '체',
  84: '터빈',
  85: '히트파이프',
  86: '나트륨',
  87: 'CO2',
  88: '과산화수소',
  89: '효모',
  90: '씨앗',
  91: '슬라임',
  92: '송진',
  93: '호박',
  94: '백린',
  95: '설탕',
  96: '염소',
  97: '헬륨',
  98: '에어로젤',
  99: '질산암모늄',
  100: '컨베이어',
  101: '비누',
  102: '비눗물',
  103: '거품',
  104: '설탕물',
  105: '철가루',
  106: 'U238',
  107: '용융 U238',
  108: '핵폐기물',
  109: '우퍼',
  110: '흰개미',
  111: '나노봇',
  112: '선풍기',
  113: '녹',
  114: '녹가루',
  115: '산성 슬라임',
  116: '갈륨',
  117: '액체 갈륨',
  118: '수은 증기',
  119: '깨진 유리',
  120: '열선',
  121: '레이저',
  122: '펌프',
  123: '전자석',
  124: '흑요석',
  125: '황',
  126: '초석',
  127: '성형작약',
  128: '알루미늄 가루',
  129: '불꽃놀이 화약',
  130: '불꽃 자탄',
  131: '불꽃',
  132: '전선',
  133: '태양광 패널',
  134: '산호',
  135: '백화 산호',
  136: '알루미늄',
  137: '섬광화약',
  138: '섬광',
  143: '녹은 알루미늄',
};
