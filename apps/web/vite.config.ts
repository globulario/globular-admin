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
      // Catch both " ./foo_pb.js?commonjs-external" and "\0./foo_pb.js?commonjs-external"
      const extIdx = source.indexOf('?commonjs-external')
      if (extIdx < 0 && !source.includes('_pb.js')) return null
      const bare = (extIdx >= 0 ? source.slice(0, extIdx) : source).replace(/^\0/, '').trim()
      if (!bare.endsWith('_pb.js') && !bare.endsWith('_pb.d.ts')) return null
      // Resolve relative to the proto dist directory
      if (bare.startsWith('./')) {
        const basename = bare.slice(2)
        // Try resolving from importer directory first
        if (importer) {
          const importerClean = importer.split('?')[0].replace(/^\0/, '')
          const dir = path.dirname(importerClean)
          const candidate = path.resolve(dir, bare)
          if (fs.existsSync(candidate)) return candidate
        }
        // Fall back: scan all proto subdirectories
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
      port: 5173,
      open: true,
      proxy: {
        '/prometheus': {
          target: 'http://127.0.0.1:9090',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/prometheus/, ''),
        },
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
        '/dns.DnsService': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/backup_manager.BackupManagerService': {
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
        'cluster-doctor-proto/cluster_doctor_grpc_web_pb',
        'cluster-doctor-proto/cluster_doctor_pb',
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
        'globular-web-client/dns/dns_grpc_web_pb',
        'globular-web-client/dns/dns_pb',
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
        'globular-web-client/backup_manager/backup_manager_grpc_web_pb',
        'globular-web-client/backup_manager/backup_manager_pb',
      ],
    },
    resolve: {
      alias: {
        // globular-web-client is only symlinked inside packages/components and
        // packages/backend node_modules, not at the workspace root.  Without
        // this alias Vite cannot pre-bundle the CJS proto stubs and serves
        // them directly via /@fs/, which breaks named ESM imports.
        'globular-web-client': path.resolve(__dirname, '../../../services/typescript/dist'),
        'cluster-doctor-proto': path.resolve(__dirname, '../../../services/typescript/dist/cluster_doctor'),
        // Resolve @globular/backend to source so Vite hot-reloads changes
        // without needing `npm run build` in packages/backend.
        '@globular/backend': path.resolve(__dirname, '../../packages/backend/src'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
      // The cluster-doctor-proto workspace package symlinks to packages/cluster-doctor-proto,
      // which resolves outside node_modules. Include it explicitly so Rollup's CJS plugin
      // converts require()/module.exports to ESM, matching globular-web-client behaviour.
      //
      // Also include services/typescript/dist: pnpm resolves the globular-web-client symlink
      // to its real path, placing it outside node_modules. Without this pattern Rollup's CJS
      // plugin skips these files and goog.object.extend exports are not statically analysable.
      commonjsOptions: {
        include: [/cluster-doctor-proto/, /node_modules/, /services[\\/]typescript[\\/]dist/],
      },
    },
  }
})
