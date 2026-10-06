// Entry point. Wires up: webhook receiver, WebSocket server, push
// subscription endpoints, preferences/known-visitor-tagging/feedback
// endpoints, event snapshots, and the orchestration pipeline.

import { createServer } from "node:http";
import express from "express";
import { loadEnv } from "./loadEnv";
import { ringRouter } from "./ring/routes";
import { pushRouter } from "./push/routes";
import { preferencesRouter } from "./preferences/routes";
import { visitorsRouter } from "./visitors/routes";
import { feedbackRouter } from "./feedback/routes";
import { eventsRouter } from "./events/routes";
import { attachWebSocketServer } from "./api/websocket";

loadEnv();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(ringRouter);
app.use(pushRouter);
app.use(preferencesRouter);
app.use(visitorsRouter);
app.use(feedbackRouter);
app.use(eventsRouter);

// The WebSocket server upgrades HTTP connections on this same server (see
// api/websocket.ts), so it needs the underlying http.Server rather than the
// Express app itself -- app.listen() below returns one implicitly, but
// creating it explicitly here lets attachWebSocketServer() run first.
const httpServer = createServer(app);
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`prism-backend listening on :${PORT}`);
});
