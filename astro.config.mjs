import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Pure static output → deployed to Cloudflare Workers Static Assets (no adapter,
// no server-side code). Vite (bundled in Astro) gives us `?init` WASM and
// `new URL(..., import.meta.url)` Web Workers for the future performance seams.
export default defineConfig({
  output: 'static',
  integrations: [svelte()],
  // Reserved for when the simulation moves off the main thread:
  // vite: { worker: { format: 'es' } },
});
