// Serves the built companion app (apps/prism-companion-web/dist) from the
// backend itself, for a deployment where one server and one URL carry the
// app, its API and the WebSocket stream. Turned on by COMPANION_APP_DIR; in
// development Vite serves the app instead (npm run dev).
//
// Mounted after every API router, so it only answers requests nothing else
// did: a file from the build, or, for a page navigation, index.html.

import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";

/** The directory to serve, or null when COMPANION_APP_DIR is unset. Throws when it's set but missing a build. */
export function getCompanionAppDir(): string | null {
  const dir = process.env.COMPANION_APP_DIR?.trim();
  if (!dir) return null;
  const resolved = path.resolve(dir);
  if (!existsSync(path.join(resolved, "index.html"))) {
    throw new Error(`COMPANION_APP_DIR has no index.html (build the app with npm run build): ${resolved}`);
  }
  return resolved;
}

export function serveCompanionApp(app: Express, dir: string): void {
  const indexHtml = path.join(dir, "index.html");
  app.use(
    express.static(dir, {
      index: "index.html",
      setHeaders: (res, filePath) => {
        // Vite fingerprints everything under assets/, so those can be cached
        // for good. index.html and the service worker must be re-checked so
        // a new deployment reaches browsers.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  // A page navigation to any other path gets the app, which has one view.
  app.get(/.*/, (req, res, next) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
}
