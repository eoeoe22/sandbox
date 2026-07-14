<script lang="ts">
  // A centered overlay dialog, portaled to <body> so it escapes the sidebar's
  // `backdrop-filter` containing block and `overflow` clipping (the same reason
  // the palette flyouts portal out). Used for the 설정 and 혼합 브러시 modals on
  // both desktop and mobile. Closes on the backdrop, the × button, or Escape.
  import type { Snippet } from 'svelte';

  interface Props {
    /** Whether the modal is shown. */
    open: boolean;
    /** Dialog title, shown in the header and used as the aria-label. */
    title: string;
    /** Optional Bootstrap icon class for the header (e.g. 'bi-sliders2'). */
    icon?: string;
    /** Called when the user dismisses the modal (backdrop / × / Escape). */
    onclose: () => void;
    /** Body content. */
    children: Snippet;
  }

  let { open, title, icon, onclose, children }: Props = $props();

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- The backdrop closes the dialog on a direct press (target === backdrop),
       but not when the press bubbles up from inside the dialog card. -->
  <div
    class="overlay"
    use:portal
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div class="modal-head">
        {#if icon}<i class={`bi ${icon}`} aria-hidden="true"></i>{/if}
        <span class="modal-title">{title}</span>
        <button class="close" onclick={onclose} aria-label="닫기" title="닫기">
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

  .modal {
    display: flex;
    flex-direction: column;
    width: 340px;
    max-width: 100%;
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
  }
  .close {
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
