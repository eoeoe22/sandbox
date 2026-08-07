<script lang="ts">
  // 게임 가이드 — the /guide page's second tab, next to the material codex.
  //
  // The codex explains materials one at a time; nothing explained the systems
  // that connect them (why a wet sand pile doesn't drain like a bucket, why a
  // steel bar cools slower than a sand pile the same temperature, why a rubber
  // ball doesn't show up in a cell inspector). This is that missing page — a
  // static, hand-written document rather than a registry extract, because
  // "how the engine works" isn't data any material declares.
  //
  // Korean only for now (see the codex's i18n split for why bilingual prose
  // lives in its own module) — this page's chrome (tab labels, nav) goes
  // through t() like the rest of the app, but the long-form body text below
  // does not. Translating it is follow-up work, tracked in docs/CODEX.md.
  import { t } from '../i18n';
</script>

<div class="guide-doc">
  <header class="page-head">
    <a class="home" href="/">
      <i class="bi bi-arrow-left" aria-hidden="true"></i>
      <span>{t('brand')}</span>
    </a>
    <h1>게임 가이드</h1>
    <p class="lede">
      물질 하나하나의 설명은 <strong>물질 도감</strong> 탭에 있다. 여기서는 그 물질들이
      공유하는 규칙 — 격자와 상태, 겹침, 열전도, 그리고 화면 속 도구들 — 을 다룬다.
    </p>
  </header>

  <section class="sec">
    <h2><i class="bi bi-grid-3x3-gap-fill" aria-hidden="true"></i> 격자와 파티클</h2>
    <p>
      샌드박스는 촘촘한 격자다. 칸 하나가 파티클 하나이고, 매 틱(초당 수십 회)마다 각
      파티클이 자기 규칙대로 이웃과 자리를 바꾸거나 반응한다 — 모래가 쌓이고, 물이
      퍼지고, 불이 옮겨붙는 모든 움직임이 이 칸 단위 계산의 누적이다.
    </p>
    <p>
      화면에서 굴러다니는 <strong>고무공·드럼통·다이너마이트</strong> 같은 것들은 예외다.
      이들은 격자 칸이 아니라 <strong>격자 위를 떠다니는 독립된 물체</strong>다. 그래서
      돋보기로 관찰하면 격자 칸의 물질 구성만 집계될 뿐 이런 물체는 잡히지 않는다 — 대신
      물체 오른쪽 위에 자기 온도가 따로 표시된다. 물체는 부딪히고 구르고 깨지는 반면,
      격자 파티클은 흐르고 쌓이고 서로 반응한다. 무엇을 만지고 있는지 헷갈린다면 이
      구분이 답이다.
    </p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-layers-fill" aria-hidden="true"></i> 네 가지 상태</h2>
    <p>물질은 넷 중 하나의 상태로 존재하고, 상태가 파티클이 어떻게 움직이는지를 결정한다.</p>
    <div class="phase-grid">
      <div class="phase-card">
        <i class="bi bi-box-fill" aria-hidden="true"></i>
        <h3>고체</h3>
        <p>제자리에 고정된다. 스스로는 움직이지 않고, 폭발이나 충격 같은 외력에만 반응한다.</p>
      </div>
      <div class="phase-card">
        <i class="bi bi-hourglass-split" aria-hidden="true"></i>
        <h3>가루</h3>
        <p>중력 방향으로 쌓이고 흘러내린다. 경사가 지면 옆으로 무너지지만, 액체처럼 수평으로 퍼지지는 않는다.</p>
      </div>
      <div class="phase-card">
        <i class="bi bi-droplet-fill" aria-hidden="true"></i>
        <h3>액체</h3>
        <p>중력을 따르면서 수평으로도 퍼져 수위를 맞춘다. 담긴 그릇의 모양대로 고인다.</p>
      </div>
      <div class="phase-card">
        <i class="bi bi-cloud-fill" aria-hidden="true"></i>
        <h3>기체</h3>
        <p>위로 확산하며 흩어진다. 밀도가 가장 낮아 다른 상태 위로 떠오른다.</p>
      </div>
    </div>
    <p class="hint">
      사이드바(모바일은 하단 바)의 팔레트 탭이 이 네 상태를 기본 분류로 쓴다 — 어느 탭을
      먼저 뒤져야 할지 모를 때는 찾는 물질의 상태부터 떠올리면 된다.
    </p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-water" aria-hidden="true"></i> 겹침: 스며드는 유체</h2>
    <p>
      체·메쉬 같은 다공성 고체나 헐거운 가루 더미는 액체·기체를 완전히 막지 못한다. 이런
      물질 위로 흐른 유체는 사라지는 대신 <strong>같은 칸에 겹쳐서 스며든다</strong> — 젖은
      모래가 실제로 물기를 머금은 채로 있는 것과 같다. 겹친 유체는 자기 중력·부력을 따라
      계속 흐르고, 빈 자리를 만나면 다시 표면으로 올라온다.
    </p>
    <p>
      스며든 물이 산성이면 계속 부식시키고, 불붙은 기름이 스며든 나무는 속까지 서서히
      달아오른다 — 겹침은 단순히 "숨어 있는 것"이 아니라 그 자리에서 계속 반응하는
      물질이다. 돋보기로 관찰하면 겹침 칸 수가 "겹침 N칸"으로 따로 표시된다.
    </p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-thermometer-half" aria-hidden="true"></i> 열전도</h2>
    <p>
      칸마다 온도를 가지고, 매 틱 사방 이웃과 온도를 교환한다. 얼마나 빨리 교환하는지는
      물질의 전도율이 정하는데, <strong>금속처럼 전도율이 높은 물질은 극적으로 빠르게
      데워지고 식으며, 모래·나무처럼 낮은 물질은 열을 오래 붙들고 있는다</strong> — 빈
      칸(공기)은 아예 단열재라 열이 새지 않는다.
    </p>
    <p>
      온도는 물질의 상태도 바꾼다. 물은 100℃에서 끓어 수증기가 되고, 용암은 충분히
      식으면 돌로 굳는다 — 화면 좌측 상단(모바일은 설정)의 <strong>온도계 아이콘</strong>을
      누르면 물질 색 대신 온도를 색으로 보여주는 열지도로 전환되어, 눈에 안 보이던 열의
      흐름을 그대로 볼 수 있다.
    </p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-tools" aria-hidden="true"></i> 도구</h2>
    <p>
      브러시는 재료를 칠하는 것 말고도 여러 가지 일을 한다. 브러시 크기·모양(원/사각)과
      채우기 방식은 사이드바에서 항상 조절할 수 있고, 아래는 재료 대신 브러시 아래 칸에
      직접 작용하는 특수 도구들이다.
    </p>
    <ul class="tool-list">
      <li><i class="bi bi-eraser-fill" aria-hidden="true"></i><div><strong>지우개</strong><span>브러시 아래를 빈 칸으로 되돌린다.</span></div></li>
      <li><i class="bi bi-palette-fill" aria-hidden="true"></i><div><strong>혼합</strong><span>최대 세 물질을 비율대로 섞어서 칠한다.</span></div></li>
      <li><i class="bi bi-fire" aria-hidden="true"></i><div><strong>가열 / 냉각</strong><span>재료를 놓지 않고 브러시 아래 온도만 올리거나 내린다.</span></div></li>
      <li><i class="bi bi-shuffle" aria-hidden="true"></i><div><strong>섞기</strong><span>브러시 안의 고체가 아닌 파티클끼리 자리를 뒤섞는다.</span></div></li>
      <li><i class="bi bi-lightning-charge-fill" aria-hidden="true"></i><div><strong>전기</strong><span>브러시 아래 도체에 전기 펄스를 직접 흘려보낸다.</span></div></li>
      <li><i class="bi bi-broadcast" aria-hidden="true"></i><div><strong>충격파</strong><span>브러시 영역 자체를 발진원으로 삼아 파괴력 없는 충격파를 쏜다.</span></div></li>
      <li><i class="bi bi-eye" aria-hidden="true"></i><div><strong>보기</strong><span>아무것도 그리지 않고 화면만 관찰한다.</span></div></li>
      <li><i class="bi bi-bounding-box" aria-hidden="true"></i><div><strong>영역 선택</strong><span>드래그로 사각형을 잡고, 그 순간 선택된 도구를 영역 전체에 한 번에 적용한다.</span></div></li>
      <li><i class="bi bi-search" aria-hidden="true"></i><div><strong>돋보기</strong><span>브러시 아래 파티클 종류·비율·평균 온도를 카드로 보여준다.</span></div></li>
    </ul>
    <p class="hint">
      <strong>휠(가운데) 클릭</strong>은 커서 아래의 물질을 그대로 팔레트 선택으로
      집어 온다 — 세상을 건드리지 않는 스포이드다. <strong>우클릭</strong>은 어떤 도구를
      들고 있든 항상 지우개로 동작한다. 물질 칩을 <strong>더블클릭</strong>하면 그 물질을
      끝없이 뿜어내는 Clone으로 낙점된다.
    </p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-save-fill" aria-hidden="true"></i> 저장과 불러오기</h2>
    <p>
      진행 상황은 브라우저에 자동 저장되어, 새로고침해도 이어서 시작된다. 그와 별개로
      재생 제어 그룹의 <strong>저장</strong> 버튼으로 지금 화면을 이름 붙인 슬롯으로
      따로 보관할 수 있고, 슬롯은 <strong>.psbx.json</strong> 파일로 내보내거나 다시
      가져올 수 있다. 시작 화면의 <strong>불러오기</strong>에서도 저장해 둔 슬롯을 바로
      열 수 있다.
    </p>
  </section>

  <footer class="page-foot">
    <a class="btn primary" href="/sandbox">
      <i class="bi bi-play-circle-fill" aria-hidden="true"></i>
      <span>{t('codex.toSandbox')}</span>
    </a>
    <a class="btn" href="/">
      <i class="bi bi-house-door" aria-hidden="true"></i>
      <span>{t('codex.toHome')}</span>
    </a>
  </footer>
