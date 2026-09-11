import { describe, expect, it } from "vitest";
import {
  normalizeBilledCostCents,
  resolveBilledCostUsd,
  resolveCacheAdjustedCostUsd,
  resolveLedgerCostStatus,
} from "../services/heartbeat.js";
import { resolveBedrockCostUsd } from "../services/bedrock-pricing.js";

describe("heartbeat cost accounting", () => {
  it("marks token-bearing CLI usage without a reported cost as unpriced", () => {
    expect(resolveLedgerCostStatus({
      costUsd: null,
      inputTokens: 2_732_577,
      cachedInputTokens: 2_632_998,
      outputTokens: 32_644,
    })).toBe("unpriced");
  });

  it("marks reported CLI cost as priced", () => {
    expect(resolveLedgerCostStatus({
      costUsd: 1.25,
      inputTokens: 2_090,
      cachedInputTokens: 300_000,
      outputTokens: 77_000,
    })).toBe("reported");
  });

  it("uses an explicit cache-adjusted provider cost when available", () => {
    expect(resolveCacheAdjustedCostUsd({
      costUsd: 1.25,
      cacheAdjustedCostUsd: 0.92,
    })).toBe(0.92);
  });

  it("attributes provider-reported billed cost as cache-adjusted by default", () => {
    expect(resolveCacheAdjustedCostUsd({
      costUsd: 1.25,
      cacheAdjustedCostUsd: null,
    })).toBe(1.25);
  });

  it("does not attribute invalid or unavailable costs", () => {
    expect(resolveCacheAdjustedCostUsd({
      costUsd: null,
      cacheAdjustedCostUsd: Number.NaN,
    })).toBeNull();
  });

  it("prices a run that only reports a cache-adjusted cost", () => {
    const billedCostUsd = resolveCacheAdjustedCostUsd({
      costUsd: null,
      cacheAdjustedCostUsd: 0.42,
    });
    expect(billedCostUsd).toBe(0.42);
    expect(resolveLedgerCostStatus({
      costUsd: billedCostUsd,
      inputTokens: 1_000,
      cachedInputTokens: 900_000,
      outputTokens: 5_000,
    })).toBe("reported");
  });

  it("bills the discounted amount when both nominal and cache-adjusted costs are reported", () => {
    expect(resolveCacheAdjustedCostUsd({
      costUsd: 3.1,
      cacheAdjustedCostUsd: 1.5,
    })).toBe(1.5);
  });
});

/**
 * The Foundation Cloud billing path, end to end over the pure helpers.
 *
 * A managed run reaches the ledger with token counts and no cost, because
 * Claude Code cannot price Bedrock. These assertions pin the two steps that
 * turn that into a billable row, since either one silently yields a zero-cent
 * charge for a tenant that did consume tokens.
 */
describe("Foundation Cloud (Bedrock) ledger pricing", () => {
  const usage = { inputTokens: 48_000, cachedInputTokens: 120_000, outputTokens: 6_500 };

  it("prices a Bedrock run the adapter reported no cost for", () => {
    const adapterCost = resolveCacheAdjustedCostUsd({ costUsd: null });
    expect(adapterCost ?? null).toBeNull();

    const priced = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", usage);
    expect(priced).not.toBeNull();
    expect(priced!).toBeGreaterThan(0);
  });

  /**
   * `metered_api` is what claude-local reports once CLAUDE_CODE_USE_BEDROCK is
   * set. It must not be zeroed the way `subscription_included` is — that branch
   * exists for runs already paid for by a seat, and a Bedrock run is not one.
   */
  it("keeps the priced amount because a Bedrock run is metered, not included in a subscription", () => {
    const priced = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", usage)!;
    expect(normalizeBilledCostCents(priced, "metered_api")).toBeGreaterThan(0);
    expect(normalizeBilledCostCents(priced, "subscription_included")).toBe(0);
  });

  it("reports the run as priced once Bedrock supplies the cost", () => {
    const priced = resolveBedrockCostUsd("us.anthropic.claude-sonnet-4-6", usage)!;
    expect(resolveLedgerCostStatus({ costUsd: priced, ...usage })).toBe("reported");
    // Without the pricer the same run is recorded as owed-but-unbilled.
    expect(resolveLedgerCostStatus({ costUsd: null, ...usage })).toBe("unpriced");
  });
});

describe("one billed-cost answer for the ledger and the run", () => {
  const bedrockUsage = {
    inputTokens: 120_000,
    cachedInputTokens: 40_000,
    outputTokens: 8_000,
  };

  it("prices a Bedrock run the adapter left uncosted", () => {
    // Claude Code reports tokens and no cost under CLAUDE_CODE_USE_BEDROCK.
    // Both the ledger row and the run's own usageJson read this, and they
    // disagreed before it existed: cost_events said reported with cents while
    // the run described itself as unpriced.
    const usd = resolveBilledCostUsd(
      { model: "global.anthropic.claude-sonnet-4-6" } as never,
      bedrockUsage,
    );
    expect(usd).toBeCloseTo(0.492, 6);
    expect(
      resolveLedgerCostStatus({ costUsd: usd, ...bedrockUsage }),
    ).toBe("reported");
  });

  it("leaves an adapter-reported price alone", () => {
    expect(
      resolveBilledCostUsd(
        { model: "global.anthropic.claude-sonnet-4-6", costUsd: 1.25 } as never,
        bedrockUsage,
      ),
    ).toBeCloseTo(1.25, 6);
  });

  it("refuses to guess a price for a model it has no rate for", () => {
    const usd = resolveBilledCostUsd(
      { model: "global.anthropic.claude-nonesuch-9-9" } as never,
      bedrockUsage,
    );
    expect(usd).toBeNull();
    expect(
      resolveLedgerCostStatus({ costUsd: usd, ...bedrockUsage }),
    ).toBe("unpriced");
  });
});
