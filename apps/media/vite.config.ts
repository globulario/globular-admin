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
      port: 5174,
      open: true,
      fs: {
        allow: [
          path.resolve(__dirname, '../..'),
          protoDir,
        ],
      },
      proxy: {
        '/config': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/stats': {
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
        '/admin.AdminService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/services_manager.ServicesManagerService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/applications_manager.ApplicationManagerService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/persistence.PersistenceService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/media.MediaService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/title.TitleService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/search.SearchService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/blog.BlogService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/conversation.ConversationService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/torrent.TorrentService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/cluster_controller.ClusterControllerService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/cluster_doctor.ClusterDoctorService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/log.LogService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/monitoring.MonitoringService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/admin': {
          target,
          changeOrigin: true,
          secure: false,
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
