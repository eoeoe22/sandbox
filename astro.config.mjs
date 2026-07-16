import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Pure static output → deployed to Cloudflare Workers Static Assets (no adapter,
// no server-side code). Vite (bundled in Astro) gives us `?init` WASM and
// `new URL(..., import.meta.url)` Web Workers for the future performance seams.
export default defineConfig({
  output: 'static',
  integrations: [svelte()],
  vite: {
    // Reserved for when the simulation moves off the main thread:
    // worker: { format: 'es' },
    build: {
      // Never inline small assets as base64 data URIs — every static file
      // (including favicon.svg) must ship as its own hashed file so a
      // changed file gets a new URL and unchanged files keep old ones
      // cacheable forever.
      assetsInlineLimit: 0,
      // Base/default naming (inherited by the ssr & prerender environments,
      // which is where layout-level assets like favicon.svg and
      // layout-scoped CSS actually get emitted from) — kept in sync with the
      // client-environment override below.
      rolldownOptions: {
        output: {
          assetFileNames: '_astro/[name]-[hash][extname]',
        },
      },
      // Terser instead of the esbuild default: heavier variable mangling and
      // dead-code removal for smaller, less readable output.
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
        },
        mangle: {
          toplevel: true,
        },
        format: {
          comments: false,
        },
      },
    },
    // Astro's client build renames output via `environments.client.build.
    // rolldownOptions.output` (Vite 8 bundles with Rolldown), not the plain
    // `build.rollupOptions` — override the naming pattern there so every
    // emitted file reads `original-name-hash.ext` instead of the default
    // `original-name.hash.ext`.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              entryFileNames: '_astro/[name]-[hash].js',
              chunkFileNames: '_astro/[name]-[hash].js',
              assetFileNames: '_astro/[name]-[hash][extname]',
            },
          },
        },
      },
    },
  },
});
