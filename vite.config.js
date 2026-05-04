import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '農場民宿收支系統',
        short_name: '農場財務',
        description: '整合住宿與農產的智慧財務平台',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3261/3261180.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3261/3261180.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
