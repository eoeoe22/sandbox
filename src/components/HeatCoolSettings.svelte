<script lang="ts">
  // Sensitivity editor for the 가열/냉각 브러시: how many degrees ('절대온도')
  // or what percent of the current temperature ('상대온도') the brush moves per
  // second at sim speed ×1, held for 1 second — see PointerPainter.heatRatePerTick
  // / heatRateOneShot for how this dial turns into an actual per-tick or
  // one-shot (영역 선택) delta. Shared by both 가열 and 냉각 (the sign flips per
  // tool; the sensitivity itself is one setting).
  import {
    $heatRateMode as heatRateMode,
    $heatAbsoluteRate as heatAbsoluteRate,
    $heatRelativeRate as heatRelativeRate,
  } from '../state/store';
  import {
    HEAT_ABS_RATE_MIN,
    HEAT_ABS_RATE_MAX,
    HEAT_ABS_RATE_STEP,
    HEAT_REL_RATE_MIN,
    HEAT_REL_RATE_MAX,
    HEAT_REL_RATE_STEP,
  } from '../game/config';
  import { t } from '../i18n';

  const isAbsolute = $derived($heatRateMode === 'absolute');
</script>

<div class="heat-settings">
  <div class="field">
    <span class="field-label">{t('heatCool.mode')}</span>
    <div class="seg" role="group" aria-label={t('heatCool.modeGroup')}>
      <button
        class="ctl"
        class:active={isAbsolute}
        onclick={() => heatRateMode.set('absolute')}
        aria-pressed={isAbsolute}
        title={t('heatCool.absoluteTooltip')}
      >
        <i class="bi bi-thermometer" aria-hidden="true"></i>
        <span class="label">{t('heatCool.absolute')}</span>
      </button>
      <button
        class="ctl"
        class:active={!isAbsolute}
        onclick={() => heatRateMode.set('relative')}
        aria-pressed={!isAbsolute}
        title={t('heatCool.relativeTooltip')}
      >
        <i class="bi bi-percent" aria-hidden="true"></i>
        <span class="label">{t('heatCool.relative')}</span>
      </button>
    </div>
  </div>

  {#if isAbsolute}
    <label class="field">
      <span class="field-label">{t('heatCool.sensitivityAbs', { n: $heatAbsoluteRate })}</span>
      <input
        type="range"
        min={HEAT_ABS_RATE_MIN}
        max={HEAT_ABS_RATE_MAX}
        step={HEAT_ABS_RATE_STEP}
        value={$heatAbsoluteRate}
        oninput={(e) => heatAbsoluteRate.set(+e.currentTarget.value)}
      />
    </label>
  {:else}
    <label class="field">
      <span class="field-label">{t('heatCool.sensitivityRel', { n: $heatRelativeRate })}</span>
      <input
        type="range"
        min={HEAT_REL_RATE_MIN}
        max={HEAT_REL_RATE_MAX}
        step={HEAT_REL_RATE_STEP}
        value={$heatRelativeRate}
        oninput={(e) => heatRelativeRate.set(+e.currentTarget.value)}
      />
    </label>
  {/if}

  <p class="hint">
    {t('heatCool.hint')}
  </p>
</div>

<style>
  .heat-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .seg {
    display: flex;
    gap: 6px;
  }
  .seg .ctl {
    flex: 1 1 0;
  }
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
  .ctl.active {
    border-color: #6ea8fe;
    background: #23324a;
  }
  .hint {
    margin: 0;
    color: #8a8a99;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
