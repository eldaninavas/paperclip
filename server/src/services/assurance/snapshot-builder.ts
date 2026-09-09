import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  assets,
  completionContracts,
  heartbeatRunEvents,
  heartbeatRuns,
  issueApprovals,
  issueAttachments,
  issueWorkProducts,
  issues,
  nativeRunFinalizations,
  nativeRunResults,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import { ASSURANCE_POLICY_VERSION } from "@paperclipai/shared";
import { reconcileAssuranceCosts } from "./cost-reconciler.js";
import { assuranceSha256 } from "./hasher.js";

const TERMINAL_RUN_STATES = ["succeeded", "failed", "cancelled", "timed_out"];

function issueIdFromRun(run: typeof heartbeatRuns.$inferSelect): string | null {
  if (run.nativeIssueId) return run.nativeIssueId;
  const context = run.contextSnapshot ?? {};
  for (const key of ["issueId", "taskId"]) {
    const value = context[key];
    if (typeof value === "string") return value;
  }
  return null;
}

export async function buildAssuranceRunSnapshot(input: { db: Db; companyId: string; runId: string }) {
  const run = await input.db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.companyId, input.companyId),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!run) throw new Error("assurance_run_not_found");
  if (!TERMINAL_RUN_STATES.includes(run.status)) throw new Error("assurance_run_not_terminal");
  const issueId = issueIdFromRun(run);
  const [events, result, finalization, costs] = await Promise.all([
    input.db.select({
      id: heartbeatRunEvents.id,
      seq: heartbeatRunEvents.seq,
      sourceSeq: heartbeatRunEvents.sourceSeq,
      eventType: heartbeatRunEvents.eventType,
        payloadSha256: heartbeatRunEvents.sourcePayloadSha256,
      createdAt: heartbeatRunEvents.createdAt,
    }).from(heartbeatRunEvents).where(and(
      eq(heartbeatRunEvents.companyId, input.companyId),
      eq(heartbeatRunEvents.runId, input.runId),
    )).orderBy(heartbeatRunEvents.seq),
    input.db.select().from(nativeRunResults).where(and(
      eq(nativeRunResults.companyId, input.companyId),
      eq(nativeRunResults.runId, input.runId),
    )).orderBy(desc(nativeRunResults.createdAt)).limit(1).then((rows) => rows[0] ?? null),
    input.db.select().from(nativeRunFinalizations).where(and(
      eq(nativeRunFinalizations.companyId, input.companyId),
      eq(nativeRunFinalizations.runId, input.runId),
    )).limit(1).then((rows) => rows[0] ?? null),
    reconcileAssuranceCosts({
      db: input.db,
      companyId: input.companyId,
      issueId: issueId ?? undefined,
      runIds: [input.runId],
      usageByRun: [{ runId: run.id, usage: run.usageJson }],
    }),
  ]);
  const snapshot = {
    schemaVersion: "foundation.assurance-run-record.v1",
    run: {
      id: run.id,
      issueId,
      agentId: run.agentId,
      responsibleUserId: run.responsibleUserId,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      runtimeMode: run.runtimeMode,
      driverKind: run.driverKind,
      driverVersion: run.driverVersion,
      completionContractId: run.completionContractId,
      completionContractSha256: run.completionContractSha256,
      sessionIdBefore: run.sessionIdBefore,
      sessionIdAfter: run.sessionIdAfter,
      logRef: run.logRef,
      logBytes: run.logBytes,
      logSha256: run.logSha256,
      livenessState: run.livenessState,
      livenessReason: run.livenessReason,
    },
    eventChain: events.map((event) => ({
      id: event.id,
      seq: event.seq,
      sourceSeq: event.sourceSeq,
      eventType: event.eventType,
      payloadSha256: event.payloadSha256,
      createdAt: event.createdAt.toISOString(),
    })),
    nativeResult: result ? {
      id: result.id,
      schemaStatus: result.schemaStatus,
      canonicalSha256: result.canonicalSha256,
    } : null,
    nativeFinalization: finalization ? {
      phase: finalization.phase,
      resultId: finalization.resultId,
      assessmentId: finalization.assessmentId,
      decisionId: finalization.decisionId,
      failureCode: finalization.failureCode,
    } : null,
    consumption: { completeness: costs.totals.costCompleteness, events: costs.events, totals: costs.totals },
  };
  return {
    issueId,
    snapshot,
    sourceDigest: assuranceSha256({ runUpdatedAt: run.updatedAt, snapshot }),
    snapshotSha256: assuranceSha256(snapshot),
    costCompleteness: costs.totals.costCompleteness,
    status: finalization?.phase === "committed" && costs.totals.costCompleteness === "reported"
      ? "finalized" as const
      : finalization?.failureCode || !result
        ? "incomplete" as const
        : "provisional" as const,
  };
}

