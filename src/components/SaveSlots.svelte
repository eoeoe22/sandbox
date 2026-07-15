<script lang="ts">
  // Modal for managing named sandbox snapshots: save the current world under a
  // name, list saved snapshots, load one back, rename, or delete. The actual
  // serialize/apply lives in state/snapshots.ts; this component is a thin UI
  // shell that reads the list on open and refreshes after each mutation.
  import {
    listSnapshots,
    saveLiveSnapshot,
    applySnapshot,
    deleteSnapshot,
    renameSnapshot,
    type SnapshotMeta,
  } from '../state/snapshots';

  let snapshots = $state<SnapshotMeta[]>([]);
  let newName = $state('');
  // The id of a snapshot currently being renamed; its row/card swaps to an input.
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  // Flash the last action's outcome so the user gets feedback (saved / loaded /
  // failed) without a modal or toast.
  let flash = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  // Gallery (big thumbnails, grid) vs list (compact rows with small thumbs).
  // Gallery is the default — it shows off the captured previews best.
  let viewMode = $state<'gallery' | 'list'>('gallery');

  function refresh(): void {
    snapshots = listSnapshots();
  }

  // Re-read every time the modal opens so a freshly-loaded page (or a snapshot
  // saved in another tab) is reflected.
  export function open(): void {
    newName = '';
    renamingId = null;
    flash = null;
    refresh();
  }

  function showFlash(msg: string): void {
    flash = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = null;
    }, 2500);
  }

  function handleSave(): void {
    // Check the deterministic cap before attempting the write so the user can
    // tell "delete a slot" from "storage is full".
    if (snapshots.length >= 50) {
      showFlash('저장 한도(50개) 초과 — 기존 스냅샷을 삭제하세요');
      return;
    }
    const meta = saveLiveSnapshot(newName);
    if (meta) {
      newName = '';
      showFlash(`"${meta.name}" 저장됨`);
    } else {
      showFlash('저장 실패 (저장 공간이 부족합니다)');
    }
    refresh();
  }

  function handleLoad(id: string): void {
    const ok = applySnapshot(id);
    showFlash(ok ? '불러오기 완료' : '불러오기 실패');
  }

  function handleDelete(id: string, name: string): void {
    if (!confirm(`"${name}" 삭제할까요?`)) return;
    deleteSnapshot(id);
    showFlash(`"${name}" 삭제됨`);
    refresh();
  }

  function startRename(s: SnapshotMeta): void {
    renamingId = s.id;
    renameValue = s.name;
  }

  function commitRename(id: string): void {
    if (renamingId !== id) return;
    const ok = renameSnapshot(id, renameValue);
    renamingId = null;
    if (!ok) showFlash('이름 변경 실패 (저장 공간 부족)');
    refresh();
  }

  function fmtDate(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return '';
    }
  }
</script>

