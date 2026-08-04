<script lang="ts" module>
  // Shared across every Modal instance (see the per-instance registration
  // below): the currently open dialogs, oldest first.
  const openModals: object[] = [];

  // The document's own inline `overflow` from before ANY modal locked it, held
  // here for the same reason the stack above is shared: the value belongs to the
  // document, not to a dialog. Read the note on the lock in the effect below for
  // what goes wrong when each instance keeps its own copy.
  let overflowBeforeLock: string | null = null;
</script>

<script lang="ts">
  // An overlay dialog, portaled to <body> so it escapes the sidebar's
  // `backdrop-filter` containing block and `overflow` clipping (the same reason
  // the palette flyouts portal out). Used for the 설정 and 혼합 브러시 modals on
  // both desktop and mobile. Closes on the backdrop, the × button, or Escape.
  //
  // Two shapes, one set of machinery (`variant`): a centered card, and an
  // **오프캔버스** panel docked to the right edge at full height. The difference is
  // twenty lines of CSS; everything that is actually hard — the portal, the
  // stacking so Escape peels one dialog at a time, the document scroll lock and
  // its ordering hazard, the focus trap, the backdrop press/release test — is the
  // same problem either way and is solved once, here.
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { t } from '../i18n';

  interface Props {
    /** Whether the modal is shown. */
    open: boolean;
    /** Dialog title, shown in the header and used as the aria-label. */
    title: string;
    /** Optional Bootstrap icon class for the header (e.g. 'bi-sliders2'). */
    icon?: string;
    /** Called when the user dismisses the modal (backdrop / × / Escape). */
    onclose: () => void;
    /**
     * Dialog width in CSS px. Defaults to the compact 340 the toolbar dialogs
     * use; a content-heavy dialog (the snapshot manager's slot grid) asks for
     * more. `max-width: 100%` still applies, so a wide value degrades to the
     * viewport on a phone rather than overflowing it.
     */
    width?: number;
    /**
     * How the dialog sits on screen.
     *
     * - `'center'` (default) — a centered card, capped at 86% of the viewport.
     * - `'offcanvas'` — a full-height panel docked to the right edge, sliding in
     *   from it. For content that is a *document* rather than a form: the 도감
     *   상세 card and its in-game twin, which are long, scroll, and are read
     *   beside the thing they describe rather than on top of it. `width` still
     *   sets the panel's width and still degrades to the viewport on a phone.
     */
    variant?: 'center' | 'offcanvas';
    /** Body content. */
    children: Snippet;
  }

  let { open, title, icon, onclose, width = 340, variant = 'center', children }: Props = $props();


  let dialogEl = $state<HTMLDivElement | null>(null);

  // Backdrop press bookkeeping — see the overlay's handlers below. Plain `let`,
  // not `$state`: nothing renders off these.
  let pressedBackdrop = false;
  let pressX = 0;
  let pressY = 0;
  /** How far the pointer may travel between press and release and still count as
   *  a dismissing tap rather than a swipe. */
  const BACKDROP_SLOP = 10;

  // Every open Modal listens on `window` for Escape and Tab, so with one modal
  // stacked over another (the snapshot load options over the save/load list)
  // both would fire on a single Escape and close the pair. This module-level
  // stack — oldest first — makes only the topmost dialog respond, so Escape
  // peels one layer at a time and the focus trap belongs to the dialog the user
  // is actually looking at. A unique token per instance keeps it correct when
  // two modals mount in the same tick.
  const token = {};
  $effect(() => {
    if (!open) return;
    openModals.push(token);
    // Hold the document still underneath. On the sandbox pages this is already
    // true (global.css locks `html, body`), but that lock belongs to the app
    // alone (Base.astro's `app` prop) and every other page scrolls like an
    // ordinary document — and there a drag anywhere outside the dialog card
    // scrolls the page behind the backdrop, which on a phone is most of the
    // screen. Reference-counted off the same stack the
    // Escape handling uses, so a modal opened over another doesn't release the
    // lock when only the top one closes. An inline style beats the stylesheet's
    // `overflow: visible`, and restoring the saved value (rather than clearing
    // to '') leaves a page that set its own overflow as it was.
    //
    // Both the saved value and the "am I the one who locked it" test are module
    // state, NOT per-instance, and that is the whole correctness argument. The
    // first version kept `previousOverflow` on each instance and restored
    // whichever instance happened to empty the stack — right only if dialogs
    // close in reverse of the order they opened. Stack A, then B: B captures
    // 'hidden', because A had already locked. Close A first and B's cleanup runs
    // last, restoring *its* capture — so the document is left inline-locked with
    // nothing remaining to unlock it, which on a scrolling page is a permanently
    // dead scrollbar. Saving once, at the moment the lock is actually applied,
    // has no ordering assumption to violate.
    const root = document.documentElement;
    if (openModals.length === 1) {
      overflowBeforeLock = root.style.overflow;
      root.style.overflow = 'hidden';
    }
    return () => {
      const i = openModals.indexOf(token);
      if (i !== -1) openModals.splice(i, 1);
      // Forget any press in flight. The overlay's own handlers clear this, but
      // they only run if the press is allowed to finish: close on Escape (or any
      // other `onclose()`) mid-press and the element they live on is gone before
      // the release, with a `pointercancel` that isn't guaranteed. That matters
      // because a Modal instance outlives its dialog — ControlPanel mounts the
      // settings, blend, heat/cool and save-slot modals once each and only
      // toggles `open` — so a leftover `true` would sit here until the next time
      // that dialog opened, and then a mouse release over the backdrop with no
      // press of its own (a drag that began elsewhere; the mouse has no implicit
      // capture to make one) would measure travel against a stale point and
      // close a dialog nobody pressed on.
      pressedBackdrop = false;
      if (openModals.length === 0 && overflowBeforeLock !== null) {
        root.style.overflow = overflowBeforeLock;
        overflowBeforeLock = null;
      }
    };
  });
  const isTopmost = (): boolean => openModals[openModals.length - 1] === token;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  /**
   * Dismiss from a backdrop release, eating the `click` that comes after it.
   *
   * `click` is dispatched *after* `pointerup`, and by then this handler has
   * already closed the dialog and Svelte has taken the overlay out of the DOM —
   * so the click lands on whatever is now under the cursor. On the 도감 that is a
   * grid card, and tapping beside an open detail panel to dismiss it immediately
   * opened a different material's panel instead: the dialog looked like it never
   * closed, it just changed its mind about what it was showing.
   *
   * Deciding on the pointer pair and *acting* on it is still right (see the
   * overlay's handlers for why the press/release/travel test is what works on
   * touch) — what was missing is that the gesture isn't over at `pointerup`. The
   * capture-phase trap swallows exactly one click, anywhere, and disarms itself
   * either way: a release that produces no click at all (a touch the UA decides
   * was a scroll) must not leave the trap waiting to eat someone's next one.
   */
  function dismissFromBackdrop(): void {
    let timer: ReturnType<typeof setTimeout>;
    const swallow = (ev: MouseEvent): void => {
      ev.stopPropagation();
      ev.preventDefault();
      window.removeEventListener('click', swallow, true);
      clearTimeout(timer);
    };
    window.addEventListener('click', swallow, true);
    timer = setTimeout(() => window.removeEventListener('click', swallow, true), 500);
    onclose();
  }

  // The tabbable controls inside the dialog card, for the focus trap and for
  // moving focus in on open. Skips hidden/disabled controls.
  function focusables(): HTMLElement[] {
    if (!dialogEl) return [];
    return Array.from(
      dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  // On open, move focus into the dialog (a11y: keyboard/AT users land inside it,
  // not on the toolbar behind the backdrop); on close, restore focus to whatever
  // opened it. `tick()` waits for the `{#if open}` block to mount and bind
  // `dialogEl` before focusing (it isn't bound yet when the effect first runs).
  $effect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    let cancelled = false;
    tick().then(() => {
      if (!cancelled && open) (focusables()[0] ?? dialogEl)?.focus();
    });
    return () => {
      cancelled = true;
      opener?.focus?.();
    };
  });

  function onKeydown(e: KeyboardEvent): void {
    if (!open || !isTopmost()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key !== 'Tab') return;
    // A MaterialPicker popover (blend modal) portals its flyout out to <body>,
    // so its focused item isn't a descendant of the dialog. Leave the picker's
    // own keyboard handling alone while focus is inside it (identified by the
    // data-picker-portal marker) — only trap Tab within the dialog otherwise.
    const active = document.activeElement as HTMLElement | null;
    if (active && active.closest('[data-picker-portal]')) return;
    const f = focusables();
    if (f.length === 0) {
      e.preventDefault();
      dialogEl?.focus();
      return;
    }
    const first = f[0];
    const last = f[f.length - 1];
    const inside = active ? dialogEl?.contains(active) : false;
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- The backdrop closes the dialog when the press *and* the release are on it,
       not when either comes from inside the dialog card. Dismissing on the press
       alone meant a finger that landed beside the card and started to drag —
       reaching for the content, or a stray flick — closed the dialog before it
       had moved a pixel. The travel test is what makes the release safe to trust
       on touch: the UA gives the pointerdown target implicit capture, so a
       pointerup is retargeted to the overlay even when the finger ended up over
       the card, and a position test is the only thing that still tells a tap
       from a swipe. -->
  {@const offcanvas = variant === 'offcanvas'}
  <div
    class="overlay"
    class:offcanvas
    use:portal
    onpointerdown={(e) => {
      pressedBackdrop = e.target === e.currentTarget;
      pressX = e.clientX;
      pressY = e.clientY;
    }}
    onpointercancel={() => (pressedBackdrop = false)}
    onpointerup={(e) => {
      if (!pressedBackdrop) return;
      pressedBackdrop = false;
      if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > BACKDROP_SLOP) return;
      if (e.target !== e.currentTarget) return;
      dismissFromBackdrop();
    }}
  >
    <div
      class="modal"
      class:offcanvas
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      style:width="{width}px"
      bind:this={dialogEl}
    >
      <div class="modal-head">
        {#if icon}<i class={`bi ${icon}`} aria-hidden="true"></i>{/if}
        <span class="modal-title">{title}</span>
        <button class="close" onclick={onclose} aria-label={t('close')} title={t('close')}>
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="modal-body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  /* 오프캔버스: the panel is pinned to the right edge at full height, so the
     overlay stops centering and stops insetting it. The backdrop itself is
     unchanged — same scrim, same press/release dismissal. */
  .overlay.offcanvas {
    align-items: stretch;
    justify-content: flex-end;
    padding: 0;
  }

  .modal {
    display: flex;
    flex-direction: column;
    /* Overridden per instance by the `width` prop's inline style. */
    width: 340px;
    max-width: 100%;
    /* The pair, not just the second line: a browser that doesn't know `dvh`
       drops the whole declaration as invalid, and the dialog loses its cap
       entirely — a long codex entry then runs off the bottom of the screen with
       nothing to scroll, since `.modal-body` only scrolls once the modal is
       capped. */
    max-height: 86vh;
    max-height: min(86vh, 86dvh);
    background: rgba(24, 24, 30, 0.98);
    border: 1px solid #2a2a33;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
    color: #e8e8ee;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    user-select: none;
  }

  /* The panel form. `width` still comes from the inline style (so a caller sizes
     it the same way either way) and `max-width: 100%` still caps it, which is
     what makes this a full-screen sheet on a phone with no second rule. Only the
     right edge is drawn: the other three sit against the viewport. */
  .modal.offcanvas {
    height: 100%;
    max-height: 100%;
    border-radius: 12px 0 0 12px;
    border-right: none;
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.55);
    animation: offcanvas-in 0.22s cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes offcanvas-in {
    from {
      transform: translateX(100%);
    }
  }

  /* The slide is decoration; the panel still has to appear. */
  @media (prefers-reduced-motion: reduce) {
    .modal.offcanvas {
      animation: none;
    }
  }

  .modal-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid #2a2a33;
    font-weight: 600;
  }
  .modal-head i {
    color: #6ea8fe;
    font-size: 16px;
  }
  .modal-title {
    flex: 1 1 auto;
    /* The dialog suppresses selection so a drag on it doesn't smear text (it
       sits over a canvas the app drags for a living). The title is the
       exception: on the codex it names the material, which is the thing someone
       wants to copy. Scoped to the element, so it beats the value inherited from
       `.modal` while the rest of the chrome stays unselectable. */
    user-select: text;
  }
  .close {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font-size: 13px;
  }
  /* On a phone this 28px button is the dialog's only visible way out (Escape
     needs a keyboard, and the backdrop is not an affordance anyone is told
     about). Grow the hit area, not the button: a pseudo-element counts as part
     of its originating element for hit-testing, so the target reaches 44px with
     the paint and the 52px header height both untouched. */
  .close::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 44px;
    height: 44px;
  }

  .close:hover {
    border-color: #3a3a46;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #3a3a46 transparent;
  }
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }
  .modal-body::-webkit-scrollbar-thumb {
    background: #3a3a46;
    border-radius: 4px;
  }
</style>
