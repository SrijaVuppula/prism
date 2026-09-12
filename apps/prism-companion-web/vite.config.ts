import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies the backend's WebSocket stream and REST endpoints in dev, so the
// companion app can be developed against a local prism-backend without any
// env file -- see hooks/useRealtimeEvents.ts and hooks/usePushSubscription.ts,
// which both default to same-origin URLs.
const BACKEND_ORIGIN = process.env.VITE_BACKEND_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: BACKEND_ORIGIN, ws: true },
      "/push": BACKEND_ORIGIN,
      "/health": BACKEND_ORIGIN,
    },
  },
});
