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
    grid.randomizeTints();
  }


  let lastTime = 0;
  const fpsInterval = 1000 / 30; // 30fps throttle

  import { fireShockwave } from '../game/materials/woofer';

  function handlePointerInteraction(e: MouseEvent | TouchEvent) {
    if (!canvasEl || !grid || !sim) return;
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
    const relY = 1 - (clientY - rect.top) / rect.height;

    const gx = Math.floor(relX * HERO_W);
    const gy = Math.floor(relY * HERO_H);

    if (gx < 0 || gx >= HERO_W || gy < 0 || gy >= HERO_H) return;

    if (Math.random() > 0.5) {
      // Spawn fire
      const fireId = safeId('fire');
      const radius = 5;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            const cx = gx + dx;
            const cy = gy + dy;
            if (cx >= 0 && cx < HERO_W && cy >= 0 && cy < HERO_H) {
              const idx = cy * HERO_W + cx;
              if (Math.random() < 0.6) {
                grid.cells[idx] = fireId;
                grid.temp[idx] = 600;
                grid.markActive(cx, cy);
              }
            }
          }
        }
      }
    } else {
      // Spawn shockwave
      const radius = 6;
      const cells = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            const cx = gx + dx;
            const cy = gy + dy;
            if (cx >= 0 && cx < HERO_W && cy >= 0 && cy < HERO_H) {
              cells.push(cy * HERO_W + cx);
            }
          }
        }
      }
      fireShockwave(sim.context, cells);
    }
  }

  function tick(timestamp: number) {
    if (!isVisible || !isTabActive) {
      animId = null;
      return;
    }

    animId = requestAnimationFrame(tick);

    const elapsed = timestamp - lastTime;
    if (elapsed < fpsInterval) return;
    lastTime = timestamp - (elapsed % fpsInterval);

    // 5 streams spawner
    const streamMaterials = ['sand', 'water', 'gasoline', 'sawdust', 'salt'];
    const streamCount = streamMaterials.length;
    const spacing = Math.floor(HERO_W / (streamCount + 1));
    const startX = spacing;

    for (let i = 0; i < streamCount; i++) {
      if (Math.random() < 0.2) {
        const matId = safeId(streamMaterials[i]);
        const rx = startX + i * spacing + Math.floor(Math.random() * 3) - 1; // Slight jitter
        const ry = HERO_H - 2;
        if (rx >= 0 && rx < HERO_W && ry >= 0 && ry < HERO_H) {
          const idx = ry * HERO_W + rx;
          grid.cells[idx] = matId;
          grid.markActive(rx, ry);
        }
      }
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
  on:mousedown={handlePointerInteraction}
  on:touchstart={handlePointerInteraction}
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
