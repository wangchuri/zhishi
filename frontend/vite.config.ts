import path from "path"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  server: {
    host: true, // 监听 0.0.0.0，暴露到局域网
    port: 5173,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["logo.png", "logo.jpg"],
      manifest: {
        name: "知拾",
        short_name: "知拾",
        description: "自学习伙伴 — 上传资料、自动出题、刷题与苏格拉底式辅导",
        theme_color: "#1F5C5A",
        background_color: "#F3EFE6",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          {
            src: "logo.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "logo.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // 富文本编辑器（Tiptap）使主包超过默认 2 MiB 预缓存上限
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,png,jpg,jpeg,svg,ico,woff2}"],
        navigateFallback: "index.html",
        // 后端 API / 清缓存入口走网络，不做缓存
        navigateFallbackDenylist: [/^\/api\//, /\/api\//, /^\/health$/],
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