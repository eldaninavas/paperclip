import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  assuranceTaskValidations,
  issueApprovals,
} from "@paperclipai/db";
import {
  ASSURANCE_POLICY_VERSION,
  type AssuranceCheck,
  type AssuranceTaskValidationState,
} from "@paperclipai/shared";
import { buildAssuranceTaskSnapshot } from "./snapshot-builder.js";

function approvalMatches(payload: Record<string, unknown>, validationId: string, inputDigest: string) {
  return payload.taskValidationId === validationId && payload.inputDigest === inputDigest;
}

export function shouldRequestAssuranceTaskApproval(input: {
  status: string;
  humanAcceptanceRequired: boolean;
}) {
  return input.status === "done" && input.humanAcceptanceRequired;
}

export async function validateAssuranceTask(input: {
  db: Db;
  companyId: string;
  issueId: string;
  actor: { type: "user" | "agent" | "system"; id: string; agentId?: string | null };
}) {
  const built = await buildAssuranceTaskSnapshot(input);
  return input.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assurance:task:${input.companyId}:${input.issueId}`}, 0))`);
    const latest = await tx.select().from(assuranceTaskValidations).where(and(
      eq(assuranceTaskValidations.companyId, input.companyId),
      eq(assuranceTaskValidations.issueId, input.issueId),
    )).orderBy(desc(assuranceTaskValidations.validatedAt)).limit(1).then((rows) => rows[0] ?? null);
    if (latest && latest.inputDigest !== built.inputDigest && latest.state !== "stale") {
      await tx.update(assuranceTaskValidations).set({ state: "stale", updatedAt: new Date() }).where(eq(assuranceTaskValidations.id, latest.id));
    }

    const checks: AssuranceCheck[] = [];
    const taskEligible = ["in_review", "done"].includes(built.issue.status);
    checks.push({ key: "task_terminal_or_review", label: "Task submitted for review or completed", state: taskEligible ? "passed" : "failed" });
    const runs = (built.snapshot.runs as Array<Record<string, unknown>>).length;
    checks.push({ key: "run_evidence", label: "At least one terminal run is recorded", state: runs > 0 ? "passed" : "missing" });
    const nativeRuns = (built.snapshot.runs as Array<Record<string, unknown>>).filter((run) => run.runtimeMode === "native").length;
    const assessments = (built.snapshot.assessments as Array<Record<string, unknown>>).length;
    const decisions = (built.snapshot.statusDecisions as Array<Record<string, unknown>>).length;
    checks.push({
      key: "native_finalization",
      label: "Native runs have durable assessments and decisions",
      state: nativeRuns === 0 ? "not_applicable" : assessments >= nativeRuns && decisions >= nativeRuns ? "passed" : "missing",
      detail: nativeRuns === 0 ? "Legacy runs are retained as limited evidence." : null,
    });
    checks.push({
      key: "cost_reconciliation",
      label: "Consumption provenance is identified",
      state: built.totals.costCompleteness === "missing" ? "missing" : "passed",
      detail: `Consumption completeness: ${built.totals.costCompleteness}`,
    });
    const deliverables = built.totals.deliverables;
    checks.push({
      key: "deliverables",
      label: "Deliverables are linked or absence is explicit",
      state: deliverables > 0 ? "passed" : "not_applicable",
      detail: deliverables > 0 ? `${deliverables} linked deliverable records` : "No deliverable was linked to this task.",
    });

    let validation = latest?.inputDigest === built.inputDigest ? latest : null;
    if (!validation) {
      const [created] = await tx.insert(assuranceTaskValidations).values({
        companyId: input.companyId,
        issueId: input.issueId,
        projectId: built.issue.projectId,
        sourceStatusVersion: Number(built.issue.statusVersion),
        inputDigest: built.inputDigest,
        policyVersion: ASSURANCE_POLICY_VERSION,
        state: "pending",
        checksJson: { checks },
        totalsJson: built.totals as unknown as Record<string, unknown>,
        snapshotJson: built.snapshot,
        snapshotSha256: built.snapshotSha256,
        validatedAt: new Date(),
        supersedesValidationId: latest?.id ?? null,
      }).returning();
      if (!created) throw new Error("assurance_validation_not_persisted");
      validation = created;
    }

    const humanAcceptanceDue = shouldRequestAssuranceTaskApproval({
      status: built.issue.status,
      humanAcceptanceRequired: built.humanAcceptanceRequired,
    });
    const obsoleteOpenApprovalIds = built.assuranceApprovals
      .filter((row) =>
        ["pending", "revision_requested"].includes(row.status)
        && (!humanAcceptanceDue || !approvalMatches(row.payload, validation!.id, built.inputDigest))
      )
      .map((row) => row.id);
    if (obsoleteOpenApprovalIds.length > 0) {
      const now = new Date();
      await tx.update(approvals).set({
        status: "cancelled",
        decisionNote: humanAcceptanceDue
          ? "Superseded by a newer Assurance task snapshot."
          : "Assurance approval is only requested after the task is done.",
        decidedAt: now,
        updatedAt: now,
      }).where(inArray(approvals.id, obsoleteOpenApprovalIds));
    }

    let exactApproval = built.assuranceApprovals.find((row) =>
      row.status !== "cancelled" && approvalMatches(row.payload, validation!.id, built.inputDigest)
    ) ?? null;
    if (humanAcceptanceDue && !exactApproval) {
      const [createdApproval] = await tx.insert(approvals).values({
        companyId: input.companyId,
        type: "assurance_task_validation",
        requestedByAgentId: input.actor.type === "agent" ? input.actor.agentId ?? input.actor.id : null,
        requestedByUserId: input.actor.type === "user" ? input.actor.id : null,
        status: "pending",
        payload: {
          taskValidationId: validation.id,
          issueId: input.issueId,
          inputDigest: built.inputDigest,
          policyVersion: ASSURANCE_POLICY_VERSION,
          statement: "Approve the completed task delivery and its exact Assurance evidence.",
        },
      }).returning();
      if (!createdApproval) throw new Error("assurance_approval_not_persisted");
      await tx.insert(issueApprovals).values({
        companyId: input.companyId,
        issueId: input.issueId,
        approvalId: createdApproval.id,
        linkedByAgentId: input.actor.type === "agent" ? input.actor.agentId ?? input.actor.id : null,
        linkedByUserId: input.actor.type === "user" ? input.actor.id : null,
      });
      exactApproval = createdApproval;
    }
    const humanAccepted = !humanAcceptanceDue || exactApproval?.status === "approved";
    checks.push({
      key: "human_acceptance",
      label: "Required human accepted this exact digest",
      state: humanAcceptanceDue ? humanAccepted ? "passed" : "missing" : "not_applicable",
      detail: humanAcceptanceDue ? `Input digest ${built.inputDigest}` : null,
    });
    const blocking = checks.some((check) => check.state === "failed" || check.state === "missing");
    const state: AssuranceTaskValidationState = checks.some((check) => check.state === "failed")
      ? "rejected"
      : blocking ? "incomplete" : "valid";
    const [updated] = await tx.update(assuranceTaskValidations).set({
      state,
      checksJson: { checks },
      totalsJson: built.totals as unknown as Record<string, unknown>,
      validatedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(assuranceTaskValidations.id, validation.id)).returning();
    return updated ?? validation;
  });
}

export async function markAssuranceTaskStale(db: Db, companyId: string, issueIds: string[]) {
  if (!issueIds.length) return 0;
  const rows = await db.update(assuranceTaskValidations).set({ state: "stale", updatedAt: new Date() }).where(and(
    eq(assuranceTaskValidations.companyId, companyId),
    inArray(assuranceTaskValidations.issueId, issueIds),
    inArray(assuranceTaskValidations.state, ["pending", "valid", "incomplete", "rejected"]),
  )).returning({ id: assuranceTaskValidations.id });
  return rows.length;
}