</div>

<style>
  .guide-doc {
    max-width: 860px;
    margin: 0 auto;
    width: 100%;
  }

  /* --- Page heading — matches Codex.svelte's .page-head so the two tabs read
       as one document, not two unrelated pages stitched together. --- */
  .page-head {
    margin-bottom: 1.8rem;
  }

  .home {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #4f46e5;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.2;
    padding: 0.85rem 0.75rem;
    margin: -0.85rem -0.75rem calc(1rem - 0.85rem);
  }

  .home:hover {
    color: #818cf8;
  }

  .page-head h1 {
    margin: 0 0 0.6rem;
    font-size: 2.1rem;
    font-weight: 800;
    background: linear-gradient(135deg, #a5b4fc 0%, #38bdf8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .lede {
    margin: 0;
    color: #94a3b8;
    font-size: 0.98rem;
    line-height: 1.6;
  }

  .lede strong {
    color: #c7cede;
  }

  .sec {
    margin: 2.2rem 0;
    padding: 1.3rem 1.4rem;
    border: 1px solid #22262f;
    border-radius: 0.85rem;
    background: #12141a;
  }

  .sec h2 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0 0.7rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: #e0e6ed;
  }

  .sec h2 i {
    color: #6ea8fe;
    font-size: 1.1rem;
  }

  .sec p {
    margin: 0 0 0.75rem;
    color: #b8c0cf;
    font-size: 0.95rem;
    line-height: 1.7;
  }

  .sec p:last-child {
    margin-bottom: 0;
  }

  .sec strong {
    color: #e0e6ed;
  }

  .hint {
    color: #7a8394 !important;
    font-size: 0.86rem !important;
  }

  .phase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.7rem;
    margin: 0.9rem 0;
  }

  .phase-card {
    padding: 0.9rem;
    border: 1px solid #262a33;
    border-radius: 0.6rem;
    background: #181b22;
  }

  .phase-card i {
    color: #6ea8fe;
    font-size: 1.2rem;
  }

  .phase-card h3 {
    margin: 0.45rem 0 0.35rem;
    font-size: 1rem;
    font-weight: 700;
    color: #e0e6ed;
  }

  .phase-card p {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.5;
    color: #94a3b8;
  }

  .tool-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 0.6rem;
    margin: 0.9rem 0;
    padding: 0;
    list-style: none;
  }

  .tool-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid #262a33;
    border-radius: 0.55rem;
    background: #181b22;
  }

  .tool-list i {
    flex: none;
    margin-top: 0.15rem;
    color: #6ea8fe;
    font-size: 1rem;
  }

  .tool-list div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .tool-list strong {
    font-size: 0.88rem;
    color: #e0e6ed;
  }

  .tool-list span {
    font-size: 0.8rem;
    line-height: 1.4;
    color: #8a93a3;
  }

  /* --- Footer links — identical markup/styling to Codex.svelte's .page-foot,
       intentionally duplicated rather than shared: the two components are
       siblings mounted one at a time, and factoring two links into a shared
       component would cost more than it saves. --- */
  .page-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #22262f;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.6rem 1.1rem;
    border-radius: 0.55rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #c7cede;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .btn:hover {
    border-color: #3a4150;
    color: #e0e6ed;
  }

  .btn.primary {
    background: #4f46e5;
    border-color: #4f46e5;
    color: #fff;
  }

  .btn.primary:hover {
    background: #4338ca;
    border-color: #4338ca;
    color: #fff;
  }

  @media (max-width: 560px) {
    .sec {
      padding: 1.05rem 1.1rem;
    }
  }
</style>
