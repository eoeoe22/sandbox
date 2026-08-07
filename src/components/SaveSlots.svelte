<script lang="ts">
  // Modal for managing named sandbox snapshots: save the current world under a
  // name + description, list saved snapshots, load one back, edit, delete, and
  // move them in and out of the browser as files. The actual serialize/apply
  // lives in state/snapshots.ts; this component is a thin UI shell that reads
  // the list on open and refreshes after each mutation.
  import {
    listSnapshots,
    saveLiveSnapshot,
    loadSnapshot,
    applyWorld,
    deleteSnapshot,
    updateSnapshot,
    exportSnapshot,
    importSnapshotFromText,
    MAX_SNAPSHOTS,
    type SnapshotMeta,
  } from '../state/snapshots';
  import {
    downloadTextFile,
    SNAPSHOT_FILE_EXT,
    SNAPSHOT_FILE_MAX_BYTES,
  } from '../state/snapshotFile';
  import { $gridDims as gridDims } from '../state/store';
  import type { PersistedWorld } from '../state/persistence';
  import Modal from './Modal.svelte';
  import SnapshotLoad from './SnapshotLoad.svelte';
  import { t } from '../i18n';

  /** Longest description the inputs accept — mirrors MAX_DESC_LEN in the store. */
  const DESC_MAX = 200;

  let snapshots = $state<SnapshotMeta[]>([]);
  let newName = $state('');
  let newDesc = $state('');
  // The id of a snapshot currently being edited; its row/card swaps to a form.
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDesc = $state('');
  // Flash the last action's outcome so the user gets feedback (saved / loaded /
  // failed) without a modal or toast. `flashBad` styles failures differently —
  // a red "not a snapshot file" shouldn't look like a green "saved".
  let flash = $state<string | null>(null);
  let flashBad = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  // Gallery (big thumbnails, grid) vs list (compact rows with small thumbs).
  // Gallery is the default — it shows off the captured previews best.
  let viewMode = $state<'gallery' | 'list'>('gallery');
  // Hidden <input type="file">, clicked by the 파일 불러오기 button.
  let fileInput = $state<HTMLInputElement | null>(null);
  // True while a snapshot file is dragged over the panel (drop target hint).
  let dragOver = $state(false);
  // The snapshot whose load options are open. Loading is a two-step action: the
  // sizes rarely match, so the user picks how it lands (and sees a preview)
  // before anything replaces what's on the canvas.
  let pending = $state<{ name: string; world: PersistedWorld } | null>(null);

  function refresh(): void {
    snapshots = listSnapshots();
  }

  // This component lives inside Modal's `{#if open}`, so it mounts fresh each
  // time the modal opens. Loading here is the reliable path: the parent's
  // openSaveSlots() sets `saveSlotsOpen = true` and calls `open()` in the same
  // tick, but the `bind:this` binding lags the open state by a tick, so that
  // call can no-op on first open. Mounting is guaranteed whenever the modal is
  // shown, so the list is always current (another tab's saves included).
  $effect(() => {
    refresh();
  });

  // Reset transient state (the list is reloaded by the mount effect above).
  export function open(): void {
    newName = '';
    newDesc = '';
    editingId = null;
    flash = null;
  }

  function showFlash(msg: string, bad = false): void {
    flash = msg;
    flashBad = bad;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = null;
    }, 2500);
  }

  function handleSave(): void {
    // Check the deterministic cap before attempting the write so the user can
    // tell "delete a slot" from "storage is full".
    if (snapshots.length >= MAX_SNAPSHOTS) {
      showFlash(t('save.limitExceeded'), true);
      return;
    }
    const meta = saveLiveSnapshot(newName, newDesc);
    if (meta) {
      newName = '';
      newDesc = '';
      showFlash(t('save.saved', { name: meta.name }));
    } else {
      showFlash(t('save.saveFailed'), true);
    }
    refresh();
  }

  /** Open the load options for a snapshot. Nothing is applied yet. */
  function handleLoad(s: SnapshotMeta): void {
    const world = loadSnapshot(s.id);
    if (!world) {
      showFlash(t('save.loadFailed'), true);
      return;
    }
    pending = { name: s.name, world };
  }

  function handleConfirmLoad(placed: PersistedWorld): void {
    pending = null;
    const ok = applyWorld(placed);
    showFlash(ok ? t('save.loadOk') : t('save.loadFailed'), !ok);
  }

  function handleDelete(id: string, name: string): void {
    if (!confirm(t('save.deleteConfirm', { name }))) return;
    deleteSnapshot(id);
    showFlash(t('save.deleted', { name }));
    refresh();
  }

  function startEdit(s: SnapshotMeta): void {
    editingId = s.id;
    editName = s.name;
    editDesc = s.desc ?? '';
  }

  function commitEdit(id: string): void {
    if (editingId !== id) return;
    const ok = updateSnapshot(id, editName, editDesc);
    editingId = null;
    if (!ok) showFlash(t('save.renameFailed'), true);
    refresh();
  }

  /** Write one snapshot out as a `.psbx.json` file (title in the filename,
   *  description + world inside). */
  function handleExport(id: string, name: string): void {
    const file = exportSnapshot(id);
    if (!file) {
      showFlash(t('save.exportFailed'), true);
      return;
    }
    downloadTextFile(file.filename, file.text);
    showFlash(t('save.exported', { name }));
  }

  /**
   * Read a picked/dropped snapshot file into the list. Deliberately does not
   * touch the canvas — the import lands as a new entry the user can load when
   * they're ready, so it never destroys whatever they're building.
   */
  async function importFile(file: File): Promise<void> {
    if (file.size > SNAPSHOT_FILE_MAX_BYTES) {
      showFlash(t('save.importTooBig'), true);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      showFlash(t('save.importReadFailed'), true);
      return;
    }
    // Fall back to the filename (minus our extension) when the file carries no
    // title, so an entry is never nameless.
    const stem = file.name.endsWith(SNAPSHOT_FILE_EXT)
      ? file.name.slice(0, -SNAPSHOT_FILE_EXT.length)
      : file.name.replace(/\.[^.]+$/, '');
    const result = importSnapshotFromText(text, stem);
    if ('meta' in result) {
      showFlash(t('save.imported', { name: result.meta.name }));
    } else {
      showFlash(
        result.error === 'invalid'
          ? t('save.importInvalid')
          : result.error === 'limit'
            ? t('save.importLimit')
            : t('save.importFailed'),
        true,
      );
    }
    refresh();
  }

  function handleFilePick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input so picking the same file twice in a row fires `change`
    // again (the browser skips it when the value is unchanged).
    input.value = '';
    if (file) void importFile(file);
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void importFile(file);
  }

  function fmtDate(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return '';
    }
  }

  // Focus + select the edit-name input as soon as it mounts, so the user can
  // start typing without an extra click.
  function autofocus(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
</script>

<div
  class="snapshots"
  class:drag-over={dragOver}
  role="group"
  aria-label={t('modal.saveTitle')}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={handleDrop}
>
  <div class="save-row">
    <input
      class="name-input"
      type="text"
      placeholder={t('save.namePlaceholder')}
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
    <button class="ctl save-btn" onclick={handleSave} aria-label={t('save.saveAria')}>
      <i class="bi bi-save" aria-hidden="true"></i>
      <span>{t('save.save')}</span>
    </button>
  </div>
  <input
    class="desc-input"
    type="text"
    placeholder={t('save.descPlaceholder')}
    value={newDesc}
    maxlength={DESC_MAX}
    oninput={(e) => (newDesc = e.currentTarget.value)}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    }}
  />

  {#if flash}
    <p class="flash" class:bad={flashBad}>{flash}</p>
  {/if}

  <div class="toolbar">
    <button
      class="ctl file-btn"
      onclick={() => fileInput?.click()}
      title={t('save.importTooltip')}
    >
      <i class="bi bi-folder2-open" aria-hidden="true"></i>
      <span>{t('save.import')}</span>
    </button>
    <!-- Accept both the full double extension and a bare .json: some browsers
         and file pickers only match the last segment. -->
    <input
      bind:this={fileInput}
      class="file-input"
      type="file"
      accept=".psbx.json,.json,application/json"
      onchange={handleFilePick}
      tabindex="-1"
      aria-hidden="true"
    />

    {#if snapshots.length > 0}
      <div class="view-toggle" role="radiogroup" aria-label={t('save.viewToggleGroup')}>
        <button
          class="seg"
          role="radio"
          aria-checked={viewMode === 'gallery'}
          class:active={viewMode === 'gallery'}
          onclick={() => (viewMode = 'gallery')}
          title={t('save.galleryTooltip')}
        >
          <i class="bi bi-grid" aria-hidden="true"></i>
        </button>
        <button
          class="seg"
          role="radio"
          aria-checked={viewMode === 'list'}
          class:active={viewMode === 'list'}
          onclick={() => (viewMode = 'list')}
          title={t('save.listTooltip')}
        >
          <i class="bi bi-list-ul" aria-hidden="true"></i>
        </button>
      </div>
    {/if}
  </div>

  <div class="scroller">
    {#if snapshots.length === 0}
      <p class="empty">{t('save.empty')}</p>
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
                  onclick={() => handleLoad(s)}
                  aria-label={t('save.loadAria', { name: s.name })}
                  title={t('save.loadTooltip')}
                >
                  <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
                </button>
                <button
                  class="mini"
                  onclick={() => handleExport(s.id, s.name)}
                  aria-label={t('save.exportAria', { name: s.name })}
                  title={t('save.exportTooltip')}
                >
                  <i class="bi bi-download" aria-hidden="true"></i>
                </button>
                <button
                  class="mini"
                  onclick={() => startEdit(s)}
                  aria-label={t('save.renameAria', { name: s.name })}
                  title={t('save.renameTooltip')}
                >
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </button>
                <button
                  class="mini danger"
                  onclick={() => handleDelete(s.id, s.name)}
                  aria-label={t('save.deleteAria', { name: s.name })}
                  title={t('save.deleteTooltip')}
                >
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            {#if editingId === s.id}
              <div class="edit-form">
                <input
                  class="rename-input"
                  type="text"
                  value={editName}
                  maxlength={40}
                  use:autofocus
                  oninput={(e) => (editName = e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(s.id);
                    } else if (e.key === 'Escape') {
                      editingId = null;
                    }
                  }}
                />
                <input
                  class="rename-input desc"
                  type="text"
                  placeholder={t('save.descPlaceholder')}
                  value={editDesc}
                  maxlength={DESC_MAX}
                  oninput={(e) => (editDesc = e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(s.id);
                    } else if (e.key === 'Escape') {
                      editingId = null;
                    }
                  }}
                />
                <button class="ctl tiny" onclick={() => commitEdit(s.id)}>
                  {t('save.save')}
                </button>
              </div>
            {:else}
              <div class="card-info">
                <span class="card-name" title={s.name} ondblclick={() => startEdit(s)}>
                  {s.name}
                </span>
                {#if s.desc}
                  <span class="card-desc" title={s.desc}>{s.desc}</span>
                {/if}
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
            {#if editingId === s.id}
              <div class="edit-form">
                <input
                  class="rename-input"
                  type="text"
                  value={editName}
                  maxlength={40}
                  use:autofocus
                  oninput={(e) => (editName = e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(s.id);
                    } else if (e.key === 'Escape') {
                      editingId = null;
                    }
                  }}
                />
                <input
                  class="rename-input desc"
                  type="text"
                  placeholder={t('save.descPlaceholder')}
                  value={editDesc}
                  maxlength={DESC_MAX}
                  oninput={(e) => (editDesc = e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit(s.id);
                    } else if (e.key === 'Escape') {
                      editingId = null;
                    }
                  }}
                />
                <button class="ctl tiny" onclick={() => commitEdit(s.id)}>
                  {t('save.save')}
                </button>
              </div>
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
                <span class="row-name" title={s.name} ondblclick={() => startEdit(s)}>
                  {s.name}
                </span>
                {#if s.desc}
                  <span class="row-desc" title={s.desc}>{s.desc}</span>
                {/if}
                <span class="row-meta">
                  {s.w}×{s.h} · {fmtDate(s.createdAt)}
                </span>
              </div>
              <div class="row-actions">
                <button
                  class="mini"
                  onclick={() => handleLoad(s)}
                  aria-label={t('save.loadAria', { name: s.name })}
                  title={t('save.loadTooltip')}
                >
                  <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
                </button>
                <button
                  class="mini"
                  onclick={() => handleExport(s.id, s.name)}
                  aria-label={t('save.exportAria', { name: s.name })}
                  title={t('save.exportTooltip')}
                >
                  <i class="bi bi-download" aria-hidden="true"></i>
                </button>
                <button
                  class="mini"
                  onclick={() => startEdit(s)}
                  aria-label={t('save.renameAria', { name: s.name })}
                  title={t('save.renameTooltip')}
                >
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </button>
                <button
                  class="mini danger"
                  onclick={() => handleDelete(s.id, s.name)}
                  aria-label={t('save.deleteAria', { name: s.name })}
                  title={t('save.deleteTooltip')}
                >
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <p class="hint">
    {t('save.hint')}
  </p>
</div>

<!-- Stacked over the save/load list. Modal tracks which dialog is topmost, so
     Escape closes this one first and leaves the list open behind it. -->
<Modal
  open={pending !== null}
  title={t('load.title')}
  icon="bi-aspect-ratio"
  width={460}
  onclose={() => (pending = null)}
>
  {#if pending}
    <SnapshotLoad
      world={pending.world}
      name={pending.name}
      dstW={$gridDims.w}
      dstH={$gridDims.h}
      onconfirm={handleConfirmLoad}
      oncancel={() => (pending = null)}
    />
  {/if}
</Modal>

<style>
  .snapshots {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Dropping a snapshot file anywhere on the panel imports it; the outline is
     the only affordance that says so mid-drag. */
  .snapshots.drag-over {
    outline: 2px dashed #6ea8fe;
    outline-offset: 6px;
    border-radius: 6px;
  }

  .save-row {
    display: flex;
    gap: 6px;
  }
  .name-input,
  .desc-input,
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
  .desc-input:focus,
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
  .flash.bad {
    background: #2e1e1e;
    color: #ffa0a0;
  }

  /* File import + view toggle, on one wrapping row. */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .file-btn {
    flex: none;
  }
  /* The real <input type="file"> is never shown — the styled button clicks it.
     Kept in the DOM (not `display: none`) so the picker still works. */
  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  /* Name + description + confirm, shown in place of a card/row while editing. */
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .rename-input.desc {
    font-size: 12px;
  }
  .ctl.tiny {
    align-self: flex-start;
    padding: 3px 8px;
    font-size: 12px;
  }

  .view-toggle {
    display: inline-flex;
    gap: 2px;
    margin-left: auto;
    padding: 2px;
    border: 1px solid #2a2a33;
    border-radius: 6px;
    background: #14141a;
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
  /* Two lines of description max: enough to read the gist, bounded so a long
     note can't push the metadata out of a fixed-width card. */
  .card-desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #9a9aa8;
    font-size: 10px;
    line-height: 1.3;
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
  .row-desc {
    color: #9a9aa8;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
