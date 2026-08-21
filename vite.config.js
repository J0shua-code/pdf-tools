/**
 * Vite config for Cloudflare Pages deployment.
 * Configures the build to output to the `web/` directory so that
 * Cloudflare serves `web/index.html` as the site root.
 */
import { defineConfig } from 'vite'
import copy from 'rollup-plugin-copy'

export default defineConfig({
  base: '/',
  build: {
    outDir: 'web',
    emptyOutDir: true,
    rollupOptions: {
      input: 'web/index.html',
    },
  },
  plugins: [
    copy({
      targets: [
        { src: 'worker/ghostscript.worker.js', dest: 'web' }
      ]
    })
  ]
})

/