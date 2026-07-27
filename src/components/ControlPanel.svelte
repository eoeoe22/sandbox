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
    $particleCount as particleCount,
    $frameMs as frameMs,
    $perfPasses as perfPasses,
    requestClear,
    requestStep,
    resetSettings,
  } from '../state/store';
  import {
    $locale as locale,
    t,
    materialName,
    objectLabel,
  } from '../i18n';
  import {
    BRUSH_MIN,
    BRUSH_MAX,
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
    void $locale; // re-resolve when the language changes
    if ($tool === 'object') return objectLabel($selectedObject);
    const mat = getMaterial($selectedMaterial);
    if (!mat) return t('tool.material');
    if (mat.id === CLONE.id && $cloneTarget !== null) {
      const target = getMaterial($cloneTarget);
      if (target) return `${materialName(target.id, target.name)}(Clone)`;
    }
    return materialName(mat.id, mat.name);
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
  // Labels resolve through `t()` so they follow the active locale.
  const GRAVITY_DIRS_META: { dir: GravityDir; icon: string; labelKey: string }[] = [
    { dir: 'up', icon: 'bi-arrow-up', labelKey: 'sim.gravityDirUp' },
    { dir: 'left', icon: 'bi-arrow-left', labelKey: 'sim.gravityDirLeft' },
    { dir: 'right', icon: 'bi-arrow-right', labelKey: 'sim.gravityDirRight' },
    { dir: 'down', icon: 'bi-arrow-down', labelKey: 'sim.gravityDirDown' },
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
  const overwriteLabel = $derived.by(() => {
    void $locale;
    if ($overwriteLevel === OVERWRITE_AUTO) {
      const mat = getMaterial($selectedMaterial);
      const name = mat ? materialName(mat.id, mat.name) : t('brush.overwriteMissing');
      return t('brush.overwriteAutoLabel', { name });
    }
    return t(`brush.overwriteLevel${$overwriteLevel}`);
  });

  // Expanded HUD readouts.
  const fillPct = $derived.by(() => {
    const total = $gridDims.w * $gridDims.h;
    return total > 0 ? Math.round(($particleCount / total) * 1000) / 10 : 0;
  });
  // Actual step rate: the loop's interval is 2000/(TICK_HZ*mult) ms, i.e.
  // TICK_HZ*mult/2 Hz — so ×1 is 30 Hz (half of TICK_HZ), ×2 is 60, ×4 is 120.
  const simHz = $derived(Math.round((TICK_HZ * $simSpeed) / 2));
  const gridLabel = $derived.by(() => {
    void $locale;
    return $gridDivision === 0 ? t('grid.divisionOff') : `${$gridDivision}`;
  });

  // Phase 0 per-pass breakdown (dev only; non-null only under `?perf`). Each
  // value is ms per sim tick, except render which is ms per frame. See
  // game/engine/profiler.ts and docs/PERFORMANCE.md.
  const perfLine = $derived.by(() => {
    void $locale;
    const p = $perfPasses;
    if (!p) return null;
    const f = (v: number): string => v.toFixed(3);
    const sim = p.ms.heat + p.ms.ca + p.ms.objects + p.ms.drift;
    return (
      `${t('hud.perfHeat')} ${f(p.ms.heat)} · ${t('hud.perfCa')} ${f(p.ms.ca)} · ` +
      `${t('hud.perfObjects')} ${f(p.ms.objects)} · ${t('hud.perfDrift')} ${f(p.ms.drift)} · ` +
      `${t('hud.perfRender')} ${f(p.ms.render)} (${t('hud.perfTick')} ${f(sim)} ms/tick)`
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
</script>

<!-- Frequently-tweaked settings. Shown inline in the sidebar on desktop and
     inside the 설정 modal on mobile (rendered in both spots; CSS shows the right
     one for the viewport — see .inline-settings / .modal-frequent). -->
{#snippet frequentSettings()}
  <label class="field">
    <span class="field-label">
      {t('brush.size', { n: $brushSize })}<span class="wheel-hint">{t('brush.sizeWheelHint')}</span>
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
    <span class="field-label">{t('brush.shape')}</span>
    <div class="seg" role="group" aria-label={t('brush.shape')}>
      <button
        class="ctl"
        class:active={$brushShape === 'circle'}
        onclick={() => brushShape.set('circle')}
        aria-pressed={$brushShape === 'circle'}
        title={t('brush.shapeCircleTooltip')}
      >
        <i class="bi bi-circle-fill" aria-hidden="true"></i>
        <span class="label">{t('brush.shapeCircle')}</span>
      </button>
      <button
        class="ctl"
        class:active={$brushShape === 'square'}
        onclick={() => brushShape.set('square')}
        aria-pressed={$brushShape === 'square'}
        title={t('brush.shapeSquareTooltip')}
      >
        <i class="bi bi-square-fill" aria-hidden="true"></i>
        <span class="label">{t('brush.shapeSquare')}</span>
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">{t('brush.fill')}</span>
    <div class="seg" role="group" aria-label={t('brush.fill')}>
      <button
        class="ctl"
        class:active={$brushMode === 'full'}
        onclick={() => brushMode.set('full')}
        aria-pressed={$brushMode === 'full'}
        title={t('brush.fillFullTooltip')}
      >
        <i class="bi bi-grid-fill" aria-hidden="true"></i>
        <span class="label">{t('brush.fillFull')}</span>
      </button>
      <button
        class="ctl"
        class:active={$brushMode === 'particle'}
        onclick={() => brushMode.set('particle')}
        aria-pressed={$brushMode === 'particle'}
        title={t('brush.fillParticleTooltip')}
      >
        <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
        <span class="label">{t('brush.fillParticle')}</span>
      </button>
    </div>
  </div>

  <label class="field">
    <span class="field-label">{t('brush.overwrite', { label: overwriteLabel })}</span>
    <input
      type="range"
      min={OVERWRITE_AUTO}
      max={OVERWRITE_LEVEL_MAX}
      step="1"
      value={$overwriteLevel}
      oninput={(e) => overwriteLevel.set(+e.currentTarget.value)}
    />
    <div class="overwrite-steps" aria-hidden="true">
      <span
        class="step auto"
        class:filled={$overwriteLevel === OVERWRITE_AUTO}
        title={t('brush.overwriteAuto')}
      ></span>
      {#each Array(OVERWRITE_LEVEL_MAX + 1) as _, i}
        <span class="step" class:filled={$overwriteLevel >= i}></span>
      {/each}
    </div>
  </label>

  <div class="field">
    <span class="field-label">
      {t('sim.speed', { n: $simSpeed })}{#if $simSpeed === 1}<span class="wheel-hint">{t('sim.speedDefaultHint')}</span>{/if}
    </span>
    <div class="seg speed-seg" role="group" aria-label={t('sim.speedGroup')}>
      {#each SIM_SPEEDS as sp (sp)}
        <button
          class="ctl"
          class:active={$simSpeed === sp}
          onclick={() => simSpeed.set(sp)}
          aria-pressed={$simSpeed === sp}
          title={t('sim.speedTooltip', { n: sp })}
        >
          ×{sp}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    <span class="field-label">
      {t('sim.gravity', {
        dir: t(GRAVITY_DIRS_META.find((g) => g.dir === $gravityDir)?.labelKey ?? ''),
        strength: gravityPct === 0 ? t('sim.gravityZero') : t('sim.gravityStrength', { n: gravityPct }),
      })}
    </span>
    <div class="gravity-pad" role="group" aria-label={t('sim.gravityDirGroup')}>
      {#each GRAVITY_DIRS_META as g (g.dir)}
        <button
          class={`ctl grav-${g.dir}`}
          class:active={$gravityDir === g.dir}
          onclick={() => gravityDir.set(g.dir)}
          aria-pressed={$gravityDir === g.dir}
          aria-label={t('sim.gravityDirAria', { dir: t(g.labelKey) })}
          title={t('sim.gravityDirTooltip', { dir: t(g.labelKey) })}
        >
          <i class={`bi ${g.icon}`} aria-hidden="true"></i>
        </button>
      {/each}
    </div>
    <input
      type="range"
      aria-label={t('sim.gravityStrengthAria')}
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
    <span class="field-label">{t('render.heatmap')}</span>
    <div class="seg" role="group" aria-label={t('render.heatmapGroup')}>
      <button
        class="ctl"
        class:active={!$heatOverlay}
        onclick={() => heatOverlay.set(false)}
        aria-pressed={!$heatOverlay}
        title={t('render.heatmapOffTooltip')}
      >
        <i class="bi bi-palette" aria-hidden="true"></i>
        <span class="label">{t('render.heatmapOff')}</span>
      </button>
      <button
        class="ctl"
        class:active={$heatOverlay}
        onclick={() => heatOverlay.set(true)}
        aria-pressed={$heatOverlay}
        title={t('render.heatmapOnTooltip')}
      >
        <i class="bi bi-thermometer-half" aria-hidden="true"></i>
        <span class="label">{t('render.heatmapOn')}</span>
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">{t('render.smoke')}</span>
    <div class="seg" role="group" aria-label={t('render.smokeGroup')}>
      <button
        class="ctl"
        class:active={$smokeLevel === 'high'}
        onclick={() => smokeLevel.set('high')}
        aria-pressed={$smokeLevel === 'high'}
        title={t('render.smokeHighTooltip')}
      >
        <i class="bi bi-cloud-fog2" aria-hidden="true"></i>
        <span class="label">{t('render.smokeHigh')}</span>
      </button>
      <button
        class="ctl"
        class:active={$smokeLevel === 'medium'}
        onclick={() => smokeLevel.set('medium')}
        aria-pressed={$smokeLevel === 'medium'}
        title={t('render.smokeMediumTooltip')}
      >
        <i class="bi bi-cloud" aria-hidden="true"></i>
        <span class="label">{t('render.smokeMedium')}</span>
      </button>
      <button
        class="ctl"
        class:active={$smokeLevel === 'off'}
        onclick={() => smokeLevel.set('off')}
        aria-pressed={$smokeLevel === 'off'}
        title={t('render.smokeOffTooltip')}
      >
        <i class="bi bi-cloud-slash" aria-hidden="true"></i>
        <span class="label">{t('render.smokeOff')}</span>
      </button>
    </div>
  </div>
{/snippet}

<!-- Set-once settings: tucked in the 설정 modal on every viewport so they don't
     crowd the常用 controls. -->
{#snippet fixedSettings()}
  <!-- Language switch: rarely changed but easy to find at the top of the
       set-once settings. Two segment buttons; picking one writes $locale,
       which persistence saves and the whole UI re-derives from. -->
  <div class="field">
    <span class="field-label">{t('language.label')}</span>
    <div class="seg" role="group" aria-label={t('language.group')}>
      <button
        class="ctl"
        class:active={$locale === 'ko'}
        onclick={() => locale.set('ko')}
        aria-pressed={$locale === 'ko'}
        title={t('language.tooltip')}
      >
        <span class="label">{t('language.korean')}</span>
      </button>
      <button
        class="ctl"
        class:active={$locale === 'en'}
        onclick={() => locale.set('en')}
        aria-pressed={$locale === 'en'}
        title={t('language.tooltip')}
      >
        <span class="label">{t('language.english')}</span>
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">{t('border.label')}</span>
    <div class="seg" role="group" aria-label={t('border.group')}>
      <button
        class="ctl"
        class:active={$borderMode === 'wall'}
        onclick={() => borderMode.set('wall')}
        aria-pressed={$borderMode === 'wall'}
        title={t('border.wallTooltip')}
      >
        <i class="bi bi-bricks" aria-hidden="true"></i>
        <span class="label">{t('border.wall')}</span>
      </button>
      <button
        class="ctl"
        class:active={$borderMode === 'void'}
        onclick={() => borderMode.set('void')}
        aria-pressed={$borderMode === 'void'}
        title={t('border.voidTooltip')}
      >
        <i class="bi bi-dash-square-dotted" aria-hidden="true"></i>
        <span class="label">{t('border.void')}</span>
      </button>
    </div>
  </div>

  <label class="field">
    <span class="field-label">
      {t('grid.resolution', { w: $gridDims.w, h: $gridDims.h })}
      <span class="wheel-hint">{t('grid.resolutionHint')}</span>
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
      <span>{t('grid.lowRes')}</span>
      <span>{t('grid.highRes')}</span>
    </div>
  </label>

  <div class="field">
    <span class="field-label">{t('grid.division', { label: gridLabel })}</span>
    <div class="seg grid-seg" role="group" aria-label={t('grid.divisionGroup')}>
      {#each GRID_DIVISIONS as gd (gd)}
        <button
          class="ctl"
          class:active={$gridDivision === gd}
          onclick={() => gridDivision.set(gd)}
          aria-pressed={$gridDivision === gd}
          title={gd === 0 ? t('grid.divisionTooltipOff') : t('grid.divisionTooltipOn', { n: gd })}
        >
          {gd === 0 ? t('grid.divisionOff') : gd}
        </button>
      {/each}
    </div>
  </div>

  <label class="field">
    <span class="field-label">
      {t('grid.bottomDeadzone', { n: $bottomDeadzone })}
      <span class="wheel-hint">{t('grid.bottomDeadzoneHint')}</span>
    </span>
    <input
      type="range"
      aria-label={t('grid.bottomDeadzoneAria')}
      min={BOTTOM_DEADZONE_MIN}
      max={BOTTOM_DEADZONE_MAX}
      step={BOTTOM_DEADZONE_STEP}
      value={$bottomDeadzone}
      oninput={(e) => bottomDeadzone.set(+e.currentTarget.value)}
    />
    <p class="field-note">
      {t('grid.bottomDeadzoneNote')}
    </p>
  </label>

  <div class="field">
    <span class="field-label">{t('brushDetails.label')}</span>
    <div class="settings-links">
      <button
        class="ctl"
        onclick={openHeatCoolFromSettings}
        aria-label={t('brushDetails.heatCoolAria')}
        title={t('brushDetails.heatCoolTooltip')}
      >
        <i class="bi bi-thermometer-half" aria-hidden="true"></i>
        <span class="label">{t('brushDetails.heatCool')}</span>
      </button>
      <button
        class="ctl"
        onclick={openBlendFromSettings}
        aria-label={t('brushDetails.blendAria')}
        title={t('brushDetails.blendTooltip')}
      >
        <i class="bi bi-palette-fill" aria-hidden="true"></i>
        <span class="label">{t('brushDetails.blend')}</span>
      </button>
    </div>
  </div>
{/snippet}

<aside class="panel">
  <div class="head">
    <i class="bi bi-boxes" aria-hidden="true"></i>
    <h1>Particle Sandbox</h1>

    <!-- Desktop top-left quick toggles: switch the render mode between normal
         material color (eye) and the温도 heat-map (thermometer), plus the 설정
         modal opener. The header is desktop-only (hidden on mobile). -->
    <div class="head-actions">
      <button
        class="head-btn"
        class:active={!$heatOverlay}
        onclick={() => heatOverlay.set(false)}
        aria-pressed={!$heatOverlay}
        aria-label={t('render.heatmapNormalAria')}
        title={t('render.heatmapNormalTooltip')}
      >
        <i class="bi bi-eye" aria-hidden="true"></i>
      </button>
      <button
        class="head-btn"
        class:active={$heatOverlay}
        onclick={() => heatOverlay.set(true)}
        aria-pressed={$heatOverlay}
        aria-label={t('render.heatmapHeatAria')}
        title={t('render.heatmapHeatTooltip')}
      >
        <i class="bi bi-thermometer-half" aria-hidden="true"></i>
      </button>
      <button
        class="head-btn"
        onclick={() => (settingsOpen = true)}
        aria-label={t('tool.settings')}
        title={t('tool.settingsTooltip')}
      >
        <i class="bi bi-sliders2" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  <!-- Primary controls (bottom-bar row 1 on mobile) + material palette (row 2). -->
  <div class="bar">
    <div class="bar-row primary">
      <div class="group" role="group" aria-label={t('play.groupPlayback')}>
        <button
          class="ctl"
          onclick={() => running.set(!$running)}
          aria-label={$running ? t('play.pause') : t('play.resume')}
          title={$running ? t('play.pause') : t('play.resume')}
        >
          <i class={`bi ${$running ? 'bi-pause-fill' : 'bi-play-fill'}`} aria-hidden="true"></i>
          <span class="label">{$running ? t('play.pause') : t('play.resume')}</span>
        </button>
        <button
          class="ctl"
          onclick={requestStep}
          disabled={$running}
          aria-label={t('play.stepFull')}
          title={t('play.stepTooltip')}
        >
          <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
          <span class="label">{t('play.step')}</span>
        </button>
        <button
          class="ctl clear-btn"
          class:armed={clearArmed}
          onclick={handleClear}
          aria-label={clearArmed ? t('play.clearFull') : t('play.clearFull')}
          title={t('play.clearTooltip')}
        >
          <i class="bi bi-trash3" aria-hidden="true"></i>
          <span class="label">{clearArmed ? t('play.clearConfirm') : t('play.clear')}</span>
        </button>
        <button
          class="ctl"
          onclick={openSaveSlots}
          aria-label={t('play.saveFull')}
          title={t('play.saveTooltip')}
        >
          <i class="bi bi-collection" aria-hidden="true"></i>
          <span class="label">{t('play.save')}</span>
        </button>
      </div>

      <!-- 재료(브러시 도구 선택) 옆에 영역(사각 선택 모드)을 붙여 둔다. 영역은
           $tool과 독립적인 토글(돋보기와 같은 패턴)이라 재료 자신뿐 아니라 혼합/
           가열/냉각/섞기/지우개/전기/충격파에도 켠 채로 함께 쓸 수 있다 — 켜져 있으면 브러시
           스트로크 대신 사각형을 드래그해 선택하고, 그 시점에 고른 도구를 사각
           영역 전체에 한 번에 적용한다(PointerPainter.applyRect). PC에서 좌클릭
           드래그는 드롭 즉시 적용(터치와 동일), 우클릭 드래그는 Enter로 확정하는
           대기 상태로 남는다. .mode-group은 순전히 시각적 묶음이다. -->
      <div class="group mode-group" role="group" aria-label={t('tool.groupDraw')}>
        <button
          class="ctl material-btn"
          class:active={$tool === 'material'}
          onclick={() => tool.set('material')}
          aria-pressed={$tool === 'material'}
          aria-label={t('tool.materialLabel', { name: selectedName })}
          title={t('tool.materialTooltip', { name: selectedName })}
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
          aria-label={t('tool.area')}
          title={t('tool.areaTooltip')}
        >
          <i class="bi bi-bounding-box" aria-hidden="true"></i>
          <span class="label">{t('tool.area')}</span>
        </button>
      </div>

      <!-- 특수 브러시. 지우개가 맨 앞 — 가장 자주 집는 도구라 재료 바로 옆에 두고,
           전기/충격파는 맨 뒤에 붙여 전기 계열끼리 묶는다. -->
      <div class="group" role="group" aria-label={t('tool.groupSpecial')}>
        <button
          class="ctl"
          class:active={$tool === 'erase'}
          onclick={() => tool.set('erase')}
          aria-pressed={$tool === 'erase'}
          aria-label={t('tool.erase')}
          title={t('tool.eraseTooltip')}
        >
          <i class="bi bi-eraser-fill" aria-hidden="true"></i>
          <span class="label">{t('tool.erase')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'blend'}
          onclick={() => tool.set('blend')}
          ondblclick={() => (blendOpen = true)}
          aria-pressed={$tool === 'blend'}
          aria-label={t('tool.blend')}
          title={t('tool.blendTooltip')}
        >
          <i class="bi bi-palette-fill" aria-hidden="true"></i>
          <span class="label">{t('tool.blend')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'heat'}
          onclick={() => tool.set('heat')}
          ondblclick={() => {
            tool.set('heat');
            heatCoolOpen = true;
          }}
          aria-pressed={$tool === 'heat'}
          aria-label={t('tool.heat')}
          title={t('tool.heatTooltip')}
        >
          <i class="bi bi-fire" aria-hidden="true"></i>
          <span class="label">{t('tool.heat')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'cool'}
          onclick={() => tool.set('cool')}
          ondblclick={() => {
            tool.set('cool');
            heatCoolOpen = true;
          }}
          aria-pressed={$tool === 'cool'}
          aria-label={t('tool.cool')}
          title={t('tool.coolTooltip')}
        >
          <i class="bi bi-snow" aria-hidden="true"></i>
          <span class="label">{t('tool.cool')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'mix'}
          onclick={() => tool.set('mix')}
          aria-pressed={$tool === 'mix'}
          aria-label={t('tool.mix')}
          title={t('tool.mixTooltip')}
        >
          <i class="bi bi-tornado" aria-hidden="true"></i>
          <span class="label">{t('tool.mix')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'view'}
          onclick={() => tool.set('view')}
          aria-pressed={$tool === 'view'}
          aria-label={t('tool.view')}
          title={t('tool.viewTooltip')}
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
          <span class="label">{t('tool.view')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'spark'}
          onclick={() => tool.set('spark')}
          aria-pressed={$tool === 'spark'}
          aria-label={t('tool.spark')}
          title={t('tool.sparkTooltip')}
        >
          <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
          <span class="label">{t('tool.spark')}</span>
        </button>
        <button
          class="ctl"
          class:active={$tool === 'shock'}
          onclick={() => tool.set('shock')}
          aria-pressed={$tool === 'shock'}
          aria-label={t('tool.shock')}
          title={t('tool.shockTooltip')}
        >
          <i class="bi bi-broadcast" aria-hidden="true"></i>
          <span class="label">{t('tool.shock')}</span>
        </button>
      </div>

      <!-- 돋보기 inspect overlay: an independent toggle (not one of the brush
           tools) that surveys what's under the brush while on. -->
      <div class="group" role="group" aria-label={t('tool.groupObserve')}>
        <button
          class="ctl"
          class:active={$inspect}
          onclick={() => inspect.set(!$inspect)}
          aria-pressed={$inspect}
          aria-label={t('tool.inspect')}
          title={t('tool.inspectTooltip')}
        >
          <i class="bi bi-search" aria-hidden="true"></i>
          <span class="label">{t('tool.inspect')}</span>
        </button>
      </div>

      <!-- Mobile only: open the settings modal (the desktop opener lives in the
           header, which is hidden on mobile). -->
      <button
        class="ctl settings-toggle"
        onclick={() => (settingsOpen = true)}
        aria-label={t('tool.settings')}
        title={t('tool.settingsTooltip')}
      >
        <i class="bi bi-sliders2" aria-hidden="true"></i>
      </button>
    </div>

    <div class="bar-row palette-row">
      <MaterialPalette />
    </div>
  </div>

  <!-- Desktop: frequently-tweaked settings inline under the palette (hidden on
       mobile, where they move into the 설정 modal instead). -->
  <div class="inline-settings">
    {@render frequentSettings()}
  </div>
</aside>

<!-- 설정 modal. On mobile it also carries the frequently-tweaked settings (there
     is no room for them inline in the bottom bar); on desktop those show inline
     and .modal-frequent is hidden, leaving just the set-once settings here. -->
<Modal open={settingsOpen} title={t('modal.settingsTitle')} icon="bi-sliders2" onclose={() => (settingsOpen = false)}>
  <div class="modal-frequent">
    {@render frequentSettings()}
  </div>

  {@render fixedSettings()}

  <div class="hud">
    <span class="dims">{t('hud.grid', { w: $gridDims.w, h: $gridDims.h })}</span>
    <span title={t('hud.particlesTooltip')}>{t('hud.particles', { n: $particleCount.toLocaleString() })}</span>
    <span title={t('hud.fillTooltip')}>{t('hud.fill', { n: fillPct })}</span>
    <span class="fps" title={t('hud.fpsTooltip')}>
      {t('hud.fps', { n: $fps })}{#if $fpsPeak > $fps + 5}{t('hud.fpsPeak', { n: $fpsPeak })}{/if}
    </span>
    <span title={t('hud.frameMsTooltip')}>{t('hud.frameMs', { n: $frameMs })}</span>
    <span title={t('hud.simHzTooltip')}>{t('hud.simHz', { n: simHz })}</span>
    {#if perfLine}
      <span class="perf" title={t('hud.perfTooltip')}>{perfLine}</span>
    {/if}
  </div>

  <button
    class="ctl reset-btn"
    class:armed={resetArmed}
    onclick={handleReset}
    aria-label={resetArmed ? t('reset.ariaArmed') : t('reset.aria')}
    title={t('reset.tooltip')}
  >
    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
    <span class="label">{resetArmed ? t('reset.buttonArmed') : t('reset.button')}</span>
  </button>

  <p class="hint">
    {t('hint.draw')}
  </p>
</Modal>

<!-- 혼합 브러시 ratio editor, opened by double-clicking the 혼합 button (a single
     click just selects the tool), or from 설정 → 브러시 세부 설정. -->
<Modal open={blendOpen} title={t('modal.blendTitle')} icon="bi-palette-fill" onclose={() => (blendOpen = false)}>
  <p class="blend-hint">
    {t('modal.blendHint')}
  </p>
  <BlendBrush />
</Modal>

<!-- 가열/냉각 브러시 감도 설정, opened by double-clicking either button, or
     from 설정 → 브러시 세부 설정. -->
<Modal
  open={heatCoolOpen}
  title={t('modal.heatCoolTitle')}
  icon="bi-thermometer-half"
  onclose={() => (heatCoolOpen = false)}
>
  <HeatCoolSettings />
</Modal>

<!-- 저장 / 불러오기 modal: named snapshot slots saved in localStorage. -->
<Modal open={saveSlotsOpen} title={t('modal.saveTitle')} icon="bi-collection" onclose={() => (saveSlotsOpen = false)}>
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
    <div class="area-popover-body">{t('tool.areaObjectBlocked')}</div>
    <div class="area-popover-arrow"></div>
  </div>
{/if}

<style>
  /* --------------------------------------------------------------------- */
  /* Desktop (default): the panel is a fixed sidebar docked to the left, the
     full height of the viewport. Its width matches the --sidebar-w the canvas
     carves out, so the sandbox never sits underneath it.                   */
  /* --------------------------------------------------------------------- */
  .panel {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10;
    width: var(--sidebar-w);
    height: 100vh;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(20, 20, 26, 0.92);
    backdrop-filter: blur(8px);
    border-right: 1px solid #2a2a33;
    color: #e8e8ee;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    user-select: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #3a3a46 transparent;
  }
  .panel::-webkit-scrollbar {
    width: 8px;
  }
  .panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .panel::-webkit-scrollbar-thumb {
    background: #3a3a46;
    border-radius: 4px;
  }
  .panel::-webkit-scrollbar-thumb:hover {
    background: #4a4a58;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e8e8ee;
  }
  .head > i {
    font-size: 18px;
    color: #6ea8fe;
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  /* Header quick actions: render-mode toggles (eye/thermometer) + 설정 opener,
     pushed to the right edge of the header. */
  .head-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .head-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font-size: 15px;
  }
  .head-btn:hover {
    border-color: #3a3a46;
  }
  .head-btn.active {
    border-color: #6ea8fe;
    background: #23324a;
  }

  .bar,
  .inline-settings {
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

  /* 재료 옆에 영역(사각 선택 모드) 토글을 붙여 얇은 테두리로 둘러싼 시각적
     묶음. 영역은 $tool과 별개의 독립 토글이라 재료가 아닌 다른 도구와 함께도
     켜질 수 있지만("서로 배타적" 관계는 아님), 그리기 방식을 고르는 첫 손동작
     이라는 점에서 나란히 둔다. 버튼 자체 스타일(.ctl/.active)은 그대로 공유한다. */
  .mode-group {
    padding: 3px;
    border: 1px solid #2a2a33;
    border-radius: 8px;
    background: #17171b;
  }

  /* Shared button. */
  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .ctl i {
    font-size: 15px;
    line-height: 1;
  }
  .ctl:hover {
    border-color: #3a3a46;
  }
  .ctl:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ctl.active {
    border-color: #6ea8fe;
    background: #23324a;
  }
  /* Armed 전체 지우기 button: an amber "are you sure?" state before it wipes. */
  .ctl.armed {
    border-color: #e0a030;
    background: #4a3a1a;
    color: #ffd98a;
  }
  .ctl.armed:hover {
    border-color: #f0b040;
  }

  /* The 재료 brush button shows the selected material's name in full — never
     truncated with an ellipsis. The button sizes to fit the name (the control
     group wraps around it on desktop; the bar scrolls sideways on mobile). */
  .material-name {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  /* Two-option segmented control (speed, shape, mode, border). */
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
    gap: 4px;
  }
  .field-label {
    color: #cfcfd8;
  }
  .field input[type='range'] {
    width: 100%;
  }

  .overwrite-steps {
    display: flex;
    gap: 3px;
  }
  .overwrite-steps .step {
    flex: 1 1 0;
    height: 4px;
    border-radius: 2px;
    background: #2a2a33;
  }
  .overwrite-steps .step.filled {
    background: #6ea8fe;
  }
  /* The "자동" notch is visually distinct (amber) so it reads as a mode toggle,
     not just "loosest level". */
  .overwrite-steps .step.auto {
    flex: 1 1 0;
    background: #3a3a1a;
  }
  .overwrite-steps .step.auto.filled {
    background: #e0a030;
  }

  .hud {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 10px;
    font-variant-numeric: tabular-nums;
    color: #8a8a99;
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
  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }
  .blend-hint {
    margin: 0;
    color: #8a8a99;
    font-size: 12px;
    line-height: 1.5;
  }

  /* Speed (5 steps) and grid (5 steps) segmented controls pack more buttons into
     the same width, so tighten the padding and shrink the numeric labels. */
  .speed-seg .ctl,
  .grid-seg .ctl {
    padding: 6px 2px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  /* Gravity direction as a D-pad: up on top, left/right flanking an empty
     center, down on the bottom — so the layout itself reads as a direction. */
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
  .grav-up {
    grid-area: up;
  }
  .grav-left {
    grid-area: left;
  }
  .grav-right {
    grid-area: right;
  }
  .grav-down {
    grid-area: down;
  }

  /* Small explanatory note under a control (e.g. the bottom dead-zone slider). */
  .field-note {
    margin: 2px 0 0;
    color: #7a7a88;
    font-size: 10px;
    line-height: 1.4;
  }

  /* Min/max captions under a range slider. */
  .range-ends {
    display: flex;
    justify-content: space-between;
    color: #8a8a99;
    font-size: 10px;
  }

  /* Entry points into the 가열/냉각·혼합 dedicated modals, from inside 설정. */
  .settings-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .settings-links .ctl {
    flex: 1 1 auto;
  }

  /* Restore-defaults button: full width, armed amber like 전체 지우기. */
  .reset-btn {
    width: 100%;
    justify-content: center;
  }

  /* 영역 선택이 오브젝트 도구에서 거부됐을 때 뜨는 팝오버: 트리거(영역 버튼) 위에
     뜨는 작은 말풍선, 아래쪽 화살표가 버튼을 가리킨다. Bootstrap의 popover와 같은
     생김새를 손으로 재현한 것 — 전체 bootstrap.min.css는 싣지 않는다는 기존 방침
     (docs/FEATURES.md 참고)을 지키면서, Modal/MaterialPalette 플라이아웃과 같은
     패턴(고정 위치 + portal + 다크 테마)으로 만들었다. */
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
    border: 1px solid #3a3a46;
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
    border-right: 1px solid #3a3a46;
    border-bottom: 1px solid #3a3a46;
    transform: translateX(-50%) rotate(45deg);
  }

  /* The frequently-tweaked settings render both inline (desktop) and inside the
     settings modal (mobile). Each viewport shows exactly one copy. */
  .modal-frequent {
    display: none;
  }
  /* On desktop the heat-map mode is driven by the header eye/thermometer icons,
     so hide the redundant inline segmented control there (it still shows in the
     mobile settings modal, whose .modal-frequent copy this rule doesn't match). */
  .inline-settings .heat-field {
    display: none;
  }

  /* Mobile-only settings opener in the bar. */
  .settings-toggle {
    display: none;
  }

  /* --------------------------------------------------------------------- */
  /* Mobile: the panel becomes a two-row bar docked along the bottom. Row 1 is
     the primary controls, row 2 the material palette; both scroll sideways if
     they overflow. All secondary settings live in the 설정 modal.

     Anchored with `top` (not `bottom:0`) so it lands at the toolbar/canvas
     boundary measured from the dynamic viewport. `bottom:0` on a fixed element
     is relative to the *layout* viewport (100vh — the large height with the
     address bar collapsed), which hides the bar behind the address bar on
     mobile. `top: calc(100dvh - h)` is measured from the top using dvh (the
     *visible* viewport), so it always sits just under the canvas regardless of
     address-bar state.                                       */
  /* --------------------------------------------------------------------- */
  @media (max-width: 768px) {
    .panel {
      /* vh fallback for browsers without dvh support. The bottom dead zone is
         reserved below the bar, so lift the bar by it too (0px by default). */
      top: calc(100vh - var(--bottombar-h) - var(--bottom-deadzone));
      top: calc(100dvh - var(--bottombar-h) - var(--bottom-deadzone));
      bottom: auto;
      left: 0;
      width: 100vw;
      height: var(--bottombar-h);
      padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
      gap: 6px;
      border-right: none;
      border-top: 1px solid #2a2a33;
      overflow: visible;
    }

    .head {
      display: none;
    }

    .bar {
      flex: 1;
      min-width: 0;
      gap: 6px;
    }
    .bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bar-row::-webkit-scrollbar {
      display: none;
    }
    .bar-row.primary {
      flex-direction: row;
    }
    .group {
      flex: none;
      flex-wrap: nowrap;
    }
    .group .ctl {
      flex: none;
    }
    /* Icon-only buttons in the bar: hide the text labels, square them up. */
    .bar .label {
      display: none;
    }
    /* …except the 재료 button, which keeps showing the selected material name
       (the bar scrolls sideways, so a wider button is fine). */
    .bar .material-btn .material-name {
      display: inline;
    }
    /* …and the armed 지우기 button, so the "계속하시겠습니까?" confirm prompt is
       visible on mobile too (the bar scrolls to fit the wider button). */
    .bar .ctl.armed .label {
      display: inline;
    }
    .bar .ctl {
      padding: 8px 10px;
    }
    .bar .ctl i {
      font-size: 17px;
    }

    .settings-toggle {
      display: inline-flex;
      flex: none;
      margin-left: auto;
    }

    /* Inline settings are desktop-only; on mobile they move into the modal. */
    .inline-settings {
      display: none;
    }
    /* Inside the modal, show the frequently-tweaked settings on mobile. */
    .modal-frequent {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* The mobile modal copy keeps the heat-map control (no header icons on
       mobile), overriding the desktop .inline-settings .heat-field hide. */
    .modal-frequent .heat-field {
      display: flex;
    }
    .wheel-hint {
      display: none;
    }
  }
</style>
