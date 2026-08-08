// Bilingual body text for the /guide page's "게임 가이드" tab
// (GameGuideDoc.svelte) — the systems overview that sits next to the material
// codex: the grid, the four states, overlap, heat conduction, tools, and
// save/load.
//
// One file, not a ko/en split like codex.ko.ts/codex.en.ts: that split exists
// because the codex's per-material prose is large enough (~68KB combined) to
// need keeping out of the shared island chunk (see i18n/codex.ts). This page
// is orders of magnitude smaller and has exactly one reader (GameGuideDoc.svelte,
// itself only mounted on /guide), so there is no shared-chunk risk to design
// around — both languages just live together, and `satisfies GuideDocText`
// makes a missing key in either one a compile error rather than a silent gap.
//
// Korean is the source of truth, same as the codex. English is a faithful
// translation — when the Korean changes, retranslate the English to match.
//
// Prose style follows i18n/codex.ko.ts's editorial guide (formal endings, no
// em dash, no bold-for-emphasis, no parenthetical asides, conditions as
// "~하면 ~합니다" / plain "if X, then Y"), stretched from that guide's 1-2
// sentence material entries to this page's longer sections.

export interface ToolItemText {
  term: string;
  desc: string;
}

/** The nine tool-list entries, in the order the page shows them. */
export type ToolKey =
  | 'eraser'
  | 'blend'
  | 'heatCool'
  | 'mix'
  | 'electric'
  | 'shock'
  | 'view'
  | 'areaSelect'
  | 'inspect';

export interface GuideDocText {
  lede: string;
  grid: { title: string; p: [string, string] };
  phases: {
    title: string;
    intro: string;
    /** Keyed by the same stable phase keys as `PHASE_KEYS`
     *  (game/materials/categories.ts) — titles come from `categoryLabel`
     *  there rather than being duplicated here. */
    desc: { solid: string; powder: string; liquid: string; gas: string };
    hint: string;
  };
  overlap: { title: string; p: [string, string] };
  heat: { title: string; p: [string, string] };
  tools: {
    title: string;
    intro: string;
    items: Record<ToolKey, ToolItemText>;
    hint: string;
  };
  save: { title: string; p: string };
}

