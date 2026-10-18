import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getCompanionAppDir, serveCompanionApp } from "../../src/web/companionApp";

const dir = mkdtempSync(path.join(tmpdir(), "companion-app-"));
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Prism</title>");
  writeFileSync(path.join(dir, "sw.js"), "self.addEventListener('push', () => {});");
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log('app')");

  const app = express();
  app.get("/alerts", (_req, res) => {
    res.json({ alerts: [] });
  });
  serveCompanionApp(app, dir);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.COMPANION_APP_DIR;
});

describe("serveCompanionApp", () => {
  it("serves the app at / and leaves API routes alone", async () => {
    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Prism</title>");
    expect(page.headers.get("cache-control")).toBe("no-cache");

    expect(await (await fetch(`${baseUrl}/alerts`)).json()).toEqual({ alerts: [] });
  });

  it("caches fingerprinted assets for good, and re-checks the service worker", async () => {
    const asset = await fetch(`${baseUrl}/assets/index-abc123.js`);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const worker = await fetch(`${baseUrl}/sw.js`);
    expect(await worker.text()).toContain("push");
    expect(worker.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers a page navigation to any other path with the app, but not an API-style request", async () => {
    const page = await fetch(`${baseUrl}/settings`, { headers: { Accept: "text/html" } });
    expect(await page.text()).toContain("<title>Prism</title>");

    const api = await fetch(`${baseUrl}/no-such-endpoint`, { headers: { Accept: "application/json" } });
    expect(api.status).toBe(404);
  });
});

describe("getCompanionAppDir", () => {
  it("is off unless COMPANION_APP_DIR is set, and refuses a directory without a build", () => {
    expect(getCompanionAppDir()).toBeNull();
    process.env.COMPANION_APP_DIR = dir;
    expect(getCompanionAppDir()).toBe(dir);
    process.env.COMPANION_APP_DIR = path.join(dir, "assets");
    expect(() => getCompanionAppDir()).toThrow(/no index.html/);
  });
});
