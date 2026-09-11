import { describe, expect, it } from "vitest";

import {
  canonicalBedrockModelKey,
  isBedrockModelId,
  pricedBedrockModelKeys,
  resolveBedrockCostUsd,
} from "./bedrock-pricing.js";

describe("isBedrockModelId", () => {
  it("recognizes the region- and scope-prefixed spellings Bedrock actually emits", () => {
    expect(isBedrockModelId("us.anthropic.claude-sonnet-4-6")).toBe(true);
    expect(isBedrockModelId("global.anthropic.claude-sonnet-4-6")).toBe(true);
    expect(isBedrockModelId("eu.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(true);
    expect(
      isBedrockModelId(
        "arn:aws:bedrock:us-east-1:523859314550:inference-profile/global.anthropic.claude-sonnet-4-6",
      ),
    ).toBe(true);
  });

  /**
   * The bare Anthropic name must not match. That run is billed by Anthropic
   * against the customer's own key and the adapter reports its real cost;
   * pricing it here would bill Foundation's Bedrock rate for tokens Foundation
   * never bought.
   */
  it("does not claim a bare Anthropic API model name", () => {
    expect(isBedrockModelId("claude-sonnet-4-6")).toBe(false);
    expect(isBedrockModelId("claude-opus-4-6")).toBe(false);
  });
});

describe("canonicalBedrockModelKey", () => {
  it("drops the training date and revision suffix, which do not change the rate", () => {
    expect(canonicalBedrockModelKey("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "claude-sonnet-4-5",
    );
    expect(canonicalBedrockModelKey("global.anthropic.claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
    expect(canonicalBedrockModelKey("us.anthropic.claude-opus-4-6-v1")).toBe(
      "claude-opus-4-6",
    );
  });

  it("returns null when there is no Claude family in the identifier", () => {
    expect(canonicalBedrockModelKey("us.amazon.nova-pro-v1:0")).toBeNull();
  });
});

describe("resolveBedrockCostUsd", () => {
  it("prices input, output and cache reads at the published per-million rates", () => {
    // Sonnet 4.6: $3 input, $15 output, $0.30 cache read per million.
    const cost = resolveBedrockCostUsd("global.anthropic.claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15 + 0.3, 10);
  });

  it("prices each family at its own rate", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 };
    expect(resolveBedrockCostUsd("us.anthropic.claude-haiku-4-5", usage)).toBeCloseTo(1, 10);
    expect(resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-5", usage)).toBeCloseTo(3, 10);
    expect(resolveBedrockCostUsd("us.anthropic.claude-opus-4-6", usage)).toBeCloseTo(5, 10);
  });

  it("charges cache writes above the base input rate when the adapter reports them", () => {
    const withWrite = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 1_000_000,
    });
    expect(withWrite).toBeCloseTo(3.75, 10);
  });

  /**
   * The whole point of the module: a run that reports tokens and no price must
   * come back with a number, or the tenant's ledger row is zero.
   */
  it("prices a realistic run rather than returning zero", () => {
    const cost = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", {
      inputTokens: 48_000,
      cachedInputTokens: 120_000,
      outputTokens: 6_500,
    });
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
    expect(cost!).toBeCloseTo(
      (48_000 / 1e6) * 3 + (6_500 / 1e6) * 15 + (120_000 / 1e6) * 0.3,
      10,
    );
  });

  it("refuses to guess: unknown model families and non-Bedrock ids return null", () => {
    const usage = { inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 };
    // A Bedrock id whose family this build has no verified rate for.
    expect(resolveBedrockCostUsd("us.anthropic.claude-fable-9-9", usage)).toBeNull();
    // Anthropic-billed run: the adapter's own cost must win.
    expect(resolveBedrockCostUsd("claude-sonnet-4-6", usage)).toBeNull();
    expect(resolveBedrockCostUsd(null, usage)).toBeNull();
    expect(resolveBedrockCostUsd(undefined, usage)).toBeNull();
  });

  it("treats missing or negative counts as zero instead of crediting the tenant", () => {
    const cost = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", {
      inputTokens: -5,
      outputTokens: Number.NaN,
      cachedInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 10);
  });

  it("exposes the priced families so a rate gap is visible", () => {
    expect(pricedBedrockModelKeys()).toContain("claude-sonnet-4-6");
    expect(pricedBedrockModelKeys().length).toBeGreaterThanOrEqual(4);
  });
});
