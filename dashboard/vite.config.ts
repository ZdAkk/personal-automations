import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React app lives in web/ and builds to web/dist, which the Fastify server
// serves statically in production. In dev, `npm run dev` proxies /api to the
// server so both run side by side.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8088", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8088", changeOrigin: true },
    },
  },
});
