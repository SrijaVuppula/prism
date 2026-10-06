import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies the backend's WebSocket stream and REST endpoints in dev, so the
// companion app can be developed against a local prism-backend without any
// env file -- see hooks/useRealtimeEvents.ts and lib/apiBase.ts, which
// default to same-origin URLs. Every path prefix the app calls on the
// backend needs an entry here.
const BACKEND_ORIGIN = process.env.VITE_BACKEND_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: BACKEND_ORIGIN, ws: true },
      "/push": BACKEND_ORIGIN,
      "/preferences": BACKEND_ORIGIN,
      "/visitors": BACKEND_ORIGIN,
      "/alerts": BACKEND_ORIGIN,
      "/health": BACKEND_ORIGIN,
    },
  },
});
