// @vitest-environment node
// The app's icons: the Home Screen icon on iPhone (apple-touch-icon), the
// manifest's icons for installing the app elsewhere, and the icon on push
// notifications. Each must exist, be the size it claims, and be opaque,
// since iOS shows a transparent Home Screen icon on a black background.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "..");
const publicFile = (url: string) => path.join(appDir, "public", url.replace(/^\//, ""));

/** Width, height and PNG colour type (2 = RGB, 6 = RGB with alpha) from the PNG's header. */
function pngInfo(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("app icons", () => {
  it("lists PNG icons in the manifest at the sizes it claims, including a maskable one", () => {
    const manifest = JSON.parse(readFileSync(publicFile("manifest.json"), "utf8")) as {
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(icon.type).toBe("image/png");
      expect(pngInfo(publicFile(icon.src))).toEqual({ width, height, colourType: 2 });
    }
  });

  it("gives iPhones an opaque 180×180 Home Screen icon", () => {
    const html = readFileSync(path.join(appDir, "index.html"), "utf8");
    const href = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    expect(pngInfo(publicFile(href!))).toEqual({ width: 180, height: 180, colourType: 2 });
  });

  it("shows the app icon on push notifications", () => {
    const serviceWorker = readFileSync(publicFile("sw.js"), "utf8");
    const icon = serviceWorker.match(/icon: "([^"]+)"/)?.[1];
    expect(icon).toBeDefined();
    expect(pngInfo(publicFile(icon!)).width).toBeGreaterThanOrEqual(192);
  });
});
