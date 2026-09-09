import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assuranceRunRecords } from "@paperclipai/db";
import { buildAssuranceRunSnapshot } from "./snapshot-builder.js";

export async function reconcileAssuranceRunRecord(input: { db: Db; companyId: string; runId: string }) {
  const built = await buildAssuranceRunSnapshot(input);
  const existing = await input.db.select().from(assuranceRunRecords).where(and(
    eq(assuranceRunRecords.companyId, input.companyId),
    eq(assuranceRunRecords.runId, input.runId),
    eq(assuranceRunRecords.sourceDigest, built.sourceDigest),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (existing) return existing;
  const prior = await input.db.select().from(assuranceRunRecords).where(and(
    eq(assuranceRunRecords.companyId, input.companyId),
    eq(assuranceRunRecords.runId, input.runId),
  )).orderBy(desc(assuranceRunRecords.capturedAt)).limit(1).then((rows) => rows[0] ?? null);
  const now = new Date();
  const [row] = await input.db.insert(assuranceRunRecords).values({
    companyId: input.companyId,
    runId: input.runId,
    issueId: built.issueId,
    status: built.status,
    sourceDigest: built.sourceDigest,
    snapshotJson: built.snapshot,
    snapshotSha256: built.snapshotSha256,
    costCompleteness: built.costCompleteness,
    capturedAt: now,
    finalizedAt: built.status === "finalized" ? now : null,
    supersedesRecordId: prior?.id ?? null,
  }).returning();
  if (!row) throw new Error("assurance_run_record_not_persisted");
  return row;
}
