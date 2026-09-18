import { describe, expect, it } from "vitest";
import { StubClassifier } from "../src/classifier";

describe("StubClassifier", () => {
  it("returns a fixed, well-formed classification for local development/testing", async () => {
    const classifier = new StubClassifier();
    const result = await classifier.classify("https://cdn.example.com/snap/evt_1.jpg");

    expect(result.category).toBe("person");
    expect(result.description).toBeTypeOf("string");
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("ignores the snapshot URL passed in — a stub is not a real classifier", async () => {
    const classifier = new StubClassifier();
    const a = await classifier.classify("https://cdn.example.com/a.jpg");
    const b = await classifier.classify("https://cdn.example.com/b.jpg");

    expect(a).toEqual(b);
  });
});
