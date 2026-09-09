// Entry point. Wires up: webhook receiver, WebSocket server, and (once built)
// the orchestration pipeline. Kept minimal until Phase 1 lands.

import express from "express";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// TODO (Phase 1.2): mount the Ring webhook route here.
// TODO (Phase 3.5): attach the WebSocket/SSE server here.

app.listen(PORT, () => {
  console.log(`prism-backend listening on :${PORT}`);
});