export const guideDocKo: GuideDocText = {
  lede:
    '물질 하나하나의 설명은 물질 도감 탭에 있습니다. 이 탭에서는 물질들이 공유하는 규칙인 격자와 상태, 겹침, 열전도, 도구를 다룹니다.',
  grid: {
    title: '격자와 파티클',
    p: [
      '샌드박스는 촘촘한 격자입니다. 칸 하나가 파티클 하나이며, 매 틱마다 각 파티클이 자기 규칙대로 이웃과 자리를 바꾸거나 반응합니다. 모래가 쌓이고 물이 퍼지고 불이 옮겨붙는 움직임은 이 칸 단위 계산이 쌓인 결과입니다.',
      '고무공, 드럼통, 다이너마이트 같은 것은 격자 칸이 아니라 격자 위를 떠다니는 독립된 물체입니다. 돋보기로 관찰하면 격자 칸의 물질 구성만 집계되며 이런 물체는 잡히지 않습니다. 대신 물체 오른쪽 위에 자기 온도가 따로 표시됩니다. 물체는 부딪히고 구르고 깨지며, 격자 파티클은 흐르고 쌓이고 서로 반응합니다.',
    ],
  },
  phases: {
    title: '네 가지 상태',
    intro: '물질은 넷 중 하나의 상태로 존재하며, 상태가 파티클의 움직임을 결정합니다.',
    desc: {
      solid: '제자리에 고정됩니다. 스스로 움직이지 않으며, 폭발이나 충격 같은 외력에만 반응합니다.',
      powder: '중력 방향으로 쌓이고 흘러내립니다. 경사가 지면 옆으로 무너지지만 액체처럼 수평으로 퍼지지는 않습니다.',
      liquid: '중력을 따르며 수평으로도 퍼져 수위를 맞춥니다. 담긴 그릇의 모양대로 고입니다.',
      gas: '위로 확산하며 흩어집니다. 밀도가 가장 낮아 다른 상태 위로 떠오릅니다.',
    },
    hint: '데스크톱 사이드바와 모바일 하단 바의 팔레트 탭은 이 네 상태를 기본 분류로 씁니다.',
  },
  overlap: {
    title: '겹침: 스며드는 유체',
    p: [
      '체나 메쉬 같은 다공성 고체, 또는 헐거운 가루 더미는 액체와 기체를 완전히 막지 못합니다. 이런 물질 위로 흐른 유체는 사라지지 않고 같은 칸에 겹쳐서 스며듭니다. 젖은 모래가 물기를 머금은 채로 있는 상태가 이 경우입니다. 겹친 유체는 자기 중력과 부력을 따라 계속 흐르고, 빈 자리를 만나면 다시 표면으로 올라옵니다.',
      '스며든 물이 산성이면 계속 부식시키고, 불붙은 기름이 스며든 나무는 속까지 서서히 달아오릅니다. 겹침은 숨어 있는 것이 아니라 그 자리에서 계속 반응하는 물질입니다. 돋보기로 관찰하면 겹침 칸 수가 겹침 N칸으로 따로 표시됩니다.',
    ],
  },
  heat: {
    title: '열전도',
    p: [
      '칸마다 온도를 가지며, 매 틱 사방 이웃과 온도를 교환합니다. 교환 속도는 물질의 전도율이 정합니다. 금속처럼 전도율이 높은 물질은 빠르게 데워지고 식으며, 모래나 나무처럼 전도율이 낮은 물질은 열을 오래 붙듭니다. 빈 칸은 단열재라 열이 새지 않습니다.',
      '온도는 물질의 상태도 바꿉니다. 물은 100℃에서 끓어 수증기가 되고, 용암은 충분히 식으면 돌로 굳습니다. 데스크톱은 화면 좌측 상단, 모바일은 설정 안의 온도계 아이콘을 누르면 물질 색 대신 온도를 색으로 보여주는 열지도로 전환됩니다.',
    ],
  },
  tools: {
    title: '도구',
    intro:
      '브러시는 재료를 칠하는 것 외에도 여러 동작을 합니다. 브러시 크기와 모양, 채우기 방식은 사이드바에서 항상 조절할 수 있습니다. 아래 도구들은 재료 대신 브러시 아래 칸에 직접 작용합니다.',
    items: {
      eraser: { term: '지우개', desc: '브러시 아래를 빈 칸으로 되돌립니다.' },
      blend: { term: '혼합', desc: '최대 세 물질을 비율대로 섞어서 칠합니다.' },
      heatCool: { term: '가열 / 냉각', desc: '재료를 놓지 않고 브러시 아래 온도만 올리거나 내립니다.' },
      mix: { term: '섞기', desc: '브러시 안의 고체가 아닌 파티클끼리 자리를 뒤섞습니다.' },
      electric: { term: '전기', desc: '브러시 아래 도체에 전기 펄스를 직접 흘려보냅니다.' },
      shock: { term: '충격파', desc: '브러시 영역 자체를 발진원으로 삼아 파괴력 없는 충격파를 쏩니다.' },
      view: { term: '보기', desc: '아무것도 그리지 않고 화면만 관찰합니다.' },
      areaSelect: {
        term: '영역 선택',
        desc: '드래그로 사각형을 잡으면, 그 순간 선택된 도구를 영역 전체에 한 번에 적용합니다.',
      },
      inspect: { term: '돋보기', desc: '브러시 아래 파티클 종류와 비율, 평균 온도를 카드로 보여줍니다.' },
    },
    hint:
      '휠(가운데) 클릭은 커서 아래의 물질을 그대로 팔레트 선택으로 집어 옵니다. 우클릭은 항상 지우개로 동작합니다. 물질 칩을 더블클릭하면 그 물질을 지속적으로 생성하는 복제가 선택됩니다.',
  },
  save: {
    title: '저장과 불러오기',
    p:
      '진행 상황은 브라우저에 자동 저장되어 새로고침해도 이어서 시작됩니다. 재생 제어 그룹의 저장 버튼을 누르면 지금 화면을 이름 붙인 슬롯으로 따로 보관할 수 있습니다. 슬롯은 .psbx.json 파일로 내보내거나 다시 가져올 수 있습니다. 시작 화면의 불러오기에서도 저장해 둔 슬롯을 바로 열 수 있습니다.',
  },
} satisfies GuideDocText;

