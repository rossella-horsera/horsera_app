import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  build: {
    rollupOptions: {
      // Exclude TensorFlow.js from the bundle — it uses indexedDB/localStorage
      // for model caching which is incompatible with sandboxed iframe deployment.
      // The useVideoAnalysis hook handles the import failure gracefully.
      external: [
        "@tensorflow/tfjs",
        "@tensorflow-models/pose-detection",
      ],
    },
  },
}));
