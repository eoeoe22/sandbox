// Korean UI strings — mirrors the English keyset in ui.en.ts. A missing key
// falls back to English (then the raw key), so this table only needs to cover
// the strings actually translated.

export const ko = {
  // --- Brand / generic ---
  brand: 'Particle Sandbox',
  close: '닫기',

  // --- Play controls ---
  play: {
    pause: '일시정지',
    resume: '재생',
    step: '스텝',
    stepFull: '한 스텝 진행',
    stepTooltip: '한 스텝 진행 (일시정지 중)',
    clear: '지우기',
    clearArmed: '지우기',
    clearConfirm: '계속하시겠습니까?',
    clearFull: '전체 지우기',
    clearTooltip: '캔버스를 전체 지웁니다.',
    save: '저장',
    saveFull: '저장 / 불러오기',
    saveTooltip: '현재 샌드박스를 저장하거나 불러옵니다.',
    groupPlayback: '재생 제어',
  },

  // --- Tools ---
  tool: {
    material: '재료',
    area: '영역',
    areaTooltip:
      '영역 선택 도구입니다. 사각형으로 드래그해 영역을 지정하면, 재료·혼합·가열·냉각·섞기·지우개·전기·충격파 중 그 순간 고른 도구를 영역 전체에 한 번에 적용합니다. PC에서는 좌클릭 드래그 시 즉시 적용되고, 우클릭 드래그는 Enter 키로 확정하거나 Escape 키로 취소합니다. 모바일에서는 손을 떼는 즉시 적용됩니다. 다른 브러시 도구와 함께 켜둘 수 있으나, 오브젝트 도구에서는 사용할 수 없습니다.',
    areaObjectBlocked: '오브젝트는 영역 선택을 사용할 수 없습니다.',
    blend: '혼합',
    blendTooltip: '여러 물질을 비율대로 섞어 그립니다. 더블클릭하면 비율 조절 창이 열립니다.',
    heat: '가열',
    heatTooltip: '브러시 영역의 온도를 올립니다. 빈칸은 제외되며, 더블클릭하면 감도 설정이 열립니다.',
    cool: '냉각',
    coolTooltip: '브러시 영역의 온도를 내립니다. 빈칸은 제외되며, 더블클릭하면 감도 설정이 열립니다.',
    mix: '섞기',
    mixTooltip: '브러시 영역의 파티클을 섞습니다. 고체는 제외됩니다.',
    erase: '지우개',
    eraseTooltip: '브러시 영역을 빈칸으로 지웁니다. 닿은 오브젝트도 함께 삭제됩니다.',
    view: '보기',
    viewTooltip:
      '보기 모드입니다. 그리지 않으며, 오브젝트(공·드럼통)를 끌어 옮길 수 있습니다. 오른쪽 클릭 지우개는 이 모드에서도 사용할 수 있습니다.',
    spark: '전기',
    sparkTooltip:
      '전기 브러시는 브러시 영역의 도체에 전원(Spark)을 공급합니다. 배터리 없이도 회로를 손으로 돌릴 수 있고, 닿은 전기 장치(선풍기·우퍼·레이저·펌프·전자석)와 전기 기폭 장약도 그대로 작동합니다.',
    shock: '충격파',
    shockTooltip:
      '충격파 브러시는 브러시 영역에서 Woofer 충격파를 터뜨립니다. 우퍼가 없어도 되고, 아무것도 부수지 않으면서 가루·액체·오브젝트만 바깥으로 밀어냅니다. 누르고 있으면 일정 박자로 반복됩니다.',
    inspect: '돋보기',
    inspectTooltip:
      '돋보기는 브러시 영역의 파티클 종류·개수·비율·평균온도를 표시하고, 화면의 모든 오브젝트 옆에 각자의 온도를 함께 띄웁니다. 그리기와 별도로 켤 수 있습니다.',
    settings: '설정',
    settingsTooltip: '설정',
    groupDraw: '그리기 방식',
    groupSpecial: '특수 브러시',
    groupObserve: '관찰 도구',
    materialLabel: '재료: {name}',
    materialTooltip: '선택한 재료를 그립니다: {name}',
  },

  // --- Brush / draw settings ---
  brush: {
    size: '브러시 크기: {n}',
    sizeWheelHint: ' (휠로 조절)',
    shape: '브러시 모양',
    shapeCircle: '원형',
    shapeSquare: '사각형',
    shapeCircleTooltip: '원형 브러시',
    shapeSquareTooltip: '사각형 브러시',
    fill: '채우기',
    fillFull: 'Full',
    fillParticle: 'Particle',
    fillFullTooltip: '브러시 영역을 빈틈없이 채웁니다.',
    fillParticleTooltip: '브러시 영역에 무작위로 빈틈을 남깁니다. 고체는 항상 Full로 채웁니다.',
    overwrite: '덮어쓰기: {label}',
    overwriteAuto: '자동',
    overwriteAutoLabel: '자동 ({name})',
    overwriteLevel0: '덮어쓰기 없음',
    overwriteLevel1: '기체만',
    overwriteLevel2: '기체+액체',
    overwriteLevel3: '기체+가루+액체',
    overwriteLevel4: '기체+가루+액체+고체',
    overwriteLevel5: '전체 (Wall 포함)',
    overwriteMissing: '?',
  },

  // --- Simulation settings ---
  sim: {
    speed: '속도: ×{n}',
    speedDefaultHint: ' (기본)',
    speedTooltip: '시뮬레이션 속도 ×{n}',
    speedGroup: '시뮬레이션 속도',
    gravity: '중력: {dir} · {strength}',
    gravityZero: '무중력',
    gravityStrength: '세기 {n}%',
    gravityDirGroup: '중력 방향',
    gravityStrengthAria: '중력 세기',
    gravityDirUp: '위',
    gravityDirLeft: '왼쪽',
    gravityDirRight: '오른쪽',
    gravityDirDown: '아래',
    gravityDirTooltip: '중력을 {dir}쪽으로',
    gravityDirAria: '중력 {dir}',
  },

  // --- Render / overlay settings ---
  render: {
    heatmap: '온도 열지도',
    heatmapOff: '일반',
    heatmapOn: '열지도',
    heatmapGroup: '온도 열지도 오버레이',
    heatmapOffTooltip: '일반 물질 색으로 표시합니다.',
    heatmapOnTooltip: '온도에 따라 색을 입혀 열화상처럼 표시합니다.',
    heatmapNormalAria: '일반 렌더링',
    heatmapHeatAria: '열지도 렌더링',
    heatmapNormalTooltip: '물질 색으로 표시하는 일반 렌더링입니다.',
    heatmapHeatTooltip: '온도에 따라 열화상처럼 표시하는 열지도 렌더링입니다.',
    smoke: '연기',
    smokeHigh: '상',
    smokeMedium: '중',
    smokeOff: '끔',
    smokeGroup: '연기 세기',
    smokeHighTooltip: '연소·폭발 반응이 연기를 많이 냅니다.',
    smokeMediumTooltip: '연기를 적당히 내는 기본값입니다.',
    smokeOffTooltip: '반응에서 연기를 내지 않습니다.',
  },

  // --- Edge / world settings ---
  border: {
    label: '테두리',
    group: '테두리 모드',
    wall: '벽',
    void: '공허',
    wallTooltip: '테두리가 단단한 벽이라 파티클이 밖으로 나가지 못합니다.',
    voidTooltip: '테두리가 공허라서 가장자리에 닿은 파티클은 밖으로 떨어져 사라집니다.',
  },

  // --- Grid / resolution settings ---
  grid: {
    resolution: '해상도: {w}×{h}',
    resolutionHint: ' (셀 크기)',
    lowRes: '저해상도',
    highRes: '고해상도',
    division: '격자 표시: {label}',
    divisionOff: '끔',
    divisionGroup: '격자 표시 간격',
    divisionTooltipOff: '격자선을 표시하지 않습니다.',
    divisionTooltipOn: '{n}칸마다 격자선을 표시합니다.',
    bottomDeadzone: '아래 데드존: {n}px',
    bottomDeadzoneHint: ' (화면 아래 가림 방지)',
    bottomDeadzoneAria: '아래 데드존',
    bottomDeadzoneNote:
      '태블릿·모바일 브라우저에서 화면 아래가 주소창 등에 가릴 때, 이 값을 올려 샌드박스 아래에 빈 공간을 확보합니다. PC에서는 0을 권장합니다.',
  },

  // --- Brush detail settings ---
  brushDetails: {
    label: '브러시 세부 설정',
    heatCool: '가열/냉각 감도',
    heatCoolAria: '가열/냉각 감도 설정 열기',
    heatCoolTooltip: '가열/냉각 브러시의 감도(절대온도/상대온도)를 조절합니다.',
    blend: '혼합 브러시 구성',
    blendAria: '혼합 브러시 구성 열기',
    blendTooltip: '혼합 브러시가 섞을 물질과 비율을 조절합니다.',
  },

  // --- Modals ---
  modal: {
    settingsTitle: '설정',
    blendTitle: '혼합 브러시 비율',
    blendHint:
      '최대 3가지 물질을 골라 비율을 정하면, 혼합 브러시가 그 비율대로 섞어 칠합니다. 막대의 경계를 드래그하면 비율이 조절됩니다.',
    heatCoolTitle: '가열/냉각 브러시 설정',
    saveTitle: '저장 / 불러오기',
  },

  // --- HUD ---
  hud: {
    grid: '격자 {w}×{h}',
    particles: '입자 {n}',
    particlesTooltip: '현재 배치된 입자 수 (빈칸 제외)',
    fill: '채움 {n}%',
    fillTooltip: '격자에서 입자가 차지하는 비율',
    fps: '{n} FPS',
    fpsPeak: ' · 최대 {n}',
    fpsTooltip:
      "적응형 주사율(ProMotion/Adaptive Sync) 기기는 유휴 시 절전을 위해 주사율을 낮춥니다. '최대'는 이 세션에서 관측된 최고값입니다.",
    frameMs: '{n} ms/프레임',
    frameMsTooltip: '프레임 렌더링에 걸린 평균 시간',
    simHz: '시뮬 {n} Hz',
    simHzTooltip: '현재 시뮬레이션 갱신 속도 (속도 배율 × 기본 틱레이트)',
    perfTooltip:
      'Phase 0 개발 프로파일러 (?perf): 틱을 패스별로 계측한 평균 시간. 열=열확산, CA=물질 스캔, 렌더=프레임 렌더.',
    perfHeat: '열',
    perfCa: 'CA',
    perfObjects: '오브젝트',
    perfDrift: '드리프트',
    perfRender: '렌더',
    perfTick: '틱',
  },

  // --- Reset ---
  reset: {
    button: '설정 기본값 복원',
    buttonArmed: '기본값으로 되돌릴까요?',
    aria: '모든 설정 기본값 복원',
    ariaArmed: '기본값 복원 확인',
    tooltip: '모든 설정을 기본값으로 되돌립니다. 월드와 즐겨찾기는 유지됩니다.',
  },

  // --- Hints ---
  hint: {
    draw:
      '캔버스를 드래그하면 물질이 그려집니다. 오른쪽 클릭이나 지우개 브러시로 지울 수 있습니다. ' +
      '휠(가운데) 클릭은 스포이드 기능으로, 커서 아래의 물질이나 오브젝트를 그대로 집어 옵니다.',
  },

  // --- Material palette ---
  palette: {
    searchPlaceholder: '물질 검색…',
    searchAria: '물질 검색',
    searchClear: '검색 지우기',
    searchClearTooltip: '검색 지우기',
    noResults: '일치하는 물질이 없습니다.',
    resultsGroup: '검색 결과',
    quickGroup: '즐겨찾기·최근 사용',
    // 터치에서 길게 눌러 연 물질 카드가 도감 산문을 받아 오는 동안. 세션 첫 한 번뿐이다.
    cardLoading: '불러오는 중…',
    objectKey: '오브젝트',
    favAdd: '{name} 즐겨찾기 추가',
    favRemove: '{name} 즐겨찾기 해제',
    favAddTooltip: '즐겨찾기 추가',
    favRemoveTooltip: '즐겨찾기 해제',
  },

  // --- Material picker (blend editor) ---
  picker: {
    categoryMaterials: '{label} 물질',
    categories: '물질 카테고리',
    back: '뒤로',
    backAria: '카테고리로 돌아가기',
    missing: '?',
    slotLabel: '{n}번 물질',
  },

  // --- Blend brush editor ---
  blend: {
    dividerAria: '{a}와 {b} 비율 조절',
    dividerTooltip: '드래그해 비율 조절',
    remove: '이 물질 제거',
    removeTooltip: '제거',
    add: '물질 추가',
  },

  // --- 배치 방향 배지 (방향성 물질) ---
  placeDir: {
    aria: '{name} 배치 방향: {dir}',
    up: '위',
    down: '아래',
    left: '왼쪽',
    right: '오른쪽',
  },

  // --- Inspect panel ---
  inspect: {
    brushInfo: '브러시 정보',
    areaInfo: '영역 정보',
    emptyArea: '드래그해 영역을 선택하면 정보가 표시됩니다.',
    emptySpace: '빈 공간 · {n}칸',
    particles: '입자 {occupied} / {total}칸 · {pct}%',
    particlesTooltip: '브러시 영역에서 입자가 찬 칸 / 전체 칸',
    avgTemp: '평균 {n}°C',
    avgTempTooltip: '입자가 있는 칸의 평균 온도 (벽 제외)',
    overlap: '겹침 {n}칸',
    overlapTooltip: '액체가 스며든(겹친) 칸 수 (예: 젖은 모래)',
    materialAvgTempTooltip: '{name} 평균 온도',
    noTempTooltip: '온도 없음 (벽 등)',
    more: '그 외 {n}종',
  },

  // --- Heat/Cool settings ---
  heatCool: {
    mode: '기준 방식',
    modeGroup: '가열/냉각 감도 기준 방식',
    absolute: '절대온도',
    relative: '상대온도',
    absoluteTooltip: '온도를 고정된 도(°) 단위로 올리거나 내립니다.',
    relativeTooltip:
      '현재 온도 크기에 비례한 퍼센트(%)로 올리거나 내립니다. 영하에서도 방향은 항상 가열은 상승, 냉각은 하강입니다.',
    sensitivityAbs: '감도: 초당 {n}°',
    sensitivityRel: '감도: 초당 {n}%',
    hint: '값은 배속×1로 1초간 눌렀을 때 오르내리는 양이 기준입니다. 절대온도는 도(°) 단위, 상대온도는 현재 온도 크기 대비 퍼센트 단위입니다. 배속을 올리면 브러시를 누르는 동안 실제 초당 변화량도 그만큼 빨라집니다. 영역 선택으로 확정할 때는 현재 배속과 무관하게 이 기준값 1초치를 한 번에 그대로 적용합니다. 냉각 브러시도 같은 감도를 반대 방향으로 씁니다. 상대온도는 영하에서도 방향이 뒤집히지 않도록 온도의 크기(절대값)에 비례해 움직이므로, 정확히 0°인 대상은 상대온도로 움직이지 않습니다. 절대온도는 이때도 항상 동작합니다.',
  },

  // --- Save slots ---
  save: {
    namePlaceholder: '저장할 이름 (비우면 자동)',
    descPlaceholder: '설명 (선택)',
    saveAria: '현재 캔버스 저장',
    save: '저장',
    limitExceeded: '저장 한도(50개)를 초과했습니다. 기존 스냅샷을 삭제해야 합니다.',
    saveFailed: '저장 공간이 부족해 저장하지 못했습니다.',
    saved: '"{name}" 저장됨',
    loadOk: '불러오기 완료',
    loadFailed: '불러오기 실패',
    loadTooltip: '불러오기',
    renameTooltip: '이름 · 설명 수정',
    deleteTooltip: '삭제',
    deleteConfirm: '"{name}" 삭제할까요?',
    deleted: '"{name}" 삭제됨',
    renameFailed: '저장 공간이 부족해 수정하지 못했습니다.',
    loadAria: '"{name}" 불러오기',
    renameAria: '"{name}" 이름 · 설명 수정',
    deleteAria: '"{name}" 삭제',
    viewToggleGroup: '스냅샷 보기 방식',
    galleryTooltip: '갤러리 보기',
    listTooltip: '목록 보기',
    empty: '저장된 스냅샷이 없습니다. 현재 샌드박스 상태를 저장하거나, 파일을 불러올 수 있습니다.',
    hint: '저장 스냅샷은 브라우저 로컬에 보관됩니다. 불러오기를 누르면 미리보기 창이 열려, 크기가 다른 장면을 현재 캔버스에 어떻게 앉힐지 직접 고를 수 있습니다.',

    // --- File export / import ---
    exportTooltip: '파일로 내보내기',
    exportAria: '"{name}" 파일로 내보내기',
    exported: '"{name}" 내보냄',
    exportFailed: '내보내기 실패',
    import: '파일 불러오기',
    importTooltip: '.psbx.json 스냅샷 파일을 목록에 추가합니다. 캔버스는 그대로 유지됩니다.',
    imported: '"{name}" 목록에 추가됨',
    importInvalid: '스냅샷 파일이 아니거나 손상되었습니다.',
    importTooBig: '파일이 너무 큽니다.',
    importReadFailed: '파일을 읽지 못했습니다.',
    importLimit: '저장 한도(50개)를 초과했습니다. 기존 스냅샷을 삭제해야 합니다.',
    importFailed: '저장 공간이 부족해 불러오지 못했습니다.',
  },

  // --- Start screen's 불러오기 modal: browse/manage slots with no live canvas
  // to save from. Everything else it needs (rename·delete·export·import·view
  // toggle wording) is shared with `save` above.
  startLoad: {
    title: '저장 슬롯',
    subtitle: '저장된 슬롯을 선택해 바로 시작하거나, .psbx.json 파일을 드래그해 가져올 수 있습니다.',
    dropAria: '스냅샷 드롭 존',
    empty: '저장된 스냅샷이 없습니다.',
    emptyHint: '게임 실행 중 저장 버튼을 누르면 이곳에 슬롯으로 기록됩니다.',
  },

  // --- Snapshot load options (preview modal) ---
  load: {
    title: '불러오기 옵션',
    previewAria: '미리보기: 끌거나 방향키로 장면을 옮깁니다.',
    modeGroup: '스냅샷을 맞추는 방식',
    mode: {
      auto: '자동 맞춤',
      autoTooltip:
        '종횡비를 유지한 채 전체가 들어가도록 압축하거나 확대합니다. 잘리는 곳 없이 다 보이고, 남는 자리는 빈칸입니다.',
      manual: '수동',
      manualTooltip:
        '배율을 직접 정하고 장면을 원하는 위치로 끌어 놓습니다. 캔버스 밖으로 나간 부분은 잘립니다.',
      simple: '원본 크기',
      simpleTooltip:
        '크기를 바꾸지 않습니다. 캔버스를 넘치는 부분은 잘라내고, 모자라는 부분은 빈칸으로 둡니다.',
    },
    scale: '배율',
    scaleX: '가로',
    scaleY: '세로',
    linkAxes: '비율 고정',
    presetAuto: '맞춤',
    presetOriginal: '원본',
    presetFill: '꽉 채우기',
    manualHint:
      '미리보기를 끌어서 장면을 옮깁니다. 방향키로 미세 조정할 수 있고, Shift를 누르면 10칸씩 움직입니다. 많이 축소하면 셀이 합쳐지므로 1칸짜리 전선 같은 얇은 구조는 끊길 수 있습니다.',
    cancel: '취소',
    confirm: '불러오기',
  },

  // --- Language selector ---
  language: {
    label: '언어',
    group: '언어',
    korean: '한국어',
    english: 'English',
    tooltip: '인터페이스 언어를 전환합니다.',
  },

  // --- 404 page ---
  notFound: {
    title: '404 · Particle Sandbox',
    heading: '404',
    message: '페이지를 찾을 수 없습니다.',
    link: '샌드박스로 돌아가기',
  },

  // --- 물질 도감 (/guide) ---
  // 본문은 여기가 아니다 — 물질 설명은 codex.ko.ts, 태그 이름·설명은 codexTerms.ts.
  // 여기는 페이지 골격 문구만.
  codex: {
    title: '물질 도감',
    tabMaterials: '물질 도감',
    tabBasics: '게임 가이드',
    tabGroup: '가이드 섹션',
    search: '물질 검색',
    searchClear: '검색어 지우기',
    all: '전체',
    objects: '오브젝트',
    empty: '검색 결과가 없습니다.',
    emptyHint: '다른 이름으로 찾거나 필터를 풀면 결과가 늘어날 수 있습니다.',
    count: '{n}종',
    phaseFilter: '상태',
    tagFilter: '태그',
    tagFilterHint: '고른 태그를 모두 가진 물질만 남습니다.',
    filterReset: '필터 초기화',
    copy: '마크다운 복사',
    copyList: '목록 마크다운 복사',
    copied: '복사했습니다.',
    copyFailed: '복사하지 못했습니다.',
    // 태그 필터 패널의 소제목. 키는 game/codex/tags.ts 의 그룹 키.
    tagGroup: {
      electric: '전기',
      light: '빛·열',
      fire: '불',
      acid: '산',
      radiation: '방사선',
      blast: '폭발·파괴',
      mix: '섞임',
      spoil: '부패',
      overlap: '겹침',
      body: '오브젝트 거동',
    },
    // 마크다운으로 복사할 때만 쓰이는 표 머리말·머리글.
    md: {
      name: '물질',
      category: '카테고리',
      phase: '상태',
      item: '항목',
      value: '값',
      filters: '필터',
      search: '검색',
      shown: '{total}종 중 {n}종',
    },
    statsHeading: '수치',
    traitsHeading: '특성',
    reactionsHeading: '반응',
    nothing: '없음',
    detail: '자세히 보기',
    close: '닫기',
    toSandbox: '샌드박스로 가기',
    toHome: '시작 페이지로',
    objectNote: '오브젝트는 격자 위가 아니라 그 위를 굴러다니는 강체입니다.',
    unit: { temp: '℃', cells: '칸', ticks: '틱', seconds: '초' },
    reaction: {
      unchanged: '그대로',
      byproduct: '부산물',
      catalyst: '촉매',
      chance: '확률 {v}',
      tempMin: '{v}℃ 이상',
      tempMax: '{v}℃ 이하',
      exo: '발열 +{v}℃',
      endo: '흡열 {v}℃',
    },
  },
} as const;
