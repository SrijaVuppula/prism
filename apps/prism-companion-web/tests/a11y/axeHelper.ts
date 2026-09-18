// Shared helper for running an automated WCAG 2.2 AA accessibility check
// (axe-core) against a rendered component tree in jsdom, as part of the
// vitest suite -- see docs/ACCESSIBILITY.md for the audit this backs.
//
// color-contrast is disabled here deliberately: jsdom's getComputedStyle
// reflects declared CSS values rather than a real browser's painted,
// cascaded pixel colors, so axe-core's contrast checks are unreliable
// under jsdom (upstream guidance is to run them in a real browser instead).
// Contrast against the WCAG AA thresholds is verified precisely and
// deterministically in colorContrast.test.ts, computed directly from the
// same hex values declared in src/App.css using the WCAG relative-luminance
// formula -- which does not depend on a browser's rendering pipeline.
import axe from "axe-core";

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });

  if (results.violations.length > 0) {
    const detail = results.violations
      .map((violation) => {
        const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
        return `- ${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.helpUrl}\n  nodes: ${targets}`;
      })
      .join("\n");
    throw new Error(`Accessibility violations found:\n${detail}`);
  }
}
