import path from "path"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    host: true, // 监听 0.0.0.0，暴露到局域网
    port: 5173,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.png"],
      manifest: {
        name: "知拾",
        short_name: "知拾",
        description: "自学习伙伴 — 上传资料、自动出题、刷题与苏格拉底式辅导",
        theme_color: "#1F5C5A",
        background_color: "#F3EFE6",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        icons: [
          {
            src: "logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        navigateFallback: "index.html",
        // 后端 API 走网络，不做缓存
        navigateFallbackDenylist: [/^\/api\//, /\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})