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
  // Bilingual like the codex, but structured differently: all the prose lives
  // in i18n/guideDoc.ts as one `GuideDocText` object per language (see that
  // file's header for why it's one file rather than codex.ko.ts/codex.en.ts's
  // two). This component only picks the current language's object and renders
  // it — the same object also feeds the Markdown export, so the page and the
  // clipboard can't say something different.
  //
  // 설명 옆에는 **돌아가는 엔진**이 붙는다. 예시 사진이 들어갈 자리마다 작은
  // 캔버스가 하나씩 놓이고, 그 안에서 실제 시뮬레이션이 대본대로 돈다
  // (`game/guideDemo.ts` + `GuideDemo.svelte`). 벽으로 그은 선, 쌓이는 모래,
  // 넘치는 그릇, 오르는 연기, 모래에 스미는 물, 한쪽 끝부터 달아오르는 히트파이프
  // — 여섯 장면이다.
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import { $locale as locale, t, categoryLabel } from '../i18n';
  import { guideDocKo, guideDocEn, type GuideDocText, type ToolKey } from '../i18n/guideDoc';
  import { iconFor } from '../game/materials/categories';
  import { copyText } from '../lib/clipboard';
  import type { GuideDemoKind } from '../game/guideDemo';

  const doc = $derived<GuideDocText>($locale === 'ko' ? guideDocKo : guideDocEn);

  /**
   * 데모 캔버스 컴포넌트. 정적 import 가 아니라 **마운트 뒤 동적 import** 인 것은
   * 번들 때문이다 — `GuideDemo.svelte` 는 Grid·Simulation·CanvasRenderer 와 데모
   * 물질 배럴을 끌어오는데, 정적으로 매달면 그 전부가 `/guide` 의 첫 청크에 들어가
   * **물질 도감 탭만 보고 나가는 사람도 시뮬레이션을 내려받는다.** 도감이 애초에
   * 빌드 타임 추출인 이유(§1 "왜 빌드 타임인가")를 이 탭이 되돌려 놓는 셈이다.
   *
   * `null` 인 동안은 자리만 비워 둔다. 문서는 캔버스 없이도 완결된 글이라,
   * 스켈레톤이나 로딩 표시를 둘 이유가 없다.
   */
  let Demo = $state<Component<{ kind: GuideDemoKind }> | null>(null);
  onMount(async () => {
    Demo = (await import('./GuideDemo.svelte')).default;
  });

  /** The four state cards, in display order. Titles come from `categoryLabel`
   *  and icons from `iconFor` — both already the palette's own source of
   *  truth for these keys, so this page can't drift from what the palette
   *  tabs actually show. */
  const PHASE_ORDER = ['solid', 'powder', 'liquid', 'gas'] as const;

  const TOOL_ORDER: ToolKey[] = [
    'eraser',
    'blend',
    'heatCool',
    'mix',
    'electric',
    'shock',
    'view',
    'areaSelect',
    'inspect',
  ];
  const TOOL_ICONS: Record<ToolKey, string> = {
    eraser: 'bi-eraser-fill',
    blend: 'bi-palette-fill',
    heatCool: 'bi-fire',
    mix: 'bi-shuffle',
    electric: 'bi-lightning-charge-fill',
    shock: 'bi-broadcast',
    view: 'bi-eye',
    areaSelect: 'bi-bounding-box',
    inspect: 'bi-search',
  };

  /** One Markdown section: a heading plus its paragraphs/lists, blank-line
   *  separated — the same shape `codex/format.ts`'s writers produce. */
  function section(heading: string, blocks: string[]): string {
    return [`## ${heading}`, ...blocks].join('\n\n');
  }

  /** The whole document as Markdown, built from the same `GuideDocText` the
   *  page renders — so what gets copied can never say something the screen
   *  doesn't. */
  function toMarkdown(d: GuideDocText, title: string): string {
    const sections = [
      d.lede,
      section(d.grid.title, d.grid.p),
      section(d.phases.title, [
        d.phases.intro,
        PHASE_ORDER.map((k) => `- ${categoryLabel(k)}: ${d.phases.desc[k]}`).join('\n'),
        d.phases.hint,
      ]),
      section(d.overlap.title, d.overlap.p),
      section(d.heat.title, d.heat.p),
      section(d.tools.title, [
        d.tools.intro,
        TOOL_ORDER.map((k) => `- ${d.tools.items[k].term}: ${d.tools.items[k].desc}`).join('\n'),
        d.tools.hint,
      ]),
      section(d.save.title, [d.save.p]),
    ];
    return [`# ${title}`, ...sections].join('\n\n') + '\n';
  }

  /** Whether the last copy attempt succeeded, or `null` before the first
   *  press / after the flash expires. */
  let copied = $state<boolean | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function handleCopy(): Promise<void> {
    const ok = await copyText(toMarkdown(doc, t('codex.tabBasics')));
    clearTimeout(copyTimer);
    copied = ok;
    copyTimer = setTimeout(() => (copied = null), 2200);
  }

  const copyLabel = $derived(copied === null ? t('codex.copy') : t(copied ? 'codex.copied' : 'codex.copyFailed'));
