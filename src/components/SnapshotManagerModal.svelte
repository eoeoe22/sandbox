<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listSnapshots,
    deleteSnapshot,
    importSnapshotFromText,
    exportSnapshot,
    type SnapshotMeta,
  } from '../state/snapshots';
  import { downloadTextFile, SNAPSHOT_FILE_EXT, SNAPSHOT_FILE_MAX_BYTES } from '../state/snapshotFile';
  import Modal from './Modal.svelte';

  let { isOpen = false, onClose = () => {} } = $props<{
    isOpen?: boolean;
    onClose?: () => void;
  }>();

  let snapshots = $state<SnapshotMeta[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);
  let dragOver = $state(false);
  let flash = $state<string | null>(null);

  function refresh() {
    snapshots = listSnapshots();
  }

  $effect(() => {
    if (isOpen) refresh();
  });

  function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (confirm('이 스냅샷을 삭제하시겠습니까?')) {
      deleteSnapshot(id);
      refresh();
    }
  }

  function handleExport(e: MouseEvent, meta: SnapshotMeta) {
    e.stopPropagation();
    const payload = exportSnapshot(meta.id);
    if (!payload) return;
    downloadTextFile(payload.filename, payload.content);
  }

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    processFile(file);
    input.value = '';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function processFile(file: File) {
    if (!file.name.endsWith(SNAPSHOT_FILE_EXT)) {
      flash = '지원하지 않는 파일 형식입니다 (.psbx.json 파일만 가능)';
      return;
    }
    if (file.size > SNAPSHOT_FILE_MAX_BYTES) {
      flash = '파일 크기가 너무 큽니다';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== 'string') return;
      const imported = importSnapshotFromText(text);
      if (imported) {
        flash = `"${imported.name}" 스냅샷을 가져왔습니다`;
        refresh();
      } else {
        flash = '스냅샷 파싱 실패';
      }
    };
    reader.readAsText(file);
  }
</script>

{#if isOpen}
  <!-- Modal's props are `open` / `onclose` (lowercase). This used to pass
       `onClose` and omit `open` entirely, so `{#if open}` inside Modal saw
       `undefined` and the dialog never rendered — the button opened nothing. -->
  <Modal open title="📂 저장 슬롯 & 스냅샷 관리자" icon="bi-folder2-open" width={720} onclose={onClose}>
    <div
      class="snapshot-modal-content"
      class:dragover={dragOver}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
      role="region"
      aria-label="스냅샷 드롭 존"
    >
      <div class="top-bar">
        <p class="subtitle">
          저장된 슬롯을 선택해 즉시 샌드박스를 실행하거나, .psbx.json 세이브 파일을 드래그하여 가져올 수 있습니다.
        </p>
        <div class="actions">
          <button class="btn-import" onclick={() => fileInput?.click()}>
            <i class="bi bi-file-earmark-arrow-up"></i>
            <span>파일 가져오기 (.psbx.json)</span>
          </button>
          <input
            type="file"
            accept={SNAPSHOT_FILE_EXT}
            bind:this={fileInput}
            onchange={handleFileSelect}
            class="hidden-file-input"
          />
        </div>
      </div>

      {#if flash}
        <div class="flash-banner">{flash}</div>
      {/if}

      {#if snapshots.length === 0}
        <div class="empty-state">
          <div class="icon">📁</div>
          <h3>저장된 스냅샷이 없습니다</h3>
          <p>게임 실행 중 [저장] 버튼을 누르면 이 곳에 슬롯으로 기록됩니다.</p>
        </div>
      {:else}
        <div class="snapshots-grid">
          {#each snapshots as snap}
            <a href={`/sandbox?slot=${snap.id}`} class="snap-card">
              <div class="thumb-container">
                {#if snap.thumb}
                  <img src={snap.thumb} alt={snap.name} class="thumb-img" />
                {:else}
                  <div class="thumb-placeholder">
                    <i class="bi bi-grid-3x3-gap"></i>
                  </div>
                {/if}
                <div class="dim-badge">{snap.w}×{snap.h}</div>
              </div>
              <div class="snap-info">
                <h4 class="snap-name">{snap.name}</h4>
                {#if snap.desc}
                  <p class="snap-desc">{snap.desc}</p>
                {/if}
                <div class="snap-meta">
                  <span class="date">{new Date(snap.createdAt).toLocaleDateString('ko-KR')}</span>
                  <div class="btn-group">
                    <button
                      class="icon-btn"
                      title="파일로 내보내기"
                      onclick={(e) => handleExport(e, snap)}
                    >
                      <i class="bi bi-download"></i>
                    </button>
                    <button
                      class="icon-btn danger"
                      title="삭제"
                      onclick={(e) => handleDelete(e, snap.id)}
                    >
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .snapshot-modal-content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 320px;
    max-width: 720px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .top-bar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .subtitle {
    color: #94a3b8;
    font-size: 0.9rem;
    margin: 0;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-import {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(79, 70, 229, 0.2);
    border: 1px solid rgba(99, 102, 241, 0.4);
    color: #a5b4fc;
    border-radius: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-import:hover {
    background: rgba(79, 70, 229, 0.35);
    color: #fff;
  }

  .hidden-file-input {
    display: none;
  }

  .flash-banner {
    background: rgba(14, 165, 233, 0.2);
    border: 1px solid rgba(56, 189, 248, 0.4);
    color: #7dd3fc;
    padding: 0.6rem 0.8rem;
    border-radius: 0.5rem;
    font-size: 0.85rem;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    background: rgba(15, 23, 42, 0.4);
    border-radius: 0.75rem;
    border: 1px dashed rgba(255, 255, 255, 0.1);
  }

  .empty-state .icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  .empty-state h3 {
    margin: 0 0 0.25rem 0;
    color: #e2e8f0;
    font-size: 1.1rem;
  }

  .empty-state p {
    margin: 0;
    color: #64748b;
    font-size: 0.85rem;
  }

  .snapshots-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .snap-card {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s ease;
  }

  .snap-card:hover {
    transform: translateY(-2px);
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.5);
  }

  .thumb-container {
    height: 110px;
    background: #0f172a;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    font-size: 2rem;
    color: #334155;
  }

  .dim-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.75);
    color: #cbd5e1;
    font-size: 0.7rem;
    padding: 2px 5px;
    border-radius: 4px;
  }

  .snap-info {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .snap-name {
    margin: 0 0 0.25rem 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .snap-desc {
    margin: 0 0 0.5rem 0;
    font-size: 0.8rem;
    color: #94a3b8;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .snap-meta {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #64748b;
  }

  .btn-group {
    display: flex;
    gap: 0.25rem;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .icon-btn:hover {
    color: #38bdf8;
    background: rgba(255, 255, 255, 0.05);
  }

  .icon-btn.danger:hover {
    color: #f87171;
  }
</style>
