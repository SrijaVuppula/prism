// Keeps CREDITS.md in step with the fixture images: every image under
// eval/fixtures has exactly one credit row, and every row names an image
// that's there.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const fixturesDir = path.join(repoRoot, "packages", "prism-backend", "eval", "fixtures");
const credits = readFileSync(path.join(repoRoot, "CREDITS.md"), "utf8");

const images = readdirSync(fixturesDir).filter((name) => name.endsWith(".jpg"));

/** The table rows of CREDITS.md: fixture file, Pexels photo id and link, photographer. */
const rows = credits
  .split("\n")
  .map((line) => /^\| `([^`]+)` \| \[(\d+)\]\(([^)]+)\) \| (.+) \|$/.exec(line))
  .filter((match): match is RegExpExecArray => match !== null)
  .map(([, file, photoId, link, photographer]) => ({ file, photoId, link, photographer: photographer.trim() }));

describe("CREDITS.md", () => {
  it("credits every fixture image exactly once", () => {
    expect(images.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.file).sort()).toEqual([...images].sort());
  });

  it("links each photo's Pexels page and names its photographer", () => {
    for (const row of rows) {
      expect(row.link).toBe(`https://www.pexels.com/photo/${row.photoId}/`);
      expect(row.photographer).not.toBe("");
    }
  });

  it("says the photos are under the Pexels License, not the MIT license", () => {
    expect(credits).toContain("[Pexels License](https://www.pexels.com/license/)");
    expect(credits).toContain("not covered by this repository's MIT license");
  });
});
