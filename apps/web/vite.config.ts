import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import {
  fixProtoExternals,
  globularOptimizeDeps,
  globularResolveAlias,
  globularCommonjsInclude,
} from '@globular/build-tools'

const protoDir = path.resolve(__dirname, '../../../services/typescript/dist')
const packagesDir = path.resolve(__dirname, '../../packages')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target = env.VITE_PROXY_TARGET || 'https://www.globular.cloud'

  return {
    plugins: [fixProtoExternals(protoDir)],
    root: '.',
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/prometheus': {
          target: 'http://127.0.0.1:9090',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/prometheus/, ''),
        },
      },
    },
    optimizeDeps: {
      include: globularOptimizeDeps(),
    },
    resolve: {
      alias: globularResolveAlias(protoDir, packagesDir),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
      commonjsOptions: {
        include: globularCommonjsInclude(),
      },
    },
  }
})