export async function buildAssuranceTaskSnapshot(input: { db: Db; companyId: string; issueId: string }) {
  const issue = await input.db.select().from(issues).where(and(
    eq(issues.id, input.issueId),
    eq(issues.companyId, input.companyId),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!issue) throw new Error("assurance_issue_not_found");

  const runs = (await input.db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId),
    inArray(heartbeatRuns.status, TERMINAL_RUN_STATES),
    or(
      eq(heartbeatRuns.nativeIssueId, input.issueId),
      sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${input.issueId}`,
      sql`${heartbeatRuns.contextSnapshot} ->> 'taskId' = ${input.issueId}`,
    ),
  ))).filter((run) => issueIdFromRun(run) === input.issueId);
  const runIds = runs.map((run) => run.id);

  const [contracts, assessments, decisions, products, attachmentRows, approvalRows, costs] = await Promise.all([
    input.db.select().from(completionContracts).where(and(
      eq(completionContracts.companyId, input.companyId),
      eq(completionContracts.issueId, input.issueId),
    )).orderBy(completionContracts.revision),
    input.db.select().from(workAssessments).where(and(
      eq(workAssessments.companyId, input.companyId),
      eq(workAssessments.issueId, input.issueId),
    )).orderBy(workAssessments.createdAt),
    input.db.select().from(statusDecisions).where(and(
      eq(statusDecisions.companyId, input.companyId),
      eq(statusDecisions.issueId, input.issueId),
    )).orderBy(statusDecisions.decisionVersion),
    input.db.select().from(issueWorkProducts).where(and(
      eq(issueWorkProducts.companyId, input.companyId),
      eq(issueWorkProducts.issueId, input.issueId),
    )),
    input.db.select({
      id: issueAttachments.id,
      assetId: assets.id,
      sha256: assets.sha256,
      contentType: assets.contentType,
      byteSize: assets.byteSize,
      originalFilename: assets.originalFilename,
    }).from(issueAttachments).innerJoin(assets, and(
      eq(issueAttachments.assetId, assets.id),
      eq(issueAttachments.companyId, assets.companyId),
    )).where(and(
      eq(issueAttachments.companyId, input.companyId),
      eq(issueAttachments.issueId, input.issueId),
    )),
    input.db.select({
      id: approvals.id,
      type: approvals.type,
      status: approvals.status,
      payload: approvals.payload,
      decidedByUserId: approvals.decidedByUserId,
      decidedAt: approvals.decidedAt,
    }).from(issueApprovals).innerJoin(approvals, and(
      eq(issueApprovals.approvalId, approvals.id),
      eq(issueApprovals.companyId, approvals.companyId),
    )).where(and(
      eq(issueApprovals.companyId, input.companyId),
      eq(issueApprovals.issueId, input.issueId),
    )),
    reconcileAssuranceCosts({
      db: input.db,
      companyId: input.companyId,
      issueId: input.issueId,
      runIds,
      usageByRun: runs.map((run) => ({ runId: run.id, usage: run.usageJson })),
    }),
  ]);

  const humanAcceptanceRequired = issue.reviewPolicy === "human_only" || issue.reviewPolicy === "not_creator";
  const evidenceApprovals = approvalRows.filter((row) => row.type !== "assurance_task_validation");
  costs.totals.deliverables = products.length + attachmentRows.length;
  // The approval that accepts an Assurance digest is a decision *about* the
  // snapshot, not evidence that may participate in that snapshot. Including
  // it here makes approval self-invalidating because each request changes the
  // digest it is meant to approve.
  costs.totals.approvals = evidenceApprovals.length;
  const snapshot = {
    schemaVersion: "foundation.assurance-task-snapshot.v1",
    policyVersion: ASSURANCE_POLICY_VERSION,
    task: {
      id: issue.id,
      projectId: issue.projectId,
      parentId: issue.parentId,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      statusVersion: issue.statusVersion,
      lastStatusDecisionId: issue.lastStatusDecisionId,
      reviewPolicy: issue.reviewPolicy,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      responsibleUserId: issue.responsibleUserId,
      billingCode: issue.billingCode,
      executionRunId: issue.executionRunId,
      sourceTrust: issue.sourceTrust,
      startedAt: issue.startedAt?.toISOString() ?? null,
      completedAt: issue.completedAt?.toISOString() ?? null,
      cancelledAt: issue.cancelledAt?.toISOString() ?? null,
      updatedAt: issue.updatedAt.toISOString(),
    },
    completionContracts: contracts.map((row) => ({
      id: row.id,
      revision: row.revision,
      schemaVersion: row.schemaVersion,
      policyVersion: row.policyVersion,
      canonicalSha256: row.canonicalSha256,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      runtimeMode: run.runtimeMode,
      completionContractId: run.completionContractId,
      completionContractSha256: run.completionContractSha256,
      logSha256: run.logSha256,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    })),
    assessments: assessments.map((row) => ({ id: row.id, runId: row.runId, inputDigest: row.inputDigest, policyVersion: row.policyVersion })),
    statusDecisions: decisions.map((row) => ({ id: row.id, runId: row.runId, decisionDigest: row.decisionDigest, toStatus: row.toStatus, applicationState: row.applicationState })),
    consumption: { events: costs.events, totals: costs.totals },
    deliverables: {
      workProducts: products.map((row) => ({
        id: row.id,
        type: row.type,
        provider: row.provider,
        externalId: row.externalId,
        title: row.title,
        url: row.url,
        status: row.status,
        reviewState: row.reviewState,
        assetSha256: typeof row.metadata?.sha256 === "string" ? row.metadata.sha256 : null,
        preserved: row.provider === "paperclip",
      })),
      attachments: attachmentRows,
    },
    approvalRequirement: { humanAcceptanceRequired, policy: issue.reviewPolicy ?? "anyone" },
    approvals: evidenceApprovals
      .map((row) => ({ id: row.id, type: row.type, status: row.status, decidedAt: row.decidedAt?.toISOString() ?? null })),
  };
  return {
    issue,
    snapshot,
    inputDigest: assuranceSha256(snapshot),
    snapshotSha256: assuranceSha256(snapshot),
    totals: costs.totals,
    humanAcceptanceRequired,
    assuranceApprovals: approvalRows.filter((row) => row.type === "assurance_task_validation"),
  };
}
