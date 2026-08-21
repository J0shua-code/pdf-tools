/**
 * Vite config for Cloudflare Pages deployment.
 * Configures the build to output to the `web/` directory so that
 * Cloudflare serves `web/index.html` as the site root.
 */
export default {
  base: '/',
  build: {
    outDir: 'web',
    emptyOutDir: true,
    rollupOptions: {
      input: 'web/index.html',
    },
  },
  plugins: [],
}

/