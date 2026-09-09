import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { costEvents } from "@paperclipai/db";
import type { AssuranceCostCompleteness, AssuranceTotals } from "@paperclipai/shared";

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function reconcileAssuranceCosts(input: {
  db: Db;
  companyId: string;
  issueId?: string;
  runIds: string[];
  usageByRun?: Array<{ runId: string; usage: Record<string, unknown> | null }>;
}): Promise<{ events: Array<Record<string, unknown>>; totals: AssuranceTotals }> {
  const predicates = [eq(costEvents.companyId, input.companyId)];
  if (input.issueId) predicates.push(eq(costEvents.issueId, input.issueId));
  else if (input.runIds.length) predicates.push(inArray(costEvents.heartbeatRunId, input.runIds));
  const rows = await input.db.select().from(costEvents).where(and(...predicates));
  let completeness: AssuranceCostCompleteness = "missing";
  if (rows.length) {
    completeness = rows.every((row) => row.costStatus === "reported") ? "reported" : "partial";
  }
  const totals: AssuranceTotals = rows.reduce<AssuranceTotals>((sum, row) => ({
    ...sum,
    inputTokens: sum.inputTokens + row.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + row.cachedInputTokens,
    outputTokens: sum.outputTokens + row.outputTokens,
    costCents: sum.costCents + row.costCents,
  }), {
    runs: input.runIds.length,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    deliverables: 0,
    approvals: 0,
    costCompleteness: completeness,
  });
  if (!rows.length && input.usageByRun?.some((entry) => entry.usage)) {
    for (const entry of input.usageByRun) {
      const usage = entry.usage ?? {};
      totals.inputTokens += finiteNumber(usage.inputTokens ?? usage.input_tokens);
      totals.cachedInputTokens += finiteNumber(usage.cachedInputTokens ?? usage.cached_input_tokens);
      totals.outputTokens += finiteNumber(usage.outputTokens ?? usage.output_tokens);
    }
    totals.costCompleteness = "estimated";
  }
  return {
    events: rows.map((row) => ({
      id: row.id,
      runId: row.heartbeatRunId,
      provider: row.provider,
      biller: row.biller,
      billingType: row.billingType,
      model: row.model,
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      costCents: row.costCents,
      costStatus: row.costStatus,
      occurredAt: row.occurredAt.toISOString(),
    })),
    totals,
  };
}
