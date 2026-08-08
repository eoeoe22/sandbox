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
      '샌드박스는 기본적으로 격자 파티클이 상호작용하는 공간입니다.',
      '고무공, 드럼통, 다이너마이트 등의 오브젝트는 파티클과 별도의 독립 물체로, 파티클과 독립적으로, 더 역동적으로 움직입니다.',
    ],
  },
  phases: {
    title: '물질 상태',
    intro: '물질은 넷 중 하나의 상태로 존재하며, 상태가 파티클의 움직임을 결정합니다.',
    desc: {
      solid: '제자리에 고정됩니다. 스스로 움직이지 않습니다.',
      powder: '중력 방향으로 쌓이고 흘러내립니다. 경사가 지면 옆으로 무너지지만 액체처럼 수평으로 퍼지지는 않습니다.',
      liquid: '중력을 따르며, 담긴 그릇의 모양대로 고입니다.',
      gas: '위로 확산하며 흩어집니다. 밀도가 가장 낮아 다른 상태 위로 떠오릅니다.',
    },
    hint: '데스크톱 사이드바와 모바일 하단 바의 팔레트 탭은 이 네 상태를 기본 분류로 씁니다.',
  },
  overlap: {
    title: '겹침: 스며드는 유체',
    p: [
      '대부분의 가루 및 일부 고체에는 액체 및 기체가 일부 스며들거나 통과할 수 있습니다.',
      '돋보기로 관찰하면 겹침 칸 수가 겹침 N칸으로 따로 표시됩니다.',
    ],
  },
  heat: {
    title: '열전도',
    p: [
      '모든 파티클은 온도를 가지며, 매 틱 사방 이웃과 온도를 교환합니다.',
      '온도는 물질의 상태 및 물질의 행동에 영향을 줍니다.',
    ],
  },
  tools: {
    title: '도구',
    intro:
      '물질을 칠하는 기본 브러시 이외의 방식으로 샌드박스를 조작할 수 있는 도구들입니다.',
    items: {
      eraser: { term: '지우개', desc: '칠한 부분에 있는 파티클 및 오브젝트를 삭제합니다.' },
      blend: { term: '혼합', desc: '최대 세 물질을 고르고, 비율을 조절해 섞인 상태로 배치합니다. 더블클릭하여 배합을 설정할 수 있습니다.' },
      heatCool: { term: '가열 / 냉각', desc: '칠한 부분의 온도를 조절합니다. 더블클릭하여 가열/냉각 강도를 조절할 수 있습니다.' },
      mix: { term: '섞기', desc: '파티클끼리 자리를 뒤섞습니다.' },
      electric: { term: '전기', desc: '도체에 전기 펄스를 직접 흘려보냅니다.' },
      shock: { term: '충격파', desc: '가루, 액체, 기체, 오브젝트를 밀어내는 충격파를 발생시킵니다.' },
      view: { term: '보기', desc: '샌드박스를 조작하지 않습니다. 이 상태에서 오브젝트를 드래그 할 수 있습니다.' },
      areaSelect: {
        term: '영역 선택',
        desc: '드래그로 사각형을 그리면, 선택한 도구를 영역 전체에 한 번에 적용합니다.',
      },
      inspect: { term: '돋보기', desc: '클릭한 칸의 파티클 종류, 비율, 평균 온도를 카드로 보여줍니다.' },
    },
    hint:
      '휠(가운데) 클릭은 커서 아래의 물질을 그대로 팔레트 선택으로 집어 옵니다. 우클릭은 항상 지우개로 동작합니다. 물질 팔레트를 더블클릭하면 그 물질을 지속적으로 생성하는 복제가 선택됩니다.',
  },
  save: {
    title: '저장과 불러오기',
    p:
      '진행 상황은 브라우저에 자동 저장되어 새로고침해도 이어서 시작됩니다. 저장 버튼을 누르면 지금 샌드박스 화면을 이름 붙인 슬롯에 저장할 수 있습니다. 저장 데이터는 .psbx.json 파일로 내보내거나 다시 가져올 수 있습니다.',
  },
} satisfies GuideDocText;

export const guideDocEn: GuideDocText = {
  lede:
    'Descriptions of individual materials are located in the Material Codex tab. This tab covers the rules shared by materials: the grid, states of matter, overlap, heat conduction, and tools.',
  grid: {
    title: 'Grid and Particles',
    p: [
      'The sandbox is fundamentally a space where grid particles interact.',
      'Objects such as rubber balls, drums, and dynamite are independent entities separate from particles, moving independently of particles and more dynamically.',
    ],
  },
  phases: {
    title: 'Material States',
    intro: 'Materials exist in one of four states, and the state determines particle movement.',
    desc: {
      solid: 'Fixed in place. Does not move on its own.',
      powder:
        'Piles up and flows in the direction of gravity. Slopes collapse sideways, but it does not spread horizontally like a liquid.',
      liquid: 'Follows gravity and settles into the shape of its container.',
      gas: 'Diffuses upward and disperses. Having the lowest density, it floats above other states.',
    },
    hint: 'The palette tabs on the desktop sidebar and mobile bottom bar use these four states as their basic classification.',
  },
  overlap: {
    title: 'Overlap: Seeping Fluids',
    p: [
      'Liquids and gases can partially seep into or pass through most powders and some solids.',
      'When inspected with the magnifier, the number of overlapped cells is displayed separately as N overlapped cells.',
    ],
  },
  heat: {
    title: 'Heat Conduction',
    p: [
      'Every particle has a temperature and exchanges heat with its four neighbors each tick.',
      "Temperature affects a material's state and behavior.",
    ],
  },
  tools: {
    title: 'Tools',
    intro:
      'These are tools to manipulate the sandbox in ways other than the default material brush.',
    items: {
      eraser: { term: 'Eraser', desc: 'Deletes particles and objects in the painted area.' },
      blend: { term: 'Blend', desc: 'Select up to three materials and place them mixed according to adjusted ratios. Double-click to configure the mix.' },
      heatCool: { term: 'Heat / Cool', desc: 'Adjusts the temperature of the painted area. Double-click to adjust heat/cool intensity.' },
      mix: { term: 'Mix', desc: 'Shuffles the positions of particles.' },
      electric: { term: 'Electric', desc: 'Sends electric pulses directly into conductors.' },
      shock: { term: 'Shockwave', desc: 'Generates a shockwave that pushes away powders, liquids, gases, and objects.' },
      view: { term: 'View', desc: 'Does not manipulate the sandbox. Objects can be dragged in this mode.' },
      areaSelect: {
        term: 'Area Select',
        desc: 'Drag to draw a rectangle and apply the selected tool to the entire area at once.',
      },
      inspect: { term: 'Magnifier', desc: 'Displays the particle types, ratios, and average temperature of the clicked cell in a card.' },
    },
    hint:
      'Middle-clicking picks up the material under the cursor directly into the palette selection. Right-clicking always acts as the eraser. Double-clicking a material palette chip selects Clone, which continuously generates that material.',
  },
  save: {
    title: 'Save and Load',
    p:
      'Progress is automatically saved in the browser, allowing you to resume even after reloading. Pressing the save button allows you to save the current sandbox screen into a named slot. Saved data can be exported to or imported from a .psbx.json file.',
  },
} satisfies GuideDocText;
