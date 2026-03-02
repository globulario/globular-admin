import { defineConfig, loadEnv } from 'vite'
import path from 'path'

// Vite automatically provides mode in the callback
export default defineConfig(({ mode }) => {
  // Use import.meta.env instead of process.cwd()
  const env = loadEnv(mode, '.', '')

  // Default to your backend if no .env value is set
  const target = env.VITE_PROXY_TARGET || 'https://globule-ryzen.globular.io'

  return {
    root: '.',
    server: {
      port: 5174,
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
      ],
    },
    resolve: {
      alias: {
        'globular-web-client': path.resolve(__dirname, '../../../services/typescript/dist'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
    },
  }
})
