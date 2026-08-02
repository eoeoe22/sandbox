<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Grid } from '../game/engine/Grid';
  import { Simulation } from '../game/engine/Simulation';
  import { CanvasRenderer } from '../game/render/CanvasRenderer';
  import { SandboxLayout } from '../game/layout';
  import { allMaterials } from '../game/materials/registry';
  import '../game/materials'; // side-effect: register materials

  let canvasEl: HTMLCanvasElement;
  let animId: number | null = null;
  let isVisible = true;
  let isTabActive = true;

  let grid: Grid;
  let sim: Simulation;
  let renderer: CanvasRenderer;
  let layout: SandboxLayout;

  // Reduced resolution for smooth 30fps hero background
  const HERO_W = 160;
  const HERO_H = 90;

  function safeId(name: string): number {
    const found = allMaterials().find((m) => m && m.name.toLowerCase() === name.toLowerCase());
    return found ? found.id : 0;
  }

  function seedHeroWorld() {
    grid.cells.fill(0);
    grid.temp.fill(20);

    const lavaId = safeId('lava');
    const waterId = safeId('water');
    const sandId = safeId('sand');
    const fireId = safeId('fire');
    const stoneId = safeId('stone');
    const plantId = safeId('plant');

    // Create bottom stone basin
    for (let x = 0; x < HERO_W; x++) {
      grid.cells[x] = stoneId;
    }

    // Add lava pool on left bottom
    for (let y = 1; y < 15; y++) {
      for (let x = 10; x < 50; x++) {
        const idx = y * HERO_W + x;
        grid.cells[idx] = lavaId;
        grid.temp[idx] = 950;
      }
    }

    // Add water reservoir on right top
    for (let y = 60; y < 85; y++) {
      for (let x = 100; x < 140; x++) {
        const idx = y * HERO_W + x;
        grid.cells[idx] = waterId;
      }
    }

    // Add sand dune in middle
    for (let y = 1; y < 35; y++) {
      for (let x = 60; x < 95; x++) {
        if (Math.random() > 0.15) {
          const idx = y * HERO_W + x;
          grid.cells[idx] = sandId;
        }
      }
    }

    // Add plants on sand
    for (let y = 35; y < 45; y++) {
      for (let x = 70; x < 85; x++) {
        const idx = y * HERO_W + x;
        grid.cells[idx] = plantId;
      }
    }

    grid.randomizeTints();
  }

  function handlePointerMove(e: MouseEvent | TouchEvent) {
    if (!canvasEl || !grid) return;
    const rect = canvasEl.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }

    const relX = (clientX - rect.left) / rect.width;
    const relY = 1 - (clientY - rect.top) / rect.height; // inverted Y in SandboxLayout

    const gx = Math.floor(relX * HERO_W);
    const gy = Math.floor(relY * HERO_H);

    const sparkId = safeId('spark');
    const fireId = safeId('fire');
    const sandId = safeId('sand');

    // Spawn a gentle particle aura/burst around cursor
    const radius = 4;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (cx >= 0 && cx < HERO_W && cy >= 0 && cy < HERO_H) {
            const idx = cy * HERO_W + cx;
            if (Math.random() < 0.3) {
              grid.cells[idx] = Math.random() > 0.5 ? fireId : sandId;
              grid.temp[idx] = 400;
              grid.markActive(cx, cy);
            }
          }
        }
      }
    }
  }

  let lastTime = 0;
  const fpsInterval = 1000 / 30; // 30fps throttle

  function tick(timestamp: number) {
    if (!isVisible || !isTabActive) {
      animId = null;
      return;
    }

    animId = requestAnimationFrame(tick);

    const elapsed = timestamp - lastTime;
    if (elapsed < fpsInterval) return;
    lastTime = timestamp - (elapsed % fpsInterval);

    // Continuous subtle spawner on top
    if (Math.random() < 0.4) {
      const rx = Math.floor(20 + Math.random() * (HERO_W - 40));
      const ry = HERO_H - 2;
      const idx = ry * HERO_W + rx;
      const waterId = safeId('water');
      const sandId = safeId('sand');
      grid.cells[idx] = Math.random() > 0.5 ? waterId : sandId;
      grid.markActive(rx, ry);
    }

    sim.step();
    renderer.render();
  }

  function startLoop() {
    if (!animId && isVisible && isTabActive) {
      lastTime = performance.now();
      animId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function handleVisibilityChange() {
    isTabActive = !document.hidden;
    if (isTabActive) startLoop();
    else stopLoop();
  }

  onMount(() => {
    layout = new SandboxLayout();
    layout.setViewport(canvasEl.clientWidth || window.innerWidth, canvasEl.clientHeight || window.innerHeight);

    // Instantiate fixed-size grid for hero canvas
    grid = new Grid(HERO_W, HERO_H);
    sim = new Simulation(grid);
    renderer = new CanvasRenderer(canvasEl, grid, layout);

    const dpr = window.devicePixelRatio || 1;
    renderer.resize(
      Math.max(1, Math.floor((canvasEl.clientWidth || window.innerWidth) * dpr)),
      Math.max(1, Math.floor((canvasEl.clientHeight || window.innerHeight) * dpr))
    );

    seedHeroWorld();

    // IntersectionObserver to pause when off-screen
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isVisible = entry.isIntersecting;
          if (isVisible) startLoop();
          else stopLoop();
        });
      },
      { threshold: 0.1 }
    );
    observer.observe(canvasEl);

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleResize = () => {
      if (!canvasEl) return;
      const dpr = window.devicePixelRatio || 1;
      renderer.resize(
        Math.max(1, Math.floor(canvasEl.clientWidth * dpr)),
        Math.max(1, Math.floor(canvasEl.clientHeight * dpr))
      );
      layout.setViewport(canvasEl.clientWidth, canvasEl.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    startLoop();

    return () => {
      stopLoop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<div
  class="hero-canvas-container"
  on:mousemove={handlePointerMove}
  on:touchmove={handlePointerMove}
  role="presentation"
>
  <canvas bind:this={canvasEl} class="hero-canvas"></canvas>
  <div class="hero-overlay"></div>
</div>

<style>
  .hero-canvas-container {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    z-index: 0;
    pointer-events: auto;
  }

  .hero-canvas {
    width: 100%;
    height: 100%;
    display: block;
    filter: brightness(0.65) contrast(1.15) blur(0.5px);
  }

  .hero-overlay {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 30%, rgba(16, 16, 20, 0.3) 0%, rgba(10, 10, 14, 0.85) 100%),
      linear-gradient(to bottom, rgba(16, 16, 20, 0.4) 0%, rgba(10, 10, 14, 0.95) 100%);
    pointer-events: none;
  }
</style>
