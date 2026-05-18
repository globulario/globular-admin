import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

/**
 * The globular-web-client proto stubs live outside node_modules (via pnpm link:).
 * Rollup's CJS plugin marks their relative require() targets as "?commonjs-external"
 * because they resolve outside node_modules. This plugin intercepts those virtual IDs
 * and resolves them to the actual file on disk.
 */
export function fixProtoExternals(protoDir: string): Plugin {
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

/**
 * Standard optimizeDeps.include list for all proto-generated CJS modules
 * from the symlinked globular-web-client package.
 */
export function globularOptimizeDeps(): string[] {
  return [
    'globular-web-client/admin/admin_grpc_web_pb',
    'globular-web-client/admin/admin_pb',
    'globular-web-client/ai_executor/ai_executor_grpc_web_pb',
    'globular-web-client/ai_executor/ai_executor_pb',
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
    'globular-web-client/workflow/workflow_grpc_web_pb',
    'globular-web-client/workflow/workflow_pb',
  ]
}

/**
 * Standard resolve.alias entries for globular workspaces.
 * @param servicesTypescriptDist - absolute path to services/typescript/dist
 * @param packagesDir - absolute path to the packages/ directory
 */
export function globularResolveAlias(servicesTypescriptDist: string, packagesDir: string): Record<string, string> {
  return {
    'globular-web-client': servicesTypescriptDist,
    'cluster-doctor-proto': servicesTypescriptDist + '/cluster_doctor',
    '@globular/sdk': packagesDir + '/sdk/src',
    '@globular/ui': packagesDir + '/ui/src',
    '@globular/media': packagesDir + '/media/src',
  }
}

/**
 * Standard commonjsOptions.include patterns for proto stubs that
 * resolve outside node_modules (symlinked workspace packages).
 */
export function globularCommonjsInclude(): RegExp[] {
  return [/cluster-doctor-proto/, /node_modules/, /services[\\/]typescript[\\/]dist/]
}
