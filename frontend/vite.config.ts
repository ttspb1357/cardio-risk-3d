import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development (`npm run dev`, port 5173) API calls are proxied to the FastAPI server on port 8000.
// In production FastAPI serves the built `dist/` folder itself, so no proxy is involved.
const API = "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/predict", "/features", "/metrics", "/samples", "/health"].map((p) => [p, API])),
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1600 },
});
