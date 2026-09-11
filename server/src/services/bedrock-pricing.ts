/**
 * Token pricing for Anthropic models served through Amazon Bedrock.
 *
 * Foundation Cloud runs the customer's agent against Bedrock in Foundation's
 * own AWS account, so the ledger cannot learn the price from the adapter the
 * way it does for a customer-supplied Anthropic key: Claude Code reports token
 * counts but no cost when `CLAUDE_CODE_USE_BEDROCK` is set, because it does not
 * know the account's rates. Without a price here every Bedrock run lands in
 * `cost_events` as `unpriced` with `costCents: 0` — tokens recorded, nothing
 * billable — which is precisely the row Foundation needs to charge a tenant.
 *
 * The rates below are USD per million tokens, read from the on-demand rate card
 * that `bedrock:ListFoundationModelAgreementOffers` returns for each model
 * (dimensions `AFS1_*_Global`), not from documentation. Refresh them from that
 * API rather than by hand; `scripts/` has no generator yet because the set is
 * small and changes rarely.
 *
 * An unknown model returns `null`, never a guess. A wrong price silently
 * overcharges or undercharges a customer, so an unpriced row that someone has
 * to explain is the safer failure: `resolveLedgerCostStatus` already marks it
 * `unpriced`, which is a visible, queryable state.
 */

/** USD per million tokens, per canonical model family. */
const BEDROCK_USD_PER_MILLION: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  // Verified 2026-09-11 against ListFoundationModelAgreementOffers (us-east-1),
  // dimensions AFS1_*_Global, and re-checked the same night.
  //
  // The rate card also carries a SECOND, higher cache-write dimension for the
  // one-hour TTL, which this table does not model:
  //
  //   model          CacheWriteInputTokenCount   CacheWrite1hInputTokenCount
  //   sonnet-4-6     3.75                        6
  //   opus-4-6       6.25                        10
  //   haiku-4-5      1.25                        2
  //
  // It matters for whoever prices cache writes exactly: runner-core sums
  // `ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` into a single
  // `cacheWriteTokens`, so the two buckets would have to be kept apart before
  // either rate could be applied. Today both fold into input at the base rate,
  // which understates rather than overstates.
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/**
 * True for a Bedrock-native model identifier.
 *
 * Bedrock ids carry a region-or-scope prefix (`us.`, `eu.`, `apac.`, `global.`)
 * ahead of the vendor segment, or arrive as a full inference-profile ARN. A
 * bare `claude-sonnet-4-6` is the Anthropic API's own name and is deliberately
 * not matched: that run is billed by Anthropic, and the adapter reports its
 * cost directly.
 */
export function isBedrockModelId(model: string): boolean {
  return /^[a-z0-9]+\.anthropic\./i.test(model) || model.startsWith("arn:aws:bedrock:");
}

/**
 * Reduce any Bedrock spelling of a model to the family key used above.
 *
 * The same model reaches this function as `us.anthropic.claude-sonnet-4-6`,
 * `global.anthropic.claude-sonnet-4-6`, `anthropic.claude-sonnet-4-5-20250929-v1:0`
 * or as an inference-profile ARN ending in any of those. Only the family and
 * its major/minor version decide the price — the training date and the `-v1:0`
 * revision suffix do not — so both are dropped rather than enumerated.
 */
export function canonicalBedrockModelKey(model: string): string | null {
  const match = /claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i.exec(model);
  if (!match) return null;
  return `claude-${match[1]!.toLowerCase()}-${match[2]}-${match[3]}`;
}

export type BedrockTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /**
   * Cache *writes*, which Bedrock prices above the base input rate. Claude Code
   * does not currently break these out, so this is optional and defaults to
   * zero — those tokens then price as ordinary input, which understates the
   * cost slightly rather than overstating it.
   */
  cacheWriteInputTokens?: number;
};

/**
 * Cost in USD for one Bedrock run, or `null` when the model is not a priced
 * Bedrock model. Returning `null` for an unknown Bedrock model is intentional:
 * see the note at the top of this file.
 */
export function resolveBedrockCostUsd(
  model: string | null | undefined,
  usage: BedrockTokenUsage,
): number | null {
  if (typeof model !== "string" || model.length === 0) return null;
  if (!isBedrockModelId(model)) return null;
  const key = canonicalBedrockModelKey(model);
  if (!key) return null;
  const rate = BEDROCK_USD_PER_MILLION[key];
  if (!rate) return null;

  const nonNegative = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

  const cacheWrite = nonNegative(usage.cacheWriteInputTokens);
  const cacheRead = nonNegative(usage.cachedInputTokens);
  const input = nonNegative(usage.inputTokens);
  const output = nonNegative(usage.outputTokens);

  const perMillion = (tokens: number, usdPerMillion: number) =>
    (tokens / 1_000_000) * usdPerMillion;

  return (
    perMillion(input, rate.input) +
    perMillion(output, rate.output) +
    perMillion(cacheRead, rate.cacheRead) +
    perMillion(cacheWrite, rate.cacheWrite)
  );
}

/** Model families this build can price, for diagnostics and tests. */
export function pricedBedrockModelKeys(): readonly string[] {
  return Object.keys(BEDROCK_USD_PER_MILLION);
}

/**
 * Whether the deployment's configured model is one this build can bill for.
 *
 * Changing `FOUNDATION_BEDROCK_MODEL` to a family missing from the rate card
 * does not fail anything: runs keep working, the ledger keeps recording tokens,
 * and every row lands `unpriced` at zero cents. That is revenue leaving without
 * an error anywhere, so the answer is surfaced on the health endpoint the
 * deploy already reads, where a wrong model is visible on the next deploy
 * rather than on the next invoice.
 */
export function describeBedrockBillingReadiness(env: {
  CLAUDE_CODE_USE_BEDROCK?: string;
  ANTHROPIC_MODEL?: string;
}): { model: string | null; priced: boolean } | null {
  const enabled = (env.CLAUDE_CODE_USE_BEDROCK ?? "").trim();
  if (enabled === "" || enabled === "0" || enabled.toLowerCase() === "false") {
    return null;
  }
  const model = (env.ANTHROPIC_MODEL ?? "").trim();
  if (model === "") return { model: null, priced: false };
  const key = canonicalBedrockModelKey(model);
  return {
    model,
    priced: key !== null && key in BEDROCK_USD_PER_MILLION,
  };
}
