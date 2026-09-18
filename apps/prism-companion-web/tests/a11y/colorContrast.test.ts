// Verifies the WCAG 2.2 AA color-contrast checklist item in
// docs/ACCESSIBILITY.md (>= 4.5:1 for normal text, >= 3:1 for large text
// and UI components) against the actual palette declared in src/App.css.
//
// This computes contrast directly from the WCAG relative-luminance formula
// rather than through a browser: the app's palette is a fixed set of CSS
// custom properties (no runtime color computation), so this is exact,
// deterministic, and -- unlike axe-core's color-contrast rule under jsdom
// (see a11y/axeHelper.ts) -- doesn't need real paint/layout to be
// trustworthy. Reading the values out of App.css (rather than hardcoding
// them here) means a future palette change is checked against AA
// automatically instead of silently drifting out of sync with this test.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolved from the package root (vitest's cwd when run via `npm run test`)
// rather than import.meta.url: under the jsdom test environment,
// import.meta.url resolves against jsdom's document URL, not a real file://
// path, so a URL built from it fails to convert back to a filesystem path.
const APP_CSS_PATH = resolve(process.cwd(), "src/App.css");

function loadCssVariables(): Record<string, string> {
  const css = readFileSync(APP_CSS_PATH, "utf-8");
  const rootBlockMatch = css.match(/:root\s*{([^}]*)}/);
  if (!rootBlockMatch) throw new Error("Could not find a :root block in App.css");
  const variables: Record<string, string> = {};
  for (const line of rootBlockMatch[1].split(";")) {
    const match = line.match(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/);
    if (match) variables[match[1]] = match[2];
  }
  return variables;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
  const value = normalized.slice(1);
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map(linearize);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const NORMAL_TEXT_MIN = 4.5;
const UI_COMPONENT_MIN = 3;

describe("color contrast (WCAG 2.2 AA)", () => {
  const vars = loadCssVariables();

  it.each([
    // Body text, muted captions/hints, and Signal Class text against both
    // surfaces they actually appear on (page background and card/panel
    // surface) -- see App.css for where each variable is used.
    ["text on bg (body copy)", "text", "bg", NORMAL_TEXT_MIN],
    ["text on surface (card/panel copy)", "text", "surface", NORMAL_TEXT_MIN],
    ["muted on bg (connection status, empty state)", "muted", "bg", NORMAL_TEXT_MIN],
    ["muted on surface (settings hints)", "muted", "surface", NORMAL_TEXT_MIN],
    ["routine on bg (Signal Class badge text)", "routine", "bg", NORMAL_TEXT_MIN],
    ["routine on surface (Signal Class badge text)", "routine", "surface", NORMAL_TEXT_MIN],
    ["notable on bg (Signal Class badge text)", "notable", "bg", NORMAL_TEXT_MIN],
    ["notable on surface (Signal Class badge text)", "notable", "surface", NORMAL_TEXT_MIN],
    ["urgent on bg (Signal Class badge / error text)", "urgent", "bg", NORMAL_TEXT_MIN],
    ["urgent on surface (Signal Class badge / error text)", "urgent", "surface", NORMAL_TEXT_MIN],
    // UI components: button borders, the pressed feedback-button fill, and
    // the focus ring, each against the surface it's drawn on.
    ["accent on bg (button border)", "accent", "bg", UI_COMPONENT_MIN],
    ["accent on surface (button border)", "accent", "surface", UI_COMPONENT_MIN],
    ["bg on accent (pressed feedback button text on its fill)", "bg", "accent", NORMAL_TEXT_MIN],
    ["focus-ring on bg", "focus-ring", "bg", UI_COMPONENT_MIN],
    ["focus-ring on surface", "focus-ring", "surface", UI_COMPONENT_MIN],
  ])("%s meets its AA threshold", (_label, fg, bg, minRatio) => {
    expect(vars[fg]).toBeDefined();
    expect(vars[bg]).toBeDefined();
    const ratio = contrastRatio(vars[fg], vars[bg]);
    expect(ratio).toBeGreaterThanOrEqual(minRatio);
  });
});
