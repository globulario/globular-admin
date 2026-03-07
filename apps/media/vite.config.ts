import { defineConfig, loadEnv, type Plugin } from 'vite'
import path from 'path'
import fs from 'fs'

// The globular-web-client proto stubs live outside node_modules (via pnpm link:).
// Rollup's CJS plugin marks their relative require() targets as "?commonjs-external"
// because they resolve outside node_modules. This plugin intercepts those virtual IDs
// and resolves them to the actual file on disk.
const protoDir = path.resolve(__dirname, '../../../services/typescript/dist')
function fixProtoExternals(): Plugin {
  return {
    name: 'fix-proto-commonjs-externals',
    enforce: 'pre',
    resolveId(source, importer) {
      const extIdx = source.indexOf('?commonjs-external')
      if (extIdx < 0 && !source.includes('_pb.js')) return null
      const bare = (extIdx >= 0 ? source.slice(0, extIdx) : source).replace(/^\0/, '').trim()
      if (!bare.endsWith('_pb.js') && !bare.endsWith('_pb.d.ts')) return null
      if (bare.startsWith('./')) {
        const basename = bare.slice(2)
        if (importer) {
          const importerClean = importer.split('?')[0].replace(/^\0/, '')
          const dir = path.dirname(importerClean)
          const candidate = path.resolve(dir, bare)
          if (fs.existsSync(candidate)) return candidate
        }
        try {
          const subdirs = fs.readdirSync(protoDir, { withFileTypes: true })
            .filter((d: any) => d.isDirectory())
            .map((d: any) => d.name)
          for (const sub of subdirs) {
            const candidate = path.join(protoDir, sub, basename)
            if (fs.existsSync(candidate)) return candidate
          }
        } catch {}
      }
      return null
    },
  }
}

// Vite automatically provides mode in the callback
export default defineConfig(({ mode }) => {
  // Use import.meta.env instead of process.cwd()
  const env = loadEnv(mode, '.', '')

  // Default to your backend if no .env value is set
  const target = env.VITE_PROXY_TARGET || 'https://www.globular.cloud'

  return {
    plugins: [fixProtoExternals()],
    root: '.',
    server: {
      port: 5174,
      open: true,
      fs: {
        // Allow serving assets from the components package (symlinked workspace dep)
        allow: [
          '.',
          path.resolve(__dirname, '../../packages/components'),
          path.resolve(__dirname, '../../../services/typescript/dist'),
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
    // Force Vite to pre-bundle (CJS→ESM) all proto-generated modules from the
    // symlinked globular-web-client package that Vite would otherwise skip.
    optimizeDeps: {
      include: [
        'globular-web-client/admin/admin_grpc_web_pb',
        'globular-web-client/admin/admin_pb',
        'globular-web-client/applications_manager/applications_manager_grpc_web_pb',
        'globular-web-client/applications_manager/applications_manager_pb',
        'globular-web-client/authentication/authentication_grpc_web_pb',
        'globular-web-client/authentication/authentication_pb',
        'globular-web-client/blog/blog_grpc_web_pb',
        'globular-web-client/blog/blog_pb',
        'globular-web-client/cluster_controller/cluster_controller_grpc_web_pb',
        'globular-web-client/cluster_controller/cluster_controller_pb',
        'globular-web-client/cluster_controller/plan_pb',
        'globular-web-client/cluster_doctor/cluster_doctor_grpc_web_pb',
        'globular-web-client/cluster_doctor/cluster_doctor_pb',
        'globular-web-client/conversation/conversation_grpc_web_pb',
        'globular-web-client/conversation/conversation_pb',
        'globular-web-client/discovery/discovery_grpc_web_pb',
        'globular-web-client/discovery/discovery_pb',
        'globular-web-client/event/event_grpc_web_pb',
        'globular-web-client/event/event_pb',
        'globular-web-client/log/log_grpc_web_pb',
        'globular-web-client/log/log_pb',
        'globular-web-client/file/file_grpc_web_pb',
        'globular-web-client/file/file_pb',
        'globular-web-client/media/media_grpc_web_pb',
        'globular-web-client/media/media_pb',
        'globular-web-client/persistence/persistence_grpc_web_pb',
        'globular-web-client/persistence/persistence_pb',
        'globular-web-client/rbac/rbac_grpc_web_pb',
        'globular-web-client/rbac/rbac_pb',
        'globular-web-client/repository/repository_grpc_web_pb',
        'globular-web-client/repository/repository_pb',
        'globular-web-client/resource/resource_grpc_web_pb',
        'globular-web-client/resource/resource_pb',
        'globular-web-client/search/search_grpc_web_pb',
        'globular-web-client/search/search_pb',
        'globular-web-client/services_manager/services_manager_grpc_web_pb',
        'globular-web-client/services_manager/services_manager_pb',
        'globular-web-client/title/title_grpc_web_pb',
        'globular-web-client/title/title_pb',
        'globular-web-client/torrent/torrent_grpc_web_pb',
        'globular-web-client/torrent/torrent_pb',
        'globular-web-client/monitoring/monitoring_grpc_web_pb',
        'globular-web-client/monitoring/monitoring_pb',
      ],
    },
    resolve: {
      alias: {
        'globular-web-client': path.resolve(__dirname, '../../../services/typescript/dist'),
        '@globular/backend': path.resolve(__dirname, '../../packages/backend/src'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
      commonjsOptions: {
        include: [/node_modules/, /services[\\/]typescript[\\/]dist/],
      },
    },
  }
})
