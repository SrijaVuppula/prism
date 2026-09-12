// Entry point. Wires up: webhook receiver, WebSocket server, push
// subscription endpoints, and the orchestration pipeline.

import { createServer } from "node:http";
import express from "express";
import { ringRouter } from "./ring/routes";
import { pushRouter } from "./push/routes";
import { attachWebSocketServer } from "./api/websocket";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(ringRouter);
app.use(pushRouter);

// The WebSocket server upgrades HTTP connections on this same server (see
// api/websocket.ts), so it needs the underlying http.Server rather than the
// Express app itself -- app.listen() below returns one implicitly, but
// creating it explicitly here lets attachWebSocketServer() run first.
const httpServer = createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`prism-backend listening on :${PORT}`);
});
