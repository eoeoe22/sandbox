<script lang="ts">
  import { $placeDir as placeDir, $selectedMaterial as selectedMaterial } from '../state/store';
  import { getMaterial } from '../game/materials';
  import { t, materialName } from '../i18n';

  // 배치 방향 badge — a small arrow pinned to the top-right corner of the play
  // area, showing which way the selected 방향성 물질 (컨베이어 / 팬 / 레이저 /
  // 성형작약) would be stamped if you painted right now.
  //
  // The direction has always been the drag's: a belt runs the way the stroke
  // moved, a fan blows the way it moved off its press point (see
  // PointerPainter.updateFanDir / beltDirX). In a plain brush stroke that is
  // self-evident *after the fact* — the belt you just painted is right there
  // with its chevrons on it. In 영역 선택 mode it is not: the marquee drag sets
  // the direction, but nothing is placed until the rect is confirmed, so
  // aiming a shaped charge inside a selection meant confirming and looking.
  // This badge is that answer, shown before the commit.
  //
  // It shows in the plain brush too. Nothing is lost by it — and a click that
  // reuses the *previous* stroke's direction (a press with no drag keeps the
  // last one) is exactly as invisible as the marquee case, so it earns its
  // place there as well.
  //
  // It shows only while a placement gesture is actually live, though — a press,
  // a marquee drag, or a marquee pending confirm. Merely *selecting* a Conveyor
  // isn't aiming one, and a badge that appeared on selection and then sat there
  // for as long as the chip stayed picked was decoration over the play area
  // rather than a readout of anything happening. See PointerPainter.placingNow.
  //
  // PointerPainter owns the state and publishes null whenever nothing
  // directional is selected, the active tool isn't placing material at all, or
  // no placement gesture is under way — which is what hides this. Pure readout:
  // pointer-events:none so it can never eat a brush stroke that runs up into
  // the corner.
  const ICONS = {
    up: 'bi-arrow-up',
    down: 'bi-arrow-down',
    left: 'bi-arrow-left',
    right: 'bi-arrow-right',
  } as const;

  const dir = $derived($placeDir);
  // Named for the reader, not for the badge: the arrow says which way, the
  // label says which way *what*. Only the screen reader sees it — the badge is
  // pointer-transparent, so a `title` tooltip could never be summoned anyway.
  const label = $derived(
    dir === null
      ? ''
      : t('placeDir.aria', {
          name: materialName($selectedMaterial, getMaterial($selectedMaterial).name),
          dir: t(`placeDir.${dir}`),
        }),
  );
</script>

{#if dir}
  <div class="place-dir" role="status" aria-live="polite" aria-label={label}>
    <i class={`bi ${ICONS[dir]}`} aria-hidden="true"></i>
  </div>
{/if}

<style>
  /* Top-right of the play area, opposite the 돋보기 readout (top-left) so the two
     never collide. Same fixed/z-index/pointer-events shape as that card; the
     canvas spans the full viewport under both, and the sidebar/bottom bar sit on
     the other edges, so a plain viewport corner is the play area's corner on
     desktop and mobile alike. */
  .place-dir {
    position: fixed;
    z-index: 8;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Deliberately smaller than the cards it borrows its look from: it sits over
       the play area rather than beside it, and it's a single glyph — the box only
       has to be big enough to read at a glance, not to be a control. */
    width: 26px;
    height: 26px;
    background: rgba(20, 20, 26, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid #2a2a33;
    border-radius: 7px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    /* The palette's selection blue — this is a readout *about* the selected
       material, and it reads as the same family as the chip's own highlight. */
    color: #6ea8fe;
    font-size: 15px;
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }
</style>
