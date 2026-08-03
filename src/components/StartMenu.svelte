<script lang="ts">
  // 시작 화면의 메뉴. 게임 시작 화면답게 세로로 쌓은 네 줄이 전부이고, 그중 두
  // 줄(프리셋 맵·불러오기)만 오버레이를 연다. 나머지는 평범한 링크다.
  //
  // 배경의 샌드박스(StartScreenSandbox)는 이 컴포넌트 아래에 깔려 있으므로,
  // 버튼이 아닌 여백은 pointer-events를 흘려보내 그대로 눌러 그릴 수 있게 한다.

  import PresetGallery from './PresetGallery.svelte';

  let presetsOpen = $state(false);
  let snapshotsOpen = $state(false);

  // 스냅샷 관리자는 **눌렀을 때 처음 받아온다.** 이 모달만이 세이브를 복원하려고
  // `state/persistence` → 전체 물질 배럴(138종)을 끌어오는데, 시작 화면은 그
  // 대신 경량 배럴만 쓰기로 한 화면이다. 정적으로 import하면 메뉴를 열지도 않은
  // 사람이 첫 로드에 전체 레지스트리를 받게 되므로 여기서만 지연시킨다.
  type SnapshotModalComponent = typeof import('./SnapshotManagerModal.svelte').default;
  let SnapshotModal = $state<SnapshotModalComponent | null>(null);

  async function openSnapshots(): Promise<void> {
    if (!SnapshotModal) SnapshotModal = (await import('./SnapshotManagerModal.svelte')).default;
    snapshotsOpen = true;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && presetsOpen) {
      e.preventDefault();
      presetsOpen = false;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<nav class="menu" aria-label="시작 메뉴">
  <a class="item primary" href="/sandbox">
    <i class="bi bi-play-fill" aria-hidden="true"></i>
    <span>게임 시작</span>
  </a>

  <button class="item" type="button" onclick={() => (presetsOpen = true)}>
    <i class="bi bi-grid-1x2-fill" aria-hidden="true"></i>
    <span>프리셋 맵</span>
  </button>

  <button class="item" type="button" onclick={openSnapshots}>
    <i class="bi bi-folder2-open" aria-hidden="true"></i>
    <span>불러오기</span>
  </button>

  <a class="item" href="/guide">
    <i class="bi bi-book-half" aria-hidden="true"></i>
    <span>도감</span>
  </a>
</nav>

{#if presetsOpen}
  <!-- 프리셋 카드 갤러리. 시작 화면 자체는 한 화면에 담고, 목록은 여기로 뺀다. -->
  <div
    class="scrim"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) presetsOpen = false;
    }}
  >
    <div class="sheet" role="dialog" aria-modal="true" aria-label="프리셋 맵">
      <button class="close" type="button" onclick={() => (presetsOpen = false)} aria-label="닫기">
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
      <PresetGallery currentLocale="ko" />
    </div>
  </div>
{/if}

{#if SnapshotModal}
  <SnapshotModal isOpen={snapshotsOpen} onClose={() => (snapshotsOpen = false)} />
{/if}

<style>
  .menu {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
    width: min(300px, 78vw);
    /* 시작 화면의 앞면은 클릭을 배경 샌드박스로 흘려보낸다(pages/index.astro).
       실제로 눌러야 하는 이 두 덩어리에서만 다시 켠다. */
    pointer-events: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.8rem 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.65rem;
    background: rgba(16, 16, 24, 0.55);
    backdrop-filter: blur(10px);
    color: #cbd5e1;
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease,
      transform 0.18s ease;
  }

  .item i {
    font-size: 1.05rem;
    opacity: 0.75;
  }

  .item:hover,
  .item:focus-visible {
    background: rgba(30, 32, 48, 0.8);
    border-color: rgba(129, 140, 248, 0.5);
    color: #f8fafc;
    transform: translateX(3px);
  }

  .item.primary {
    background: linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%);
    border-color: transparent;
    color: #fff;
    font-size: 1.1rem;
    padding: 0.95rem 1.1rem;
    box-shadow: 0 10px 26px -10px rgba(79, 70, 229, 0.9);
  }

  .item.primary i {
    opacity: 1;
    font-size: 1.25rem;
  }

  .item.primary:hover,
  .item.primary:focus-visible {
    filter: brightness(1.1);
    transform: translateX(3px);
  }

  /* --- 프리셋 시트 --- */

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(4, 4, 8, 0.72);
    backdrop-filter: blur(6px);
    pointer-events: auto;
  }

  .sheet {
    position: relative;
    width: min(1100px, 100%);
    max-height: min(88vh, 88dvh);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    background: rgba(12, 12, 18, 0.96);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    color: #f1f5f9;
  }

  .close {
    position: absolute;
    top: 0.9rem;
    right: 0.9rem;
    z-index: 1;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    background: rgba(24, 24, 32, 0.9);
    color: #e2e8f0;
    cursor: pointer;
  }

  .close:hover {
    border-color: rgba(129, 140, 248, 0.6);
  }

  @media (max-width: 480px) {
    .menu {
      gap: 0.45rem;
    }
    .item {
      padding: 0.7rem 0.95rem;
      font-size: 0.95rem;
    }
    .item.primary {
      padding: 0.85rem 0.95rem;
      font-size: 1.02rem;
    }
  }
</style>
