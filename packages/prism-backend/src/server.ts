// Entry point. Wires up: webhook receiver, WebSocket server, and (once built)
// the orchestration pipeline. Kept minimal for now.

import express from "express";
import { ringRouter } from "./ring/routes";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(ringRouter);

// TODO: attach the WebSocket/SSE server here.

app.listen(PORT, () => {
  console.log(`prism-backend listening on :${PORT}`);
});
