import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function declarationBlock(selector: string) {
  const start = stylesheet.indexOf(`${selector} {`);
  expect(start, `${selector} declaration exists`).toBeGreaterThanOrEqual(0);
  const end = stylesheet.indexOf("\n}", start);
  expect(end, `${selector} declaration closes`).toBeGreaterThan(start);
  return stylesheet.slice(start, end);
}

describe("Foundation theme palette", () => {
  it("uses a light navigation surface in light mode", () => {
    const root = declarationBlock(":root");

    expect(root).toContain("--foundation-sidebar: #f1f1f3");
    expect(root).toContain("--foundation-sidebar-foreground: #292a2e");
    expect(root).toContain("--foundation-canvas: #e9eaed");
    expect(root).toContain("--foundation-surface-raised: #fbfbfc");
  });

  it("keeps the dark navigation palette scoped to dark mode", () => {
    const dark = declarationBlock(".dark");

    expect(dark).toContain("--foundation-sidebar: #0b0c0e");
    expect(dark).toContain("--foundation-sidebar-foreground: #ececee");
    expect(dark).toContain("--foundation-canvas: #08090a");
    expect(dark).toContain("--foundation-surface-raised: #17181a");
  });
});
