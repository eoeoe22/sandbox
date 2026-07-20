<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    $running as running,
    $simSpeed as simSpeed,
    $brushSize as brushSize,
    $brushShape as brushShape,
    $brushMode as brushMode,
    $overwriteLevel as overwriteLevel,
    $tool as tool,
    $areaSelect as areaSelect,
    $inspect as inspect,
    $selectedMaterial as selectedMaterial,
    $selectedObject as selectedObject,
    $cloneTarget as cloneTarget,
    OBJECT_LABELS,
    $fps as fps,
    $fpsPeak as fpsPeak,
    $gridDims as gridDims,
    $borderMode as borderMode,
    $smokeLevel as smokeLevel,
    $gravityDir as gravityDir,
    $gravityStrength as gravityStrength,
    $cellScale as cellScale,
    $heatOverlay as heatOverlay,
    $gridDivision as gridDivision,
    $bottomDeadzone as bottomDeadzone,
    $sidebarPosition as sidebarPosition,
    $particleCount as particleCount,
    $frameMs as frameMs,
    $perfPasses as perfPasses,
    requestClear,
    requestStep,
    resetSettings,
  } from '../state/store';
  import {
    BRUSH_MIN,
    BRUSH_MAX,
    OVERWRITE_LEVELS,
    OVERWRITE_LEVEL_MIN,
    OVERWRITE_LEVEL_MAX,
    OVERWRITE_AUTO,
    SIM_SPEEDS,
    TICK_HZ,
    GRAVITY_STRENGTH_MIN,
    GRAVITY_STRENGTH_MAX,
    GRAVITY_STRENGTH_STEP,
    CELL_SCALES,
    GRID_DIVISIONS,
    BOTTOM_DEADZONE_MIN,
    BOTTOM_DEADZONE_MAX,
    BOTTOM_DEADZONE_STEP,
  } from '../game/config';
  import type { GravityDir } from '../game/config';
  import { getMaterial, CLONE } from '../game/materials';
  import MaterialPalette from './MaterialPalette.svelte';
  import BlendBrush from './BlendBrush.svelte';
  import HeatCoolSettings from './HeatCoolSettings.svelte';
  import InspectPanel from './InspectPanel.svelte';
  import Modal from './Modal.svelte';
  import SaveSlots from './SaveSlots.svelte';

  // Name shown on the 재료 (draw) brush button, so the active brush target is
  // always visible without opening the palette. While the 'object' tool is
  // active this is the selected free object's name (오브젝트 선택 시 오브젝트
  // 이름 표시), not a material — the object layer has no material id of its own.
  // A Clone pre-latched via the palette's 더블클릭 shortcut ($cloneTarget) shows
  // "물질이름(Clone)" instead of plain "Clone", so the button still reads as
  // "what will this paint" rather than just naming the carrier material.
  const selectedName = $derived.by(() => {
    if ($tool === 'object') return OBJECT_LABELS[$selectedObject];
    const mat = getMaterial($selectedMaterial);
    if (!mat) return '재료';
    if (mat.id === CLONE.id && $cloneTarget !== null) {
      const target = getMaterial($cloneTarget);
      if (target) return `${target.name}(Clone)`;
    }
    return mat.name;
  });

  // Modals, opened from the toolbar. The 설정 modal holds the settings that
  // are set once and left alone (plus, on mobile, the frequently-tweaked ones,
  // which live inline in the sidebar on desktop). The 혼합 브러시 modal holds the
  // blend-ratio editor, opened only by double-clicking the 혼합 button (or from
  // 설정) — a single click just selects the tool, like every other brush
  // button, so picking 혼합 to paint with doesn't force the editor open every
  // time. The 가열/냉각 감도 modal holds the heat/cool sensitivity editor, same
  // double-click pattern. The 저장 modal manages named world snapshots
  // (save/load/rename/delete).
  let settingsOpen = $state(false);
  let blendOpen = $state(false);
  let heatCoolOpen = $state(false);
  let saveSlotsOpen = $state(false);
  let saveSlotsPanel: SaveSlots | null = null;

  // Open the snapshot (save/load) modal. Tell the panel to re-read its list so
  // a freshly-opened modal reflects the current localStorage state.
  function openSaveSlots(): void {
    saveSlotsOpen = true;
    saveSlotsPanel?.open();
  }

  // Entry points from inside 설정 into the 가열/냉각·혼합 dedicated modals
  // ("브러시 세부 설정"). Closing 설정 and opening the target modal in the same
  // synchronous handler would race Modal's open/close focus effects (both
  // modals' `$effect`s run off the same batched update, so the one opening
  // could capture `document.activeElement` before the one closing has restored
  // it) — `await tick()` between the two lets 설정's close effect finish first,
  // so the newly-opened modal reliably captures a settled focus target instead.
  async function openHeatCoolFromSettings(): Promise<void> {
    settingsOpen = false;
    await tick();
    heatCoolOpen = true;
  }
  async function openBlendFromSettings(): Promise<void> {
    settingsOpen = false;
    await tick();
    blendOpen = true;
  }

  // 전체 지우기 is destructive, so it's a two-step confirm: the first click arms
  // the button (its label switches to a confirm prompt for 2s); a second click
  // within that window clears the world, otherwise it quietly disarms.
  let clearArmed = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  function handleClear(): void {
    if (clearArmed) {
      clearTimeout(clearTimer);
      clearArmed = false;
      requestClear();
      return;
    }
    clearArmed = true;
    clearTimer = setTimeout(() => {
      clearArmed = false;
    }, 2000);
  }

  // 기본값 복원 is also a two-step confirm (it resets every setting at once), the
  // same arm-then-confirm pattern as 전체 지우기. It never touches the world or
  // the user's favorites — only the sliders/toggles in the settings modal.
  let resetArmed = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  function handleReset(): void {
    if (resetArmed) {
      clearTimeout(resetTimer);
      resetArmed = false;
      resetSettings();
      return;
    }
    resetArmed = true;
    resetTimer = setTimeout(() => {
      resetArmed = false;
    }, 2000);
  }

  // Gravity direction buttons: an arrow icon + label per direction, laid out to
  // read like a D-pad (up on top, left/right in the middle, down on the bottom).
  const GRAVITY_DIRS_META: { dir: GravityDir; icon: string; label: string }[] = [
    { dir: 'up', icon: 'bi-arrow-up', label: '위' },
    { dir: 'left', icon: 'bi-arrow-left', label: '왼쪽' },
    { dir: 'right', icon: 'bi-arrow-right', label: '오른쪽' },
    { dir: 'down', icon: 'bi-arrow-down', label: '아래' },
  ];
  const gravityPct = $derived(Math.round($gravityStrength * 100));

  // Resolution slider works on the index into CELL_SCALES (coarse→fine); the
  // slider position maps directly to a scale value.
  const cellScaleIndex = $derived(Math.max(0, CELL_SCALES.indexOf($cellScale)));
  function setCellScaleFromIndex(i: number): void {
    const scale = CELL_SCALES[Math.min(CELL_SCALES.length - 1, Math.max(0, i))];
    if (scale !== undefined) cellScale.set(scale);
  }

  // 덮어쓰기 slider spans AUTO (-1) and the 0..MAX manual levels. AUTO derives
  // its effective level from the selected material, so its label is annotated.
  const overwriteLabel = $derived(
    $overwriteLevel === OVERWRITE_AUTO
      ? `자동 (${getMaterial($selectedMaterial)?.name ?? '?'})`
      : OVERWRITE_LEVELS[$overwriteLevel],
  );

  // Expanded HUD readouts.
  const fillPct = $derived.by(() => {
    const total = $gridDims.w * $gridDims.h;
    return total > 0 ? Math.round(($particleCount / total) * 1000) / 10 : 0;
  });
  // Actual step rate: the loop's interval is 2000/(TICK_HZ*mult) ms, i.e.
  // TICK_HZ*mult/2 Hz — so ×1 is 30 Hz (half of TICK_HZ), ×2 is 60, ×4 is 120.
  const simHz = $derived(Math.round((TICK_HZ * $simSpeed) / 2));
  const gridLabel = $derived($gridDivision === 0 ? '끔' : `${$gridDivision}`);

  // Phase 0 per-pass breakdown (dev only; non-null only under `?perf`). Each
  // value is ms per sim tick, except render which is ms per frame. See
  // game/engine/profiler.ts and docs/PERFORMANCE.md.
  const perfLine = $derived.by(() => {
    const p = $perfPasses;
    if (!p) return null;
    const f = (v: number): string => v.toFixed(3);
    const sim = p.ms.heat + p.ms.ca + p.ms.objects + p.ms.drift;
    return (
      `열 ${f(p.ms.heat)} · CA ${f(p.ms.ca)} · 오브젝트 ${f(p.ms.objects)} · ` +
      `드리프트 ${f(p.ms.drift)} · 렌더 ${f(p.ms.render)} (틱 ${f(sim)} ms/tick)`
    );
  });

  onDestroy(() => {
    clearTimeout(clearTimer);
    clearTimeout(resetTimer);
    clearTimeout(areaPopoverTimer);
  });

  // 영역 선택 is a per-cell/rect action with no meaning for the object layer (a
  // spawn is a point action — see PointerPainter.applyRect's 'object' no-op), so
  // attempting to turn it on while the 'object' tool is active is refused with a
  // brief popover instead of silently doing nothing. Turning 영역 select back
  // *off* is always allowed, regardless of tool.
  let areaPopoverOpen = $state(false);
  let areaBtn: HTMLButtonElement | null = null;
  let areaPopoverPos = $state<{ top: number; left: number } | null>(null);
  let areaPopoverTimer: ReturnType<typeof setTimeout> | undefined;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function showAreaBlockedPopover(): void {
    clearTimeout(areaPopoverTimer);
    if (areaBtn) {
      const r = areaBtn.getBoundingClientRect();
      areaPopoverPos = { top: r.top, left: r.left + r.width / 2 };
    }
    areaPopoverOpen = true;
    areaPopoverTimer = setTimeout(() => {
      areaPopoverOpen = false;
    }, 2600);
  }

  function handleAreaSelectClick(): void {
    if (!areaSelect.get() && tool.get() === 'object') {
      showAreaBlockedPopover();
      return;
    }
    areaPopoverOpen = false;
    areaSelect.set(!areaSelect.get());
  }

  // Synchronize sidebarPosition with body class at runtime
  $effect(() => {
    const pos = $sidebarPosition;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('sidebar-left', 'sidebar-right');
      document.body.classList.add(`sidebar-${pos}`);
    }
  });

  // PC Sidebar accordion section states
  let showToolSection = $state(true);
  let showSimSection = $state(true);
  let showSettingSection = $state(false);

  // Mobile popup menu toggle
  let mobileToolsOpen = $state(false);

  // Special brushes definitions
  const SPECIAL_TOOLS = [
    { id: 'blend', name: '혼합', icon: 'bi-palette-fill', title: '혼합 브러시 (더블클릭 비율 설정)', dblClick: () => (blendOpen = true) },
    { id: 'heat', name: '가열', icon: 'bi-fire', title: '가열 브러시 (더블클릭 감도 설정)', dblClick: () => { tool.set('heat'); heatCoolOpen = true; } },
    { id: 'cool', name: '냉각', icon: 'bi-snow', title: '냉각 브러시 (더블클릭 감도 설정)', dblClick: () => { tool.set('cool'); heatCoolOpen = true; } },
    { id: 'mix', name: '섞기', icon: 'bi-tornado', title: '섞기 브러시' },
    { id: 'erase', name: '지우개', icon: 'bi-eraser-fill', title: '지우개 브러시' },
    { id: 'view', name: '보기', icon: 'bi-eye', title: '보기 모드' },
  ] as const;

  const activeSpecialTool = $derived(SPECIAL_TOOLS.find(t => t.id === $tool));

  function selectSpecialTool(id: typeof SPECIAL_TOOLS[number]['id']) {
    tool.set(id);
    mobileToolsOpen = false;
  }
