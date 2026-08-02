<script lang="ts">
  import { PRESETS } from '../game/presets';

  export let currentLocale: 'ko' | 'en' = 'ko';
</script>

<div class="preset-gallery">
  <div class="gallery-header">
    <h2>
      <span class="icon">🚀</span>
      <span>{currentLocale === 'ko' ? '샌드박스 템플릿 & 프리셋 맵' : 'Sandbox Presets & Templates'}</span>
    </h2>
    <p>
      {currentLocale === 'ko'
        ? '원클릭으로 다채롭고 흥미진진한 파티클 반응 무대를 즉시 체험해 보세요.'
        : 'Jump straight into exciting particle interaction scenarios with one click.'}
    </p>
  </div>

  <div class="cards-grid">
    {#each PRESETS as preset}
      <a href={`/sandbox?preset=${preset.id}`} class="preset-card">
        <div class="card-top">
          <span class="preset-icon">{preset.icon}</span>
          <span class="preset-badge">{preset.badge[currentLocale] || preset.badge.ko}</span>
        </div>
        <div class="card-body">
          <h3 class="preset-title">{preset.name[currentLocale] || preset.name.ko}</h3>
          <p class="preset-desc">{preset.desc[currentLocale] || preset.desc.ko}</p>
        </div>
        <div class="card-footer">
          <span class="start-link">
            <span>{currentLocale === 'ko' ? '이 맵으로 시작' : 'Launch Scenario'}</span>
            <i class="bi bi-arrow-right-short"></i>
          </span>
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  .preset-gallery {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .gallery-header {
    text-align: center;
    margin-bottom: 2.5rem;
  }

  .gallery-header h2 {
    font-size: 1.8rem;
    font-weight: 800;
    margin: 0 0 0.5rem 0;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .gallery-header p {
    color: #94a3b8;
    margin: 0;
    font-size: 0.95rem;
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .preset-card {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    backdrop-filter: blur(8px);
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .preset-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 1rem;
    padding: 1px;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(14, 165, 233, 0.1), transparent);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  .preset-card:hover {
    transform: translateY(-4px);
    background: rgba(30, 41, 59, 0.75);
    box-shadow: 0 12px 24px -6px rgba(0, 0, 0, 0.6), 0 0 16px rgba(79, 70, 229, 0.25);
  }

  .preset-card:hover::before {
    opacity: 1;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .preset-icon {
    font-size: 2.2rem;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  }

  .preset-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    border-radius: 9999px;
    background: rgba(79, 70, 229, 0.2);
    color: #818cf8;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .card-body {
    flex: 1;
  }

  .preset-title {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: #f1f5f9;
  }

  .preset-desc {
    font-size: 0.88rem;
    color: #94a3b8;
    line-height: 1.5;
    margin: 0 0 1.25rem 0;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .start-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: #38bdf8;
    transition: color 0.2s ease, transform 0.2s ease;
  }

  .preset-card:hover .start-link {
    color: #818cf8;
    transform: translateX(2px);
  }

  .start-link i {
    font-size: 1.2rem;
  }
</style>
