<script lang="ts">
  // Start screen's 불러오기 modal: browse saved slots and jump straight into one,
  // or bring in a `.psbx.json` file. There's no live canvas here (the game
  // hasn't started), so unlike SaveSlots.svelte — its in-game twin — this has
  // no "save the current world" row; everything else (gallery/list view,
  // rename/describe, export, drag-and-drop import) mirrors it so the two
  // don't drift into inconsistent UIs for the same underlying slots.
  import {
    listSnapshots,
    deleteSnapshot,
    updateSnapshot,
    exportSnapshot,
    importSnapshotFromText,
    type SnapshotMeta,
  } from '../state/snapshots';
  import { downloadTextFile, SNAPSHOT_FILE_EXT, SNAPSHOT_FILE_MAX_BYTES } from '../state/snapshotFile';
  import Modal from './Modal.svelte';
  import { t } from '../i18n';

  let { isOpen = false, onClose = () => {} } = $props<{
    isOpen?: boolean;
    onClose?: () => void;
  }>();

  /** Longest description the rename form accepts — mirrors MAX_DESC_LEN in the store. */
  const DESC_MAX = 200;

  let snapshots = $state<SnapshotMeta[]>([]);
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDesc = $state('');
  let flash = $state<string | null>(null);
  let flashBad = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let viewMode = $state<'gallery' | 'list'>('gallery');
  let fileInput = $state<HTMLInputElement | null>(null);
  let dragOver = $state(false);

  function refresh(): void {
    snapshots = listSnapshots();
  }

  // Unlike SaveSlots.svelte — freshly mounted (and so freshly initialized)
  // every time its own Modal opens — this component is mounted once by
  // StartMenu and simply toggles `isOpen`, so its script-level state survives
  // a close. Without resetting it here, closing the modal mid-rename (Escape,
  // backdrop, ×) leaves `editingId` pointing at a snapshot and reopening
  // lands straight back on the rename form, pre-filled with whatever was
  // typed before.
  $effect(() => {
    if (isOpen) {
      refresh();
      editingId = null;
      flash = null;
      clearTimeout(flashTimer);
      dragOver = false;
    }
  });

  function showFlash(msg: string, bad = false): void {
    flash = msg;
    flashBad = bad;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = null;
    }, 2500);
  }

  function handleDelete(e: MouseEvent, s: SnapshotMeta): void {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm(t('save.deleteConfirm', { name: s.name }))) return;
    deleteSnapshot(s.id);
    showFlash(t('save.deleted', { name: s.name }));
    refresh();
  }

  function handleExport(e: MouseEvent, s: SnapshotMeta): void {
    e.stopPropagation();
    e.preventDefault();
    const file = exportSnapshot(s.id);
    if (!file) {
      showFlash(t('save.exportFailed'), true);
      return;
    }
    downloadTextFile(file.filename, file.text);
    showFlash(t('save.exported', { name: s.name }));
  }

  function startEdit(e: MouseEvent, s: SnapshotMeta): void {
    e.stopPropagation();
    e.preventDefault();
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

  async function importFile(file: File): Promise<void> {
    if (!file.name.endsWith(SNAPSHOT_FILE_EXT) && !file.name.endsWith('.json')) {
      showFlash(t('save.importInvalid'), true);
      return;
    }
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

  function handleFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void importFile(file);
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void importFile(file);
  }

  function fmtDate(ms: number): string {
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return '';
    }
  }

  function autofocus(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
</script>

{#if isOpen}
  <Modal open title={t('startLoad.title')} icon="bi-folder2-open" width={760} onclose={onClose}>
    <div
      class="panel"
      class:drag-over={dragOver}
      role="region"
      aria-label={t('startLoad.dropAria')}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
    >
      <div class="top-row">
        <p class="subtitle">{t('startLoad.subtitle')}</p>
        <div class="toolbar">
          <button class="ctl" onclick={() => fileInput?.click()} title={t('save.importTooltip')}>
            <i class="bi bi-file-earmark-arrow-up" aria-hidden="true"></i>
            <span>{t('save.import')}</span>
          </button>
          <input
            bind:this={fileInput}
            class="file-input"
            type="file"
            accept={`${SNAPSHOT_FILE_EXT},.json,application/json`}
            onchange={handleFileSelect}
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
      </div>

      {#if flash}
        <p class="flash" class:bad={flashBad}>{flash}</p>
      {/if}

      <div class="scroller">
        {#if snapshots.length === 0}
          <div class="empty-state">
            <i class="bi bi-folder2" aria-hidden="true"></i>
            <h3>{t('startLoad.empty')}</h3>
            <p>{t('startLoad.emptyHint')}</p>
          </div>
        {:else if viewMode === 'gallery'}
          <div class="gallery">
            {#each snapshots as s (s.id)}
              <!-- A `<div>`, not an `<a>`: the rename form below puts real
                   `<input>`s in here, and an anchor wrapping form controls is
                   both invalid HTML and a keyboard trap (Enter in the input
                   would double as "follow this link"). Loading is its own
                   explicit action instead — the primary button in the overlay. -->
              <div class="card">
                <div class="thumb-wrap">
                  {#if s.thumb}
                    <img class="thumb" src={s.thumb} alt={s.name} loading="lazy" />
                  {:else}
                    <div class="thumb-placeholder" aria-hidden="true">
                      <i class="bi bi-image"></i>
                    </div>
                  {/if}
                  <div class="dim-badge">{s.w}×{s.h}</div>
                  <div class="card-overlay">
                    <a
                      class="mini"
                      href={`/sandbox?slot=${s.id}`}
                      aria-label={t('save.loadAria', { name: s.name })}
                      title={t('save.loadTooltip')}
                    >
                      <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
                    </a>
                    <button
                      class="mini"
                      onclick={(e) => handleExport(e, s)}
                      aria-label={t('save.exportAria', { name: s.name })}
                      title={t('save.exportTooltip')}
                    >
                      <i class="bi bi-download" aria-hidden="true"></i>
                    </button>
                    <button
                      class="mini"
                      onclick={(e) => startEdit(e, s)}
                      aria-label={t('save.renameAria', { name: s.name })}
                      title={t('save.renameTooltip')}
                    >
                      <i class="bi bi-pencil" aria-hidden="true"></i>
                    </button>
                    <button
                      class="mini danger"
                      onclick={(e) => handleDelete(e, s)}
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
                    <span class="card-name" title={s.name} ondblclick={(e) => startEdit(e, s)}>
                      {s.name}
                    </span>
                    {#if s.desc}
                      <span class="card-desc" title={s.desc}>{s.desc}</span>
                    {/if}
                    <span class="card-meta">{fmtDate(s.createdAt)}</span>
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
                    <span class="row-name" title={s.name} ondblclick={(e) => startEdit(e, s)}>
                      {s.name}
                    </span>
                    {#if s.desc}
                      <span class="row-desc" title={s.desc}>{s.desc}</span>
                    {/if}
                    <span class="row-meta">{s.w}×{s.h} · {fmtDate(s.createdAt)}</span>
                  </div>
                  <div class="row-actions">
                    <a
                      class="mini"
                      href={`/sandbox?slot=${s.id}`}
                      aria-label={t('save.loadAria', { name: s.name })}
                      title={t('save.loadTooltip')}
                    >
                      <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
                    </a>
                    <button
                      class="mini"
                      onclick={(e) => handleExport(e, s)}
                      aria-label={t('save.exportAria', { name: s.name })}
                      title={t('save.exportTooltip')}
                    >
                      <i class="bi bi-download" aria-hidden="true"></i>
                    </button>
                    <button
                      class="mini"
                      onclick={(e) => startEdit(e, s)}
                      aria-label={t('save.renameAria', { name: s.name })}
                      title={t('save.renameTooltip')}
                    >
                      <i class="bi bi-pencil" aria-hidden="true"></i>
                    </button>
                    <button
                      class="mini danger"
                      onclick={(e) => handleDelete(e, s)}
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
    </div>
  </Modal>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: min(420px, 74vw);
    max-width: 720px;
  }
  .panel.drag-over {
    outline: 2px dashed #6ea8fe;
    outline-offset: 6px;
    border-radius: 6px;
  }

  .top-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .subtitle {
    margin: 0;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1.4;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
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

  .scroller {
    max-height: 62vh;
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

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    background: rgba(15, 23, 42, 0.4);
    border-radius: 0.75rem;
    border: 1px dashed rgba(255, 255, 255, 0.1);
  }
  .empty-state i {
    font-size: 2.4rem;
    color: #3a3a46;
  }
  .empty-state h3 {
    margin: 0.6rem 0 0.25rem;
    color: #e2e8f0;
    font-size: 1.05rem;
  }
  .empty-state p {
    margin: 0;
    color: #64748b;
    font-size: 0.85rem;
  }

  /* ---- Gallery view ---- */
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid #2a2a33;
    border-radius: 8px;
    background: #1b1b22;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease;
  }
  .card:hover {
    border-color: #6ea8fe;
    transform: translateY(-2px);
  }
  .thumb-wrap {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: 5px;
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
    font-size: 26px;
  }
  .thumb-placeholder.sm {
    font-size: 14px;
  }
  .dim-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.75);
    color: #cbd5e1;
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 4px;
  }
  .card-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4px;
    padding: 4px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent 55%);
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
    padding: 0 2px;
  }
  .card-name {
    color: #e8e8ee;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
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
  .row:hover {
    border-color: #6ea8fe;
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
    font-weight: 600;
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

  /* ---- Rename form (shared shape, gallery card / list row) ---- */
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 2px;
  }
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
  .rename-input:focus {
    outline: none;
    border-color: #6ea8fe;
  }
  .rename-input.desc {
    font-size: 12px;
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
    text-decoration: none;
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
  .ctl.tiny {
    align-self: flex-start;
    padding: 3px 8px;
    font-size: 12px;
  }
</style>
