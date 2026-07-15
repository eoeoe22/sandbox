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

  const isAbsolute = $derived($heatRateMode === 'absolute');
</script>

<div class="heat-settings">
  <div class="field">
    <span class="field-label">기준 방식</span>
    <div class="seg" role="group" aria-label="가열/냉각 감도 기준 방식">
      <button
        class="ctl"
        class:active={isAbsolute}
        onclick={() => heatRateMode.set('absolute')}
        aria-pressed={isAbsolute}
        title="온도를 고정된 도(°) 단위로 올리거나 내립니다"
      >
        <i class="bi bi-thermometer" aria-hidden="true"></i>
        <span class="label">절대온도</span>
      </button>
      <button
        class="ctl"
        class:active={!isAbsolute}
        onclick={() => heatRateMode.set('relative')}
        aria-pressed={!isAbsolute}
        title="현재 온도 크기에 비례한 퍼센트(%)로 올리거나 내립니다 (영하에서도 방향은 항상 가열=상승·냉각=하강)"
      >
        <i class="bi bi-percent" aria-hidden="true"></i>
        <span class="label">상대온도</span>
      </button>
    </div>
  </div>

  {#if isAbsolute}
    <label class="field">
      <span class="field-label">감도: 초당 {$heatAbsoluteRate}°</span>
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
      <span class="field-label">감도: 초당 {$heatRelativeRate}%</span>
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
    값은 <strong>배속×1로 1초간</strong> 눌렀을 때 오르내리는 양(절대온도는 도, 상대온도는 현재
    온도 크기 대비 퍼센트) 기준입니다. 배속을 올리면 브러시를 누르는 동안 실제 초당 변화량도
    그만큼 빨라집니다. <strong>영역 선택</strong>으로 확정할 때는 현재 배속과 무관하게 이 기준값
    1초치를 한 번에 그대로 적용합니다. 냉각 브러시도 같은 감도를 반대 방향으로 씁니다. 상대온도는
    영하에서도 방향이 뒤집히지 않도록 온도의 <strong>크기(절대값)</strong>에 비례해 움직이므로,
    정확히 0°인 대상은 상대온도로 움직이지 않습니다(절대온도는 항상 동작).
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
