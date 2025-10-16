import { defineConfig, loadEnv } from 'vite'

// Vite automatically provides mode in the callback
export default defineConfig(({ mode }) => {
  // Use import.meta.env instead of process.cwd()
  const env = loadEnv(mode, '.', '')

  // Default to your backend if no .env value is set
  const target = env.VITE_PROXY_TARGET || 'https://globule-ryzen.globular.io'

  return {
    root: '.',
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/config': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/authentication.AuthenticationService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/rbac.RbacService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/resource.ResourceService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/file.FileService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/event.EventService': {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
    },
  }
})