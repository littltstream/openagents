import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Second entry, loaded only by the embedded workspace view: it runs
          // on the workspace's own https origin and must carry nothing but the
          // session handoff. See src/main/workspace-host.ts.
          'workspace-view': resolve('src/preload/workspace-view.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      // The launcher owns its local origin and has no web deployment subpath.
      'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify('')
    },
    resolve: {
      dedupe: ['react', 'react-dom', 'sonner', 'radix-ui'],
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve('../../workspace/frontend')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
