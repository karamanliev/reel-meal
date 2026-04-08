import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";

export default defineConfig({
  plugins: [UnoCSS(), react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy /api/* requests to the Hono server in dev
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
