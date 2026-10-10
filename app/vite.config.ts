import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  define: { global: "globalThis" },
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "process", "events", "util", "assert", "stream", "crypto"],
      globals: { Buffer: false, process: false, global: false },
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@anchor-lang/core", "@solana/web3.js", "@solana/spl-token", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk", "buffer", "bn.js"],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