</script>

<!-- Frequently-tweaked settings. Shown inline in the sidebar on desktop and
     inside the 설정 modal on mobile (rendered in both spots; CSS shows the right
     one for the viewport — see .inline-settings / .modal-frequent). -->
{#snippet frequentSettings()}
  <label class="field">
    <span class="field-label">
      브러시 크기: {$brushSize}<span class="wheel-hint"> (휠로 조절)</span>
    </span>
    <input
      type="range"
      min={BRUSH_MIN}
      max={BRUSH_MAX}
      value={$brushSize}
      oninput={(e) => brushSize.set(+e.currentTarget.value)}
    />
  </label>

  <div class="field">
    <span class="field-label">브러시 모양</span>
    <div class="seg" role="group" aria-label="브러시 모양">
      <button
        class="ctl"
        class:active={$brushShape === 'circle'}
        onclick={() => brushShape.set('circle')}
        aria-pressed={$brushShape === 'circle'}
        title="원형 브러시"
      >
        <i class="bi bi-circle-fill" aria-hidden="true"></i>
        <span class="label">원형</span>
      </button>
      <button
        class="ctl"
        class:active={$brushShape === 'square'}
        onclick={() => brushShape.set('square')}
        aria-pressed={$brushShape === 'square'}
        title="사각형 브러시"
      >
        <i class="bi bi-square-fill" aria-hidden="true"></i>
        <span class="label">사각형</span>
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">채우기</span>
    <div class="seg" role="group" aria-label="브러시 채우기 방식">
      <button
        class="ctl"
        class:active={$brushMode === 'full'}
        onclick={() => brushMode.set('full')}
        aria-pressed={$brushMode === 'full'}
        title="브러시 영역을 빈틈없이 채웁니다"
      >
        <i class="bi bi-grid-fill" aria-hidden="true"></i>
        <span class="label">Full</span>
      </button>
      <button
        class="ctl"
        class:active={$brushMode === 'particle'}
        onclick={() => brushMode.set('particle')}
        aria-pressed={$brushMode === 'particle'}
        title="브러시 영역에 무작위로 빈틈을 남깁니다 (고체는 항상 Full)"
      >
        <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
        <span class="label">Particle</span>
      </button>
    </div>
  </div>

  <label class="field">
    <span class="field-label">덮어쓰기: {overwriteLabel}</span>
    <input
      type="range"
      min={OVERWRITE_AUTO}
      max={OVERWRITE_LEVEL_MAX}
      step="1"
      value={$overwriteLevel}
      oninput={(e) => overwriteLevel.set(+e.currentTarget.value)}
    />
    <div class="overwrite-steps" aria-hidden="true">
      <span class="step auto" class:filled={$overwriteLevel === OVERWRITE_AUTO} title="자동"></span>
      {#each OVERWRITE_LEVELS as _, i}
        <span class="step" class:filled={$overwriteLevel >= i}></span>
      {/each}
    </div>
  </label>

  <div class="field">
    <span class="field-label">
      속도: ×{$simSpeed}{#if $simSpeed === 1}<span class="wheel-hint"> (기본)</span>{/if}
    </span>
    <div class="seg speed-seg" role="group" aria-label="시뮬레이션 속도">
      {#each SIM_SPEEDS as sp (sp)}
        <button
          class="ctl"
          class:active={$simSpeed === sp}
          onclick={() => simSpeed.set(sp)}
          aria-pressed={$simSpeed === sp}
          title={`시뮬레이션 속도 ×${sp}`}
        >
          ×{sp}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    <span class="field-label">
      중력: {GRAVITY_DIRS_META.find((g) => g.dir === $gravityDir)?.label}
      · {gravityPct === 0 ? '무중력' : `세기 ${gravityPct}%`}
    </span>
    <div class="gravity-pad" role="group" aria-label="중력 방향">
      {#each GRAVITY_DIRS_META as g (g.dir)}
        <button
          class={`ctl grav-${g.dir}`}
          class:active={$gravityDir === g.dir}
          onclick={() => gravityDir.set(g.dir)}
          aria-pressed={$gravityDir === g.dir}
          aria-label={`중력 ${g.label}`}
          title={`중력을 ${g.label}쪽으로`}
        >
          <i class={`bi ${g.icon}`} aria-hidden="true"></i>
        </button>
      {/each}
    </div>
    <input
      type="range"
      aria-label="중력 세기"
      min={GRAVITY_STRENGTH_MIN}
      max={GRAVITY_STRENGTH_MAX}
      step={GRAVITY_STRENGTH_STEP}
      value={$gravityStrength}
      oninput={(e) => gravityStrength.set(+e.currentTarget.value)}
    />
  </div>

  <!-- Temperature heat-map render mode. On desktop this is driven by the
       eye/thermometer icons in the header, so the inline copy is hidden there
       (.heat-field) and this control only surfaces in the mobile settings modal. -->
  <div class="field heat-field">
    <span class="field-label">온도 열지도</span>
    <div class="seg" role="group" aria-label="온도 열지도 오버레이">
      <button
        class="ctl"
        class:active={!$heatOverlay}
        onclick={() => heatOverlay.set(false)}
        aria-pressed={!$heatOverlay}
        title="일반 물질 색으로 표시합니다"
      >
        <i class="bi bi-palette" aria-hidden="true"></i>
        <span class="label">일반</span>
      </button>
      <button
        class="ctl"
        class:active={$heatOverlay}
        onclick={() => heatOverlay.set(true)}
        aria-pressed={$heatOverlay}
        title="온도에 따라 색을 입혀 열화상처럼 표시합니다"
      >
        <i class="bi bi-thermometer-half" aria-hidden="true"></i>
        <span class="label">열지도</span>
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">연기</span>
    <div class="seg" role="group" aria-label="연기 세기">
      <button
        class="ctl"
        class:active={$smokeLevel === 'high'}
        onclick={() => smokeLevel.set('high')}
        aria-pressed={$smokeLevel === 'high'}
        title="연소·폭발 반응이 연기를 많이 냅니다"
      >
        <i class="bi bi-cloud-fog2" aria-hidden="true"></i>
        <span class="label">상</span>
      </button>
      <button
        class="ctl"
        class:active={$smokeLevel === 'medium'}
        onclick={() => smokeLevel.set('medium')}
        aria-pressed={$smokeLevel === 'medium'}
        title="연기를 적당히 냅니다 (기본값)"
      >
        <i class="bi bi-cloud" aria-hidden="true"></i>
        <span class="label">중</span>
      </button>
      <button
        class="ctl"
        class:active={$smokeLevel === 'off'}
        onclick={() => smokeLevel.set('off')}
        aria-pressed={$smokeLevel === 'off'}
        title="반응에서 연기를 내지 않습니다"
      >
        <i class="bi bi-cloud-slash" aria-hidden="true"></i>
        <span class="label">끔</span>
      </button>
    </div>
  </div>
{/snippet}

<!-- Set-once settings: tucked in the 설정 modal on every viewport so they don't
     crowd the常用 controls. -->
{#snippet fixedSettings()}
  <div class="field">
    <span class="field-label">테두리</span>
    <div class="seg" role="group" aria-label="테두리 모드">
      <button
        class="ctl"
        class:active={$borderMode === 'wall'}
        onclick={() => borderMode.set('wall')}
        aria-pressed={$borderMode === 'wall'}
        title="테두리가 단단한 벽 — 파티클이 밖으로 나가지 못합니다"
      >
        <i class="bi bi-bricks" aria-hidden="true"></i>
        <span class="label">벽</span>
      </button>
      <button
        class="ctl"
        class:active={$borderMode === 'void'}
        onclick={() => borderMode.set('void')}
        aria-pressed={$borderMode === 'void'}
        title="테두리가 공허 — 가장자리에 닿은 파티클은 밖으로 떨어져 사라집니다"
      >
        <i class="bi bi-dash-square-dotted" aria-hidden="true"></i>
        <span class="label">공허</span>
      </button>
    </div>
  </div>

  <label class="field">
    <span class="field-label">
      해상도: {$gridDims.w}×{$gridDims.h}
      <span class="wheel-hint"> (셀 크기)</span>
    </span>
    <input
      type="range"
      min="0"
      max={CELL_SCALES.length - 1}
      step="1"
      value={cellScaleIndex}
      oninput={(e) => setCellScaleFromIndex(+e.currentTarget.value)}
    />
    <div class="range-ends" aria-hidden="true">
      <span>저해상도</span>
      <span>고해상도</span>
    </div>
  </label>

  <div class="field">
    <span class="field-label">격자 표시: {gridLabel}</span>
    <div class="seg grid-seg" role="group" aria-label="격자 표시 간격">
      {#each GRID_DIVISIONS as gd (gd)}
        <button
          class="ctl"
          class:active={$gridDivision === gd}
          onclick={() => gridDivision.set(gd)}
          aria-pressed={$gridDivision === gd}
          title={gd === 0 ? '격자선을 표시하지 않습니다' : `${gd}칸마다 격자선을 표시합니다`}
        >
          {gd === 0 ? '끔' : gd}
        </button>
      {/each}
    </div>
  </div>

  <label class="field">
    <span class="field-label">
      아래 데드존: {$bottomDeadzone}px
      <span class="wheel-hint"> (화면 아래 가림 방지)</span>
    </span>
    <input
      type="range"
      aria-label="아래 데드존"
      min={BOTTOM_DEADZONE_MIN}
      max={BOTTOM_DEADZONE_MAX}
      step={BOTTOM_DEADZONE_STEP}
      value={$bottomDeadzone}
      oninput={(e) => bottomDeadzone.set(+e.currentTarget.value)}
    />
    <p class="field-note">
      태블릿·모바일 브라우저에서 화면 아래가 주소창 등에 가릴 때, 이 값을 올려 샌드박스
      아래에 빈 공간을 확보합니다. (PC는 0 권장)
    </p>
  </label>

  <div class="field">
    <span class="field-label">브러시 세부 설정</span>
    <div class="settings-links">
      <button
        class="ctl"
        onclick={openHeatCoolFromSettings}
        aria-label="가열/냉각 감도 설정 열기"
        title="가열/냉각 브러시의 감도(절대온도/상대온도)를 조절합니다"
      >
        <i class="bi bi-thermometer-half" aria-hidden="true"></i>
        <span class="label">가열/냉각 감도</span>
      </button>
      <button
        class="ctl"
        onclick={openBlendFromSettings}
        aria-label="혼합 브러시 구성 열기"
        title="혼합 브러시가 섞을 물질과 비율을 조절합니다"
      >
        <i class="bi bi-palette-fill" aria-hidden="true"></i>
        <span class="label">혼합 브러시 구성</span>
      </button>
    </div>
  </div>
{/snippet}

<aside class="panel">
  <!-- ============================================== -->
  <!-- PC 전용 레이아웃 (데스크톱 화면용) -->
  <!-- ============================================== -->
  <div class="pc-layout">
    <div class="head">
      <i class="bi bi-boxes" aria-hidden="true"></i>
      <h1>Particle Sandbox</h1>

      <div class="head-actions">
        <button
          class="head-btn"
          class:active={!$heatOverlay}
          onclick={() => heatOverlay.set(false)}
          aria-pressed={!$heatOverlay}
          aria-label="일반 렌더링"
          title="일반 렌더링 — 물질 색으로 표시"
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
        <button
          class="head-btn"
          class:active={$heatOverlay}
          onclick={() => heatOverlay.set(true)}
          aria-pressed={$heatOverlay}
          aria-label="열지도 렌더링"
          title="열지도 렌더링 — 온도에 따라 열화상처럼 표시"
        >
          <i class="bi bi-thermometer-half" aria-hidden="true"></i>
        </button>
        <button
          class="head-btn"
          onclick={() => sidebarPosition.set($sidebarPosition === 'left' ? 'right' : 'left')}
          aria-label="사이드바 위치 전환"
          title={$sidebarPosition === 'left' ? '오른쪽에 도킹 (오른손잡이 마우스 동선 단축)' : '왼쪽에 도킹'}
        >
          <i class={`bi ${$sidebarPosition === 'left' ? 'bi-layout-sidebar-reverse' : 'bi-layout-sidebar'}`} aria-hidden="true"></i>
        </button>
        <button
          class="head-btn"
          onclick={() => (settingsOpen = true)}
          aria-label="설정"
          title="설정"
        >
          <i class="bi bi-sliders2" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- PC 아코디언 1: 도구 및 팔레트 -->
    <div class="accordion-section">
      <button class="accordion-trigger" onclick={() => showToolSection = !showToolSection} aria-expanded={showToolSection}>
        <span class="trigger-title"><i class="bi bi-tools"></i> 도구 및 팔레트</span>
        <i class={`bi ${showToolSection ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
      </button>
      
      {#if showToolSection}
        <div class="accordion-content">
          <div class="bar">
            <div class="bar-row primary">
              <div class="group mode-group" role="group" aria-label="그리기 방식">
                <button
                  class="ctl material-btn"
                  class:active={$tool === 'material'}
                  onclick={() => tool.set('material')}
                  aria-pressed={$tool === 'material'}
                  aria-label={`재료: ${selectedName}`}
                  title={`선택한 재료를 그립니다: ${selectedName}`}
                >
                  <i class="bi bi-brush" aria-hidden="true"></i>
                  <span class="label material-name">{selectedName}</span>
                </button>
                <button
                  class="ctl"
                  class:active={$areaSelect}
                  onclick={handleAreaSelectClick}
                  bind:this={areaBtn}
                  aria-pressed={$areaSelect}
                  aria-label="영역 선택"
                  title="영역 선택 — 사각형으로 드래그해 영역 지정 후 그 시점에 고른 도구를 한 번에 적용합니다 (PC: Enter로 확정, Escape로 취소)."
                >
                  <i class="bi bi-bounding-box" aria-hidden="true"></i>
                  <span class="label">영역</span>
                </button>
              </div>

              <div class="group" role="group" aria-label="특수 브러시">
                {#each SPECIAL_TOOLS as t}
                  <button
                    class="ctl"
                    class:active={$tool === t.id}
                    onclick={() => tool.set(t.id)}
                    ondblclick={t.dblClick}
                    aria-pressed={$tool === t.id}
                    title={t.title}
                  >
                    <i class={`bi ${t.icon}`} aria-hidden="true"></i>
                    <span class="label">{t.name}</span>
                  </button>
                {/each}
              </div>

              <div class="group" role="group" aria-label="관찰 도구">
                <button
                  class="ctl"
                  class:active={$inspect}
                  onclick={() => inspect.set(!$inspect)}
                  aria-pressed={$inspect}
                  aria-label="돋보기"
                  title="돋보기 — 브러시 영역의 파티클 종류·개수·비율·평균온도를 표시합니다 (그리기와 별도로 동작)"
                >
                  <i class="bi bi-search" aria-hidden="true"></i>
                  <span class="label">돋보기</span>
                </button>
              </div>
            </div>

            <div class="bar-row palette-row">
              <MaterialPalette />
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- PC 아코디언 2: 시뮬레이션 제어 -->
    <div class="accordion-section">
      <button class="accordion-trigger" onclick={() => showSimSection = !showSimSection} aria-expanded={showSimSection}>
        <span class="trigger-title"><i class="bi bi-play-circle"></i> 시뮬레이션 제어</span>
        <i class={`bi ${showSimSection ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
      </button>

      {#if showSimSection}
        <div class="accordion-content">
          <div class="group" role="group" aria-label="재생 제어">
            <button
              class="ctl"
              onclick={() => running.set(!$running)}
              aria-label={$running ? '일시정지' : '재생'}
              title={$running ? '일시정지' : '재생'}
            >
              <i class={`bi ${$running ? 'bi-pause-fill' : 'bi-play-fill'}`} aria-hidden="true"></i>
              <span class="label">{$running ? '일시정지' : '재생'}</span>
            </button>
            <button
              class="ctl"
              onclick={requestStep}
              disabled={$running}
              aria-label="한 스텝 진행"
              title="한 스텝 진행 (일시정지 중)"
            >
              <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
              <span class="label">스텝</span>
            </button>
            <button
              class="ctl clear-btn"
              class:armed={clearArmed}
              onclick={handleClear}
              aria-label={clearArmed ? '전체 지우기 확인' : '전체 지우기'}
              title="전체 지우기"
            >
              <i class="bi bi-trash3" aria-hidden="true"></i>
              <span class="label">{clearArmed ? '계속하시겠습니까?' : '지우기'}</span>
            </button>
            <button
              class="ctl"
              onclick={openSaveSlots}
              aria-label="저장 / 불러오기"
              title="현재 샌드박스를 저장하거나 불러옵니다"
            >
              <i class="bi bi-collection" aria-hidden="true"></i>
              <span class="label">저장</span>
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- PC 아코디언 3: 환경 설정 -->
    <div class="accordion-section">
      <button class="accordion-trigger" onclick={() => showSettingSection = !showSettingSection} aria-expanded={showSettingSection}>
        <span class="trigger-title"><i class="bi bi-sliders"></i> 빠른 환경 설정</span>
        <i class={`bi ${showSettingSection ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
      </button>

      {#if showSettingSection}
        <div class="accordion-content">
          <div class="inline-settings">
            {@render frequentSettings()}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- ============================================== -->
  <!-- 모바일 전용 레이아웃 (하단바) -->
  <!-- ============================================== -->
  <div class="mobile-layout">
    <div class="bar">
      <!-- Row 1: 주요 컨트롤 단축 뷰 (가로 스크롤 완전 해결) -->
      <div class="bar-row primary mobile-primary-row">
        <!-- 재생/정지 -->
        <button
          class="ctl mobile-ctl"
          onclick={() => running.set(!$running)}
          aria-label={$running ? '일시정지' : '재생'}
          title={$running ? '일시정지' : '재생'}
        >
          <i class={`bi ${$running ? 'bi-pause-fill' : 'bi-play-fill'}`} aria-hidden="true"></i>
        </button>

        <!-- 1스텝 -->
        <button
          class="ctl mobile-ctl"
          onclick={requestStep}
          disabled={$running}
          aria-label="한 스텝 진행"
          title="한 스텝 진행"
        >
          <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
        </button>

        <!-- 지우기 -->
        <button
          class="ctl mobile-ctl clear-btn"
          class:armed={clearArmed}
          onclick={handleClear}
          aria-label={clearArmed ? '전체 지우기 확인' : '전체 지우기'}
          title="전체 지우기"
        >
          <i class="bi bi-trash3" aria-hidden="true"></i>
          {#if clearArmed}
            <span class="label font-compact">확인?</span>
          {/if}
        </button>

        <!-- 저장 -->
        <button
          class="ctl mobile-ctl"
          onclick={openSaveSlots}
          aria-label="저장 / 불러오기"
          title="저장"
        >
          <i class="bi bi-collection" aria-hidden="true"></i>
        </button>

        <div class="mobile-divider"></div>

        <!-- 재료 브러시 -->
        <button
          class="ctl mobile-ctl material-btn"
          class:active={$tool === 'material'}
          onclick={() => { tool.set('material'); mobileToolsOpen = false; }}
          aria-pressed={$tool === 'material'}
          title={`재료 그리기: ${selectedName}`}
        >
          <i class="bi bi-brush" aria-hidden="true"></i>
          <span class="label material-name font-compact">{selectedName}</span>
        </button>

        <!-- 영역 선택 -->
        <button
          class="ctl mobile-ctl"
          class:active={$areaSelect}
          onclick={handleAreaSelectClick}
          aria-pressed={$areaSelect}
          title="영역 선택"
        >
          <i class="bi bi-bounding-box" aria-hidden="true"></i>
        </button>

        <!-- 특수 도구 팝업 트리거 -->
        <button
          class="ctl mobile-ctl special-popup-trigger"
          class:active={activeSpecialTool !== undefined}
          onclick={() => (mobileToolsOpen = !mobileToolsOpen)}
          aria-pressed={mobileToolsOpen}
          title="특수 도구 선택"
        >
          <i class={`bi ${activeSpecialTool?.icon ?? 'bi-grid-fill'}`} aria-hidden="true"></i>
          <span class="label font-compact">{activeSpecialTool?.name ?? '특수도구'}</span>
          <i class="bi bi-caret-up-fill popup-indicator" aria-hidden="true"></i>
        </button>

        <!-- 돋보기 -->
        <button
          class="ctl mobile-ctl"
          class:active={$inspect}
          onclick={() => inspect.set(!$inspect)}
          aria-pressed={$inspect}
          title="돋보기 관찰"
        >
          <i class="bi bi-search" aria-hidden="true"></i>
        </button>

        <!-- 설정 모달 -->
        <button
          class="ctl mobile-ctl settings-toggle"
          onclick={() => (settingsOpen = true)}
          aria-label="설정"
          title="설정"
        >
          <i class="bi bi-sliders2" aria-hidden="true"></i>
        </button>
      </div>

      <!-- Row 2: 물질 팔레트 (가로 스크롤 가능) -->
      <div class="bar-row palette-row">
        <MaterialPalette />
      </div>
    </div>
  </div>
</aside>

<!-- 모바일 특수도구 팝업 오버레이 -->
{#if mobileToolsOpen}
  <div class="mobile-special-popup-overlay" use:portal>
    <div class="popup-backdrop" onclick={() => mobileToolsOpen = false} role="none"></div>
    <div class="popup-card">
      <div class="popup-header">
        <span class="popup-title"><i class="bi bi-grid-fill"></i> 특수 브러시 도구</span>
        <button class="popup-close-btn" onclick={() => mobileToolsOpen = false} aria-label="닫기">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="popup-grid">
        {#each SPECIAL_TOOLS as t}
          <button
            class="popup-item"
            class:active={$tool === t.id}
            onclick={() => selectSpecialTool(t.id)}
            ondblclick={t.dblClick}
            title={t.title}
          >
            <i class={`bi ${t.icon}`}></i>
            <span class="popup-item-name">{t.name}</span>
            {#if t.dblClick}
              <span class="popup-item-badge">더블클릭 설정</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- 설정 modal. On mobile it also carries the frequently-tweaked settings (there
     is no room for them inline in the bottom bar); on desktop those show inline
     and .modal-frequent is hidden, leaving just the set-once settings here. -->
<Modal open={settingsOpen} title="설정" icon="bi-sliders2" onclose={() => (settingsOpen = false)}>
  <div class="modal-frequent">
    {@render frequentSettings()}
  </div>

  {@render fixedSettings()}

  <div class="hud">
    <span class="dims">격자 {$gridDims.w}×{$gridDims.h}</span>
    <span title="현재 배치된 입자 수 (빈칸 제외)">입자 {$particleCount.toLocaleString()}</span>
    <span title="격자에서 입자가 차지하는 비율">채움 {fillPct}%</span>
    <span
      class="fps"
      title="적응형 주사율(ProMotion/Adaptive Sync) 기기는 유휴 시 절전을 위해 주사율을 낮춥니다. '최대'는 이 세션에서 관측된 최고값입니다."
    >
      {$fps} FPS {#if $fpsPeak > $fps + 5}· 최대 {$fpsPeak}{/if}
    </span>
    <span title="프레임 렌더링에 걸린 평균 시간">{$frameMs} ms/프레임</span>
    <span title="현재 시뮬레이션 갱신 속도 (속도 배율 × 기본 틱레이트)">시뮬 {simHz} Hz</span>
    {#if perfLine}
      <span
        class="perf"
        title="Phase 0 개발 프로파일러 (?perf): 틱을 패스별로 계측한 평균 시간. 열=열확산, CA=물질 스캔, 렌더=프레임 렌더."
        >{perfLine}</span
      >
    {/if}
  </div>

  <button
    class="ctl reset-btn"
    class:armed={resetArmed}
    onclick={handleReset}
    aria-label={resetArmed ? '기본값 복원 확인' : '모든 설정 기본값 복원'}
    title="모든 설정을 기본값으로 되돌립니다 (월드·즐겨찾기는 유지)"
  >
    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
    <span class="label">{resetArmed ? '기본값으로 되돌릴까요?' : '설정 기본값 복원'}</span>
  </button>

  <p class="hint">
    캔버스를 드래그해 물질을 그리세요. 오른쪽 클릭이나 지우개 브러시로 지웁니다.
  </p>
</Modal>

<!-- 혼합 브러시 ratio editor, opened by double-clicking the 혼합 button (a single
     click just selects the tool), or from 설정 → 브러시 세부 설정. -->
<Modal open={blendOpen} title="혼합 브러시 비율" icon="bi-palette-fill" onclose={() => (blendOpen = false)}>
  <p class="blend-hint">
    최대 3가지 물질을 골라 비율을 정하면, 혼합 브러시가 그 비율대로 섞어 칠합니다. 막대의
    경계를 드래그해 비율을 조절하세요.
  </p>
  <BlendBrush />
</Modal>

<!-- 가열/냉각 브러시 감도 설정, opened by double-clicking either button, or
     from 설정 → 브러시 세부 설정. -->
<Modal
  open={heatCoolOpen}
  title="가열/냉각 브러시 설정"
  icon="bi-thermometer-half"
  onclose={() => (heatCoolOpen = false)}
>
  <HeatCoolSettings />
</Modal>

<!-- 저장 / 불러오기 modal: named snapshot slots saved in localStorage. -->
<Modal open={saveSlotsOpen} title="저장 / 불러오기" icon="bi-collection" onclose={() => (saveSlotsOpen = false)}>
  <SaveSlots bind:this={saveSlotsPanel} />
</Modal>

<!-- 돋보기 readout, floating over the top of the sandbox (shown only while the
     inspect overlay is on and the pointer is over the canvas). -->
<InspectPanel />

<!-- 영역 선택이 오브젝트 도구에서 거부됐을 때 뜨는 부트스트랩 스타일 팝오버.
     영역 버튼 위에 짧게 떠 있다가 스스로 사라진다 (portal to <body> so it escapes
     the sidebar's backdrop-filter containing block, same reason the palette
     flyouts portal out — see MaterialPalette). -->
{#if areaPopoverOpen && areaPopoverPos}
  <div
    class="area-popover"
    use:portal
    role="tooltip"
    style={`top:${areaPopoverPos.top}px; left:${areaPopoverPos.left}px`}
  >
    <div class="area-popover-body">오브젝트는 영역 선택을 사용할 수 없습니다.</div>
    <div class="area-popover-arrow"></div>
  </div>
{/if}

<style>
  /* --------------------------------------------------------------------- */
  /* Common UI Elements & Premium Enhancements                            */
  /* --------------------------------------------------------------------- */
  .panel {
    position: fixed;
    z-index: 10;
    padding: 14px;
    display: flex;
    flex-direction: column;
    /* Glassmorphism theme */
    background: rgba(16, 16, 22, 0.85);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    color: #e8e8ee;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    user-select: none;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    transition: left 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), right 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  /* PC Docking position controls via body class */
  @media (min-width: 769px) {
    .panel {
      top: 0;
      width: var(--sidebar-w);
      height: 100vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
      gap: 12px;
    }
    body.sidebar-left .panel {
      left: 0;
      right: auto;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      border-left: none;
    }
    body.sidebar-right .panel {
      right: 0;
      left: auto;
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      border-right: none;
    }

    .pc-layout {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .mobile-layout {
      display: none;
    }
  }

  .panel::-webkit-scrollbar {
    width: 6px;
  }
  .panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .panel::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }
  .panel::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e8e8ee;
    padding-bottom: 4px;
  }
  .head > i {
    font-size: 18px;
    color: #6ea8fe;
    filter: drop-shadow(0 0 6px rgba(110, 168, 254, 0.4));
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .head-actions {
    display: flex;
    gap: 5px;
    margin-left: auto;
  }
  .head-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    background: rgba(27, 27, 34, 0.6);
    color: #e8e8ee;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .head-btn:hover {
    border-color: rgba(110, 168, 254, 0.4);
    background: rgba(35, 50, 74, 0.4);
    transform: translateY(-1px);
  }
  .head-btn.active {
    border-color: #6ea8fe;
    background: rgba(35, 50, 74, 0.8);
    box-shadow: 0 0 8px rgba(110, 168, 254, 0.3);
  }

  /* --------------------------------------------------------------------- */
  /* Accordion Layout (PC only)                                            */
  /* --------------------------------------------------------------------- */
  .accordion-section {
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
    overflow: hidden;
  }
  .accordion-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: #cfcfd8;
    cursor: pointer;
    font-weight: 500;
    font-size: 12px;
    text-align: left;
    transition: background 0.2s;
  }
  .accordion-trigger:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #e8e8ee;
  }
  .trigger-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .trigger-title i {
    color: #6ea8fe;
  }
  .accordion-content {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(0, 0, 0, 0.1);
  }

  /* --------------------------------------------------------------------- */
  /* Button Styles & Overrides                                             */
  /* --------------------------------------------------------------------- */
  .bar {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bar-row.primary {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .group .ctl {
    flex: 1 1 auto;
  }

  .mode-group {
    padding: 3px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.25);
  }

  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    background: rgba(27, 27, 34, 0.6);
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .ctl i {
    font-size: 15px;
    line-height: 1;
  }
  .ctl:hover:not(:disabled) {
    border-color: rgba(110, 168, 254, 0.4);
    background: rgba(35, 50, 74, 0.4);
    transform: translateY(-1px);
  }
  .ctl:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .ctl.active {
    border-color: #6ea8fe;
    background: rgba(35, 50, 74, 0.85);
    box-shadow: 0 0 10px rgba(110, 168, 254, 0.25);
  }
  .ctl.armed {
    border-color: #e0a030;
    background: rgba(74, 58, 26, 0.8);
    color: #ffd98a;
    box-shadow: 0 0 10px rgba(224, 160, 48, 0.2);
  }
  .ctl.armed:hover {
    border-color: #f0b040;
    background: rgba(90, 70, 30, 0.9);
  }

  .material-name {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  .seg {
    display: flex;
    gap: 6px;
  }
  .seg .ctl {
    flex: 1 1 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field-label {
    color: #cfcfd8;
    font-weight: 500;
  }
  .field input[type='range'] {
    width: 100%;
    accent-color: #6ea8fe;
    cursor: pointer;
  }

  .overwrite-steps {
    display: flex;
    gap: 3px;
  }
  .overwrite-steps .step {
    flex: 1 1 0;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
  }
  .overwrite-steps .step.filled {
    background: #6ea8fe;
  }
  .overwrite-steps .step.auto {
    flex: 1 1 0;
    background: rgba(224, 160, 48, 0.15);
  }
  .overwrite-steps .step.auto.filled {
    background: #e0a030;
  }

  .hud {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px 10px;
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
    background: rgba(0, 0, 0, 0.2);
    padding: 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }
  .fps {
    cursor: help;
  }
  .perf {
    flex-basis: 100%;
    cursor: help;
    color: #6f9f7f;
    font-size: 11px;
  }
  .hint, .blend-hint {
    margin: 0;
    color: #8a8a99;
    font-size: 11px;
    line-height: 1.4;
  }

  .speed-seg .ctl,
  .grid-seg .ctl {
    padding: 6px 2px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .gravity-pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-areas:
      '. up .'
      'left . right'
      '. down .';
    gap: 6px;
  }
  .gravity-pad .ctl {
    padding: 6px 0;
  }
  .grav-up { grid-area: up; }
  .grav-left { grid-area: left; }
  .grav-right { grid-area: right; }
  .grav-down { grid-area: down; }

  .field-note {
    margin: 2px 0 0;
    color: #7a7a88;
    font-size: 10px;
    line-height: 1.4;
  }
  .range-ends {
    display: flex;
    justify-content: space-between;
    color: #8a8a99;
    font-size: 10px;
  }

  .settings-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .settings-links .ctl {
    flex: 1 1 auto;
  }
  .reset-btn {
    width: 100%;
    justify-content: center;
    margin-top: 10px;
  }

  .area-popover {
    position: fixed;
    z-index: 50;
    transform: translate(-50%, calc(-100% - 10px));
    pointer-events: none;
    max-width: 220px;
  }
  .area-popover-body {
    padding: 8px 10px;
    background: rgba(24, 24, 30, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    color: #ffd0d0;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
  }
  .area-popover-arrow {
    position: absolute;
    bottom: -6px;
    left: 50%;
    width: 10px;
    height: 10px;
    background: rgba(24, 24, 30, 0.98);
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    transform: translateX(-50%) rotate(45deg);
  }

  .modal-frequent {
    display: none;
  }
  .inline-settings .heat-field {
    display: none;
  }
  .settings-toggle {
    display: none;
  }

  /* --------------------------------------------------------------------- */
  /* Mobile Layout & Bottom Bar Revamp                                     */
  /* --------------------------------------------------------------------- */
  @media (max-width: 768px) {
    .panel {
      top: calc(100vh - var(--bottombar-h) - var(--bottom-deadzone));
      top: calc(100dvh - var(--bottombar-h) - var(--bottom-deadzone));
      bottom: auto;
      left: 0;
      width: 100vw;
      height: var(--bottombar-h);
      padding: 8px 8px calc(6px + env(safe-area-inset-bottom, 0px));
      gap: 0;
      border-right: none;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-left: none;
      border-bottom: none;
      overflow: visible;
      background: rgba(16, 16, 22, 0.92);
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
    }

    .pc-layout {
      display: none;
    }
    .mobile-layout {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }

    .bar {
      flex: 1;
      min-width: 0;
      gap: 6px;
      height: 100%;
      justify-content: space-between;
    }
    .bar-row {
      display: flex;
      align-items: center;
      min-height: 0;
    }
    .bar-row.primary {
      flex-direction: row;
      gap: 4px;
      justify-content: space-between;
      width: 100%;
    }
    .bar-row.palette-row {
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bar-row.palette-row::-webkit-scrollbar {
      display: none;
    }

    /* Mobile Buttons */
    .mobile-ctl {
      flex: 1 1 auto;
      min-width: 32px;
      height: 38px;
      padding: 0 4px !important;
      border-radius: 8px;
      font-size: 15px;
      justify-content: center;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .mobile-ctl i {
      font-size: 16px;
    }
    .mobile-ctl:hover:not(:disabled) {
      transform: none;
      box-shadow: none;
    }
    .mobile-ctl.active {
      background: rgba(110, 168, 254, 0.15);
      border-color: rgba(110, 168, 254, 0.5);
      color: #6ea8fe;
    }

    /* 재료 버튼: 텍스트 보여줌, 가로 비율 늘림 */
    .bar .material-btn {
      flex: 3 1 auto;
      max-width: 110px;
      font-size: 11px;
      font-weight: 600;
      gap: 4px;
    }
    .bar .material-btn i {
      font-size: 12px;
    }
    .bar .material-btn .material-name {
      display: inline;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 특수도구 버튼: 아이콘 + 라벨 + 화살표 */
    .special-popup-trigger {
      flex: 3 1 auto;
      max-width: 100px;
      font-size: 11px;
      font-weight: 600;
      gap: 3px;
    }
    .special-popup-trigger i {
      font-size: 12px;
    }
    .special-popup-trigger .popup-indicator {
      font-size: 8px;
      opacity: 0.6;
    }

    /* 지우개 armed 상태 */
    .bar .ctl.armed {
      background: rgba(224, 160, 48, 0.2);
      border-color: #e0a030;
      color: #ffd98a;
      flex: 2 1 auto;
    }

    .font-compact {
      font-size: 10px;
      letter-spacing: -0.03em;
    }

    .mobile-divider {
      width: 1px;
      height: 20px;
      background: rgba(255, 255, 255, 0.08);
      margin: 0 2px;
      flex: none;
    }

    .settings-toggle {
      display: inline-flex;
    }
    .inline-settings {
      display: none;
    }
    .modal-frequent {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-frequent .heat-field {
      display: flex;
    }
    .wheel-hint {
      display: none;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Mobile Special Tools Popover (Portal Overlay)                         */
  /* --------------------------------------------------------------------- */
  .mobile-special-popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 16px;
    pointer-events: none;
  }
  .popup-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }
  .popup-card {
    position: relative;
    width: 100%;
    max-width: 380px;
    background: rgba(20, 20, 26, 0.95);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    padding: 16px;
    pointer-events: auto;
    animation: popup-slide-up 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
  }
  @keyframes popup-slide-up {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 8px;
  }
  .popup-title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8ee;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .popup-title i {
    color: #6ea8fe;
  }
  .popup-close-btn {
    background: transparent;
    border: none;
    color: #8a8a99;
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .popup-close-btn:hover {
    color: #e8e8ee;
  }

  .popup-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .popup-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 72px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    color: #cfcfd8;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 4px;
  }
  .popup-item i {
    font-size: 20px;
    color: #cfcfd8;
    transition: color 0.2s;
  }
  .popup-item-name {
    font-size: 11px;
    font-weight: 500;
  }
  .popup-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #e8e8ee;
    border-color: rgba(255, 255, 255, 0.12);
  }
  .popup-item.active {
    background: rgba(110, 168, 254, 0.12);
    border-color: #6ea8fe;
    color: #6ea8fe;
    box-shadow: 0 0 10px rgba(110, 168, 254, 0.15);
  }
  .popup-item.active i {
    color: #6ea8fe;
  }
  .popup-item-badge {
    position: absolute;
    bottom: 2px;
    font-size: 8px;
    color: #8a8a99;
    transform: scale(0.9);
    white-space: nowrap;
    opacity: 0.8;
  }
</style>