<div class="snapshots">
  <div class="save-row">
    <input
      class="name-input"
      type="text"
      placeholder="저장할 이름 (비우면 자동)"
      value={newName}
      maxlength={40}
      oninput={(e) => (newName = e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSave();
        }
      }}
    />
    <button class="ctl save-btn" onclick={handleSave} aria-label="현재 캔버스 저장">
      <i class="bi bi-save" aria-hidden="true"></i>
      <span>저장</span>
    </button>
  </div>

  {#if flash}
    <p class="flash">{flash}</p>
  {/if}

  {#if snapshots.length > 0}
    <div class="view-toggle" role="group" aria-label="스냅샷 보기 방식">
      <button
        class="seg"
        class:active={viewMode === 'gallery'}
        onclick={() => (viewMode = 'gallery')}
        aria-pressed={viewMode === 'gallery'}
        title="갤러리 보기"
      >
        <i class="bi bi-grid" aria-hidden="true"></i>
      </button>
      <button
        class="seg"
        class:active={viewMode === 'list'}
        onclick={() => (viewMode = 'list')}
        aria-pressed={viewMode === 'list'}
        title="목록 보기"
      >
        <i class="bi bi-list-ul" aria-hidden="true"></i>
      </button>
    </div>
  {/if}

  <div class="scroller">
    {#if snapshots.length === 0}
      <p class="empty">저장된 스냅샷이 없습니다. 현재 샌드박스 상태를 저장해 보세요.</p>
    {:else if viewMode === 'gallery'}
      <div class="gallery">
        {#each snapshots as s (s.id)}
          <div class="card">
            <div class="thumb-wrap">
              {#if s.thumb}
                <img class="thumb" src={s.thumb} alt={s.name} loading="lazy" />
              {:else}
                <div class="thumb-placeholder" aria-hidden="true">
                  <i class="bi bi-image"></i>
                </div>
              {/if}
              <div class="card-overlay">
                <button
                  class="mini"
                  onclick={() => handleLoad(s.id)}
                  aria-label={`"${s.name}" 불러오기`}
                  title="불러오기"
                >
                  <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
                </button>
                <button
                  class="mini"
                  onclick={() => startRename(s)}
                  aria-label={`"${s.name}" 이름 변경`}
                  title="이름 변경"
                >
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </button>
                <button
                  class="mini danger"
                  onclick={() => handleDelete(s.id, s.name)}
                  aria-label={`"${s.name}" 삭제`}
                  title="삭제"
                >
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            {#if renamingId === s.id}
              <input
                class="rename-input"
                type="text"
                value={renameValue}
                maxlength={40}
                oninput={(e) => (renameValue = e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(s.id);
                  } else if (e.key === 'Escape') {
                    renamingId = null;
                  }
                }}
                onblur={() => commitRename(s.id)}
              />
            {:else}
              <div class="card-info">
                <span class="card-name" title={s.name} ondblclick={() => startRename(s)}>
                  {s.name}
                </span>
                <span class="card-meta">{s.w}×{s.h} · {fmtDate(s.createdAt)}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="list">
        {#each snapshots as s (s.id)}
          <div class="row">
            {#if renamingId === s.id}
              <input
                class="rename-input"
                type="text"
                value={renameValue}
                maxlength={40}
                oninput={(e) => (renameValue = e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(s.id);
                  } else if (e.key === 'Escape') {
                    renamingId = null;
                  }
                }}
                onblur={() => commitRename(s.id)}
              />
            {:else}
              <div class="row-thumb">
                {#if s.thumb}
                  <img src={s.thumb} alt={s.name} loading="lazy" />
                {:else}
                  <div class="thumb-placeholder sm" aria-hidden="true">
                    <i class="bi bi-image"></i>
                  </div>
                {/if}
              </div>
              <div class="row-info">
                <span class="row-name" title={s.name} ondblclick={() => startRename(s)}>
                  {s.name}
                </span>
                <span class="row-meta">
                  {s.w}×{s.h} · {fmtDate(s.createdAt)}
                </span>
              </div>
            {/if}
            <div class="row-actions">
              <button
                class="mini"
                onclick={() => handleLoad(s.id)}
                aria-label={`"${s.name}" 불러오기`}
                title="불러오기"
              >
                <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
              </button>
              <button
                class="mini"
                onclick={() => startRename(s)}
                aria-label={`"${s.name}" 이름 변경`}
                title="이름 변경"
              >
                <i class="bi bi-pencil" aria-hidden="true"></i>
              </button>
              <button
                class="mini danger"
                onclick={() => handleDelete(s.id, s.name)}
                aria-label={`"${s.name}" 삭제`}
                title="삭제"
              >
                <i class="bi bi-trash3" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <p class="hint">
    저장 스냅샷은 브라우저 로컬에 보관됩니다. 화면 크기가 달라도 현재 캔버스에 맞춰 불러옵니다.
  </p>
</div>

<style>
  .snapshots {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .save-row {
    display: flex;
    gap: 6px;
  }
  .name-input,
  .rename-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #14141a;
    color: #e8e8ee;
    font: inherit;
  }
  .name-input:focus,
  .rename-input:focus {
    outline: none;
    border-color: #6ea8fe;
  }
  .save-btn {
    flex: none;
  }

  .flash {
    margin: 0;
    padding: 4px 8px;
    border-radius: 4px;
    background: #1e2e1e;
    color: #9fcf9f;
    font-size: 12px;
  }

  .view-toggle {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #14141a;
    align-self: flex-start;
  }
  .seg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: #8a8a96;
    cursor: pointer;
    font-size: 14px;
  }
  .seg:hover {
    color: #e8e8ee;
  }
  .seg.active {
    background: #23324a;
    border-color: #6ea8fe;
    color: #6ea8fe;
  }

  /* Shared scroll container so gallery and list share one viewport. */
  .scroller {
    max-height: 360px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3a3a46 transparent;
  }
  .scroller::-webkit-scrollbar {
    width: 6px;
  }
  .scroller::-webkit-scrollbar-thumb {
    background: #3a3a46;
    border-radius: 3px;
  }

  .empty {
    margin: 12px 0;
    color: #7a7a88;
    font-size: 12px;
    text-align: center;
  }

  /* ---- Gallery view ---- */
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
  }
  .thumb-wrap {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: 4px;
    overflow: hidden;
    background: #101014;
  }
  .thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    display: block;
  }
  .thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #4a4a55;
    font-size: 22px;
  }
  .thumb-placeholder.sm {
    font-size: 14px;
  }
  /* Actions slide in over the thumbnail on hover/focus-within; on touch they
     stay visible since there's no hover. */
  .card-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4px;
    padding: 4px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent 60%);
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .thumb-wrap:hover .card-overlay,
  .thumb-wrap:focus-within .card-overlay {
    opacity: 1;
  }
  @media (hover: none) {
    .card-overlay {
      opacity: 1;
    }
  }
  .card-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .card-name {
    color: #e8e8ee;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .card-meta {
    color: #7a7a88;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  /* ---- List view ---- */
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
  }
  .row-thumb {
    flex: none;
    width: 48px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    background: #101014;
  }
  .row-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    display: block;
  }
  .row-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row-name {
    color: #e8e8ee;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .row-meta {
    color: #7a7a88;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .row-actions {
    display: flex;
    gap: 4px;
    flex: none;
  }

  .mini {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid #2a2a33;
    border-radius: 5px;
    background: #14141a;
    color: #cfcfd8;
    cursor: pointer;
    font-size: 13px;
  }
  .mini:hover {
    border-color: #3a3a46;
    color: #e8e8ee;
  }
  .mini.danger:hover {
    border-color: #c04848;
    color: #ff8888;
  }

  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #1b1b22;
    color: #e8e8ee;
    cursor: pointer;
    font: inherit;
  }
  .ctl:hover {
    border-color: #6ea8fe;
  }

  .hint {
    margin: 0;
    color: #6a6a78;
    font-size: 11px;
    line-height: 1.4;
  }
</style>
