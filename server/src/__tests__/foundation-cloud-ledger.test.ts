import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  agents,
  companies,
  costEvents,
} from "@paperclipai/db";
import { costService } from "../services/costs.ts";
import {
  normalizeBilledCostCents,
  normalizeLedgerBillingType,
  resolveCacheAdjustedCostUsd,
  resolveLedgerBiller,
  resolveLedgerCostStatus,
} from "../services/heartbeat.ts";
import { resolveBedrockCostUsd } from "../services/bedrock-pricing.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * The Foundation Cloud billing claim, asserted against a real database.
 *
 * Foundation Cloud sells agent runs that Davaria pays Amazon for, so the claim
 * a tenant is billed on is not "the pricer returns a number" but "the run left
 * a row in cost_events carrying real cents". Those are different claims: a
 * Bedrock run reports tokens and no cost, and every earlier version of this
 * path persisted such a run at zero cents with the tokens intact — consumption
 * recorded, revenue lost, and nothing failing loudly enough to notice.
 *
 * So this composes the exact helpers `updateRuntimeState` composes, in the same
 * order, and then reads the row back out of Postgres.
 */
function ledgerRowFor(result: {
  model: string;
  provider?: string;
  biller?: string;
  billingType?: string;
  costUsd?: number | null;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
}) {
  const { inputTokens, cachedInputTokens, outputTokens } = result.usage;
  const billingType = normalizeLedgerBillingType(result.billingType);
  const billedCostUsd =
    resolveCacheAdjustedCostUsd(
      result as Parameters<typeof resolveCacheAdjustedCostUsd>[0],
    ) ??
    resolveBedrockCostUsd(result.model, {
      inputTokens,
      cachedInputTokens,
      outputTokens,
    });
  return {
    provider: result.provider ?? "unknown",
    biller: resolveLedgerBiller(
      result as Parameters<typeof resolveLedgerBiller>[0],
    ),
    billingType,
    costStatus: resolveLedgerCostStatus({
      costUsd: billedCostUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    }),
    model: result.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costCents: normalizeBilledCostCents(billedCostUsd, billingType),
  };
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

describeEmbeddedPostgres("Foundation Cloud billing ledger", () => {
  let db!: ReturnType<typeof createDb>;
  let costs!: ReturnType<typeof costService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null =
    null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("foundation-cloud-ledger-");
    db = createDb(tempDb.connectionString);
    costs = costService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(costEvents);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedTenant(name: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `${name} agent`,
      role: "engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  it("bills a Bedrock run in cents the tenant can be invoiced for", async () => {
    const { companyId, agentId } = await seedTenant("Tenant Bedrock");

    // What Claude Code actually reports under CLAUDE_CODE_USE_BEDROCK: a
    // Bedrock model id, token counts, and no cost field at all.
    await costs.createEvent(companyId, {
      agentId,
      occurredAt: new Date("2026-09-11T04:00:00.000Z"),
      ...ledgerRowFor({
        model: "global.anthropic.claude-sonnet-4-6",
        provider: "claude",
        biller: "aws_bedrock",
        billingType: "metered_api",
        usage: {
          inputTokens: 120_000,
          cachedInputTokens: 40_000,
          outputTokens: 8_000,
        },
      }),
    });

    const [row] = await db
      .select()
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId));

    expect(row?.biller).toBe("aws_bedrock");
    expect(row?.billingType).toBe("metered_api");
    expect(row?.costStatus).toBe("reported");
    // 120k in @ $3/M + 40k cache read @ $0.30/M + 8k out @ $15/M = $0.492.
    expect(row?.costCents).toBe(49);
    expect(row?.inputTokens).toBe(120_000);
    expect(row?.cachedInputTokens).toBe(40_000);
    expect(row?.outputTokens).toBe(8_000);

    // The tenant's running total is what a budget or an invoice reads.
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent?.spentMonthlyCents).toBe(49);
  });

  it("keeps each tenant's Bedrock spend on its own books", async () => {
    const heavy = await seedTenant("Tenant Heavy");
    const light = await seedTenant("Tenant Light");

    for (const [tenant, outputTokens] of [
      [heavy, 200_000],
      [light, 2_000],
    ] as const) {
      await costs.createEvent(tenant.companyId, {
        agentId: tenant.agentId,
        occurredAt: new Date("2026-09-11T04:05:00.000Z"),
        ...ledgerRowFor({
          model: "global.anthropic.claude-sonnet-4-6",
          provider: "claude",
          biller: "aws_bedrock",
          billingType: "metered_api",
          usage: { inputTokens: 10_000, cachedInputTokens: 0, outputTokens },
        }),
      });
    }

    const spendFor = async (companyId: string) => {
      const rows = await db
        .select()
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            eq(costEvents.biller, "aws_bedrock"),
          ),
        );
      return rows.reduce((total, row) => total + row.costCents, 0);
    };

    // $0.03 in + $3.00 out, and $0.03 in + $0.03 out.
    expect(await spendFor(heavy.companyId)).toBe(303);
    expect(await spendFor(light.companyId)).toBe(6);
    expect(await spendFor(randomUUID())).toBe(0);
  });

  it("never invents a price for a Bedrock model it has no rate for", async () => {
    const { companyId, agentId } = await seedTenant("Tenant Unknown Model");

    await costs.createEvent(companyId, {
      agentId,
      occurredAt: new Date("2026-09-11T04:10:00.000Z"),
      ...ledgerRowFor({
        model: "global.anthropic.claude-nonesuch-9-9",
        provider: "claude",
        biller: "aws_bedrock",
        billingType: "metered_api",
        usage: { inputTokens: 5_000, cachedInputTokens: 0, outputTokens: 500 },
      }),
    });

    const [row] = await db
      .select()
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId));

    // Recorded as consumption that still needs a price, not as free usage.
    expect(row?.costStatus).toBe("unpriced");
    expect(row?.costCents).toBe(0);
    expect(row?.inputTokens).toBe(5_000);
  });

  it("leaves a customer-keyed run billed at the price its adapter reported", async () => {
    const { companyId, agentId } = await seedTenant("Tenant Own Key");

    await costs.createEvent(companyId, {
      agentId,
      occurredAt: new Date("2026-09-11T04:15:00.000Z"),
      ...ledgerRowFor({
        // Same model id, but the adapter priced it: Foundation is not the payer.
        model: "global.anthropic.claude-sonnet-4-6",
        provider: "claude",
        biller: "anthropic",
        billingType: "metered_api",
        costUsd: 1.25,
        usage: {
          inputTokens: 120_000,
          cachedInputTokens: 40_000,
          outputTokens: 8_000,
        },
      }),
    });

    const [row] = await db
      .select()
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId));

    expect(row?.biller).toBe("anthropic");
    expect(row?.costCents).toBe(125);
  });

  it("bills nothing for a subscription run even when the model has a Bedrock rate", async () => {
    const { companyId, agentId } = await seedTenant("Tenant Subscription");

    await costs.createEvent(companyId, {
      agentId,
      occurredAt: new Date("2026-09-11T04:20:00.000Z"),
      ...ledgerRowFor({
        model: "global.anthropic.claude-sonnet-4-6",
        provider: "claude",
        biller: "anthropic",
        billingType: "subscription_included",
        usage: {
          inputTokens: 120_000,
          cachedInputTokens: 0,
          outputTokens: 8_000,
        },
      }),
    });

    const [row] = await db
      .select()
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId));

    expect(row?.billingType).toBe("subscription_included");
    expect(row?.costCents).toBe(0);
    expect(row?.inputTokens).toBe(120_000);
  });
});
