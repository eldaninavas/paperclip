import { describe, expect, it } from "vitest";
import { measuredInputTokens } from "./live-session.js";

describe("measuredInputTokens", () => {
  it("adds the cache writes runner-core reports outside inputTokens", () => {
    // The shape runner-core emits: cacheWriteTokens is already the sum of the
    // provider's ephemeral_1h and ephemeral_5m buckets.
    expect(
      measuredInputTokens({
        inputTokens: 21,
        outputTokens: 8,
        cacheReadTokens: 13,
        cacheWriteTokens: 89,
      }),
    ).toBe(110);
  });

  it("is unchanged when the provider reports no cache writes", () => {
    expect(measuredInputTokens({ inputTokens: 21, outputTokens: 8 })).toBe(21);
  });

  it("accepts the snake_case and camelCase spellings of each field", () => {
    expect(
      measuredInputTokens({
        input_tokens: 100,
        cache_write_input_tokens: 5,
      }),
    ).toBe(105);
    expect(
      measuredInputTokens({
        inputTokens: 100,
        cacheWriteInputTokens: 5,
      }),
    ).toBe(105);
  });

  it("ignores values that are not usable token counts", () => {
    // A negative or fractional count would otherwise reduce a tenant's bill.
    expect(
      measuredInputTokens({ inputTokens: -5, cacheWriteTokens: 1.5 }),
    ).toBe(0);
    expect(measuredInputTokens({})).toBe(0);
  });
});