export const guideDocEn: GuideDocText = {
  lede:
    "Each material's own description lives in the Material Codex tab. This tab covers the rules materials share: the grid, states of matter, overlap, heat conduction, and tools.",
  grid: {
    title: 'The Grid and Particles',
    p: [
      'The sandbox is a dense grid. One cell holds one particle, and every tick each particle swaps places with a neighbor or reacts according to its own rules. Sand piling up, water spreading, and fire catching are all the accumulated result of this cell-by-cell calculation.',
      'Things like the rubber ball, the drum, and dynamite are not grid cells. They are independent objects that float above the grid. The inspector only tallies the material composition of grid cells, so it never picks these up; instead, each object shows its own temperature next to it on screen. Objects collide, roll, and break, while grid particles flow, pile up, and react with each other.',
    ],
  },
  phases: {
    title: 'The Four States',
    intro: 'Every material exists in one of four states, and the state determines how its particles move.',
    desc: {
      solid: 'Fixed in place. It never moves on its own, reacting only to an outside force such as an explosion or an impact.',
      powder:
        'Piles up and slides in the direction of gravity. A slope collapses sideways, but powder does not spread horizontally the way a liquid does.',
      liquid: 'Follows gravity and also spreads horizontally to level out. It settles into the shape of whatever contains it.',
      gas: 'Diffuses upward and disperses. Being the lowest-density state, it rises above the other three.',
    },
    hint: "The palette tabs, in the desktop sidebar and the mobile bottom bar alike, use these four states as their basic grouping.",
  },
  overlap: {
    title: 'Overlap: Fluids That Soak In',
    p: [
      'Porous solids such as a sieve or mesh, and loose piles of powder, do not fully block liquids and gases. A fluid that flows over such a material does not disappear; it soaks in, overlapping the same cell. Wet sand holding onto its moisture is this case. The overlapped fluid keeps flowing under its own gravity and buoyancy, and resurfaces when it reaches an empty cell.',
      'Soaked-in acid keeps corroding, and wood soaked with burning oil slowly heats all the way through. Overlap is not something hidden away; it is a material that keeps reacting right where it sits. The inspector reports overlapped cells separately, as N overlapped cells.',
    ],
  },
  heat: {
    title: 'Heat Conduction',
    p: [
      "Every cell has a temperature and exchanges heat with its four neighbors each tick. The exchange rate is set by the material's conductivity. Materials with high conductivity, such as metals, heat up and cool down quickly, while materials with low conductivity, such as sand or wood, hold their heat for a long time. An empty cell is an insulator, so heat does not leak through it.",
      "Temperature also changes a material's state. Water boils into steam at 100°C, and lava cools into stone once it drops far enough. Pressing the thermometer icon, at the top left on desktop or inside settings on mobile, switches the display from material colors to a heat map that shows temperature as color instead.",
    ],
  },
  tools: {
    title: 'Tools',
    intro:
      'The brush does more than paint materials. Brush size, shape, and fill mode can always be adjusted from the sidebar. The tools below act directly on the cells under the brush instead of placing a material.',
    items: {
      eraser: { term: 'Eraser', desc: 'Returns the cells under the brush to empty.' },
      blend: { term: 'Blend', desc: 'Paints up to three materials mixed by ratio.' },
      heatCool: { term: 'Heat / Cool', desc: 'Raises or lowers the temperature under the brush without placing a material.' },
      mix: { term: 'Mix', desc: 'Shuffles the positions of the non-solid particles inside the brush.' },
      electric: { term: 'Electric', desc: 'Feeds an electric pulse directly into the conductors under the brush.' },
      shock: { term: 'Shockwave', desc: 'Fires a non-destructive shockwave, using the brush area itself as the source.' },
      view: { term: 'View', desc: 'Draws nothing; only lets you look at the screen.' },
      areaSelect: {
        term: 'Area Select',
        desc: 'Dragging marks a rectangle, and releasing applies whichever tool is currently selected to the whole area at once.',
      },
      inspect: { term: 'Inspect', desc: 'Shows the particle types, ratios, and average temperature under the brush in a card.' },
    },
    hint:
      'A wheel, or middle, click picks up the material under the cursor into the palette selection. It is an eyedropper that never touches the world. A right click always acts as the eraser, no matter which tool is selected. Double-clicking a material chip latches it to Clone, which then emits that material endlessly.',
  },
  save: {
    title: 'Save and Load',
    p:
      "Progress is saved to the browser automatically, so a reload picks up where it left off. Pressing the save button in the playback control group keeps the current screen as a separate, named slot. A slot can be exported to a .psbx.json file and imported again. The start screen's Load also opens a saved slot directly.",
  },
} satisfies GuideDocText;
