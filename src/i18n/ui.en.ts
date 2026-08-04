// English UI strings — the source of truth for the UI keyset. Every key used by
// `t(...)` in the components must exist here; the Korean table mirrors this.
// Dotted keys in code (`'tool.brush.material'`) descend into this nesting.

export const en = {
  // --- Brand / generic ---
  brand: 'Particle Sandbox',
  close: 'Close',

  // --- Play controls ---
  play: {
    pause: 'Pause',
    resume: 'Play',
    step: 'Step',
    stepFull: 'Advance one step',
    stepTooltip: 'Advance one step (while paused)',
    clear: 'Clear',
    clearArmed: 'Clear',
    clearConfirm: 'Continue?',
    clearFull: 'Clear all',
    clearTooltip: 'Clear the whole canvas',
    save: 'Save',
    saveFull: 'Save / Load',
    saveTooltip: 'Save or load the current sandbox',
    groupPlayback: 'Playback',
  },

  // --- Tools ---
  tool: {
    material: 'Material',
    area: 'Area',
    areaTooltip:
      'Area select — drag a rectangle to mark a region, then apply the active tool (material/blend/heat/cool/mix/erase/spark/shockwave) to it at once (PC: left-drag applies immediately, right-drag confirms with Enter / cancels with Escape; mobile: applies on drop). Can stay on alongside other brush tools (not available with the object tool).',
    areaObjectBlocked: 'Area select is not available with the object tool.',
    blend: 'Blend',
    blendTooltip:
      'Paint a mixture of several materials by ratio (double-click to open the ratio editor)',
    heat: 'Heat',
    heatTooltip:
      'Raise the temperature of the brush area (except empty cells) — double-click to open the sensitivity settings',
    cool: 'Cool',
    coolTooltip:
      'Lower the temperature of the brush area (except empty cells) — double-click to open the sensitivity settings',
    mix: 'Mix',
    mixTooltip: 'Shuffle the particles in the brush area (except solids)',
    erase: 'Erase',
    eraseTooltip: 'Clear the brush area (to empty) — also destroys touched objects',
    view: 'View',
    viewTooltip:
      'View mode — draws nothing. Objects (ball/drum) can be dragged around (right-click erase still works)',
    spark: 'Spark',
    sparkTooltip:
      'Spark — supplies power to every conductor in the brush area. Drive a circuit by hand with no battery wired in; electric appliances it touches (fan/woofer/laser/pump/electromagnet) and electrically-detonated charges fire too',
    shock: 'Shockwave',
    shockTooltip:
      'Shockwave — thumps a Woofer shockwave out of the brush area. No woofer needed, and it breaks nothing: only powder, liquid and objects are pushed outward (repeats on a steady beat while held)',
    inspect: 'Inspect',
    inspectTooltip:
      'Inspect — shows the particle kinds, counts, ratios, and average temperature of the brush area (independent of drawing)',
    settings: 'Settings',
    settingsTooltip: 'Settings',
    groupDraw: 'Draw mode',
    groupSpecial: 'Special brushes',
    groupObserve: 'Observation',
    materialLabel: 'Material: {name}',
    materialTooltip: 'Paint the selected material: {name}',
  },

  // --- Brush / draw settings ---
  brush: {
    size: 'Brush size: {n}',
    sizeWheelHint: ' (adjust with wheel)',
    shape: 'Brush shape',
    shapeCircle: 'Circle',
    shapeSquare: 'Square',
    shapeCircleTooltip: 'Round brush',
    shapeSquareTooltip: 'Square brush',
    fill: 'Fill',
    fillFull: 'Full',
    fillParticle: 'Particle',
    fillFullTooltip: 'Fills the brush area with no gaps',
    fillParticleTooltip: 'Leaves random gaps in the brush area (solids are always Full)',
    overwrite: 'Overwrite: {label}',
    overwriteAuto: 'Auto',
    overwriteAutoLabel: 'Auto ({name})',
    overwriteLevel0: 'No overwrite',
    overwriteLevel1: 'Gas only',
    overwriteLevel2: 'Gas + Liquid',
    overwriteLevel3: 'Gas + Powder + Liquid',
    overwriteLevel4: 'Gas + Powder + Liquid + Solid',
    overwriteLevel5: 'Everything (incl. Wall)',
    overwriteMissing: '?',
  },

  // --- Simulation settings ---
  sim: {
    speed: 'Speed: ×{n}',
    speedDefaultHint: ' (default)',
    speedTooltip: 'Simulation speed ×{n}',
    speedGroup: 'Simulation speed',
    gravity: 'Gravity: {dir} · {strength}',
    gravityZero: 'Zero-G',
    gravityStrength: 'Strength {n}%',
    gravityDirGroup: 'Gravity direction',
    gravityStrengthAria: 'Gravity strength',
    gravityDirUp: 'Up',
    gravityDirLeft: 'Left',
    gravityDirRight: 'Right',
    gravityDirDown: 'Down',
    gravityDirTooltip: 'Gravity toward {dir}',
    gravityDirAria: 'Gravity {dir}',
  },

  // --- Render / overlay settings ---
  render: {
    heatmap: 'Heat overlay',
    heatmapOff: 'Normal',
    heatmapOn: 'Heatmap',
    heatmapGroup: 'Heat overlay',
    heatmapOffTooltip: 'Show with material colors',
    heatmapOnTooltip: 'Color by temperature like a thermal camera',
    heatmapNormalAria: 'Normal rendering',
    heatmapHeatAria: 'Heat overlay rendering',
    heatmapNormalTooltip: 'Normal rendering — show with material colors',
    heatmapHeatTooltip: 'Heat overlay — show like a thermal camera by temperature',
    smoke: 'Smoke',
    smokeHigh: 'High',
    smokeMedium: 'Medium',
    smokeOff: 'Off',
    smokeGroup: 'Smoke level',
    smokeHighTooltip: 'Combustion/explosion reactions emit a lot of smoke',
    smokeMediumTooltip: 'A moderate amount of smoke (default)',
    smokeOffTooltip: 'Reactions emit no smoke',
  },

  // --- Edge / world settings ---
  border: {
    label: 'Border',
    group: 'Border mode',
    wall: 'Wall',
    void: 'Void',
    wallTooltip: 'Border is a solid wall — particles cannot leave',
    voidTooltip: 'Border is void — particles that reach an edge fall out and vanish',
  },

  // --- Grid / resolution settings ---
  grid: {
    resolution: 'Resolution: {w}×{h}',
    resolutionHint: ' (cell size)',
    lowRes: 'Low res',
    highRes: 'High res',
    division: 'Grid: {label}',
    divisionOff: 'Off',
    divisionGroup: 'Grid line spacing',
    divisionTooltipOff: 'Do not show grid lines',
    divisionTooltipOn: 'Show a grid line every {n} cells',
    bottomDeadzone: 'Bottom dead zone: {n}px',
    bottomDeadzoneHint: ' (prevent bottom cutoff)',
    bottomDeadzoneAria: 'Bottom dead zone',
    bottomDeadzoneNote:
      'When a tablet/mobile browser covers the bottom of the screen with an address bar, raise this value to reserve empty space below the sandbox. (0 is recommended on PC.)',
  },

  // --- Brush detail settings ---
  brushDetails: {
    label: 'Brush detail settings',
    heatCool: 'Heat/Cool sensitivity',
    heatCoolAria: 'Open heat/cool sensitivity settings',
    heatCoolTooltip: 'Adjust the heat/cool brush sensitivity (absolute/relative)',
    blend: 'Blend brush config',
    blendAria: 'Open blend brush configuration',
    blendTooltip: 'Adjust the materials and ratios the blend brush paints',
  },

  // --- Modals ---
  modal: {
    settingsTitle: 'Settings',
    blendTitle: 'Blend brush ratios',
    blendHint:
      'Pick up to 3 materials and set their ratios, and the blend brush will paint them mixed in those proportions. Drag the boundaries of the bar to adjust the ratios.',
    heatCoolTitle: 'Heat/Cool brush settings',
    saveTitle: 'Save / Load',
  },

  // --- HUD ---
  hud: {
    grid: 'Grid {w}×{h}',
    particles: 'Particles {n}',
    particlesTooltip: 'Number of particles currently placed (excluding empty cells)',
    fill: 'Fill {n}%',
    fillTooltip: 'Share of grid cells occupied by particles',
    fps: '{n} FPS',
    fpsPeak: ' · peak {n}',
    fpsTooltip:
      "Adaptive-refresh displays (ProMotion/Adaptive Sync) lower the refresh rate when idle to save power. 'Peak' is the highest value observed this session.",
    frameMs: '{n} ms/frame',
    frameMsTooltip: 'Average time spent rendering a frame',
    simHz: 'Sim {n} Hz',
    simHzTooltip: 'Current simulation update rate (speed multiplier × base tick rate)',
    perfTooltip:
      'Phase 0 dev profiler (?perf): average time per tick, broken down by pass. Heat=heat diffusion, CA=material scan, Render=frame render.',
    perfHeat: 'Heat',
    perfCa: 'CA',
    perfObjects: 'Objects',
    perfDrift: 'Drift',
    perfRender: 'Render',
    perfTick: 'tick',
  },

  // --- Reset ---
  reset: {
    button: 'Reset settings to defaults',
    buttonArmed: 'Reset to defaults?',
    aria: 'Reset all settings to defaults',
    ariaArmed: 'Confirm reset to defaults',
    tooltip: 'Reset every setting to its default (world and favorites are kept)',
  },

  // --- Hints ---
  hint: {
    draw: 'Drag on the canvas to paint a material. Right-click or use the erase brush to erase.',
  },

  // --- Material palette ---
  palette: {
    searchPlaceholder: 'Search materials…',
    searchAria: 'Search materials',
    searchClear: 'Clear search',
    searchClearTooltip: 'Clear search',
    noResults: 'No matching materials',
    resultsGroup: 'Search results',
    quickGroup: 'Favorites · Recent',
    objectKey: 'Objects',
    favAdd: 'Add {name} to favorites',
    favRemove: 'Remove {name} from favorites',
    favAddTooltip: 'Add to favorites',
    favRemoveTooltip: 'Remove from favorites',
  },

  // --- Material picker (blend editor) ---
  picker: {
    categoryMaterials: '{label} materials',
    categories: 'Material categories',
    back: 'Back to categories',
    backAria: 'Back to categories',
    missing: '?',
    slotLabel: 'Material {n}',
  },

  // --- Blend brush editor ---
  blend: {
    dividerAria: 'Adjust ratio between {a} and {b}',
    dividerTooltip: 'Drag to adjust the ratio',
    remove: 'Remove this material',
    removeTooltip: 'Remove',
    add: 'Add material',
  },

  // --- Inspect panel ---
  inspect: {
    brushInfo: 'Brush info',
    areaInfo: 'Area info',
    emptyArea: 'Drag to select an area to see its info',
    emptySpace: 'Empty space · {n} cells',
    particles: 'Particles {occupied} / {total} cells · {pct}%',
    particlesTooltip: 'Cells filled by particles in the brush area / total cells',
    avgTemp: 'Avg {n}°C',
    avgTempTooltip: 'Average temperature of cells with particles (excluding walls)',
    overlap: 'Overlap {n} cells',
    overlapTooltip: 'Cells soaked by a liquid (overlap) — e.g. wet sand',
    materialAvgTempTooltip: '{name} average temperature',
    noTempTooltip: 'No temperature (wall, etc.)',
    more: '+{n} more',
  },

  // --- Heat/Cool settings ---
  heatCool: {
    mode: 'Reference mode',
    modeGroup: 'Heat/Cool sensitivity reference mode',
    absolute: 'Absolute',
    relative: 'Relative',
    absoluteTooltip: 'Raise or lower the temperature by a fixed number of degrees (°)',
    relativeTooltip:
      'Raise or lower as a percentage (%) proportional to the current temperature magnitude (heating always goes up / cooling always goes down, even below zero)',
    sensitivityAbs: 'Sensitivity: {n}°/s',
    sensitivityRel: 'Sensitivity: {n}%/s',
    hint: 'Values are the amount changed when held for 1 second at speed ×1 (absolute in degrees, relative as a percent of the current temperature magnitude). Raising the speed scales the per-second rate while the brush is held. Confirming via Area select applies this same 1-second value in one shot, regardless of the current speed. The cool brush uses the same sensitivity in the opposite direction. Relative mode moves proportionally to the temperature magnitude (absolute value) so the direction never flips below zero; a target at exactly 0° cannot be moved by relative mode (absolute always works).',
  },

  // --- Save slots ---
  save: {
    namePlaceholder: 'Save name (blank for auto)',
    descPlaceholder: 'Description (optional)',
    saveAria: 'Save the current canvas',
    save: 'Save',
    limitExceeded: 'Save limit (50) exceeded — delete an existing snapshot',
    saveFailed: 'Save failed (storage is full)',
    saved: '"{name}" saved',
    loadOk: 'Load complete',
    loadFailed: 'Load failed',
    loadTooltip: 'Load',
    renameTooltip: 'Edit name / description',
    deleteTooltip: 'Delete',
    deleteConfirm: 'Delete "{name}"?',
    deleted: '"{name}" deleted',
    renameFailed: 'Save failed (storage is full)',
    loadAria: 'Load "{name}"',
    renameAria: 'Edit "{name}"',
    deleteAria: 'Delete "{name}"',
    viewToggleGroup: 'Snapshot view mode',
    galleryTooltip: 'Gallery view',
    listTooltip: 'List view',
    empty: 'No saved snapshots. Save the current sandbox state, or import a file.',
    hint: 'Saved snapshots are kept locally in the browser. Loading opens a preview where you choose how a differently-sized scene lands on the current canvas.',

    // --- File export / import ---
    exportTooltip: 'Export to a file',
    exportAria: 'Export "{name}" to a file',
    exported: '"{name}" exported',
    exportFailed: 'Export failed',
    import: 'Import file',
    importTooltip: 'Add a .psbx.json snapshot file to the list (the canvas is not touched)',
    imported: '"{name}" added to the list',
    importInvalid: 'Not a snapshot file (or it is corrupt)',
    importTooBig: 'File is too large',
    importReadFailed: 'Could not read the file',
    importLimit: 'Save limit (50) exceeded — delete an existing snapshot',
    importFailed: 'Import failed (storage is full)',
  },

  // --- Snapshot load options (preview modal) ---
  load: {
    title: 'Load options',
    previewAria: 'Preview — drag, or use the arrow keys, to move the scene',
    modeGroup: 'How the snapshot is fitted',
    mode: {
      auto: 'Auto fit',
      autoTooltip:
        'Scale the scene up or down to fit, keeping its aspect ratio. Nothing is cut off; leftover area stays empty.',
      manual: 'Manual',
      manualTooltip:
        'Set the scale yourself and drag the scene where you want it. Anything past the canvas edge is cut off.',
      simple: 'Original size',
      simpleTooltip:
        'No scaling. Whatever overflows the canvas is cut off, and wherever the scene falls short the difference stays empty.',
    },
    scale: 'Scale',
    scaleX: 'Width',
    scaleY: 'Height',
    linkAxes: 'Keep aspect ratio',
    presetAuto: 'Fit',
    presetOriginal: 'Original',
    presetFill: 'Fill',
    manualHint:
      'Drag the preview to move the scene (arrow keys nudge it; hold Shift for 10 cells at a time). Heavy downscaling merges cells, so thin structures such as a 1-cell wire can break.',
    cancel: 'Cancel',
    confirm: 'Load',
  },

  // --- Language selector ---
  language: {
    label: 'Language',
    group: 'Language',
    korean: '한국어',
    english: 'English',
    tooltip: 'Switch the interface language',
  },

  // --- 404 page ---
  notFound: {
    title: '404 · Particle Sandbox',
    heading: '404',
    message: 'Page not found.',
    link: 'Back to the sandbox',
  },

  // --- Material codex (/guide) ---
  // The prose lives elsewhere — descriptions in codex.en.ts, tag names and
  // explanations in codexTerms.ts. This is only the page's own furniture.
  codex: {
    title: 'Material Codex',
    search: 'Search materials',
    searchClear: 'Clear search',
    all: 'All',
    objects: 'Objects',
    empty: 'Nothing matched.',
    emptyHint: 'Try another name, or clear a filter.',
    count: '{n}',
    phaseFilter: 'State',
    tagFilter: 'Tags',
    tagFilterHint: 'Only materials with every selected tag are kept.',
    filterReset: 'Reset filters',
    copy: 'Copy as Markdown',
    copyList: 'Copy list as Markdown',
    copied: 'Copied',
    copyFailed: "Couldn't copy",
    // Headings of the tag filter panel. Keys are the group keys in
    // game/codex/tags.ts.
    tagGroup: {
      electric: 'Electricity',
      light: 'Light & heat',
      fire: 'Fire',
      acid: 'Acid',
      radiation: 'Radiation',
      blast: 'Blast & destruction',
      mix: 'Mixing',
      overlap: 'Soaking',
      body: 'Object motion',
    },
    // Only used by the Markdown export — table headers and its context line.
    md: {
      name: 'Material',
      category: 'Category',
      phase: 'State',
      item: 'Property',
      value: 'Value',
      filters: 'Filters',
      search: 'Search',
      shown: '{n} of {total}',
    },
    statsHeading: 'Numbers',
    traitsHeading: 'Traits',
    reactionsHeading: 'Reactions',
    nothing: 'nothing',
    detail: 'View details',
    close: 'Close',
    toSandbox: 'Open the sandbox',
    toHome: 'Back to the start page',
    objectNote: 'Objects are rigid bodies that roll around above the grid rather than living in it.',
    unit: { temp: '°C', cells: ' cells', ticks: ' ticks' },
    reaction: {
      unchanged: 'unchanged',
      byproduct: 'by-product',
      catalyst: 'catalyst',
      chance: '{v} chance',
      tempMin: '{v}°C and up',
      tempMax: '{v}°C and below',
      exo: 'exothermic +{v}°C',
      endo: 'endothermic {v}°C',
    },
  },
} as const;