</script>

<div class="guide-doc">
  <header class="page-head">
    <a class="home" href="/">
      <i class="bi bi-arrow-left" aria-hidden="true"></i>
      <span>{t('brand')}</span>
    </a>
    <div class="head-row">
      <h1>{t('codex.tabBasics')}</h1>
      <button class="copy" class:done={copied !== null} onclick={handleCopy}>
        <i class={`bi ${copied === true ? 'bi-check2' : 'bi-clipboard'}`} aria-hidden="true"></i>
        <span>{copyLabel}</span>
      </button>
    </div>
    <p class="lede">{doc.lede}</p>
  </header>

  <section class="sec">
    <h2><i class="bi bi-grid-3x3-gap-fill" aria-hidden="true"></i> {doc.grid.title}</h2>
    {#each doc.grid.p as p (p)}<p>{p}</p>{/each}
  </section>

  <section class="sec">
    <h2><i class="bi bi-layers-fill" aria-hidden="true"></i> {doc.phases.title}</h2>
    <p>{doc.phases.intro}</p>
    <div class="phase-grid">
      {#each PHASE_ORDER as key (key)}
        <div class="phase-card">
          <i class={`bi ${iconFor(key)}`} aria-hidden="true"></i>
          <h3>{categoryLabel(key)}</h3>
          {#if Demo}
            <div class="demo-slot"><Demo kind={key} /></div>
          {/if}
          <p>{doc.phases.desc[key]}</p>
        </div>
      {/each}
    </div>
    <p class="hint">{doc.phases.hint}</p>
  </section>

  <!-- 겹침·열전도의 데모는 첫 문단 **뒤**에 온다. 무엇을 보고 있는지 한 문단
       읽고 나서 보는 그림이지, 설명 없이 먼저 만나면 그냥 움직이는 네모다.
       `p` 가 두 칸짜리 튜플이라 each 대신 자리를 직접 적을 수 있다. -->
  <section class="sec">
    <h2><i class="bi bi-water" aria-hidden="true"></i> {doc.overlap.title}</h2>
    <p>{doc.overlap.p[0]}</p>
    {#if Demo}
      <div class="demo-wide"><Demo kind="overlap" /></div>
    {/if}
    <p>{doc.overlap.p[1]}</p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-thermometer-half" aria-hidden="true"></i> {doc.heat.title}</h2>
    <p>{doc.heat.p[0]}</p>
    {#if Demo}
      <div class="demo-wide"><Demo kind="heat" /></div>
    {/if}
    <p>{doc.heat.p[1]}</p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-tools" aria-hidden="true"></i> {doc.tools.title}</h2>
    <p>{doc.tools.intro}</p>
    <ul class="tool-list">
      {#each TOOL_ORDER as key (key)}
        <li>
          <i class={`bi ${TOOL_ICONS[key]}`} aria-hidden="true"></i>
          <div>
            <strong>{doc.tools.items[key].term}</strong>
            <span>{doc.tools.items[key].desc}</span>
          </div>
        </li>
      {/each}
    </ul>
    <p class="hint">{doc.tools.hint}</p>
  </section>

  <section class="sec">
    <h2><i class="bi bi-save-fill" aria-hidden="true"></i> {doc.save.title}</h2>
    <p>{doc.save.p}</p>
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

  .head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
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

  /* --- Copy-as-Markdown button — same shape/palette as Codex.svelte's
       `.copy`, so the two tabs' toolbars read as one design. --- */
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border-radius: 0.4rem;
    border: 1px solid #262a33;
    background: #14161c;
    color: #9aa4b2;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .copy:hover {
    color: #e0e6ed;
    border-color: #3a4150;
  }

  .copy.done {
    border-color: #4f46e5;
    color: #c7d2fe;
  }

  .lede {
    margin: 0;
    color: #94a3b8;
    font-size: 0.98rem;
    line-height: 1.6;
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

  .hint {
    color: #7a8394 !important;
    font-size: 0.86rem !important;
  }

  /* 카드가 넷에서 둘씩 두 줄로 내려온 것은 카드마다 캔버스가 들어왔기 때문이다.
     160px 카드에서는 52칸짜리 격자가 한 칸 3px가 되어, 모래가 쌓이는 것도 물이
     수평을 맞추는 것도 점의 움직임으로만 보였다. */
  .phase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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

  /* --- 데모 캔버스 자리 ------------------------------------------------------
     크기는 전부 자리가 정한다: 컴포넌트 쪽은 폭 100%에 장면별 화면비만 잡고,
     칸 크기는 거기서 역산된다(GuideDemo.svelte). 그래서 여기서 폭을 바꾸면
     알갱이가 굵어지거나 가늘어질 뿐, 장면이 달라지지는 않는다. --- */
  .demo-slot {
    margin: 0.6rem 0 0.65rem;
  }

  .demo-wide {
    margin: 1rem 0 1.1rem;
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
