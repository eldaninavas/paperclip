import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("Foundation modal motion", () => {
  it("does not replace the translate property used to center dialogs", () => {
    const start = stylesheet.indexOf("@keyframes foundation-dialog-in");
    const end = stylesheet.indexOf("@keyframes foundation-flyout-in");
    const dialogKeyframes = stylesheet.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(dialogKeyframes).toContain("transform: translateY(6px) scale(0.975)");
    expect(dialogKeyframes).not.toMatch(/(?:^|[;{])\s*translate\s*:/m);
    expect(dialogKeyframes).not.toMatch(/(?:^|[;{])\s*scale\s*:/m);
  });

  it("preserves component positioning when reduced motion is enabled", () => {
    const motionSystemStart = stylesheet.indexOf("@keyframes foundation-dialog-in");
    const start = stylesheet.indexOf("@media (prefers-reduced-motion: reduce)", motionSystemStart);
    const end = stylesheet.indexOf("/* ---------------------------------------------------------------------------", start);
    const reducedMotionRules = stylesheet.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(reducedMotionRules).toContain("animation: none !important");
    expect(reducedMotionRules).not.toContain("translate: 0");
    expect(reducedMotionRules).not.toContain("scale: 1");
  });
});
